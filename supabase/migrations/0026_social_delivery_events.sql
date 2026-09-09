ALTER TABLE social_post_targets
  ADD COLUMN transition_event_id uuid,
  ADD COLUMN transitioned_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT;

CREATE TABLE social_delivery_events (
  team_id uuid NOT NULL,
  target_id uuid NOT NULL,
  sequence bigint NOT NULL CHECK (sequence > 0),
  event_id uuid NOT NULL,
  provider text NOT NULL CHECK (provider = 'instagram'),
  event_type text NOT NULL CHECK (event_type IN (
    'target.scheduled',
    'target.cancelled',
    'target.superseded',
    'publish.started',
    'publish.progressed',
    'publish.resumed',
    'publish.succeeded',
    'publish.failed',
    'publish.uncertain',
    'remote-delete.requested',
    'remote-delete.succeeded',
    'remote-delete.failed'
  )),
  schema_version integer NOT NULL CHECK (schema_version = 1),
  event_contract jsonb NOT NULL,
  actor_kind text NOT NULL CHECK (actor_kind IN ('system', 'user')),
  actor_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  system_source text CHECK (
    system_source IS NULL OR system_source IN ('database', 'dispatcher', 'scheduler')
  ),
  occurred_at timestamp with time zone NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, target_id, sequence),
  CONSTRAINT social_delivery_events_team_event_key UNIQUE (team_id, event_id),
  CONSTRAINT social_delivery_events_target_event_key
    UNIQUE (team_id, target_id, event_id),
  CONSTRAINT social_delivery_events_target_fkey
    FOREIGN KEY (team_id, target_id)
    REFERENCES social_post_targets (team_id, id)
    ON DELETE CASCADE,
  CONSTRAINT social_delivery_events_actor_check CHECK (
    (actor_kind = 'user' AND actor_id IS NOT NULL AND system_source IS NULL)
    OR (actor_kind = 'system' AND actor_id IS NULL AND system_source IS NOT NULL)
  ),
  CONSTRAINT social_delivery_events_contract_check CHECK (
    (jsonb_typeof(event_contract) = 'object'
    AND pg_column_size(event_contract) <= 65536
    AND event_contract->>'schema' = 'screeem.social-delivery-event'
    AND event_contract @> '{"schemaVersion": 1}'::jsonb
    AND event_contract->>'id' = event_id::text
    AND event_contract->>'teamId' = team_id::text
    AND event_contract->>'targetId' = target_id::text
    AND event_contract->>'provider' = provider
    AND event_contract->>'sequence' = sequence::text
    AND event_contract->>'eventType' = event_type
    AND jsonb_typeof(event_contract->'data') = 'object'
    AND (event_contract->>'occurredAt')::timestamp with time zone = occurred_at
    AND (
      (actor_kind = 'user'
        AND event_contract->'actor'->>'kind' = 'user'
        AND event_contract->'actor'->>'userId' = actor_id::text)
      OR (actor_kind = 'system'
        AND event_contract->'actor'->>'kind' = 'system'
        AND event_contract->'actor'->>'source' = system_source)
    )) IS TRUE
  )
);

CREATE INDEX social_delivery_events_team_created_idx
  ON social_delivery_events (team_id, created_at DESC);

CREATE INDEX social_delivery_events_target_occurred_idx
  ON social_delivery_events (team_id, target_id, occurred_at, sequence);

CREATE TABLE social_delivery_receipts (
  team_id uuid NOT NULL,
  target_id uuid NOT NULL,
  event_id uuid NOT NULL,
  attempt_id uuid NOT NULL,
  revision bigint NOT NULL CHECK (revision > 0),
  key_id text NOT NULL CHECK (key_id ~ '^[A-Za-z0-9._-]{1,128}$'),
  sealed_payload text NOT NULL CHECK (
    octet_length(sealed_payload) BETWEEN 1 AND 131072
    AND sealed_payload ~ '^v[0-9]+\.[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$'
  ),
  updated_at timestamp with time zone NOT NULL,
  PRIMARY KEY (team_id, target_id, attempt_id, revision),
  CONSTRAINT social_delivery_receipts_team_event_key UNIQUE (team_id, event_id),
  CONSTRAINT social_delivery_receipts_target_fkey
    FOREIGN KEY (team_id, target_id)
    REFERENCES social_post_targets (team_id, id)
    ON DELETE CASCADE,
  CONSTRAINT social_delivery_receipts_event_fkey
    FOREIGN KEY (team_id, target_id, event_id)
    REFERENCES social_delivery_events (team_id, target_id, event_id)
    ON DELETE CASCADE
);

CREATE INDEX social_delivery_receipts_latest_idx
  ON social_delivery_receipts (team_id, target_id, updated_at DESC, revision DESC);

INSERT INTO social_delivery_events (
  team_id, target_id, sequence, event_id, provider, event_type,
  schema_version, event_contract, actor_kind, actor_id, occurred_at, created_at
)
SELECT
  target.team_id,
  target.id,
  1,
  target.request_id,
  target.provider,
  'target.scheduled',
  1,
  jsonb_build_object(
    'schema', 'screeem.social-delivery-event',
    'schemaVersion', 1,
    'id', target.request_id,
    'teamId', target.team_id,
    'targetId', target.id,
    'provider', target.provider,
    'sequence', 1,
    'actor', jsonb_build_object('kind', 'user', 'userId', target.created_by),
    'occurredAt', target.created_at,
    'eventType', 'target.scheduled',
    'data', jsonb_build_object(
      'calendarRevision', target.calendar_revision,
      'connectionId', target.connection_id,
      'externalAccountId', target.external_account_id,
      'publishAt', target.publish_at
    )
  ),
  'user',
  target.created_by,
  target.created_at,
  target.created_at
FROM social_post_targets AS target;

WITH terminal_targets AS MATERIALIZED (
  SELECT target.*, gen_random_uuid() AS delivery_event_id
  FROM social_post_targets AS target
  WHERE target.status IN ('superseded', 'cancelled')
)
INSERT INTO social_delivery_events (
  team_id, target_id, sequence, event_id, provider, event_type,
  schema_version, event_contract, actor_kind, system_source, occurred_at, created_at
)
SELECT
  target.team_id,
  target.id,
  2,
  target.delivery_event_id,
  target.provider,
  'target.' || target.status,
  1,
  jsonb_build_object(
    'schema', 'screeem.social-delivery-event',
    'schemaVersion', 1,
    'id', target.delivery_event_id,
    'teamId', target.team_id,
    'targetId', target.id,
    'provider', target.provider,
    'sequence', 2,
    'actor', jsonb_build_object('kind', 'system', 'source', 'database'),
    'occurredAt', COALESCE(target.superseded_at, target.cancelled_at),
    'eventType', 'target.' || target.status,
    'data', jsonb_build_object(
      'reason', CASE target.status
        WHEN 'superseded' THEN 'calendar_changed'
        ELSE 'system'
      END
    )
  ),
  'system',
  'database',
  COALESCE(target.superseded_at, target.cancelled_at),
  COALESCE(target.superseded_at, target.cancelled_at)
FROM terminal_targets AS target;

CREATE OR REPLACE FUNCTION reject_social_delivery_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE'
    AND pg_trigger_depth() > 1
    AND NOT EXISTS (SELECT 1 FROM teams WHERE id = OLD.team_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'social_delivery_events_are_immutable';
END;
$$;

CREATE TRIGGER social_delivery_events_immutable
  BEFORE UPDATE OR DELETE ON social_delivery_events
  FOR EACH ROW EXECUTE FUNCTION reject_social_delivery_event_mutation();

CREATE OR REPLACE FUNCTION reject_social_delivery_receipt_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE'
    AND pg_trigger_depth() > 1
    AND NOT EXISTS (SELECT 1 FROM teams WHERE id = OLD.team_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'social_delivery_receipts_are_immutable';
END;
$$;

CREATE TRIGGER social_delivery_receipts_immutable
  BEFORE UPDATE OR DELETE ON social_delivery_receipts
  FOR EACH ROW EXECUTE FUNCTION reject_social_delivery_receipt_mutation();

CREATE OR REPLACE FUNCTION record_social_target_lifecycle_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  delivery_event_id uuid;
  delivery_event_type text;
  delivery_sequence bigint;
  delivery_actor_kind text;
  delivery_actor_id uuid;
  delivery_system_source text;
  delivery_actor jsonb;
  delivery_data jsonb;
  delivery_occurred_at timestamp with time zone;
BEGIN
  IF TG_OP = 'INSERT' THEN
    delivery_event_id := NEW.request_id;
    delivery_event_type := 'target.scheduled';
    delivery_actor_kind := 'user';
    delivery_actor_id := NEW.created_by;
    delivery_system_source := NULL;
    delivery_actor := jsonb_build_object('kind', 'user', 'userId', NEW.created_by);
    delivery_occurred_at := NEW.created_at;
    delivery_data := jsonb_build_object(
      'calendarRevision', NEW.calendar_revision,
      'connectionId', NEW.connection_id,
      'externalAccountId', NEW.external_account_id,
      'publishAt', NEW.publish_at
    );
  ELSIF OLD.status = NEW.status THEN
    RETURN NEW;
  ELSIF NEW.status = 'cancelled' THEN
    delivery_event_id := COALESCE(NEW.transition_event_id, gen_random_uuid());
    delivery_event_type := 'target.cancelled';
    delivery_actor_id := NEW.transitioned_by;
    delivery_occurred_at := NEW.cancelled_at;
    delivery_data := jsonb_build_object(
      'reason', CASE WHEN NEW.transitioned_by IS NULL THEN 'system' ELSE 'user_requested' END
    );
  ELSIF NEW.status = 'superseded' THEN
    delivery_event_id := COALESCE(NEW.transition_event_id, gen_random_uuid());
    delivery_event_type := 'target.superseded';
    delivery_actor_id := NEW.transitioned_by;
    delivery_occurred_at := NEW.superseded_at;
    delivery_data := jsonb_build_object(
      'reason', CASE
        WHEN NEW.transitioned_by IS NULL THEN 'calendar_changed'
        ELSE 'replacement_scheduled'
      END
    );
  ELSE
    RETURN NEW;
  END IF;

  IF delivery_actor_kind IS NULL THEN
    IF delivery_actor_id IS NULL THEN
      delivery_actor_kind := 'system';
      delivery_system_source := 'database';
      delivery_actor := jsonb_build_object('kind', 'system', 'source', 'database');
    ELSE
      delivery_actor_kind := 'user';
      delivery_system_source := NULL;
      delivery_actor := jsonb_build_object('kind', 'user', 'userId', delivery_actor_id);
    END IF;
  END IF;

  SELECT COALESCE(max(event.sequence), 0) + 1
  INTO delivery_sequence
  FROM social_delivery_events AS event
  WHERE event.team_id = NEW.team_id AND event.target_id = NEW.id;

  INSERT INTO social_delivery_events (
    team_id, target_id, sequence, event_id, provider, event_type,
    schema_version, event_contract, actor_kind, actor_id, system_source,
    occurred_at
  ) VALUES (
    NEW.team_id,
    NEW.id,
    delivery_sequence,
    delivery_event_id,
    NEW.provider,
    delivery_event_type,
    1,
    jsonb_build_object(
      'schema', 'screeem.social-delivery-event',
      'schemaVersion', 1,
      'id', delivery_event_id,
      'teamId', NEW.team_id,
      'targetId', NEW.id,
      'provider', NEW.provider,
      'sequence', delivery_sequence,
      'actor', delivery_actor,
      'occurredAt', delivery_occurred_at,
      'eventType', delivery_event_type,
      'data', delivery_data
    ),
    delivery_actor_kind,
    delivery_actor_id,
    delivery_system_source,
    delivery_occurred_at
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER social_post_targets_record_lifecycle
  AFTER INSERT OR UPDATE OF status ON social_post_targets
  FOR EACH ROW EXECUTE FUNCTION record_social_target_lifecycle_event();

CREATE OR REPLACE FUNCTION preserve_active_social_delivery_target()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  latest_publish_event text;
BEGIN
  IF OLD.status <> 'scheduled' OR NEW.status <> 'superseded' THEN
    RETURN NEW;
  END IF;

  SELECT event.event_type
  INTO latest_publish_event
  FROM social_delivery_events AS event
  WHERE event.team_id = OLD.team_id
    AND event.target_id = OLD.id
    AND event.event_type LIKE 'publish.%'
  ORDER BY event.sequence DESC
  LIMIT 1;

  IF latest_publish_event IN (
    'publish.started', 'publish.progressed', 'publish.resumed'
  ) THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER social_post_targets_preserve_active_delivery
  BEFORE UPDATE OF status ON social_post_targets
  FOR EACH ROW EXECUTE FUNCTION preserve_active_social_delivery_target();

REVOKE ALL ON FUNCTION record_social_target_lifecycle_event() FROM PUBLIC;
REVOKE ALL ON FUNCTION preserve_active_social_delivery_target() FROM PUBLIC;

ALTER TABLE social_delivery_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_delivery_receipts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can read team social delivery events"
  ON social_delivery_events FOR SELECT USING (is_team_member(team_id));

REVOKE ALL ON social_delivery_events FROM anon, authenticated;
REVOKE ALL ON social_delivery_receipts FROM anon, authenticated;
GRANT SELECT ON social_delivery_events TO authenticated;
GRANT SELECT ON social_delivery_events TO service_role;
