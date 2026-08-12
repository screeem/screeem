-- Versioned structured form definitions. Existing forms and submissions remain
-- legacy records until a draft is explicitly created and published.
ALTER TABLE forms
  ADD COLUMN legacy_unstructured boolean NOT NULL DEFAULT true,
  ADD COLUMN definition_availability text NOT NULL DEFAULT 'draft'
    CHECK (definition_availability IN ('draft', 'active', 'paused')),
  ADD COLUMN draft_definition jsonb,
  ADD COLUMN draft_revision bigint NOT NULL DEFAULT 0 CHECK (draft_revision >= 0),
  ADD COLUMN published_version bigint,
  ADD COLUMN last_published_draft_revision bigint;

-- Tenant-first keys keep every private access path scoped to a team. The
-- endpoint_key unique index remains the intentional public lookup path.
ALTER TABLE forms
  ADD CONSTRAINT forms_team_id_id_key UNIQUE (team_id, id);

DROP INDEX forms_team_id_idx;
CREATE INDEX forms_team_created_idx ON forms(team_id, created_at DESC);
CREATE INDEX team_members_user_team_idx ON team_members(user_id, team_id);
CREATE INDEX team_members_team_joined_idx ON team_members(team_id, joined_at);
CREATE INDEX team_invitations_team_expires_idx ON team_invitations(team_id, expires_at);
DROP INDEX social_accounts_team_id_idx;
CREATE INDEX social_accounts_team_created_idx ON social_accounts(team_id, created_at);
DROP INDEX api_keys_team_id_idx;
CREATE INDEX api_keys_team_user_idx ON api_keys(team_id, user_id);
DROP INDEX public_api_keys_team_id_idx;
CREATE INDEX public_api_keys_team_created_idx ON public_api_keys(team_id, created_at DESC);

CREATE TABLE form_definition_versions (
  team_id uuid NOT NULL,
  form_id uuid NOT NULL,
  version bigint NOT NULL CHECK (version > 0),
  draft_revision bigint NOT NULL CHECK (draft_revision >= 0),
  definition jsonb NOT NULL CHECK (jsonb_typeof(definition) = 'object'),
  published_at timestamp with time zone NOT NULL,
  PRIMARY KEY (team_id, form_id, version),
  UNIQUE (team_id, form_id, draft_revision),
  FOREIGN KEY (team_id, form_id)
    REFERENCES forms(team_id, id) ON DELETE CASCADE
);

ALTER TABLE form_submissions
  ADD COLUMN team_id uuid,
  ADD COLUMN publication_version bigint;

UPDATE form_submissions AS submission
SET team_id = form_record.team_id
FROM forms AS form_record
WHERE form_record.id = submission.form_id;

ALTER TABLE form_submissions
  ALTER COLUMN team_id SET NOT NULL,
  DROP CONSTRAINT form_submissions_form_id_fkey,
  ADD CONSTRAINT form_submissions_team_form_fkey
    FOREIGN KEY (team_id, form_id)
    REFERENCES forms(team_id, id) ON DELETE CASCADE,
  ADD CONSTRAINT form_submissions_publication_version_fkey
    FOREIGN KEY (team_id, form_id, publication_version)
    REFERENCES form_definition_versions(team_id, form_id, version);

DROP INDEX form_submissions_form_created_idx;
CREATE INDEX form_submissions_team_form_created_idx
  ON form_submissions(team_id, form_id, created_at DESC);

ALTER TABLE form_definition_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can read team form definition versions" ON form_definition_versions
  FOR SELECT USING (is_team_member(team_id));

DROP POLICY "Members can read team form submissions" ON form_submissions;
CREATE POLICY "Members can read team form submissions" ON form_submissions
  FOR SELECT USING (is_team_member(team_id));

CREATE OR REPLACE FUNCTION reject_form_definition_version_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'published_form_versions_are_immutable';
END;
$$;

CREATE TRIGGER form_definition_versions_are_immutable
  BEFORE UPDATE ON form_definition_versions
  FOR EACH ROW EXECUTE FUNCTION reject_form_definition_version_update();

CREATE OR REPLACE FUNCTION initialize_form_definition(
  target_team_id uuid,
  target_form_id uuid,
  new_definition jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_form forms%ROWTYPE;
BEGIN
  SELECT * INTO current_form FROM forms
  WHERE id = target_form_id AND team_id = target_team_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'form_not_found'; END IF;
  IF current_form.draft_definition IS NOT NULL THEN
    RAISE EXCEPTION 'form_already_exists';
  END IF;

  UPDATE forms SET
    draft_definition = new_definition,
    draft_revision = 0,
    definition_availability = 'draft',
    updated_at = now()
  WHERE team_id = target_team_id AND id = target_form_id;

  RETURN jsonb_build_object(
    'form_id', target_form_id,
    'revision', 0,
    'definition', new_definition,
    'availability', 'draft',
    'published_version', NULL
  );
END;
$$;

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
    'definition', new_definition
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
    team_id, form_id, version, draft_revision, definition, published_at
  ) VALUES (
    target_team_id,
    target_form_id,
    next_version,
    current_form.draft_revision,
    current_form.draft_definition,
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
    'published_at', publication_time
  );
END;
$$;

CREATE OR REPLACE FUNCTION save_form_submission_if_active(
  target_form_id uuid,
  expected_publication_version bigint,
  new_payload jsonb,
  submission_origin text,
  submission_user_agent text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_form forms%ROWTYPE;
  submission_id uuid;
BEGIN
  SELECT * INTO current_form FROM forms
  WHERE id = target_form_id
  FOR UPDATE;

  IF NOT FOUND OR NOT current_form.is_active THEN
    RAISE EXCEPTION 'form_unavailable';
  END IF;

  IF expected_publication_version IS NULL THEN
    IF NOT current_form.legacy_unstructured OR current_form.published_version IS NOT NULL THEN
      RAISE EXCEPTION 'form_version_changed';
    END IF;
  ELSIF
    current_form.definition_availability <> 'active'
    OR current_form.published_version IS DISTINCT FROM expected_publication_version
  THEN
    RAISE EXCEPTION 'form_version_changed';
  END IF;

  INSERT INTO form_submissions (
    team_id,
    form_id,
    publication_version,
    payload,
    origin,
    user_agent
  ) VALUES (
    current_form.team_id,
    target_form_id,
    expected_publication_version,
    new_payload,
    submission_origin,
    submission_user_agent
  )
  RETURNING id INTO submission_id;

  RETURN submission_id;
END;
$$;

REVOKE ALL ON FUNCTION initialize_form_definition(uuid, uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION save_form_definition_draft(uuid, uuid, bigint, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION publish_form_definition(uuid, uuid, bigint, timestamp with time zone) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION initialize_form_definition(uuid, uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION save_form_definition_draft(uuid, uuid, bigint, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION publish_form_definition(uuid, uuid, bigint, timestamp with time zone) TO service_role;
REVOKE ALL ON FUNCTION save_form_submission_if_active(uuid, bigint, jsonb, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION save_form_submission_if_active(uuid, bigint, jsonb, text, text) TO service_role;
