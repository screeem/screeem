CREATE INDEX IF NOT EXISTS form_submissions_form_created_at_idx
  ON form_submissions (form_id, created_at DESC);

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
  recent_submission_count integer;
BEGIN
  -- The row lock serializes the count and insert for each form.
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

  SELECT count(*) INTO recent_submission_count
  FROM form_submissions
  WHERE form_id = target_form_id
    AND created_at > clock_timestamp() - interval '1 minute';

  IF recent_submission_count >= 60 THEN
    RAISE EXCEPTION 'form_rate_limited';
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

REVOKE ALL ON FUNCTION save_form_submission_if_active(uuid, bigint, jsonb, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION save_form_submission_if_active(uuid, bigint, jsonb, text, text) TO service_role;
