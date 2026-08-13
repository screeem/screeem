BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(47);

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
    SELECT save_form_submission_with_routing_if_active(
      '20000000-0000-0000-0000-000000000001',
      2,
      '{"age": 21}'::jsonb,
      'not_configured',
      NULL,
      NULL,
      NULL,
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
        PERFORM save_form_submission_with_routing_if_active(
          '20000000-0000-0000-0000-000000000001',
          2,
          jsonb_build_object('age', 21, 'submission', submission_number),
          'not_configured',
          NULL,
          NULL,
          NULL,
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

SELECT lives_ok(
  $$
    SELECT save_form_routing_draft(
      (SELECT id FROM teams WHERE created_by = '10000000-0000-0000-0000-000000000001'),
      '20000000-0000-0000-0000-000000000001',
      1,
      '{
        "version": 1,
        "rules": [{
          "id": "adult",
          "when": "submission.age >= 18",
          "route": "allow"
        }],
        "fallback": "deny"
      }'::jsonb
    )
  $$,
  'routing saves against the shared form draft revision'
);

SELECT results_eq(
  $$
    SELECT draft_revision, routing_draft ->> 'fallback'
    FROM forms
    WHERE id = '20000000-0000-0000-0000-000000000001'
  $$,
  $$ VALUES (2::bigint, 'deny'::text) $$,
  'routing advances the shared revision and remains team-scoped on the form row'
);

SELECT set_config(
  'request.jwt.claim.sub',
  '10000000-0000-0000-0000-000000000001',
  true
);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$
    UPDATE forms
    SET routing_draft = '{"version": 1, "rules": [], "fallback": "bypass"}'::jsonb
    WHERE id = '20000000-0000-0000-0000-000000000001'
  $$,
  'P0001',
  'form_lifecycle_fields_require_rpc',
  'an authenticated manager cannot bypass the routing revision RPC'
);

SELECT lives_ok(
  $$
    UPDATE forms
    SET name = 'Lifecycle metadata update'
    WHERE id = '20000000-0000-0000-0000-000000000001'
  $$,
  'an authenticated manager can still update ordinary form metadata'
);
RESET ROLE;

SET LOCAL ROLE service_role;
SELECT lives_ok(
  $$
    SELECT save_form_routing_draft(
      (SELECT id FROM teams WHERE created_by = '10000000-0000-0000-0000-000000000001'),
      '20000000-0000-0000-0000-000000000001',
      2,
      (SELECT routing_draft FROM forms WHERE id = '20000000-0000-0000-0000-000000000001')
    )
  $$,
  'the service role can use the guarded routing lifecycle RPC'
);
RESET ROLE;

SELECT throws_ok(
  $$
    SELECT save_form_definition_draft(
      (SELECT id FROM teams WHERE created_by = '10000000-0000-0000-0000-000000000001'),
      '20000000-0000-0000-0000-000000000001',
      1,
      (SELECT draft_definition FROM forms WHERE id = '20000000-0000-0000-0000-000000000001')
    )
  $$,
  'P0001',
  'form_revision_conflict:3',
  'a routing save makes an older form edit stale'
);

SELECT throws_ok(
  $$
    SELECT save_form_submission_with_routing_if_active(
      '20000000-0000-0000-0000-000000000001',
      2,
      '{"age": 21}'::jsonb,
      'not_configured',
      NULL,
      NULL,
      NULL,
      'https://example.com',
      'form-rate-limit-test'
    )
  $$,
  'P0001',
  'form_rate_limited',
  'the sixty-first submission in a minute is rejected'
);

UPDATE form_submissions
SET created_at = clock_timestamp() - interval '2 minutes'
WHERE form_id = '20000000-0000-0000-0000-000000000001';

SELECT throws_ok(
  $$
    SELECT save_form_routing_draft(
      '00000000-0000-0000-0000-000000000099',
      '20000000-0000-0000-0000-000000000001',
      3,
      NULL
    )
  $$,
  'P0001',
  'form_not_found',
  'another team cannot save routing for the form'
);

SELECT lives_ok(
  $$
    SELECT publish_form_definition(
      (SELECT id FROM teams WHERE created_by = '10000000-0000-0000-0000-000000000001'),
      '20000000-0000-0000-0000-000000000001',
      3,
      '2026-08-12T11:00:00Z'
    )
  $$,
  'form and routing publish in one version operation'
);

SELECT is(
  (
    SELECT routing_definition -> 'rules' -> 0 ->> 'id'
    FROM form_definition_versions
    WHERE form_id = '20000000-0000-0000-0000-000000000001' AND version = 3
  ),
  'adult',
  'the immutable form version contains its exact routing snapshot'
);

SELECT lives_ok(
  $$
    SELECT save_form_submission_with_routing_if_active(
      '20000000-0000-0000-0000-000000000001',
      3,
      '{"age": 21}'::jsonb,
      'matched',
      'allow',
      'adult',
      NULL,
      'https://example.com',
      'form-routing-result-test'
    )
  $$,
  'a routed submission saves against its exact publication'
);

SELECT results_eq(
  $$
    SELECT publication_version, routing_status, routing_route, matched_rule_id, routing_error
    FROM form_submissions
    WHERE form_id = '20000000-0000-0000-0000-000000000001'
      AND user_agent = 'form-routing-result-test'
  $$,
  $$ VALUES (3::bigint, 'matched'::text, 'allow'::text, 'adult'::text, NULL::text) $$,
  'the selected route and matched rule remain associated with the checked version'
);

SELECT results_eq(
  $$
    SELECT route
    FROM list_form_submission_routes(
      (SELECT team_id FROM forms WHERE id = '20000000-0000-0000-0000-000000000001'),
      '20000000-0000-0000-0000-000000000001'
    )
  $$,
  $$ VALUES ('allow'::text) $$,
  'route filters list the tenant form destinations'
);

SELECT is(
  (
    SELECT count(*)
    FROM list_form_submission_routes(
      '00000000-0000-0000-0000-000000000099',
      '20000000-0000-0000-0000-000000000001'
    )
  ),
  0::bigint,
  'route filters cannot cross tenant boundaries'
);

SELECT ok(
  NOT has_function_privilege(
    'anon',
    'list_form_submission_routes(uuid,uuid)',
    'EXECUTE'
  ),
  'anonymous callers cannot list private routing destinations'
);

SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'list_form_submission_routes(uuid,uuid)',
    'EXECUTE'
  ),
  'authenticated clients cannot bypass the tenant-scoped route API'
);

SELECT ok(
  NOT has_function_privilege(
    'anon',
    'save_form_submission_with_routing_if_active(uuid,bigint,jsonb,text,text,text,text,text,text)',
    'EXECUTE'
  ),
  'anonymous callers cannot forge stored routing results'
);

SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'save_form_submission_with_routing_if_active(uuid,bigint,jsonb,text,text,text,text,text,text)',
    'EXECUTE'
  ),
  'authenticated clients cannot bypass server-side routing evaluation'
);

SELECT lives_ok(
  $$
    SELECT save_form_routing_draft(
      (SELECT id FROM teams WHERE created_by = '10000000-0000-0000-0000-000000000001'),
      '20000000-0000-0000-0000-000000000001',
      3,
      '{"version": 1, "rules": [], "fallback": "review"}'::jsonb
    )
  $$,
  'a new routing draft can be prepared after publication'
);

SELECT ok(
  to_regprocedure('save_form_submission_if_active(uuid,bigint,jsonb,text,text)') IS NOT NULL,
  'the previous submission RPC remains available during rolling deploys'
);

SELECT ok(
  NOT has_function_privilege(
    'anon',
    'save_form_submission_if_active(uuid,bigint,jsonb,text,text)',
    'EXECUTE'
  ),
  'anonymous callers cannot bypass submission validation through the previous RPC'
);

SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'save_form_submission_if_active(uuid,bigint,jsonb,text,text)',
    'EXECUTE'
  ),
  'authenticated clients cannot bypass submission validation through the previous RPC'
);

SELECT is(
  (
    SELECT routing_definition ->> 'fallback'
    FROM form_definition_versions
    WHERE form_id = '20000000-0000-0000-0000-000000000001' AND version = 3
  ),
  'deny',
  'later routing edits do not mutate the published snapshot'
);

SELECT throws_ok(
  $$
    UPDATE form_definition_versions
    SET routing_definition = '{"version": 1, "rules": [], "fallback": "mutated"}'::jsonb
    WHERE form_id = '20000000-0000-0000-0000-000000000001' AND version = 3
  $$,
  'P0001',
  'published_form_versions_are_immutable',
  'published routing rejects direct updates'
);

SELECT has_index('forms', 'forms_team_created_idx', 'team form lists have a tenant-first index');
SELECT has_index(
  'form_submissions',
  'form_submissions_team_form_created_idx',
  'submission lists have a tenant-first index'
);
SELECT has_index(
  'form_submissions',
  'form_submissions_team_form_route_created_idx',
  'route filters have a tenant-first index'
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
    SELECT save_form_submission_with_routing_if_active(
      '20000000-0000-0000-0000-000000000001',
      2,
      '{"age": 22}'::jsonb,
      'not_configured',
      NULL,
      NULL,
      NULL,
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
