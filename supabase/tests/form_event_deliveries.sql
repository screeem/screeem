BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(29);

INSERT INTO auth.users (
  id, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES (
  '30000000-0000-0000-0000-000000000001',
  'form-events@example.com',
  '{}'::jsonb,
  '{}'::jsonb,
  now(),
  now()
);

INSERT INTO forms (id, team_id, name, created_by)
SELECT
  '40000000-0000-0000-0000-000000000001',
  id,
  'Form event delivery test',
  '30000000-0000-0000-0000-000000000001'
FROM teams
WHERE created_by = '30000000-0000-0000-0000-000000000001';

UPDATE forms
SET legacy_unstructured = false, definition_availability = 'active', published_version = 1
WHERE id = '40000000-0000-0000-0000-000000000001';

INSERT INTO form_definition_versions (
  team_id, form_id, version, draft_revision, definition, published_at
)
SELECT
  team_id, id, 1, 1, '{"formatVersion":1,"title":"Qualification","fields":[]}'::jsonb, now()
FROM forms
WHERE id = '40000000-0000-0000-0000-000000000001';

INSERT INTO form_submissions (
  id, team_id, form_id, publication_version, payload,
  routing_status, routing_route, matched_rule_id
)
SELECT
  '50000000-0000-0000-0000-000000000001',
  team_id, id, 1, '{"employees":750}'::jsonb, 'matched', 'sales', 'enterprise'
FROM forms
WHERE id = '40000000-0000-0000-0000-000000000001';

SELECT has_table('form_event_deliveries');
SELECT has_column('form_event_deliveries', 'event_type');
SELECT has_column('form_event_deliveries', 'event_payload');
SELECT has_column('form_event_deliveries', 'delivery_key');
SELECT has_column('form_event_deliveries', 'delivery_kind');
SELECT has_column('form_event_deliveries', 'stream_sequence');
SELECT col_is_pk('form_event_deliveries', ARRAY['team_id', 'event_id', 'delivery_key']);
SELECT has_index('form_event_deliveries', 'form_event_delivery_pending_idx');
SELECT has_index('form_event_deliveries', 'form_event_delivery_running_lease_idx');
SELECT has_index('form_event_deliveries', 'form_event_delivery_sequence_key');
SELECT has_index('form_event_deliveries', 'form_event_delivery_stream_sequence_key');
SELECT has_index('form_event_deliveries', 'form_event_delivery_team_form_created_idx');
SELECT is(
  (
    SELECT pg_get_expr(index.indpred, index.indrelid)
    FROM pg_index AS index
    JOIN pg_class AS relation ON relation.oid = index.indexrelid
    WHERE relation.relname = 'form_event_delivery_pending_idx'
  ),
  '((status = ''pending''::text) AND (attempt_count < 3))',
  'the pending index only tracks retryable work'
);

SELECT lives_ok(
  $$
    INSERT INTO form_event_deliveries (
      team_id, form_id, submission_id, publication_version,
      event_id, event_type, event_occurred_at, event_payload,
      delivery_kind, registration_name, delivery_key, sequence, stream_sequence
    )
    SELECT
      team_id, id, '50000000-0000-0000-0000-000000000001', 1,
      '50000000-0000-0000-0000-000000000001:routing.matched',
      'routing.matched', now(),
      '{"publicationVersion":1,"submissionId":"50000000-0000-0000-0000-000000000001","submission":{"employees":750},"ruleId":"enterprise","route":"sales"}'::jsonb,
      'routing_action',
      'notify',
      '50000000-0000-0000-0000-000000000001:routing.matched:0',
      0, 0
    FROM forms
    WHERE id = '40000000-0000-0000-0000-000000000001'
  $$,
  'a valid event delivery satisfies the schema'
);

SELECT results_eq(
  $$
    SELECT status, attempt_count, last_error
    FROM form_event_deliveries
    WHERE submission_id = '50000000-0000-0000-0000-000000000001'
  $$,
  $$ VALUES ('pending'::text, 0, NULL::text) $$,
  'delivery defaults are stable'
);

SELECT throws_ok(
  $$ UPDATE form_event_deliveries SET status = 'unknown' $$,
  '23514', NULL, 'unknown statuses are rejected'
);
SELECT throws_ok(
  $$ UPDATE form_event_deliveries SET attempt_count = 4 $$,
  '23514', NULL, 'attempts remain bounded'
);
SELECT throws_ok(
  $$ UPDATE form_event_deliveries SET sequence = 100 $$,
  '23514', NULL, 'delivery order remains bounded'
);
SELECT throws_ok(
  $$ UPDATE form_event_deliveries SET stream_sequence = 100 $$,
  '23514', NULL, 'submission stream order remains bounded'
);
SELECT throws_ok(
  $$ UPDATE form_submissions SET routing_route = '' $$,
  '23514', NULL, 'submission routes cannot be empty'
);
SELECT throws_ok(
  $$ UPDATE form_submissions SET matched_rule_id = '' $$,
  '23514', NULL, 'matched rule IDs cannot be empty'
);
SELECT throws_ok(
  $$ UPDATE form_submissions SET routing_route = NULL $$,
  '23514', NULL, 'matched submissions require a route'
);
SELECT throws_ok(
  $$ UPDATE form_submissions SET matched_rule_id = NULL $$,
  '23514', NULL, 'matched submissions require a rule ID'
);
SELECT throws_ok(
  $$ UPDATE form_submissions SET routing_status = 'fallback', routing_route = NULL, matched_rule_id = NULL $$,
  '23514', NULL, 'fallback submissions require a route'
);
SELECT throws_ok(
  $$ UPDATE form_event_deliveries SET event_payload = jsonb_build_object('value', repeat('x', 270000)) $$,
  '23514', NULL, 'event payloads remain bounded'
);
SELECT throws_ok(
  $$ UPDATE form_event_deliveries SET output = jsonb_build_object('value', repeat('x', 140000)) $$,
  '23514', NULL, 'delivery output remains bounded'
);
SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'form_event_deliveries'::regclass),
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
  (SELECT count(*) FROM form_event_deliveries),
  1::bigint,
  'a team member can read delivery status'
);
SELECT throws_ok(
  $$
    INSERT INTO form_event_deliveries (
      team_id, form_id, submission_id, publication_version,
      event_id, event_type, event_occurred_at, event_payload,
      delivery_kind, registration_name, delivery_key, sequence, stream_sequence
    )
    SELECT
      team_id, id, '50000000-0000-0000-0000-000000000001', 1,
      'blocked', 'routing.matched', now(), '{}'::jsonb,
      'routing_action', 'notify', 'blocked:0', 0, 0
    FROM forms
    WHERE id = '40000000-0000-0000-0000-000000000001'
  $$,
  '42501', NULL, 'authenticated clients cannot write delivery state'
);

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
