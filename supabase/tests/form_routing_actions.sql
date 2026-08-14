BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(20);

INSERT INTO auth.users (
  id,
  email,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
) VALUES (
  '30000000-0000-0000-0000-000000000001',
  'routing-actions@example.com',
  '{}'::jsonb,
  '{}'::jsonb,
  now(),
  now()
);

INSERT INTO forms (id, team_id, name, created_by)
SELECT
  '40000000-0000-0000-0000-000000000001',
  id,
  'Routing actions test',
  '30000000-0000-0000-0000-000000000001'
FROM teams
WHERE created_by = '30000000-0000-0000-0000-000000000001';

UPDATE forms
SET
  legacy_unstructured = false,
  definition_availability = 'active',
  published_version = 1
WHERE id = '40000000-0000-0000-0000-000000000001';

INSERT INTO form_definition_versions (
  team_id,
  form_id,
  version,
  draft_revision,
  definition,
  published_at
)
SELECT
  team_id,
  id,
  1,
  1,
  '{"formatVersion":1,"title":"Qualification","fields":[]}'::jsonb,
  now()
FROM forms
WHERE id = '40000000-0000-0000-0000-000000000001';

INSERT INTO form_submissions (
  id,
  team_id,
  form_id,
  publication_version,
  payload,
  routing_status,
  routing_route,
  matched_rule_id
)
SELECT
  '50000000-0000-0000-0000-000000000001',
  team_id,
  id,
  1,
  '{"employees":750}'::jsonb,
  'matched',
  'sales',
  'enterprise'
FROM forms
WHERE id = '40000000-0000-0000-0000-000000000001';

SELECT has_table('form_submission_action_executions');
SELECT has_column('form_submission_action_executions', 'status');
SELECT has_column('form_submission_action_executions', 'next_attempt_at');
SELECT has_column('form_submission_action_executions', 'lease_expires_at');
SELECT col_is_pk(
  'form_submission_action_executions',
  ARRAY['team_id', 'submission_id', 'action_key']
);
SELECT has_index('form_submission_action_executions', 'form_submission_action_pending_idx');
SELECT has_index(
  'form_submission_action_executions',
  'form_submission_action_running_lease_idx'
);
SELECT is(
  (
    SELECT pg_get_expr(index.indpred, index.indrelid)
    FROM pg_index AS index
    JOIN pg_class AS relation ON relation.oid = index.indexrelid
    WHERE relation.relname = 'form_submission_action_pending_idx'
  ),
  '((status = ''pending''::text) AND (attempt_count < 3))',
  'the pending index only tracks retryable pending work'
);
SELECT is(
  (
    SELECT pg_get_expr(index.indpred, index.indrelid)
    FROM pg_index AS index
    JOIN pg_class AS relation ON relation.oid = index.indexrelid
    WHERE relation.relname = 'form_submission_action_running_lease_idx'
  ),
  '(status = ''running''::text)',
  'the running index serves retries and final-attempt recovery'
);
SELECT has_index(
  'form_submission_action_executions',
  'form_submission_action_execution_index_key'
);
SELECT has_index(
  'form_submission_action_executions',
  'form_submission_action_team_form_created_idx'
);

SELECT lives_ok(
  $$
    INSERT INTO form_submission_action_executions (
      team_id,
      form_id,
      submission_id,
      publication_version,
      action_key,
      action_name,
      action_index,
      rule_id
    )
    SELECT
      team_id,
      id,
      '50000000-0000-0000-0000-000000000001',
      1,
      'enterprise:0',
      'notify',
      0,
      'enterprise'
    FROM forms
    WHERE id = '40000000-0000-0000-0000-000000000001'
  $$,
  'a valid action execution row satisfies the schema'
);

SELECT results_eq(
  $$
    SELECT status, attempt_count, last_error
    FROM form_submission_action_executions
    WHERE submission_id = '50000000-0000-0000-0000-000000000001'
  $$,
  $$ VALUES ('pending'::text, 0, NULL::text) $$,
  'action execution defaults are stable'
);

SELECT throws_ok(
  $$
    UPDATE form_submission_action_executions
    SET status = 'unknown'
    WHERE submission_id = '50000000-0000-0000-0000-000000000001'
  $$,
  '23514',
  NULL,
  'the status constraint rejects unknown states'
);

SELECT throws_ok(
  $$
    UPDATE form_submission_action_executions
    SET attempt_count = 4
    WHERE submission_id = '50000000-0000-0000-0000-000000000001'
  $$,
  '23514',
  NULL,
  'the attempt constraint remains bounded'
);

SELECT throws_ok(
  $$
    UPDATE form_submission_action_executions
    SET action_index = 10
    WHERE submission_id = '50000000-0000-0000-0000-000000000001'
  $$,
  '23514',
  NULL,
  'the action index remains bounded'
);

SELECT throws_ok(
  $$
    UPDATE form_submission_action_executions
    SET output = jsonb_build_object('value', repeat('x', 140000))
    WHERE submission_id = '50000000-0000-0000-0000-000000000001'
  $$,
  '23514',
  NULL,
  'the action output remains bounded'
);

SELECT is(
  (
    SELECT relrowsecurity
    FROM pg_class
    WHERE oid = 'form_submission_action_executions'::regclass
  ),
  true,
  'row-level security is enabled'
);

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"30000000-0000-0000-0000-000000000001"}',
  true
);

SELECT is(
  (SELECT count(*) FROM form_submission_action_executions),
  1::bigint,
  'a team member can read action execution status'
);

SELECT throws_ok(
  $$
    INSERT INTO form_submission_action_executions (
      team_id,
      form_id,
      submission_id,
      publication_version,
      action_key,
      action_name,
      action_index,
      rule_id
    )
    SELECT
      team_id,
      id,
      '50000000-0000-0000-0000-000000000001',
      1,
      'enterprise:1',
      'notify',
      1,
      'enterprise'
    FROM forms
    WHERE id = '40000000-0000-0000-0000-000000000001'
  $$,
  '42501',
  NULL,
  'authenticated clients cannot write action execution state directly'
);

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
