-- Instagram dispatcher queue (pgmq + pg_cron).
--
-- Design: pgmq owns enqueue + lease; social_post_targets remains the source of
-- truth for status. Consumers MUST re-check status = 'scheduled' after
-- pgmq.read() and archive (never publish) stale messages. The message payload
-- is hints only; the database is authoritative.
--
-- App access goes ONLY through the SECURITY DEFINER wrappers below (granted to
-- service_role). Nothing app-side touches schema pgmq or the queue tables
-- directly.
--
-- Drain triggering is DB-native (pg_cron + pg_net), independent of Vercel cron
-- plan limits (repo convention per README: Vercel schedule is daily, higher
-- frequency comes from an external scheduler). To enable the HTTP drain
-- trigger, insert one row:
--   INSERT INTO public.instagram_dispatcher_config (id, app_url, cron_secret)
--   VALUES (1, 'https://app.example.com', '<CRON_SECRET>');
-- Until then the trigger is a no-op and the route can be called manually.
-- NOTE: cron_secret must match the app's CRON_SECRET and be at least 16 chars.
-- NOTE: the expression index below lives on pgmq's internal q_ table; if the
-- queue is ever dropped/re-created, the index must be re-created with it.

CREATE EXTENSION IF NOT EXISTS pgmq;
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pgmq.list_queues() WHERE queue_name = 'instagram_publish'
  ) THEN
    PERFORM pgmq.create('instagram_publish');
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS instagram_publish_target_idx
  ON pgmq.q_instagram_publish ((message->>'targetId'));

-- Generic social dispatch wrappers (one queue per provider; Instagram is the
-- first binding, see instagram-dispatcher.ts). Queue and provider names are
-- validated against strict patterns before dynamic use. Adding a provider
-- means: pgmq.create('<name>'), the expression index below on its q_ table,
-- and a widening of the provider CHECK constraints on social_post_targets /
-- social_delivery_events (today instagram-only).

-- Drop the pre-generalization Instagram-only wrappers (unmerged history).
DROP FUNCTION IF EXISTS public.enqueue_due_instagram_targets(integer);
DROP FUNCTION IF EXISTS public.read_instagram_dispatch_messages(integer, integer);
DROP FUNCTION IF EXISTS public.load_instagram_dispatch_target(uuid, uuid);
DROP FUNCTION IF EXISTS public.load_latest_instagram_publish_attempt(uuid, uuid);
DROP FUNCTION IF EXISTS public.archive_instagram_dispatch_message(bigint);
DROP FUNCTION IF EXISTS public.reschedule_instagram_dispatch_message(bigint, integer);

-- Enqueues due, still-scheduled targets for one provider queue. Idempotent:
-- skips targets with a live queued message and targets already at a terminal
-- delivery outcome (publish.succeeded / publish.uncertain / non-retryable
-- publish.failed), so terminal archives stick and never re-enqueue.
CREATE OR REPLACE FUNCTION public.enqueue_due_social_targets(
  p_queue_name text,
  p_provider text,
  p_batch integer DEFAULT 50
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pgmq
AS $$
DECLARE
  enqueued integer := 0;
  target record;
  queue_table text;
BEGIN
  IF p_queue_name IS NULL OR p_queue_name !~ '^[a-z][a-z0-9_]{1,47}$' THEN
    RAISE EXCEPTION 'dispatch_queue_invalid';
  END IF;
  IF p_provider IS NULL OR p_provider !~ '^[a-z][a-z0-9_-]{1,63}$' THEN
    RAISE EXCEPTION 'dispatch_provider_invalid';
  END IF;
  IF p_batch IS NULL OR p_batch < 1 OR p_batch > 500 THEN
    RAISE EXCEPTION 'enqueue_batch_out_of_range';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('enqueue-' || p_queue_name));
  queue_table := 'q_' || p_queue_name;

  FOR target IN EXECUTE format(
    'SELECT team_id, id, calendar_post_id, publish_at'
    ' FROM social_post_targets'
    ' WHERE status = ''scheduled'''
    ' AND provider = $1'
    ' AND publish_at <= now()'
    ' AND NOT EXISTS ('
    '   SELECT 1 FROM pgmq.%I AS queued'
    '   WHERE queued.message->>''targetId'' = social_post_targets.id::text'
    ' )'
    ' AND NOT EXISTS ('
    '   SELECT 1 FROM social_delivery_events AS event'
    '   WHERE event.team_id = social_post_targets.team_id'
    '   AND event.target_id = social_post_targets.id'
    '   AND ('
    '     event.event_type IN (''publish.succeeded'', ''publish.uncertain'')'
    '     OR ('
    '       event.event_type = ''publish.failed'''
    '       AND (event.event_contract->''data''->>''retryable'')::boolean IS FALSE'
    '     )'
    '   )'
    ' )'
    ' ORDER BY publish_at, id'
    ' LIMIT $2',
    queue_table
  ) USING p_provider, p_batch
  LOOP
    PERFORM pgmq.send(
      p_queue_name,
      jsonb_build_object(
        'teamId', target.team_id,
        'targetId', target.id,
        'calendarPostId', target.calendar_post_id,
        'publishAt', target.publish_at
      )
    );
    enqueued := enqueued + 1;
  END LOOP;

  RETURN enqueued;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_due_social_targets(text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enqueue_due_social_targets(text, text, integer) TO service_role;

-- Lease-aware read for the app consumer. Returns live messages only.
CREATE OR REPLACE FUNCTION public.read_social_dispatch_messages(
  p_queue_name text,
  p_visibility_timeout integer DEFAULT 60,
  p_batch integer DEFAULT 25
)
RETURNS TABLE (
  msg_id bigint,
  read_ct integer,
  message jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pgmq
AS $$
BEGIN
  IF p_queue_name IS NULL OR p_queue_name !~ '^[a-z][a-z0-9_]{1,47}$' THEN
    RAISE EXCEPTION 'dispatch_queue_invalid';
  END IF;
  IF p_visibility_timeout IS NULL
    OR p_visibility_timeout < 10
    OR p_visibility_timeout > 3600 THEN
    RAISE EXCEPTION 'dispatch_visibility_timeout_out_of_range';
  END IF;
  IF p_batch IS NULL OR p_batch < 1 OR p_batch > 100 THEN
    RAISE EXCEPTION 'dispatch_batch_out_of_range';
  END IF;
  RETURN QUERY EXECUTE format(
    'SELECT queued.msg_id, queued.read_ct, queued.message'
    ' FROM pgmq.read(%L, $1, $2) AS queued',
    p_queue_name
  ) USING p_visibility_timeout, p_batch;
END;
$$;

REVOKE ALL ON FUNCTION public.read_social_dispatch_messages(text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.read_social_dispatch_messages(text, integer, integer) TO service_role;

-- Status + publish-readiness gate for one target. connection_ok is false when
-- the connection is missing, not connected, disabled, or team controls are off.
-- contract_version is the provider's version field (Instagram: template_version).
CREATE OR REPLACE FUNCTION public.load_social_dispatch_target(
  p_team_id uuid,
  p_target_id uuid
)
RETURNS TABLE (
  status text,
  publish_at timestamp with time zone,
  contract_version integer,
  connection_ok boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
    SELECT target.status,
      target.publish_at,
      target.template_version,
      (
        connection.status = 'connected'
        AND connection.enabled
        AND coalesce(controls.enabled, true)
      )
    FROM social_post_targets AS target
    LEFT JOIN integration_connections AS connection
      ON connection.team_id = target.team_id
      AND connection.id = target.connection_id
    LEFT JOIN integration_team_controls AS controls
      ON controls.team_id = target.team_id
    WHERE target.team_id = p_team_id
      AND target.id = p_target_id;
END;
$$;

REVOKE ALL ON FUNCTION public.load_social_dispatch_target(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.load_social_dispatch_target(uuid, uuid) TO service_role;

-- Latest publish-stream position for one target, for conflict healing.
-- terminal is true once the stream reached publish.succeeded, publish.uncertain,
-- or a non-retryable publish.failed.
CREATE OR REPLACE FUNCTION public.load_latest_social_publish_attempt(
  p_team_id uuid,
  p_target_id uuid,
  p_provider text
)
RETURNS TABLE (
  attempt_id text,
  terminal boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_provider IS NULL OR p_provider !~ '^[a-z][a-z0-9_-]{1,63}$' THEN
    RAISE EXCEPTION 'dispatch_provider_invalid';
  END IF;
  RETURN QUERY
    SELECT event.event_contract->'data'->>'attemptId',
      (
        event.event_type IN ('publish.succeeded', 'publish.uncertain')
        OR (
          event.event_type = 'publish.failed'
          AND (event.event_contract->'data'->>'retryable')::boolean IS FALSE
        )
      )
    FROM social_delivery_events AS event
    WHERE event.team_id = p_team_id
      AND event.target_id = p_target_id
      AND event.provider = p_provider
      AND event.event_type LIKE 'publish.%'
    ORDER BY event.sequence DESC
    LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.load_latest_social_publish_attempt(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.load_latest_social_publish_attempt(uuid, uuid, text) TO service_role;

-- Archive a queued dispatch message (terminal outcome or stale target).
-- Returns false when the message is already gone (handled elsewhere).
CREATE OR REPLACE FUNCTION public.archive_social_dispatch_message(
  p_queue_name text,
  p_msg_id bigint
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pgmq
AS $$
DECLARE
  archived bigint[];
BEGIN
  IF p_queue_name IS NULL OR p_queue_name !~ '^[a-z][a-z0-9_]{1,47}$' THEN
    RAISE EXCEPTION 'dispatch_queue_invalid';
  END IF;
  IF p_msg_id IS NULL OR p_msg_id < 1 THEN
    RAISE EXCEPTION 'dispatch_message_invalid';
  END IF;
  EXECUTE format(
    'SELECT ARRAY_AGG(result) FROM pgmq.archive(%L, ARRAY[$1]) AS result',
    p_queue_name
  ) INTO archived USING p_msg_id;
  RETURN coalesce(array_length(archived, 1), 0) = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.archive_social_dispatch_message(text, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.archive_social_dispatch_message(text, bigint) TO service_role;

-- Re-schedule a queued dispatch message (retry with backoff / not due yet).
-- Returns false when the message is already gone (handled elsewhere).
CREATE OR REPLACE FUNCTION public.reschedule_social_dispatch_message(
  p_queue_name text,
  p_msg_id bigint,
  p_delay_seconds integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pgmq
AS $$
DECLARE
  updated integer := 0;
BEGIN
  IF p_queue_name IS NULL OR p_queue_name !~ '^[a-z][a-z0-9_]{1,47}$' THEN
    RAISE EXCEPTION 'dispatch_queue_invalid';
  END IF;
  IF p_msg_id IS NULL OR p_msg_id < 1 THEN
    RAISE EXCEPTION 'dispatch_message_invalid';
  END IF;
  IF p_delay_seconds IS NULL OR p_delay_seconds < 1 OR p_delay_seconds > 86400 THEN
    RAISE EXCEPTION 'dispatch_delay_out_of_range';
  END IF;
  EXECUTE format(
    'SELECT count(*) FROM pgmq.set_vt(%L, $1, $2)',
    p_queue_name
  ) INTO updated USING p_msg_id, p_delay_seconds;
  RETURN updated = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.reschedule_social_dispatch_message(text, bigint, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reschedule_social_dispatch_message(text, bigint, integer) TO service_role;

-- Drain trigger configuration (single row; absent/NULL row = trigger disabled).
CREATE TABLE IF NOT EXISTS public.instagram_dispatcher_config (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  app_url text CHECK (
    app_url IS NULL OR app_url ~ '^https://[A-Za-z0-9.-]+(:[0-9]+)?/?$|^http://(localhost|127\.0\.0\.1)(:[0-9]+)?/?$'
  ),
  cron_secret text CHECK (cron_secret IS NULL OR char_length(cron_secret) BETWEEN 16 AND 256),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.instagram_dispatcher_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.instagram_dispatcher_config FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.instagram_dispatcher_config TO service_role;

-- Calls the Next.js drain route over HTTP. No-op unless configured.
CREATE OR REPLACE FUNCTION public.trigger_instagram_dispatch_drain()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, net
AS $$
DECLARE
  config record;
BEGIN
  SELECT app_url, cron_secret INTO config
  FROM public.instagram_dispatcher_config
  WHERE id = 1;
  IF config.app_url IS NULL OR config.cron_secret IS NULL THEN
    RETURN;
  END IF;
  PERFORM net.http_get(
    rtrim(config.app_url, '/') || '/api/internal/instagram-dispatcher',
    '{}'::jsonb,
    jsonb_build_object('Authorization', 'Bearer ' || config.cron_secret),
    10000
  );
END;
$$;

REVOKE ALL ON FUNCTION public.trigger_instagram_dispatch_drain() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.trigger_instagram_dispatch_drain() TO service_role;

-- Tickers. Re-created idempotently.
DO $cron_setup$
DECLARE
  existing_job bigint;
BEGIN
  FOR existing_job IN
    SELECT job.jobid
    FROM cron.job AS job
    WHERE job.jobname IN (
      'enqueue-due-instagram-targets',
      'trigger-instagram-dispatch-drain',
      'purge-instagram-dispatch-archive'
    )
  LOOP
    PERFORM cron.unschedule(existing_job);
  END LOOP;
  PERFORM cron.schedule(
    'enqueue-due-instagram-targets',
    '* * * * *',
    $cron_body$SELECT public.enqueue_due_social_targets('instagram_publish', 'instagram', 50);$cron_body$
  );
  PERFORM cron.schedule(
    'trigger-instagram-dispatch-drain',
    '*/5 * * * *',
    $cron_body$SELECT public.trigger_instagram_dispatch_drain();$cron_body$
  );
  PERFORM cron.schedule(
    'purge-instagram-dispatch-archive',
    '0 4 * * 0',
    $cron_body$DELETE FROM pgmq.a_instagram_publish WHERE archived_at < now() - interval '30 days';$cron_body$
  );
END;
$cron_setup$;
