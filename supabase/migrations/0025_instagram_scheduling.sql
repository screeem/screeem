ALTER TABLE calendar_events DROP CONSTRAINT calendar_events_event_type_check;
ALTER TABLE calendar_events ADD CONSTRAINT calendar_events_event_type_check CHECK (event_type IN (
  'post.created', 'title.changed', 'copy.changed', 'schedule.changed',
  'colour.changed', 'tag.added', 'tag.removed',
  'target.added', 'target.removed', 'instagram.target.configured',
  'change.reverted', 'approval.requested', 'approval.granted',
  'approval.changes_requested', 'approval.withdrawn'
));

ALTER TABLE calendar_events ADD CONSTRAINT calendar_events_team_aggregate_client_type_key
  UNIQUE (team_id, aggregate_id, client_event_id, event_type);

ALTER TABLE calendar_events DROP CONSTRAINT calendar_events_reverts_event_id_fkey;
ALTER TABLE calendar_events ADD CONSTRAINT calendar_events_reverts_event_id_fkey
  FOREIGN KEY (reverts_event_id)
  REFERENCES calendar_events(id)
  ON DELETE NO ACTION
  DEFERRABLE INITIALLY DEFERRED;

DROP POLICY "Members can append calendar events" ON calendar_events;
REVOKE INSERT ON calendar_events FROM authenticated;

CREATE OR REPLACE FUNCTION reject_calendar_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE'
    AND pg_trigger_depth() > 1
    AND NOT EXISTS (SELECT 1 FROM teams WHERE id = OLD.team_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'calendar_events_are_immutable';
END;
$$;

CREATE TABLE social_media_assets (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  bucket text NOT NULL DEFAULT 'team-objects' CHECK (
    char_length(bucket) BETWEEN 1 AND 100
  ),
  object_key text NOT NULL,
  object_etag text NOT NULL CHECK (char_length(object_etag) BETWEEN 1 AND 512),
  checksum text NOT NULL CHECK (checksum ~ '^sha256:[a-f0-9]{64}$'),
  kind text NOT NULL CHECK (kind IN ('image', 'video')),
  byte_length bigint NOT NULL CHECK (byte_length > 0 AND byte_length <= 52428800),
  schema_version integer NOT NULL CHECK (schema_version = 1),
  asset_contract jsonb NOT NULL,
  status text NOT NULL DEFAULT 'ready',
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  ready_at timestamp with time zone NOT NULL DEFAULT now(),
  tombstoned_at timestamp with time zone,
  PRIMARY KEY (team_id, id),
  CONSTRAINT social_media_assets_team_id_id_checksum_key
    UNIQUE (team_id, id, checksum),
  CONSTRAINT social_media_assets_team_id_object_key_key
    UNIQUE (team_id, object_key),
  CONSTRAINT social_media_assets_object_key_check CHECK (
    object_key = 'teams/' || team_id::text || '/social-post-media/' || id::text
  ),
  CONSTRAINT social_media_assets_contract_check CHECK (
    (jsonb_typeof(asset_contract) = 'object'
    AND pg_column_size(asset_contract) <= 32768
    AND asset_contract->>'schema' = 'screeem.social-media-asset'
    AND asset_contract @> '{"schemaVersion": 1}'::jsonb
    AND asset_contract->>'assetId' = id::text
    AND asset_contract->>'checksum' = checksum
    AND asset_contract->>'kind' = kind
    AND asset_contract->>'sizeBytes' = byte_length::text) IS TRUE
  ),
  CONSTRAINT social_media_assets_status_check CHECK (
    (status = 'ready' AND tombstoned_at IS NULL)
    OR (status = 'tombstoned' AND tombstoned_at IS NOT NULL)
  )
);

CREATE TABLE social_post_targets (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  calendar_post_id uuid NOT NULL,
  calendar_revision bigint NOT NULL CHECK (calendar_revision > 0),
  provider text NOT NULL CHECK (provider = 'instagram'),
  connection_id uuid NOT NULL,
  external_account_id text NOT NULL CHECK (
    char_length(external_account_id) BETWEEN 1 AND 256
  ),
  source_client_event_id uuid NOT NULL,
  source_event_type text NOT NULL DEFAULT 'instagram.target.configured' CHECK (
    source_event_type = 'instagram.target.configured'
  ),
  schema_version integer NOT NULL CHECK (schema_version = 1),
  template_version integer NOT NULL CHECK (template_version = 1),
  target_contract jsonb NOT NULL,
  publish_at timestamp with time zone NOT NULL,
  timezone text NOT NULL CHECK (char_length(timezone) BETWEEN 1 AND 128),
  status text NOT NULL DEFAULT 'scheduled' CHECK (
    status IN ('scheduled', 'superseded', 'cancelled')
  ),
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  superseded_at timestamp with time zone,
  cancelled_at timestamp with time zone,
  PRIMARY KEY (team_id, id),
  CONSTRAINT social_post_targets_team_request_key UNIQUE (team_id, request_id),
  CONSTRAINT social_post_targets_team_post_provider_revision_key
    UNIQUE (team_id, calendar_post_id, provider, calendar_revision),
  CONSTRAINT social_post_targets_workflow_fkey
    FOREIGN KEY (team_id, calendar_post_id)
    REFERENCES calendar_post_workflows (team_id, aggregate_id)
    ON DELETE CASCADE,
  CONSTRAINT social_post_targets_connection_fkey
    FOREIGN KEY (team_id, connection_id)
    REFERENCES integration_connections (team_id, id)
    ON DELETE NO ACTION
    DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT social_post_targets_source_event_fkey
    FOREIGN KEY (
      team_id, calendar_post_id, source_client_event_id, source_event_type
    ) REFERENCES calendar_events (
      team_id, aggregate_id, client_event_id, event_type
    )
    ON DELETE NO ACTION
    DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT social_post_targets_contract_check CHECK (
    (jsonb_typeof(target_contract) = 'object'
    AND pg_column_size(target_contract) <= 262144
    AND target_contract->>'schema' = 'screeem.social-post-target'
    AND target_contract @> '{"schemaVersion": 1, "provider": "instagram"}'::jsonb
    AND target_contract->>'id' = id::text
    AND target_contract->>'teamId' = team_id::text
    AND target_contract->>'calendarPostId' = calendar_post_id::text
    AND target_contract->>'calendarRevision' = calendar_revision::text
    AND target_contract->>'connectionId' = connection_id::text
    AND target_contract->'template'->>'version' = template_version::text
    AND target_contract->'schedule'->>'publishAt' IS NOT NULL
    AND target_contract->'schedule'->>'timezone' = timezone
    AND target_contract->>'createdBy' = created_by::text
    AND (target_contract->'schedule'->>'publishAt')::timestamp with time zone = publish_at
    AND (target_contract->>'createdAt')::timestamp with time zone = created_at) IS TRUE
  ),
  CONSTRAINT social_post_targets_status_timestamps_check CHECK (
    (status = 'scheduled' AND superseded_at IS NULL AND cancelled_at IS NULL)
    OR (status = 'superseded' AND superseded_at IS NOT NULL AND cancelled_at IS NULL)
    OR (status = 'cancelled' AND superseded_at IS NULL AND cancelled_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX social_post_targets_active_post_provider_key
  ON social_post_targets (team_id, calendar_post_id, provider)
  WHERE status = 'scheduled';

CREATE INDEX social_post_targets_due_idx
  ON social_post_targets (publish_at, id)
  WHERE status = 'scheduled';

CREATE INDEX social_post_targets_team_post_idx
  ON social_post_targets (team_id, calendar_post_id, created_at DESC);

CREATE TABLE social_post_target_assets (
  team_id uuid NOT NULL,
  target_id uuid NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal BETWEEN 0 AND 9),
  asset_id uuid NOT NULL,
  checksum text NOT NULL CHECK (checksum ~ '^sha256:[a-f0-9]{64}$'),
  PRIMARY KEY (team_id, target_id, ordinal),
  CONSTRAINT social_post_target_assets_target_fkey
    FOREIGN KEY (team_id, target_id)
    REFERENCES social_post_targets (team_id, id)
    ON DELETE CASCADE,
  CONSTRAINT social_post_target_assets_asset_fkey
    FOREIGN KEY (team_id, asset_id, checksum)
    REFERENCES social_media_assets (team_id, id, checksum)
    ON DELETE NO ACTION
    DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX social_post_target_assets_asset_idx
  ON social_post_target_assets (team_id, asset_id);

CREATE OR REPLACE FUNCTION reject_social_post_target_asset_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE'
    AND pg_trigger_depth() > 1
    AND NOT EXISTS (
      SELECT 1 FROM social_post_targets
      WHERE team_id = OLD.team_id AND id = OLD.target_id
    ) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'social_post_target_assets_are_immutable';
END;
$$;

CREATE TRIGGER social_post_target_assets_immutable
  BEFORE UPDATE OR DELETE ON social_post_target_assets
  FOR EACH ROW EXECUTE FUNCTION reject_social_post_target_asset_mutation();

CREATE OR REPLACE FUNCTION enforce_social_media_asset_immutability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF pg_trigger_depth() > 1
      AND NOT EXISTS (SELECT 1 FROM teams WHERE id = OLD.team_id) THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'social_media_asset_immutable';
  END IF;
  IF ROW(
    NEW.id, NEW.team_id, NEW.bucket, NEW.object_key, NEW.object_etag, NEW.checksum,
    NEW.kind, NEW.byte_length, NEW.schema_version, NEW.asset_contract,
    NEW.created_by, NEW.created_at, NEW.ready_at
  ) IS DISTINCT FROM ROW(
    OLD.id, OLD.team_id, OLD.bucket, OLD.object_key, OLD.object_etag, OLD.checksum,
    OLD.kind, OLD.byte_length, OLD.schema_version, OLD.asset_contract,
    OLD.created_by, OLD.created_at, OLD.ready_at
  ) THEN
    RAISE EXCEPTION 'social_media_asset_immutable';
  END IF;
  IF OLD.status <> 'ready'
    OR NEW.status <> 'tombstoned'
    OR NEW.tombstoned_at IS NULL THEN
    RAISE EXCEPTION 'social_media_asset_invalid_transition';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER social_media_assets_immutable
  BEFORE UPDATE OR DELETE ON social_media_assets
  FOR EACH ROW EXECUTE FUNCTION enforce_social_media_asset_immutability();

CREATE OR REPLACE FUNCTION enforce_social_post_target_immutability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF pg_trigger_depth() > 1
      AND NOT EXISTS (SELECT 1 FROM teams WHERE id = OLD.team_id) THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'social_post_target_immutable';
  END IF;
  IF ROW(
    NEW.id, NEW.team_id, NEW.request_id, NEW.calendar_post_id,
    NEW.calendar_revision, NEW.provider, NEW.connection_id,
    NEW.external_account_id, NEW.source_client_event_id, NEW.source_event_type,
    NEW.schema_version, NEW.template_version, NEW.target_contract,
    NEW.publish_at, NEW.timezone, NEW.created_by, NEW.created_at
  ) IS DISTINCT FROM ROW(
    OLD.id, OLD.team_id, OLD.request_id, OLD.calendar_post_id,
    OLD.calendar_revision, OLD.provider, OLD.connection_id,
    OLD.external_account_id, OLD.source_client_event_id, OLD.source_event_type,
    OLD.schema_version, OLD.template_version, OLD.target_contract,
    OLD.publish_at, OLD.timezone, OLD.created_by, OLD.created_at
  ) THEN
    RAISE EXCEPTION 'social_post_target_immutable';
  END IF;
  IF OLD.status <> 'scheduled'
    OR NEW.status NOT IN ('superseded', 'cancelled') THEN
    RAISE EXCEPTION 'social_post_target_invalid_transition';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER social_post_targets_immutable
  BEFORE UPDATE OR DELETE ON social_post_targets
  FOR EACH ROW EXECUTE FUNCTION enforce_social_post_target_immutability();

ALTER TABLE social_media_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_post_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_post_target_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can read team social media assets"
  ON social_media_assets FOR SELECT USING (is_team_member(team_id));

CREATE POLICY "Members can read team social post targets"
  ON social_post_targets FOR SELECT USING (is_team_member(team_id));

CREATE POLICY "Members can read team social post target assets"
  ON social_post_target_assets FOR SELECT USING (is_team_member(team_id));

REVOKE ALL ON social_media_assets FROM anon, authenticated;
REVOKE ALL ON social_post_targets FROM anon, authenticated;
REVOKE ALL ON social_post_target_assets FROM anon, authenticated;

GRANT SELECT ON social_media_assets TO authenticated;
GRANT SELECT ON social_post_targets TO authenticated;
GRANT SELECT ON social_post_target_assets TO authenticated;

GRANT ALL ON social_media_assets TO service_role;
GRANT ALL ON social_post_targets TO service_role;
GRANT ALL ON social_post_target_assets TO service_role;

DROP POLICY "Managers can replace team objects" ON storage.objects;
CREATE POLICY "Managers can replace team objects" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'team-objects'
    AND split_part(name, '/', 3) <> 'social-post-media'
    AND can_manage_team(storage_object_team_id(name))
  ) WITH CHECK (
    bucket_id = 'team-objects'
    AND split_part(name, '/', 3) <> 'social-post-media'
    AND can_manage_team(storage_object_team_id(name))
  );

DROP POLICY "Managers can delete team objects" ON storage.objects;
CREATE POLICY "Managers can delete team objects" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'team-objects'
    AND split_part(name, '/', 3) <> 'social-post-media'
    AND can_manage_team(storage_object_team_id(name))
  );

CREATE OR REPLACE FUNCTION enforce_calendar_workflow_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  workflow calendar_post_workflows%ROWTYPE;
  actor_role text;
  requested_revision bigint;
  reverted_type text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(
    NEW.team_id::text || ':' || NEW.client_event_id::text, 0
  ));
  IF EXISTS (
    SELECT 1 FROM calendar_events
    WHERE team_id = NEW.team_id AND client_event_id = NEW.client_event_id
  ) THEN
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    NEW.team_id::text || ':' || NEW.aggregate_id::text, 1
  ));

  SELECT role INTO actor_role
  FROM team_members
  WHERE team_id = NEW.team_id AND user_id = NEW.actor_id;
  IF actor_role IS NULL THEN
    RAISE EXCEPTION 'calendar_approval_forbidden: actor is not a team member';
  END IF;

  IF NEW.event_type = 'post.created' THEN
    IF EXISTS (
      SELECT 1 FROM calendar_post_workflows
      WHERE team_id = NEW.team_id AND aggregate_id = NEW.aggregate_id
    ) THEN
      RAISE EXCEPTION 'calendar_approval_conflict: post already exists';
    END IF;
    INSERT INTO calendar_post_workflows (team_id, aggregate_id, revision)
    VALUES (NEW.team_id, NEW.aggregate_id, 1);
    RETURN NEW;
  END IF;

  SELECT * INTO workflow
  FROM calendar_post_workflows
  WHERE team_id = NEW.team_id AND aggregate_id = NEW.aggregate_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'calendar_approval_conflict: post does not exist';
  END IF;

  IF NEW.event_type IN (
    'title.changed', 'copy.changed', 'schedule.changed', 'colour.changed',
    'tag.added', 'tag.removed', 'target.added', 'target.removed',
    'instagram.target.configured', 'change.reverted'
  ) THEN
    IF NEW.event_type = 'instagram.target.configured' THEN
      IF jsonb_typeof(NEW.payload) IS DISTINCT FROM 'object'
        OR jsonb_typeof(NEW.payload->'input') IS DISTINCT FROM 'object'
        OR jsonb_typeof(NEW.payload->'expectedRevision') IS DISTINCT FROM 'number'
        OR ((NEW.payload->>'expectedRevision') ~ '^[1-9][0-9]*$') IS DISTINCT FROM true
        OR NEW.payload->'input'->>'schema'
          IS DISTINCT FROM 'screeem.instagram-scheduled-post-input'
        OR (NEW.payload->'input' @> '{"schemaVersion": 1}'::jsonb) IS DISTINCT FROM true
        OR pg_column_size(NEW.payload) > 131072 THEN
        RAISE EXCEPTION 'calendar_approval_conflict: invalid Instagram target';
      END IF;
      IF (NEW.payload->>'expectedRevision')::bigint <> workflow.revision THEN
        RAISE EXCEPTION 'calendar_approval_conflict: stale revision';
      END IF;
    END IF;
    IF NEW.event_type = 'change.reverted' THEN
      SELECT event_type INTO reverted_type
      FROM calendar_events
      WHERE team_id = NEW.team_id
        AND aggregate_id = NEW.aggregate_id
        AND id = NEW.reverts_event_id;
      IF reverted_type IS NULL THEN
        RAISE EXCEPTION 'calendar_approval_conflict: invalid reverted event';
      END IF;
      IF reverted_type LIKE 'approval.%' THEN
        RAISE EXCEPTION 'calendar_approval_conflict: approval decisions cannot be reverted';
      END IF;
      IF reverted_type = 'instagram.target.configured' THEN
        RAISE EXCEPTION 'calendar_approval_conflict: Instagram targets must be reconfigured';
      END IF;
    END IF;
    UPDATE social_post_targets
    SET status = 'superseded', superseded_at = statement_timestamp()
    WHERE team_id = NEW.team_id
      AND calendar_post_id = NEW.aggregate_id
      AND status = 'scheduled';
    UPDATE calendar_post_workflows
    SET revision = revision + 1,
      status = 'draft', review_revision = NULL, requested_by = NULL,
      updated_at = now()
    WHERE team_id = NEW.team_id AND aggregate_id = NEW.aggregate_id;
    RETURN NEW;
  END IF;

  IF jsonb_typeof(NEW.payload->'revision') IS DISTINCT FROM 'number'
    OR ((NEW.payload->>'revision') ~ '^[1-9][0-9]*$') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'calendar_approval_conflict: invalid revision';
  END IF;
  requested_revision := (NEW.payload->>'revision')::bigint;
  IF requested_revision <> workflow.revision THEN
    RAISE EXCEPTION 'calendar_approval_conflict: stale revision';
  END IF;
  IF NEW.payload ? 'comment' AND (
    jsonb_typeof(NEW.payload->'comment') <> 'string'
    OR char_length(NEW.payload->>'comment') > 2000
  ) THEN
    RAISE EXCEPTION 'calendar_approval_conflict: invalid comment';
  END IF;

  IF NEW.event_type = 'approval.requested' THEN
    IF workflow.status NOT IN ('draft', 'changes_requested') THEN
      RAISE EXCEPTION 'calendar_approval_conflict: post is already in review';
    END IF;
    UPDATE calendar_post_workflows
    SET status = 'in_review', review_revision = requested_revision,
      requested_by = NEW.actor_id, updated_at = now()
    WHERE team_id = NEW.team_id AND aggregate_id = NEW.aggregate_id;
  ELSIF NEW.event_type IN ('approval.granted', 'approval.changes_requested') THEN
    IF actor_role NOT IN ('owner', 'admin') THEN
      RAISE EXCEPTION 'calendar_approval_forbidden: manager role required';
    END IF;
    IF workflow.status <> 'in_review'
      OR workflow.review_revision <> requested_revision THEN
      RAISE EXCEPTION 'calendar_approval_conflict: post is not awaiting this revision';
    END IF;
    UPDATE calendar_post_workflows
    SET status = CASE WHEN NEW.event_type = 'approval.granted'
      THEN 'approved' ELSE 'changes_requested' END,
      updated_at = now()
    WHERE team_id = NEW.team_id AND aggregate_id = NEW.aggregate_id;
  ELSIF NEW.event_type = 'approval.withdrawn' THEN
    IF workflow.status <> 'in_review' THEN
      RAISE EXCEPTION 'calendar_approval_conflict: post is not in review';
    END IF;
    IF workflow.requested_by <> NEW.actor_id
      AND actor_role NOT IN ('owner', 'admin') THEN
      RAISE EXCEPTION 'calendar_approval_forbidden: requester or manager required';
    END IF;
    UPDATE calendar_post_workflows
    SET status = 'draft', review_revision = NULL, requested_by = NULL,
      updated_at = now()
    WHERE team_id = NEW.team_id AND aggregate_id = NEW.aggregate_id;
  END IF;
  RETURN NEW;
END;
$$;
