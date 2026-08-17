BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(19);

INSERT INTO auth.users (
  id, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  (
    '90000000-0000-0000-0000-000000000001',
    'storage-owner@example.com',
    '{}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  ),
  (
    '90000000-0000-0000-0000-000000000002',
    'storage-member@example.com',
    '{}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  ),
  (
    '90000000-0000-0000-0000-000000000003',
    'storage-outsider@example.com',
    '{}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  );

INSERT INTO team_members (team_id, user_id, role)
SELECT id, '90000000-0000-0000-0000-000000000002', 'member'
FROM teams WHERE created_by = '90000000-0000-0000-0000-000000000001';

-- Team identifiers are captured before any role switch. Reading them later as
-- an authenticated user would be filtered by team row level security, which
-- would silently turn the cross-team cases below into empty statements.
CREATE TEMP TABLE storage_fixture AS
SELECT
  (SELECT id FROM teams WHERE created_by = '90000000-0000-0000-0000-000000000001') AS owner_team,
  (SELECT id FROM teams WHERE created_by = '90000000-0000-0000-0000-000000000003') AS outsider_team;

GRANT SELECT ON storage_fixture TO authenticated;

SELECT is(
  (SELECT public FROM storage.buckets WHERE id = 'team-objects'),
  false,
  'the team object bucket is private'
);
SELECT is(
  (SELECT file_size_limit FROM storage.buckets WHERE id = 'team-objects'),
  52428800::bigint,
  'the team object bucket caps object size'
);

SELECT is(
  storage_object_team_id('teams/90000000-0000-0000-0000-000000000001/post-media/cover.png'),
  '90000000-0000-0000-0000-000000000001'::uuid,
  'the owning team is read from the second path segment'
);
SELECT is(
  storage_object_team_id('post-media/cover.png'),
  NULL,
  'paths without the tenant root have no owning team'
);
SELECT is(
  storage_object_team_id('teams/90000000-0000-0000-0000-000000000001/post-media'),
  NULL,
  'paths without an object segment have no owning team'
);
SELECT is(
  storage_object_team_id('teams/not-a-uuid/post-media/cover.png'),
  NULL,
  'paths with an unusable team segment have no owning team'
);

SELECT isnt(
  (SELECT outsider_team FROM storage_fixture),
  NULL,
  'the unrelated team used by the cross-team cases exists'
);

INSERT INTO storage.objects (id, bucket_id, name)
SELECT
  '91000000-0000-0000-0000-000000000001',
  'team-objects',
  'teams/' || owner_team || '/post-media/inside.png'
FROM storage_fixture;

INSERT INTO storage.objects (id, bucket_id, name)
SELECT
  '91000000-0000-0000-0000-000000000002',
  'team-objects',
  'teams/' || outsider_team || '/post-media/outside.png'
FROM storage_fixture;

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"90000000-0000-0000-0000-000000000002"}',
  true
);

SELECT is(
  (SELECT count(*) FROM storage.objects WHERE id = '91000000-0000-0000-0000-000000000001'),
  1::bigint,
  'a member can read objects owned by their team'
);
SELECT is(
  (SELECT count(*) FROM storage.objects WHERE id = '91000000-0000-0000-0000-000000000002'),
  0::bigint,
  'a member cannot read objects owned by another team'
);
SELECT throws_ok(
  $$
    INSERT INTO storage.objects (id, bucket_id, name)
    SELECT
      '91000000-0000-0000-0000-000000000003',
      'team-objects',
      'teams/' || owner_team || '/post-media/member-write.png'
    FROM storage_fixture
  $$,
  '42501',
  'new row violates row-level security policy for table "objects"',
  'a member cannot write team objects directly'
);

-- Storage blocks direct deletes unless the Storage API opts in, so the delete
-- policy is exercised the same way the API reaches it.
SELECT set_config('storage.allow_delete_query', 'true', true);

SELECT lives_ok(
  $$ DELETE FROM storage.objects WHERE id = '91000000-0000-0000-0000-000000000001' $$,
  'a member delete runs without removing anything'
);

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"90000000-0000-0000-0000-000000000001"}',
  true
);

SELECT is(
  (SELECT count(*) FROM storage.objects WHERE id = '91000000-0000-0000-0000-000000000001'),
  1::bigint,
  'the object a member tried to delete is still stored'
);

SELECT lives_ok(
  $$
    INSERT INTO storage.objects (id, bucket_id, name)
    SELECT
      '91000000-0000-0000-0000-000000000004',
      'team-objects',
      'teams/' || owner_team || '/post-media/manager-write.png'
    FROM storage_fixture
  $$,
  'a manager can write team objects'
);
SELECT throws_ok(
  $$
    INSERT INTO storage.objects (id, bucket_id, name)
    SELECT
      '91000000-0000-0000-0000-000000000005',
      'team-objects',
      'teams/' || outsider_team || '/post-media/cross-team.png'
    FROM storage_fixture
  $$,
  '42501',
  'new row violates row-level security policy for table "objects"',
  'a manager cannot write objects into another team prefix'
);
SELECT throws_ok(
  $$
    INSERT INTO storage.objects (id, bucket_id, name)
    VALUES (
      '91000000-0000-0000-0000-000000000006',
      'team-objects',
      'loose-object.png'
    )
  $$,
  '42501',
  'new row violates row-level security policy for table "objects"',
  'objects outside the tenant path layout are refused'
);
SELECT is(
  (SELECT count(*) FROM storage.objects WHERE id = '91000000-0000-0000-0000-000000000004'),
  1::bigint,
  'a manager can read the object they wrote'
);

-- Renaming is how an object changes prefix, so the update policy has to check
-- the destination team and not only the current one.
SELECT throws_ok(
  $$
    UPDATE storage.objects
    SET name = 'teams/' || (SELECT outsider_team FROM storage_fixture) || '/post-media/moved.png'
    WHERE id = '91000000-0000-0000-0000-000000000004'
  $$,
  '42501',
  'new row violates row-level security policy for table "objects"',
  'a manager cannot move their object into another team prefix'
);

SELECT lives_ok(
  $$ DELETE FROM storage.objects WHERE id = '91000000-0000-0000-0000-000000000004' $$,
  'a manager can delete team objects'
);
SELECT is(
  (SELECT count(*) FROM storage.objects WHERE id = '91000000-0000-0000-0000-000000000004'),
  0::bigint,
  'the object a manager deleted is gone'
);

SELECT * FROM finish();

ROLLBACK;
