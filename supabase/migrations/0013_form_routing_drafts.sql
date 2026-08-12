-- Routing shares the form draft revision and is snapshotted into the same
-- immutable publication row. No JSON index is needed because routing is only
-- read through the existing tenant-first form/version keys.
ALTER TABLE forms
  ADD COLUMN routing_draft jsonb
    CHECK (routing_draft IS NULL OR jsonb_typeof(routing_draft) = 'object');

ALTER TABLE form_definition_versions
  ADD COLUMN routing_definition jsonb
    CHECK (routing_definition IS NULL OR jsonb_typeof(routing_definition) = 'object');

CREATE OR REPLACE FUNCTION save_form_definition_draft(
  target_team_id uuid,
  target_form_id uuid,
  expected_revision bigint,
  new_definition jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_form forms%ROWTYPE;
  next_revision bigint;
BEGIN
  SELECT * INTO current_form FROM forms
  WHERE id = target_form_id AND team_id = target_team_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'form_not_found'; END IF;
  IF current_form.draft_definition IS NULL THEN
    RAISE EXCEPTION 'form_definition_not_found';
  END IF;
  IF current_form.draft_revision <> expected_revision THEN
    RAISE EXCEPTION 'form_revision_conflict:%', current_form.draft_revision;
  END IF;

  next_revision := current_form.draft_revision + 1;
  UPDATE forms SET
    draft_definition = new_definition,
    draft_revision = next_revision,
    updated_at = now()
  WHERE team_id = target_team_id AND id = target_form_id;

  RETURN jsonb_build_object(
    'form_id', target_form_id,
    'revision', next_revision,
    'definition', new_definition,
    'routing', current_form.routing_draft
  );
END;
$$;

CREATE OR REPLACE FUNCTION save_form_routing_draft(
  target_team_id uuid,
  target_form_id uuid,
  expected_revision bigint,
  new_routing jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_form forms%ROWTYPE;
  next_revision bigint;
BEGIN
  SELECT * INTO current_form FROM forms
  WHERE id = target_form_id AND team_id = target_team_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'form_not_found'; END IF;
  IF current_form.draft_definition IS NULL THEN
    RAISE EXCEPTION 'form_definition_not_found';
  END IF;
  IF current_form.draft_revision <> expected_revision THEN
    RAISE EXCEPTION 'form_revision_conflict:%', current_form.draft_revision;
  END IF;

  next_revision := current_form.draft_revision + 1;
  UPDATE forms SET
    routing_draft = new_routing,
    draft_revision = next_revision,
    updated_at = now()
  WHERE team_id = target_team_id AND id = target_form_id;

  RETURN jsonb_build_object(
    'form_id', target_form_id,
    'revision', next_revision,
    'definition', current_form.draft_definition,
    'routing', new_routing
  );
END;
$$;

CREATE OR REPLACE FUNCTION publish_form_definition(
  target_team_id uuid,
  target_form_id uuid,
  expected_revision bigint,
  publication_time timestamp with time zone
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_form forms%ROWTYPE;
  next_version bigint;
BEGIN
  SELECT * INTO current_form FROM forms
  WHERE id = target_form_id AND team_id = target_team_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'form_not_found'; END IF;
  IF current_form.draft_definition IS NULL THEN
    RAISE EXCEPTION 'form_definition_not_found';
  END IF;
  IF current_form.draft_revision <> expected_revision THEN
    RAISE EXCEPTION 'form_revision_conflict:%', current_form.draft_revision;
  END IF;
  IF current_form.last_published_draft_revision = expected_revision THEN
    RAISE EXCEPTION 'form_draft_already_published';
  END IF;

  next_version := COALESCE(current_form.published_version, 0) + 1;
  INSERT INTO form_definition_versions (
    team_id,
    form_id,
    version,
    draft_revision,
    definition,
    routing_definition,
    published_at
  ) VALUES (
    target_team_id,
    target_form_id,
    next_version,
    current_form.draft_revision,
    current_form.draft_definition,
    current_form.routing_draft,
    publication_time
  );

  UPDATE forms SET
    published_version = next_version,
    last_published_draft_revision = current_form.draft_revision,
    legacy_unstructured = false,
    is_active = CASE
      WHEN definition_availability = 'draft' THEN true
      ELSE is_active
    END,
    definition_availability = CASE
      WHEN definition_availability = 'draft' THEN 'active'
      ELSE definition_availability
    END,
    updated_at = now()
  WHERE team_id = target_team_id AND id = target_form_id;

  RETURN jsonb_build_object(
    'form_id', target_form_id,
    'version', next_version,
    'definition', current_form.draft_definition,
    'routing', current_form.routing_draft,
    'published_at', publication_time
  );
END;
$$;

REVOKE ALL ON FUNCTION save_form_routing_draft(uuid, uuid, bigint, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION save_form_routing_draft(uuid, uuid, bigint, jsonb) TO service_role;
