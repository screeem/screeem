-- Instagram dispatcher queue (pgmq + pg_cron).
--
-- The dispatcher owns enqueue + lease via pgmq; social_post_targets remains the
-- source of truth for status. Consumers must re-check status = 'scheduled'
-- after pgmq.read() and archive (never publish) stale messages.

CREATE EXTENSION IF NOT EXISTS pgmq;
CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pgmq.list_queues() WHERE queue_name = 'instagram_publish'
  ) THEN
    PERFORM pgmq.create('instagram_publish');
  END IF;
END;
$$;

-- Enqueues due, still-scheduled Instagram targets. Idempotent: skips targets
-- that already have a live (unarchived) queued message.
CREATE OR REPLACE FUNCTION public.enqueue_due_instagram_targets(
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
BEGIN
  IF p_batch IS NULL OR p_batch < 1 OR p_batch > 500 THEN
    RAISE EXCEPTION 'enqueue_batch_out_of_range';
  END IF;

  FOR target IN
    SELECT team_id, id, calendar_post_id, publish_at
    FROM social_post_targets
    WHERE status = 'scheduled'
      AND provider = 'instagram'
      AND publish_at <= now()
      AND NOT EXISTS (
        SELECT 1
        FROM pgmq.q_instagram_publish AS queued
        WHERE queued.message->>'targetId' = social_post_targets.id::text
      )
    ORDER BY publish_at, id
    LIMIT p_batch
  LOOP
    PERFORM pgmq.send(
      'instagram_publish',
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

REVOKE ALL ON FUNCTION public.enqueue_due_instagram_targets(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enqueue_due_instagram_targets(integer) TO service_role;

-- Archive a queued dispatch message (terminal outcome or stale target).
CREATE OR REPLACE FUNCTION public.archive_instagram_dispatch_message(
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
  IF p_msg_id IS NULL OR p_msg_id < 1 THEN
    RAISE EXCEPTION 'dispatch_message_invalid';
  END IF;
  SELECT ARRAY_AGG(result) INTO archived
  FROM pgmq.archive('instagram_publish', ARRAY[p_msg_id]) AS result;
  RETURN coalesce(array_length(archived, 1), 0) = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.archive_instagram_dispatch_message(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.archive_instagram_dispatch_message(bigint) TO service_role;

-- Re-schedule a queued dispatch message (retry with backoff / not due yet).
CREATE OR REPLACE FUNCTION public.reschedule_instagram_dispatch_message(
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
  IF p_msg_id IS NULL OR p_msg_id < 1 THEN
    RAISE EXCEPTION 'dispatch_message_invalid';
  END IF;
  IF p_delay_seconds IS NULL OR p_delay_seconds < 0 OR p_delay_seconds > 86400 THEN
    RAISE EXCEPTION 'dispatch_delay_out_of_range';
  END IF;
  SELECT count(*) INTO updated
  FROM pgmq.set_vt('instagram_publish', p_msg_id, p_delay_seconds);
  RETURN updated = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.reschedule_instagram_dispatch_message(bigint, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reschedule_instagram_dispatch_message(bigint, integer) TO service_role;

-- Ticker: enqueue due targets every minute. Re-created idempotently.
DO $cron_setup$
DECLARE
  existing_job bigint;
BEGIN
  SELECT job.jobid INTO existing_job
  FROM cron.job AS job
  WHERE job.jobname = 'enqueue-due-instagram-targets';
  IF existing_job IS NOT NULL THEN
    PERFORM cron.unschedule(existing_job);
  END IF;
  PERFORM cron.schedule(
    'enqueue-due-instagram-targets',
    '* * * * *',
    $cron_body$SELECT public.enqueue_due_instagram_targets(50);$cron_body$
  );
END;
$cron_setup$;
