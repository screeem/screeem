CREATE TABLE oauth_clients (
  client_id   text PRIMARY KEY,
  client_name text,
  redirect_uris text[] NOT NULL,
  created_at  timestamp with time zone DEFAULT now()
);

ALTER TABLE oauth_clients ENABLE ROW LEVEL SECURITY;
-- Service-role only: no RLS policies needed. All access goes through createAdminClient().
REVOKE ALL ON oauth_clients FROM anon, authenticated;

CREATE TABLE oauth_auth_codes (
  code          text PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id     text NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  redirect_uri  text NOT NULL,
  code_challenge text NOT NULL,
  expires_at    timestamp with time zone NOT NULL DEFAULT (now() + interval '10 minutes')
);

ALTER TABLE oauth_auth_codes ENABLE ROW LEVEL SECURITY;
-- Service-role only: no RLS policies needed. All access goes through createAdminClient().
REVOKE ALL ON oauth_auth_codes FROM anon, authenticated;
