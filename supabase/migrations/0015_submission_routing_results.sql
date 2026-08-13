ALTER TABLE form_submissions
  ADD COLUMN routing_status text NOT NULL DEFAULT 'not_configured',
  ADD COLUMN routing_route text,
  ADD COLUMN matched_rule_id text,
  ADD COLUMN routing_error text,
  ADD CONSTRAINT form_submissions_routing_result_valid CHECK (
    length(COALESCE(routing_route, '')) <= 256
    AND length(COALESCE(matched_rule_id, '')) <= 128
    AND length(COALESCE(routing_error, '')) <= 128
    AND (
      (
        routing_status = 'not_configured'
        AND routing_route IS NULL
        AND matched_rule_id IS NULL
        AND routing_error IS NULL
      )
      OR (
        routing_status = 'matched'
        AND routing_route IS NOT NULL
        AND matched_rule_id IS NOT NULL
        AND routing_error IS NULL
      )
      OR (
        routing_status = 'fallback'
        AND routing_route IS NOT NULL
        AND matched_rule_id IS NULL
        AND routing_error IS NULL
      )
      OR (
        routing_status = 'failed'
        AND routing_route IS NULL
        AND matched_rule_id IS NULL
        AND routing_error IS NOT NULL
        AND routing_error <> ''
      )
    )
  );

CREATE INDEX form_submissions_team_form_route_created_idx
  ON form_submissions (team_id, form_id, routing_route, created_at DESC)
  WHERE routing_route IS NOT NULL;

CREATE FUNCTION list_form_submission_routes(
  target_team_id uuid,
  target_form_id uuid
)
RETURNS TABLE(route text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT routing_route
  FROM form_submissions
  WHERE team_id = target_team_id
    AND form_id = target_form_id
    AND routing_route IS NOT NULL
  ORDER BY routing_route;
$$;

REVOKE ALL ON FUNCTION list_form_submission_routes(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION list_form_submission_routes(uuid, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION list_form_submission_routes(uuid, uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION save_form_submission_if_active(
  uuid, bigint, jsonb, text, text
) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION save_form_submission_if_active(
  uuid, bigint, jsonb, text, text
) TO service_role;

CREATE FUNCTION save_form_submission_with_routing_if_active(
  target_form_id uuid,
  expected_publication_version bigint,
  new_payload jsonb,
  submission_routing_status text,
  submission_routing_route text,
  submission_matched_rule_id text,
  submission_routing_error text,
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
    IF submission_routing_status <> 'not_configured' THEN
      RAISE EXCEPTION 'invalid_submission_routing';
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
    routing_status,
    routing_route,
    matched_rule_id,
    routing_error,
    origin,
    user_agent
  ) VALUES (
    current_form.team_id,
    target_form_id,
    expected_publication_version,
    new_payload,
    submission_routing_status,
    submission_routing_route,
    submission_matched_rule_id,
    submission_routing_error,
    submission_origin,
    submission_user_agent
  )
  RETURNING id INTO submission_id;

  RETURN submission_id;
END;
$$;

REVOKE ALL ON FUNCTION save_form_submission_with_routing_if_active(
  uuid, bigint, jsonb, text, text, text, text, text, text
) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION save_form_submission_with_routing_if_active(
  uuid, bigint, jsonb, text, text, text, text, text, text
) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION save_form_submission_with_routing_if_active(
  uuid, bigint, jsonb, text, text, text, text, text, text
) TO service_role;
