CREATE TABLE public_api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 80),
  key_prefix text NOT NULL,
  key_hash text NOT NULL UNIQUE,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  last_used_at timestamp with time zone
);

CREATE INDEX public_api_keys_team_id_idx ON public_api_keys(team_id);

-- Public API keys are managed only by server routes after checking team roles.
-- Keeping RLS enabled without client policies prevents key metadata and hashes
-- from being accessed directly through the Supabase data API.
ALTER TABLE public_api_keys ENABLE ROW LEVEL SECURITY;
