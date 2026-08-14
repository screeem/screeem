CREATE TABLE integration_oauth_attempts (
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider ~ '^[a-z][a-z0-9_-]{0,63}$'),
  attempt_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  expires_at timestamp with time zone NOT NULL,
  PRIMARY KEY (team_id, provider),
  CONSTRAINT integration_oauth_attempts_identity_key
    UNIQUE (team_id, provider, attempt_id),
  CONSTRAINT integration_oauth_attempts_expiry_check CHECK (expires_at > created_at)
);

CREATE INDEX integration_oauth_attempts_expires_idx
  ON integration_oauth_attempts (expires_at);

CREATE TABLE integration_oauth_states (
  state_hash text PRIMARY KEY CHECK (state_hash ~ '^[A-Za-z0-9_-]{43}$'),
  provider text NOT NULL CHECK (provider ~ '^[a-z][a-z0-9_-]{0,63}$'),
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  attempt_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code_verifier text NOT NULL CHECK (
    char_length(code_verifier) BETWEEN 43 AND 128
    AND code_verifier ~ '^[A-Za-z0-9._~-]+$'
  ),
  return_path text NOT NULL CHECK (
    char_length(return_path) BETWEEN 1 AND 512
    AND return_path LIKE '/%'
    AND return_path NOT LIKE '//%'
  ),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  expires_at timestamp with time zone NOT NULL,
  CONSTRAINT integration_oauth_states_team_provider_key UNIQUE (team_id, provider),
  CONSTRAINT integration_oauth_states_attempt_fkey
    FOREIGN KEY (team_id, provider, attempt_id)
    REFERENCES integration_oauth_attempts (team_id, provider, attempt_id)
    ON DELETE CASCADE,
  CONSTRAINT integration_oauth_states_expiry_check CHECK (expires_at > created_at)
);

CREATE INDEX integration_oauth_states_expires_idx
  ON integration_oauth_states (expires_at);

CREATE TABLE integration_refresh_leases (
  team_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  owner_token text NOT NULL CHECK (owner_token ~ '^[A-Za-z0-9_-]{32,128}$'),
  expires_at timestamp with time zone NOT NULL,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, connection_id),
  CONSTRAINT integration_refresh_leases_connection_fkey
    FOREIGN KEY (team_id, connection_id)
    REFERENCES integration_connections (team_id, id)
    ON DELETE CASCADE,
  CONSTRAINT integration_refresh_leases_expiry_check CHECK (expires_at > updated_at)
);

CREATE INDEX integration_refresh_leases_expires_idx
  ON integration_refresh_leases (expires_at);

ALTER TABLE integration_oauth_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_oauth_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_refresh_leases ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON integration_oauth_attempts FROM anon, authenticated;
REVOKE ALL ON integration_oauth_states FROM anon, authenticated;
REVOKE ALL ON integration_refresh_leases FROM anon, authenticated;

GRANT ALL ON integration_oauth_attempts TO service_role;
GRANT ALL ON integration_oauth_states TO service_role;
GRANT ALL ON integration_refresh_leases TO service_role;
