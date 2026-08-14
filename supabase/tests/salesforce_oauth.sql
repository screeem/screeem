BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(36);

SELECT has_table('integration_oauth_attempts');
SELECT has_table('integration_oauth_states');
SELECT has_table('integration_refresh_leases');
SELECT has_column('integration_oauth_attempts', 'attempt_id');
SELECT has_column('integration_oauth_states', 'state_hash');
SELECT has_column('integration_oauth_states', 'attempt_id');
SELECT has_column('integration_oauth_states', 'team_id');
SELECT has_column('integration_oauth_states', 'user_id');
SELECT hasnt_column('integration_oauth_states', 'consumed_at');
SELECT has_index('integration_oauth_attempts', 'integration_oauth_attempts_expires_idx');
SELECT has_index('integration_oauth_states', 'integration_oauth_states_expires_idx');
SELECT col_is_pk('integration_refresh_leases', ARRAY['team_id', 'connection_id']);
SELECT has_index('integration_refresh_leases', 'integration_refresh_leases_expires_idx');

SELECT is((SELECT relrowsecurity FROM pg_class WHERE oid = 'integration_oauth_attempts'::regclass), true, 'OAuth attempts have row-level security');
SELECT is((SELECT relrowsecurity FROM pg_class WHERE oid = 'integration_oauth_states'::regclass), true, 'OAuth states have row-level security');
SELECT is((SELECT relrowsecurity FROM pg_class WHERE oid = 'integration_refresh_leases'::regclass), true, 'refresh leases have row-level security');

SELECT is(has_table_privilege('anon', 'integration_oauth_attempts', 'SELECT'), false, 'anon cannot read OAuth attempts');
SELECT is(has_table_privilege('authenticated', 'integration_oauth_attempts', 'SELECT'), false, 'authenticated cannot read OAuth attempts');
SELECT is(has_table_privilege('authenticated', 'integration_oauth_states', 'SELECT'), false, 'authenticated cannot read OAuth state');
SELECT is(has_table_privilege('authenticated', 'integration_oauth_states', 'INSERT'), false, 'authenticated cannot create OAuth state');
SELECT is(has_table_privilege('authenticated', 'integration_refresh_leases', 'SELECT'), false, 'authenticated cannot read refresh leases');
SELECT is(has_table_privilege('authenticated', 'integration_refresh_leases', 'UPDATE'), false, 'authenticated cannot mutate refresh leases');
SELECT is(has_table_privilege('service_role', 'integration_oauth_attempts', 'SELECT'), true, 'service role can read OAuth attempts');
SELECT is(has_table_privilege('service_role', 'integration_oauth_states', 'SELECT'), true, 'service role can read OAuth state');
SELECT is(has_table_privilege('service_role', 'integration_refresh_leases', 'UPDATE'), true, 'service role can update refresh leases');

INSERT INTO auth.users (
  id, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES (
  '76000000-0000-0000-0000-000000000001',
  'salesforce-oauth@example.com',
  '{}'::jsonb, '{}'::jsonb, now(), now()
);

INSERT INTO teams (id, name, created_by) VALUES (
  '77000000-0000-0000-0000-000000000001',
  'Salesforce OAuth team',
  '76000000-0000-0000-0000-000000000001'
);

SELECT lives_ok(
  $$ INSERT INTO integration_oauth_attempts (
       team_id, provider, attempt_id, user_id, created_at, expires_at
     ) VALUES (
       '77000000-0000-0000-0000-000000000001', 'salesforce',
       '78000000-0000-0000-0000-000000000001',
       '76000000-0000-0000-0000-000000000001', now(), now() + interval '10 minutes'
     ) $$,
  'a current tenant OAuth attempt can be stored'
);

SELECT lives_ok(
  $$ INSERT INTO integration_oauth_states (
       state_hash, provider, team_id, attempt_id, user_id,
       code_verifier, return_path, created_at, expires_at
     ) VALUES (
       repeat('s', 43), 'salesforce',
       '77000000-0000-0000-0000-000000000001',
       '78000000-0000-0000-0000-000000000001',
       '76000000-0000-0000-0000-000000000001',
       repeat('v', 64), '/dashboard', now(), now() + interval '10 minutes'
     ) $$,
  'a state can reference the exact current tenant attempt'
);

SELECT throws_ok(
  $$ UPDATE integration_oauth_states SET state_hash = 'short' $$,
  '23514', NULL, 'OAuth state hashes are canonical'
);
SELECT throws_ok(
  $$ UPDATE integration_oauth_states SET return_path = '//evil.invalid' $$,
  '23514', NULL, 'OAuth return paths cannot be protocol-relative'
);
SELECT throws_ok(
  $$ UPDATE integration_oauth_states SET expires_at = created_at $$,
  '23514', NULL, 'OAuth state expiry must follow creation'
);
SELECT throws_ok(
  $$ UPDATE integration_oauth_states SET attempt_id = '78000000-0000-0000-0000-000000000002' $$,
  '23503', NULL, 'OAuth state cannot reference a different attempt'
);
SELECT throws_ok(
  $$ INSERT INTO integration_oauth_states (
       state_hash, provider, team_id, attempt_id, user_id,
       code_verifier, return_path, created_at, expires_at
     ) SELECT repeat('t', 43), provider, team_id, attempt_id, user_id,
       code_verifier, return_path, created_at, expires_at
       FROM integration_oauth_states $$,
  '23505', NULL, 'only one active state exists for a team and provider'
);
SELECT throws_ok(
  $$ INSERT INTO integration_refresh_leases (
       team_id, connection_id, owner_token, expires_at
     ) VALUES (
       '77000000-0000-0000-0000-000000000001', gen_random_uuid(),
       'short', now() + interval '20 seconds'
     ) $$,
  '23514', NULL, 'refresh lease owners are canonical'
);
SELECT throws_ok(
  $$ INSERT INTO integration_refresh_leases (
       team_id, connection_id, owner_token, updated_at, expires_at
     ) VALUES (
       '77000000-0000-0000-0000-000000000001', gen_random_uuid(),
       repeat('o', 43), now(), now()
     ) $$,
  '23514', NULL, 'refresh leases must expire after their update time'
);
SELECT throws_ok(
  $$ INSERT INTO integration_refresh_leases (
       team_id, connection_id, owner_token, expires_at
     ) VALUES (
       '77000000-0000-0000-0000-000000000001', gen_random_uuid(),
       repeat('o', 43), now() + interval '20 seconds'
     ) $$,
  '23503', NULL, 'refresh leases require an exact tenant connection'
);

SELECT is(
  (
    SELECT count(*)
    FROM pg_policy
    WHERE polrelid IN (
      'integration_oauth_attempts'::regclass,
      'integration_oauth_states'::regclass,
      'integration_refresh_leases'::regclass
    )
  ),
  0::bigint,
  'OAuth attempts, states, and refresh leases have no client RLS policies'
);

SELECT * FROM finish();
ROLLBACK;
