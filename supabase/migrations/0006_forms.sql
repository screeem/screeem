-- Team-owned, write-only public form endpoints and their submissions.
CREATE TABLE forms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 80),
  endpoint_key uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  allowed_origin text,
  success_url text,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX forms_team_id_idx ON forms(team_id);

CREATE TABLE form_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id uuid NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  origin text,
  user_agent text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX form_submissions_form_created_idx ON form_submissions(form_id, created_at DESC);

ALTER TABLE forms ENABLE ROW LEVEL SECURITY;
ALTER TABLE form_submissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can read team forms" ON forms
  FOR SELECT USING (is_team_member(team_id));
CREATE POLICY "Managers can create team forms" ON forms
  FOR INSERT WITH CHECK (can_manage_team(team_id) AND created_by = auth.uid());
CREATE POLICY "Managers can update team forms" ON forms
  FOR UPDATE USING (can_manage_team(team_id)) WITH CHECK (can_manage_team(team_id));
CREATE POLICY "Managers can delete team forms" ON forms
  FOR DELETE USING (can_manage_team(team_id));

CREATE POLICY "Members can read team form submissions" ON form_submissions
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM forms WHERE forms.id = form_id AND is_team_member(forms.team_id))
  );

-- Public inserts go through the server-side submission endpoint. There is no
-- anonymous table policy, so endpoint status and stored submissions stay private.
