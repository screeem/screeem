-- Revision-bound approval state for social calendar posts.
ALTER TABLE calendar_events DROP CONSTRAINT calendar_events_event_type_check;
ALTER TABLE calendar_events ADD CONSTRAINT calendar_events_event_type_check CHECK (event_type IN (
  'post.created', 'title.changed', 'copy.changed', 'schedule.changed',
  'colour.changed', 'target.added', 'target.removed', 'change.reverted',
  'approval.requested', 'approval.granted', 'approval.changes_requested',
  'approval.withdrawn'
));

CREATE TABLE calendar_post_workflows (
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  aggregate_id uuid NOT NULL,
  revision bigint NOT NULL CHECK (revision > 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft', 'in_review', 'changes_requested', 'approved'
  )),
  review_revision bigint,
  requested_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, aggregate_id),
  CHECK (
    (status = 'draft' AND review_revision IS NULL AND requested_by IS NULL)
    OR (status <> 'draft' AND review_revision IS NOT NULL AND requested_by IS NOT NULL)
  )
);

INSERT INTO calendar_post_workflows (team_id, aggregate_id, revision)
SELECT team_id, aggregate_id, count(*) FILTER (WHERE event_type IN (
  'post.created', 'title.changed', 'copy.changed', 'schedule.changed',
  'colour.changed', 'target.added', 'target.removed', 'change.reverted'
))
FROM calendar_events
GROUP BY team_id, aggregate_id;

CREATE INDEX calendar_post_workflows_team_status_idx
  ON calendar_post_workflows(team_id, status);

ALTER TABLE calendar_post_workflows ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can read calendar workflows" ON calendar_post_workflows
  FOR SELECT USING (is_team_member(team_id));

CREATE FUNCTION enforce_calendar_workflow_event()
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
  -- Serialize retries and all events for a post. The retry lock prevents an
  -- idempotent insert from advancing the workflow projection twice.
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
    'target.added', 'target.removed', 'change.reverted'
  ) THEN
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
    END IF;
    UPDATE calendar_post_workflows
    SET revision = revision + 1,
      status = 'draft', review_revision = NULL, requested_by = NULL,
      updated_at = now()
    WHERE team_id = NEW.team_id AND aggregate_id = NEW.aggregate_id;
    RETURN NEW;
  END IF;

  IF jsonb_typeof(NEW.payload->'revision') <> 'number'
    OR (NEW.payload->>'revision') !~ '^[1-9][0-9]*$' THEN
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

CREATE TRIGGER calendar_events_workflow_projection
  BEFORE INSERT ON calendar_events
  FOR EACH ROW EXECUTE FUNCTION enforce_calendar_workflow_event();
