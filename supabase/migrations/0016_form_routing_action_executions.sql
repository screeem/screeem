ALTER TABLE form_submissions
  ADD CONSTRAINT form_submissions_team_form_id_key UNIQUE (team_id, form_id, id);

CREATE TABLE form_submission_action_executions (
  team_id uuid NOT NULL,
  form_id uuid NOT NULL,
  submission_id uuid NOT NULL,
  publication_version bigint NOT NULL,
  action_key text NOT NULL CHECK (action_key <> '' AND length(action_key) <= 160),
  action_name text NOT NULL CHECK (action_name <> '' AND length(action_name) <= 128),
  action_index integer NOT NULL CHECK (action_index BETWEEN 0 AND 9),
  rule_id text NOT NULL CHECK (rule_id <> '' AND length(rule_id) <= 128),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'succeeded', 'failed')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 3),
  last_error text CHECK (last_error IS NULL OR length(last_error) <= 128),
  output jsonb CHECK (output IS NULL OR pg_column_size(output) <= 131072),
  next_attempt_at timestamp with time zone NOT NULL DEFAULT now(),
  lease_expires_at timestamp with time zone,
  started_at timestamp with time zone,
  completed_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, submission_id, action_key),
  CONSTRAINT form_submission_action_execution_index_key
    UNIQUE (team_id, submission_id, action_index),
  CONSTRAINT form_submission_action_execution_submission_fkey
    FOREIGN KEY (team_id, form_id, submission_id)
    REFERENCES form_submissions (team_id, form_id, id)
    ON DELETE CASCADE,
  CONSTRAINT form_submission_action_execution_publication_fkey
    FOREIGN KEY (team_id, form_id, publication_version)
    REFERENCES form_definition_versions (team_id, form_id, version)
);

CREATE INDEX form_submission_action_pending_idx
  ON form_submission_action_executions (next_attempt_at, created_at)
  WHERE status = 'pending' AND attempt_count < 3;

CREATE INDEX form_submission_action_running_lease_idx
  ON form_submission_action_executions (lease_expires_at, created_at)
  WHERE status = 'running';

CREATE INDEX form_submission_action_team_form_created_idx
  ON form_submission_action_executions (team_id, form_id, created_at DESC);

ALTER TABLE form_submission_action_executions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can read team form action executions"
  ON form_submission_action_executions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM team_members
      WHERE team_members.team_id = form_submission_action_executions.team_id
        AND team_members.user_id = auth.uid()
    )
  );
