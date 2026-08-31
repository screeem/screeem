ALTER TABLE integration_oauth_states
  ADD COLUMN redirect_uri text;

ALTER TABLE integration_oauth_states
  ALTER COLUMN code_verifier DROP NOT NULL;

ALTER TABLE integration_oauth_states
  DROP CONSTRAINT integration_oauth_states_code_verifier_check,
  ADD CONSTRAINT integration_oauth_states_verifier_check CHECK (
    code_verifier IS NULL OR (
      char_length(code_verifier) BETWEEN 43 AND 128
      AND code_verifier ~ '^[A-Za-z0-9._~-]+$'
    )
  ),
  ADD CONSTRAINT integration_oauth_states_redirect_uri_check CHECK (
    redirect_uri IS NULL OR (
      char_length(redirect_uri) BETWEEN 1 AND 2048
      AND redirect_uri ~ '^https?://'
    )
  ),
  DROP CONSTRAINT integration_oauth_states_return_path_check,
  ADD CONSTRAINT integration_oauth_states_return_path_check CHECK (
    char_length(return_path) BETWEEN 1 AND 512
    AND return_path LIKE '/%'
    AND return_path NOT LIKE '//%'
    AND strpos(return_path, chr(92)) = 0
    AND strpos(lower(return_path), '%5c') = 0
  ) NOT VALID;

ALTER TABLE integration_connections
  DROP CONSTRAINT integration_connections_status_check,
  ADD CONSTRAINT integration_connections_status_check CHECK (
    status IN (
      'connected',
      'reauthorization_required',
      'disconnecting',
      'disconnected'
    )
  ),
  ADD CONSTRAINT integration_connections_disconnecting_state_check CHECK (
    status <> 'disconnecting'
    OR (NOT enabled AND disabled_at IS NOT NULL AND disconnected_at IS NULL)
  );

CREATE UNIQUE INDEX integration_connections_provider_external_account_active_key
  ON integration_connections (provider, external_account_id)
  WHERE provider IN ('instagram', 'tiktok')
    AND external_account_id IS NOT NULL
    AND status <> 'disconnected';
