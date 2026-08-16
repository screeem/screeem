BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(2);

INSERT INTO auth.users (
  id, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES (
  '84000000-0000-0000-0000-000000000001',
  'social-platform-owner@example.com',
  '{}'::jsonb,
  '{}'::jsonb,
  now(),
  now()
);

SELECT lives_ok(
  $$
    INSERT INTO social_accounts (user_id, team_id, platform, handle)
    SELECT created_by, id, 'instagram', 'screeem'
    FROM teams
    WHERE created_by = '84000000-0000-0000-0000-000000000001'
  $$,
  'Instagram accounts are supported'
);

SELECT throws_ok(
  $$
    INSERT INTO social_accounts (user_id, team_id, platform, handle)
    SELECT created_by, id, 'unsupported', 'screeem'
    FROM teams
    WHERE created_by = '84000000-0000-0000-0000-000000000001'
  $$,
  '23514', NULL,
  'unsupported social account platforms are rejected'
);

SELECT * FROM finish();
ROLLBACK;
