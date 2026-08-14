CREATE TABLE integration_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider ~ '^[a-z][a-z0-9_-]{0,63}$'),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  status text NOT NULL CHECK (
    status IN ('connected', 'reauthorization_required', 'disconnected')
  ),
  health text NOT NULL DEFAULT 'unknown' CHECK (
    health IN ('unknown', 'healthy', 'degraded')
  ),
  enabled boolean NOT NULL DEFAULT true,
  display_name text CHECK (
    display_name IS NULL OR char_length(display_name) BETWEEN 1 AND 160
  ),
  external_account_id text CHECK (
    external_account_id IS NULL OR char_length(external_account_id) BETWEEN 1 AND 256
  ),
  last_error_code text CHECK (last_error_code IS NULL OR last_error_code IN (
    'authentication_failed',
    'authorization_failed',
    'invalid_configuration',
    'invalid_request',
    'provider_unavailable',
    'rate_limited',
    'unknown'
  )),
  last_checked_at timestamp with time zone,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  disabled_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  disabled_at timestamp with time zone,
  disconnected_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  disconnected_at timestamp with time zone,
  CONSTRAINT integration_connections_team_id_id_key UNIQUE (team_id, id),
  CONSTRAINT integration_connections_team_provider_key UNIQUE (team_id, provider),
  CONSTRAINT integration_connections_disabled_state_check CHECK (
    (enabled AND disabled_at IS NULL) OR (NOT enabled AND disabled_at IS NOT NULL)
  ),
  CONSTRAINT integration_connections_disconnected_state_check CHECK (
    (status = 'disconnected' AND disconnected_at IS NOT NULL)
    OR (status <> 'disconnected' AND disconnected_at IS NULL)
  )
);

CREATE INDEX integration_connections_team_created_idx
  ON integration_connections (team_id, created_at DESC);

CREATE TABLE integration_credentials (
  team_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  key_id text NOT NULL CHECK (key_id ~ '^[A-Za-z0-9._-]{1,128}$'),
  sealed_payload text NOT NULL CHECK (
    octet_length(sealed_payload) BETWEEN 1 AND 131072
    AND sealed_payload ~ '^v[0-9]+\.[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$'
  ),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, connection_id),
  CONSTRAINT integration_credentials_connection_fkey
    FOREIGN KEY (team_id, connection_id)
    REFERENCES integration_connections (team_id, id)
    ON DELETE CASCADE
);

CREATE TABLE integration_team_controls (
  team_id uuid PRIMARY KEY REFERENCES teams(id) ON DELETE CASCADE,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  enabled boolean NOT NULL DEFAULT true,
  disabled_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  disabled_at timestamp with time zone,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT integration_team_controls_disabled_state_check CHECK (
    (enabled AND disabled_at IS NULL) OR (NOT enabled AND disabled_at IS NOT NULL)
  )
);

ALTER TABLE integration_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_team_controls ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can read team integration connections"
  ON integration_connections
  FOR SELECT
  USING (is_team_member(team_id));

CREATE POLICY "Members can read team integration controls"
  ON integration_team_controls
  FOR SELECT
  USING (is_team_member(team_id));

REVOKE ALL ON integration_connections FROM anon, authenticated;
REVOKE ALL ON integration_credentials FROM anon, authenticated;
REVOKE ALL ON integration_team_controls FROM anon, authenticated;

GRANT SELECT ON integration_connections TO authenticated;
GRANT SELECT ON integration_team_controls TO authenticated;

GRANT ALL ON integration_connections TO service_role;
GRANT ALL ON integration_credentials TO service_role;
GRANT ALL ON integration_team_controls TO service_role;
