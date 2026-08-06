-- Team workspaces. Existing user-owned data is moved into a personal team.
CREATE TABLE teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 80),
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE team_members (
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  joined_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, user_id)
);

CREATE TABLE team_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  token text NOT NULL UNIQUE,
  invited_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  expires_at timestamp with time zone NOT NULL DEFAULT (now() + interval '7 days'),
  UNIQUE (team_id, email)
);

-- One personal team per existing auth user. The created_by value is a stable
-- mapping that lets the following statements move that user's existing data.
INSERT INTO teams (name, created_by)
SELECT COALESCE(NULLIF(split_part(email, '@', 1), ''), 'My') || '''s team', id
FROM auth.users;

INSERT INTO team_members (team_id, user_id, role)
SELECT id, created_by, 'owner' FROM teams;

ALTER TABLE social_accounts ADD COLUMN team_id uuid REFERENCES teams(id) ON DELETE CASCADE;
UPDATE social_accounts sa SET team_id = t.id FROM teams t WHERE t.created_by = sa.user_id;
ALTER TABLE social_accounts ALTER COLUMN team_id SET NOT NULL;
CREATE INDEX social_accounts_team_id_idx ON social_accounts(team_id);

ALTER TABLE api_keys ADD COLUMN team_id uuid REFERENCES teams(id) ON DELETE CASCADE;
UPDATE api_keys ak SET team_id = t.id FROM teams t WHERE t.created_by = ak.user_id;
ALTER TABLE api_keys ALTER COLUMN team_id SET NOT NULL;
CREATE INDEX api_keys_team_id_idx ON api_keys(team_id);

ALTER TABLE oauth_auth_codes ADD COLUMN team_id uuid REFERENCES teams(id) ON DELETE CASCADE;

-- These SECURITY DEFINER helpers avoid recursive team_members RLS checks.
CREATE OR REPLACE FUNCTION is_team_member(target_team_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM team_members
    WHERE team_id = target_team_id AND user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION can_manage_team(target_team_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM team_members
    WHERE team_id = target_team_id
      AND user_id = auth.uid()
      AND role IN ('owner', 'admin')
  );
$$;

REVOKE ALL ON FUNCTION is_team_member(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION can_manage_team(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION is_team_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION can_manage_team(uuid) TO authenticated;

ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_invitations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can read teams" ON teams
  FOR SELECT USING (is_team_member(id));
CREATE POLICY "Team managers can update teams" ON teams
  FOR UPDATE USING (can_manage_team(id)) WITH CHECK (can_manage_team(id));

CREATE POLICY "Members can read team membership" ON team_members
  FOR SELECT USING (is_team_member(team_id));

CREATE POLICY "Managers can read invitations" ON team_invitations
  FOR SELECT USING (can_manage_team(team_id));
CREATE POLICY "Managers can create invitations" ON team_invitations
  FOR INSERT WITH CHECK (can_manage_team(team_id) AND invited_by = auth.uid());
CREATE POLICY "Managers can delete invitations" ON team_invitations
  FOR DELETE USING (can_manage_team(team_id));

DROP POLICY "Users can read own social accounts" ON social_accounts;
DROP POLICY "Users can insert own social accounts" ON social_accounts;
DROP POLICY "Users can update own social accounts" ON social_accounts;
DROP POLICY "Users can delete own social accounts" ON social_accounts;
CREATE POLICY "Members can read team social accounts" ON social_accounts
  FOR SELECT USING (is_team_member(team_id));
CREATE POLICY "Managers can insert team social accounts" ON social_accounts
  FOR INSERT WITH CHECK (can_manage_team(team_id) AND user_id = auth.uid());
CREATE POLICY "Managers can update team social accounts" ON social_accounts
  FOR UPDATE USING (can_manage_team(team_id)) WITH CHECK (can_manage_team(team_id));
CREATE POLICY "Managers can delete team social accounts" ON social_accounts
  FOR DELETE USING (can_manage_team(team_id));

DROP POLICY "Users can read own api keys" ON api_keys;
DROP POLICY "Users can insert own api keys" ON api_keys;
DROP POLICY "Users can delete own api keys" ON api_keys;
CREATE POLICY "Members can read own team api keys" ON api_keys
  FOR SELECT USING (is_team_member(team_id) AND user_id = auth.uid());
CREATE POLICY "Members can insert own team api keys" ON api_keys
  FOR INSERT WITH CHECK (is_team_member(team_id) AND user_id = auth.uid());
CREATE POLICY "Members can delete own team api keys" ON api_keys
  FOR DELETE USING (is_team_member(team_id) AND user_id = auth.uid());

-- Create a profile and personal workspace for future signups.
CREATE OR REPLACE FUNCTION handle_new_screeem_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_team_id uuid;
BEGIN
  INSERT INTO profiles (id) VALUES (NEW.id) ON CONFLICT (id) DO NOTHING;
  INSERT INTO teams (name, created_by)
    VALUES (COALESCE(NULLIF(split_part(NEW.email, '@', 1), ''), 'My') || '''s team', NEW.id)
    RETURNING id INTO new_team_id;
  INSERT INTO team_members (team_id, user_id, role)
    VALUES (new_team_id, NEW.id, 'owner');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_screeem ON auth.users;
CREATE TRIGGER on_auth_user_created_screeem
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_screeem_user();
