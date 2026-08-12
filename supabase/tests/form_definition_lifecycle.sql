BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(23);

INSERT INTO auth.users (
  id,
  email,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
) VALUES (
  '10000000-0000-0000-0000-000000000001',
  'forms-lifecycle@example.com',
  '{}'::jsonb,
  '{}'::jsonb,
  now(),
  now()
);

INSERT INTO forms (id, team_id, name, created_by)
SELECT
  '20000000-0000-0000-0000-000000000001',
  id,
  'Lifecycle test',
  '10000000-0000-0000-0000-000000000001'
FROM teams
WHERE created_by = '10000000-0000-0000-0000-000000000001';

SELECT lives_ok(
  $$
    SELECT initialize_form_definition(
      (SELECT id FROM teams WHERE created_by = '10000000-0000-0000-0000-000000000001'),
      '20000000-0000-0000-0000-000000000001',
      '{
        "formatVersion": 1,
        "title": "Eligibility",
        "submitLabel": "Check eligibility",
        "successMessage": "Received",
        "fields": [{
          "id": "age-field",
          "name": "age",
          "label": "Age",
          "required": true,
          "type": "number",
          "control": "number"
        }]
      }'::jsonb
    )
  $$,
  'a legacy form can initialize its first structured draft'
);

SELECT is(
  (SELECT draft_revision FROM forms WHERE id = '20000000-0000-0000-0000-000000000001'),
  0::bigint,
  'the initial draft starts at revision zero'
);

SELECT lives_ok(
  $$
    SELECT publish_form_definition(
      (SELECT id FROM teams WHERE created_by = '10000000-0000-0000-0000-000000000001'),
      '20000000-0000-0000-0000-000000000001',
      0,
      '2026-08-12T09:00:00Z'
    )
  $$,
  'the initial draft publishes atomically'
);

SELECT results_eq(
  $$
    SELECT definition_availability, published_version, legacy_unstructured
    FROM forms
    WHERE id = '20000000-0000-0000-0000-000000000001'
  $$,
  $$ VALUES ('active'::text, 1::bigint, false) $$,
  'first publication activates version one and ends legacy mode'
);

SELECT throws_ok(
  $$
    SELECT publish_form_definition(
      (SELECT id FROM teams WHERE created_by = '10000000-0000-0000-0000-000000000001'),
      '20000000-0000-0000-0000-000000000001',
      0,
      '2026-08-12T09:01:00Z'
    )
  $$,
  'P0001',
  'form_draft_already_published',
  'one draft revision cannot be published twice'
);

SELECT lives_ok(
  $$
    SELECT save_form_definition_draft(
      (SELECT id FROM teams WHERE created_by = '10000000-0000-0000-0000-000000000001'),
      '20000000-0000-0000-0000-000000000001',
      0,
      '{
        "formatVersion": 1,
        "title": "Adult eligibility",
        "submitLabel": "Check eligibility",
        "successMessage": "Received",
        "fields": [{
          "id": "age-field",
          "name": "age",
          "label": "Age",
          "required": true,
          "type": "number",
          "control": "number",
          "validation": {"min": 18}
        }]
      }'::jsonb
    )
  $$,
  'a matching revision saves the next draft'
);

SELECT throws_ok(
  $$
    SELECT save_form_definition_draft(
      (SELECT id FROM teams WHERE created_by = '10000000-0000-0000-0000-000000000001'),
      '20000000-0000-0000-0000-000000000001',
      0,
      '{}'::jsonb
    )
  $$,
  'P0001',
  'form_revision_conflict:1',
  'a stale writer cannot replace a newer draft'
);

SELECT lives_ok(
  $$
    SELECT publish_form_definition(
      (SELECT id FROM teams WHERE created_by = '10000000-0000-0000-0000-000000000001'),
      '20000000-0000-0000-0000-000000000001',
      1,
      '2026-08-12T09:02:00Z'
    )
  $$,
  'the next saved draft publishes as another version'
);

SELECT is(
  (
    SELECT count(*)
    FROM form_definition_versions
    WHERE form_id = '20000000-0000-0000-0000-000000000001'
  ),
  2::bigint,
  'publication versions are monotonic and retained'
);

SELECT is(
  (
    SELECT team_id
    FROM form_definition_versions
    WHERE form_id = '20000000-0000-0000-0000-000000000001'
    LIMIT 1
  ),
  (SELECT team_id FROM forms WHERE id = '20000000-0000-0000-0000-000000000001'),
  'every published version carries its owning team'
);

SELECT is(
  (
    SELECT definition ->> 'title'
    FROM form_definition_versions
    WHERE form_id = '20000000-0000-0000-0000-000000000001' AND version = 1
  ),
  'Eligibility',
  'saving a new draft does not mutate an old publication'
);

SELECT lives_ok(
  $$
    SELECT save_form_submission_if_active(
      '20000000-0000-0000-0000-000000000001',
      2,
      '{"age": 21}'::jsonb,
      'https://example.com',
      'form-lifecycle-test'
    )
  $$,
  'an active form saves against the expected publication version'
);

SELECT is(
  (
    SELECT publication_version
    FROM form_submissions
    WHERE form_id = '20000000-0000-0000-0000-000000000001'
    ORDER BY created_at DESC
    LIMIT 1
  ),
  2::bigint,
  'the submission stores the exact version checked under the row lock'
);

SELECT is(
  (
    SELECT submission.team_id
    FROM form_submissions AS submission
    WHERE submission.form_id = '20000000-0000-0000-0000-000000000001'
    ORDER BY submission.created_at DESC
    LIMIT 1
  ),
  (SELECT team_id FROM forms WHERE id = '20000000-0000-0000-0000-000000000001'),
  'the submission carries the same team as its form'
);

SELECT lives_ok(
  $$
    DO $rate_limit$
    BEGIN
      FOR submission_number IN 1..59 LOOP
        PERFORM save_form_submission_if_active(
          '20000000-0000-0000-0000-000000000001',
          2,
          jsonb_build_object('age', 21, 'submission', submission_number),
          'https://example.com',
          'form-rate-limit-test'
        );
      END LOOP;
    END
    $rate_limit$
  $$,
  'the first 60 submissions in a minute are accepted'
);

SELECT is(
  (
    SELECT count(*)
    FROM form_submissions
    WHERE form_id = '20000000-0000-0000-0000-000000000001'
  ),
  60::bigint,
  'the accepted submissions are stored'
);

SELECT throws_ok(
  $$
    SELECT save_form_submission_if_active(
      '20000000-0000-0000-0000-000000000001',
      2,
      '{"age": 21}'::jsonb,
      'https://example.com',
      'form-rate-limit-test'
    )
  $$,
  'P0001',
  'form_rate_limited',
  'the sixty-first submission in a minute is rejected'
);

SELECT has_index('forms', 'forms_team_created_idx', 'team form lists have a tenant-first index');
SELECT has_index(
  'form_submissions',
  'form_submissions_team_form_created_idx',
  'submission lists have a tenant-first index'
);
SELECT has_index(
  'form_definition_versions',
  'form_definition_versions_pkey',
  'published definition lookups use their tenant-first primary key'
);
SELECT has_index(
  'team_members',
  'team_members_user_team_idx',
  'user workspace discovery has a matching index'
);

UPDATE forms
SET is_active = false, definition_availability = 'paused'
WHERE id = '20000000-0000-0000-0000-000000000001';

SELECT throws_ok(
  $$
    SELECT save_form_submission_if_active(
      '20000000-0000-0000-0000-000000000001',
      2,
      '{"age": 22}'::jsonb,
      'https://example.com',
      'form-lifecycle-test'
    )
  $$,
  'P0001',
  'form_unavailable',
  'a paused form cannot accept a submission after locking its state'
);

SELECT throws_ok(
  $$
    UPDATE form_definition_versions
    SET definition = '{}'::jsonb
    WHERE form_id = '20000000-0000-0000-0000-000000000001' AND version = 1
  $$,
  'P0001',
  'published_form_versions_are_immutable',
  'published rows reject direct updates'
);

SELECT * FROM finish();

ROLLBACK;
