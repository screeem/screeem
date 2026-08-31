BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(53);

INSERT INTO auth.users (
  id, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  (
    '60000000-0000-0000-0000-000000000001',
    'integration-one@example.com',
    '{}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  ),
  (
    '60000000-0000-0000-0000-000000000002',
    'integration-two@example.com',
    '{}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  );

SELECT has_table('integration_connections');
SELECT has_table('integration_credentials');
SELECT has_table('integration_team_controls');
SELECT has_column('integration_connections', 'provider');
SELECT has_column('integration_connections', 'status');
SELECT has_column('integration_connections', 'revision');
SELECT has_column('integration_credentials', 'sealed_payload');
SELECT has_column('integration_credentials', 'revision');
SELECT has_column('integration_team_controls', 'revision');
SELECT has_index('integration_connections', 'integration_connections_team_provider_key');
SELECT has_index('integration_connections', 'integration_connections_team_created_idx');
SELECT has_index('integration_connections', 'integration_connections_provider_external_account_active_key');
SELECT col_is_pk('integration_credentials', ARRAY['team_id', 'connection_id']);

SELECT lives_ok(
  $$
    INSERT INTO integration_connections (
      id, team_id, provider, status, health, display_name, created_by, updated_by
    )
    SELECT
      '61000000-0000-0000-0000-000000000001', id, 'example', 'connected',
      'healthy', 'First workspace', created_by, created_by
    FROM teams
    WHERE created_by = '60000000-0000-0000-0000-000000000001'
    ORDER BY created_at
    LIMIT 1
  $$,
  'a valid integration connection satisfies the schema'
);

SELECT lives_ok(
  $$
    INSERT INTO integration_connections (
      id, team_id, provider, status, health, display_name, created_by, updated_by
    )
    SELECT
      '61000000-0000-0000-0000-000000000002', id, 'example', 'connected',
      'healthy', 'Second workspace', created_by, created_by
    FROM teams
    WHERE created_by = '60000000-0000-0000-0000-000000000002'
    ORDER BY created_at
    LIMIT 1
  $$,
  'the same provider can be connected independently by another team'
);

SELECT lives_ok(
  $$
    INSERT INTO integration_connections (
      id, team_id, provider, status, health, external_account_id, created_by, updated_by
    )
    SELECT
      '61000000-0000-0000-0000-000000000011', id, 'instagram', 'connected',
      'healthy', 'instagram-account-one', created_by, created_by
    FROM teams
    WHERE created_by = '60000000-0000-0000-0000-000000000001'
    ORDER BY created_at
    LIMIT 1
  $$,
  'a social account can be connected to one team'
);

SELECT throws_ok(
  $$
    INSERT INTO integration_connections (
      id, team_id, provider, status, health, external_account_id, created_by, updated_by
    )
    SELECT
      '61000000-0000-0000-0000-000000000012', id, 'instagram', 'connected',
      'healthy', 'instagram-account-one', created_by, created_by
    FROM teams
    WHERE created_by = '60000000-0000-0000-0000-000000000002'
    ORDER BY created_at
    LIMIT 1
  $$,
  '23505', NULL, 'an active social account cannot be shared across teams'
);

SELECT lives_ok(
  $$
    UPDATE integration_connections
    SET status = 'disconnected', enabled = false, disabled_at = now(), disconnected_at = now()
    WHERE id = '61000000-0000-0000-0000-000000000011'
  $$,
  'a social account can be released by disconnecting it'
);

SELECT lives_ok(
  $$
    INSERT INTO integration_connections (
      id, team_id, provider, status, health, external_account_id, created_by, updated_by
    )
    SELECT
      '61000000-0000-0000-0000-000000000012', id, 'instagram', 'connected',
      'healthy', 'instagram-account-one', created_by, created_by
    FROM teams
    WHERE created_by = '60000000-0000-0000-0000-000000000002'
    ORDER BY created_at
    LIMIT 1
  $$,
  'a disconnected social account can be connected to another team'
);

DELETE FROM integration_connections
WHERE id IN (
  '61000000-0000-0000-0000-000000000011',
  '61000000-0000-0000-0000-000000000012'
);

SELECT throws_ok(
  $$
    INSERT INTO integration_connections (team_id, provider, status)
    SELECT team_id, 'example', 'connected'
    FROM integration_connections
    WHERE id = '61000000-0000-0000-0000-000000000001'
  $$,
  '23505', NULL, 'a team cannot create duplicate provider connections'
);
SELECT throws_ok(
  $$ UPDATE integration_connections SET provider = 'Invalid Provider' WHERE id = '61000000-0000-0000-0000-000000000001' $$,
  '23514', NULL, 'provider names are canonical and bounded'
);
SELECT throws_ok(
  $$ UPDATE integration_connections SET status = 'pending' WHERE id = '61000000-0000-0000-0000-000000000001' $$,
  '23514', NULL, 'connection auth status is closed'
);
SELECT throws_ok(
  $$ UPDATE integration_connections SET health = 'offline' WHERE id = '61000000-0000-0000-0000-000000000001' $$,
  '23514', NULL, 'connection health is closed'
);
SELECT throws_ok(
  $$ UPDATE integration_connections SET enabled = false WHERE id = '61000000-0000-0000-0000-000000000001' $$,
  '23514', NULL, 'disabling a connection requires an audit timestamp'
);
SELECT throws_ok(
  $$ UPDATE integration_connections SET status = 'disconnected' WHERE id = '61000000-0000-0000-0000-000000000001' $$,
  '23514', NULL, 'disconnecting a connection requires an audit timestamp'
);
SELECT throws_ok(
  $$ UPDATE integration_connections SET status = 'disconnecting' WHERE id = '61000000-0000-0000-0000-000000000001' $$,
  '23514', NULL, 'a disconnecting connection must be disabled'
);
SELECT lives_ok(
  $$ UPDATE integration_connections
     SET status = 'disconnecting', enabled = false, disabled_at = now()
     WHERE id = '61000000-0000-0000-0000-000000000001' $$,
  'a disconnecting connection is disabled while its credential is retained'
);

SELECT lives_ok(
  $$
    INSERT INTO integration_credentials (
      team_id, connection_id, key_id, sealed_payload
    )
    SELECT team_id, id, 'key-v1', 'v1.b3BhcXVlLWNpcGhlcnRleHQ'
    FROM integration_connections
    WHERE id = '61000000-0000-0000-0000-000000000001'
  $$,
  'a sealed credential can be stored for its tenant connection'
);

SELECT throws_ok(
  $$
    INSERT INTO integration_credentials (
      team_id, connection_id, key_id, sealed_payload
    )
    SELECT second.team_id, first.id, 'key-v1', 'v1.Y3Jvc3MtdGVuYW50'
    FROM integration_connections AS first
    CROSS JOIN integration_connections AS second
    WHERE first.id = '61000000-0000-0000-0000-000000000001'
      AND second.id = '61000000-0000-0000-0000-000000000002'
  $$,
  '23503', NULL, 'credential foreign keys cannot cross tenants'
);
SELECT throws_ok(
  $$ UPDATE integration_credentials SET sealed_payload = '' $$,
  '23514', NULL, 'sealed credentials cannot be empty'
);
SELECT throws_ok(
  $$ UPDATE integration_credentials SET key_id = 'bad key' $$,
  '23514', NULL, 'credential key identifiers are canonical'
);

SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'integration_connections'::regclass),
  true,
  'connection metadata has row-level security'
);
SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'integration_credentials'::regclass),
  true,
  'sealed credentials have row-level security'
);
SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'integration_team_controls'::regclass),
  true,
  'team controls have row-level security'
);

SELECT is(has_table_privilege('anon', 'integration_connections', 'SELECT'), false, 'anon cannot read integration metadata');
SELECT is(has_table_privilege('anon', 'integration_team_controls', 'SELECT'), false, 'anon cannot read integration controls');
SELECT is(has_table_privilege('anon', 'integration_credentials', 'SELECT'), false, 'anon cannot read credentials');
SELECT is(has_table_privilege('authenticated', 'integration_connections', 'SELECT'), true, 'authenticated can read metadata through RLS');
SELECT is(has_table_privilege('authenticated', 'integration_team_controls', 'SELECT'), true, 'authenticated can read controls through RLS');
SELECT is(has_table_privilege('authenticated', 'integration_credentials', 'SELECT'), false, 'authenticated cannot read credentials');
SELECT is(has_table_privilege('authenticated', 'integration_credentials', 'INSERT'), false, 'authenticated cannot insert credentials');
SELECT is(has_table_privilege('authenticated', 'integration_credentials', 'UPDATE'), false, 'authenticated cannot update credentials');
SELECT is(has_table_privilege('service_role', 'integration_credentials', 'SELECT'), true, 'service role can read credentials');
SELECT is(has_table_privilege('service_role', 'integration_credentials', 'INSERT'), true, 'service role can insert credentials');
SELECT is(has_table_privilege('service_role', 'integration_credentials', 'UPDATE'), true, 'service role can update credentials');

INSERT INTO integration_team_controls (team_id, enabled, updated_by)
SELECT team_id, true, created_by
FROM integration_connections
ORDER BY team_id;

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"60000000-0000-0000-0000-000000000001"}',
  true
);

SELECT is(
  (
    SELECT count(*)
    FROM integration_connections
    WHERE id = '61000000-0000-0000-0000-000000000001'
  ),
  1::bigint,
  'a member can read safe connection metadata for their team'
);
SELECT is(
  (
    SELECT count(*)
    FROM integration_connections
    WHERE id = '61000000-0000-0000-0000-000000000002'
  ),
  0::bigint,
  'a member cannot read another team connection'
);
SELECT is(
  (SELECT count(*) FROM integration_team_controls),
  1::bigint,
  'a member can read their team integration control'
);
SELECT throws_ok(
  $$ SELECT * FROM integration_credentials $$,
  '42501', NULL, 'authenticated clients cannot read sealed credentials'
);
SELECT throws_ok(
  $$
    INSERT INTO integration_connections (team_id, provider, status)
    SELECT team_id, 'blocked', 'connected'
    FROM integration_connections
    LIMIT 1
  $$,
  '42501', NULL, 'authenticated clients cannot create connections directly'
);
SELECT throws_ok(
  $$ UPDATE integration_connections SET health = 'degraded' $$,
  '42501', NULL, 'authenticated clients cannot mutate connection state directly'
);
SELECT throws_ok(
  $$ INSERT INTO integration_team_controls (team_id) SELECT id FROM teams LIMIT 1 $$,
  '42501', NULL, 'authenticated clients cannot create team controls directly'
);
SELECT throws_ok(
  $$ UPDATE integration_team_controls SET enabled = false, disabled_at = now() $$,
  '42501', NULL, 'authenticated clients cannot mutate team controls directly'
);

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
