BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(11);

INSERT INTO auth.users (
  id, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('81000000-0000-0000-0000-000000000001', 'calendar-owner@example.com', '{}', '{}', now(), now()),
  ('81000000-0000-0000-0000-000000000002', 'calendar-member@example.com', '{}', '{}', now(), now());

INSERT INTO team_members (team_id, user_id, role)
SELECT id, '81000000-0000-0000-0000-000000000002', 'member'
FROM teams WHERE created_by = '81000000-0000-0000-0000-000000000001';

SELECT has_table('calendar_post_workflows');
SELECT has_column('calendar_post_workflows', 'revision');
SELECT has_column('calendar_post_workflows', 'status');

INSERT INTO calendar_events (
  team_id, aggregate_id, client_event_id, event_type, payload, actor_id
)
SELECT id,
  '82000000-0000-0000-0000-000000000001',
  '83000000-0000-0000-0000-000000000001',
  'post.created',
  '{"title":"Launch","copy":"Hello","date":"2026-08-20","time":"09:00","colour":"violet","targets":["X"]}',
  '81000000-0000-0000-0000-000000000002'
FROM teams WHERE created_by = '81000000-0000-0000-0000-000000000001';

SELECT results_eq(
  $$ SELECT revision, status FROM calendar_post_workflows
     WHERE aggregate_id = '82000000-0000-0000-0000-000000000001' $$,
  $$ VALUES (1::bigint, 'draft'::text) $$,
  'new posts begin as revision one drafts'
);

INSERT INTO calendar_events (
  team_id, aggregate_id, client_event_id, event_type, payload, actor_id
)
SELECT id,
  '82000000-0000-0000-0000-000000000001',
  '83000000-0000-0000-0000-000000000002',
  'approval.requested', '{"revision":1,"comment":"Please review"}',
  '81000000-0000-0000-0000-000000000002'
FROM teams WHERE created_by = '81000000-0000-0000-0000-000000000001';

SELECT results_eq(
  $$ SELECT status, review_revision, requested_by
     FROM calendar_post_workflows
     WHERE aggregate_id = '82000000-0000-0000-0000-000000000001' $$,
  $$ VALUES ('in_review'::text, 1::bigint, '81000000-0000-0000-0000-000000000002'::uuid) $$,
  'a member can request review for the current revision'
);

SELECT throws_ok(
  $$
    INSERT INTO calendar_events (
      team_id, aggregate_id, client_event_id, event_type, payload, actor_id
    ) SELECT id,
      '82000000-0000-0000-0000-000000000001',
      '83000000-0000-0000-0000-000000000003',
      'approval.granted', '{"revision":1}',
      '81000000-0000-0000-0000-000000000002'
    FROM teams WHERE created_by = '81000000-0000-0000-0000-000000000001'
  $$,
  'P0001', 'calendar_approval_forbidden: manager role required',
  'ordinary members cannot approve posts'
);

INSERT INTO calendar_events (
  team_id, aggregate_id, client_event_id, event_type, payload, actor_id
)
SELECT id,
  '82000000-0000-0000-0000-000000000001',
  '83000000-0000-0000-0000-000000000004',
  'approval.granted', '{"revision":1,"comment":"Approved"}',
  '81000000-0000-0000-0000-000000000001'
FROM teams WHERE created_by = '81000000-0000-0000-0000-000000000001';

SELECT results_eq(
  $$ SELECT status FROM calendar_post_workflows
     WHERE aggregate_id = '82000000-0000-0000-0000-000000000001' $$,
  $$ VALUES ('approved'::text) $$,
  'a team manager can approve the submitted revision'
);

INSERT INTO calendar_events (
  team_id, aggregate_id, client_event_id, event_type, payload, actor_id
)
SELECT id,
  '82000000-0000-0000-0000-000000000001',
  '83000000-0000-0000-0000-000000000005',
  'copy.changed', '{"value":"Updated"}',
  '81000000-0000-0000-0000-000000000002'
FROM teams WHERE created_by = '81000000-0000-0000-0000-000000000001';

SELECT results_eq(
  $$ SELECT revision, status FROM calendar_post_workflows
     WHERE aggregate_id = '82000000-0000-0000-0000-000000000001' $$,
  $$ VALUES (2::bigint, 'draft'::text) $$,
  'editing approved content creates a new draft revision'
);

SELECT throws_ok(
  $$
    INSERT INTO calendar_events (
      team_id, aggregate_id, client_event_id, event_type, payload, actor_id
    ) SELECT id,
      '82000000-0000-0000-0000-000000000001',
      '83000000-0000-0000-0000-000000000006',
      'approval.requested', '{"revision":1}',
      '81000000-0000-0000-0000-000000000002'
    FROM teams WHERE created_by = '81000000-0000-0000-0000-000000000001'
  $$,
  'P0001', 'calendar_approval_conflict: stale revision',
  'stale revisions cannot be submitted'
);

SELECT lives_ok(
  $$
    INSERT INTO calendar_events (
      team_id, aggregate_id, client_event_id, event_type, payload, actor_id
    ) SELECT id,
      '82000000-0000-0000-0000-000000000001',
      '83000000-0000-0000-0000-000000000007',
      'approval.requested', '{"revision":2}',
      '81000000-0000-0000-0000-000000000002'
    FROM teams WHERE created_by = '81000000-0000-0000-0000-000000000001'
  $$,
  'the new revision can be submitted'
);

SELECT throws_ok(
  $$
    INSERT INTO calendar_events (
      team_id, aggregate_id, client_event_id, event_type, payload, actor_id
    ) SELECT id,
      '82000000-0000-0000-0000-000000000001',
      '83000000-0000-0000-0000-000000000007',
      'approval.requested', '{"revision":2}',
      '81000000-0000-0000-0000-000000000002'
    FROM teams WHERE created_by = '81000000-0000-0000-0000-000000000001'
  $$,
  NULL, NULL,
  'retrying a client event is handled by the unique event key'
);

SELECT * FROM finish();
ROLLBACK;
