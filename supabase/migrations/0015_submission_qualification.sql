ALTER TABLE form_submissions
  ADD COLUMN qualification_route text,
  ADD COLUMN qualification_matched_rule text;

DROP FUNCTION save_form_submission_if_active(uuid, bigint, jsonb, text, text);

CREATE FUNCTION save_form_submission_if_active(
  target_form_id uuid,
  expected_publication_version bigint,
  new_payload jsonb,
  submission_origin text,
  submission_user_agent text,
  new_qualification_route text,
  new_qualification_matched_rule text
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
    user_agent,
    qualification_route,
    qualification_matched_rule
  ) VALUES (
    current_form.team_id,
    target_form_id,
    expected_publication_version,
    new_payload,
    submission_origin,
    submission_user_agent,
    new_qualification_route,
    new_qualification_matched_rule
  )
  RETURNING id INTO submission_id;

  RETURN submission_id;
END;
$$;

REVOKE ALL ON FUNCTION save_form_submission_if_active(uuid, bigint, jsonb, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION save_form_submission_if_active(uuid, bigint, jsonb, text, text, text, text) TO service_role;
