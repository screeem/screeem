ALTER TABLE form_submissions
  ADD CONSTRAINT form_submissions_team_form_id_key UNIQUE (team_id, form_id, id);

ALTER TABLE form_submissions
  DROP CONSTRAINT form_submissions_routing_result_valid,
  ADD CONSTRAINT form_submissions_routing_result_valid CHECK (
    length(COALESCE(routing_route, '')) <= 256
    AND length(COALESCE(matched_rule_id, '')) <= 128
    AND length(COALESCE(routing_error, '')) <= 128
    AND (
      (
        routing_status = 'not_configured'
        AND routing_route IS NULL
        AND matched_rule_id IS NULL
        AND routing_error IS NULL
      )
      OR (
        routing_status = 'matched'
        AND routing_route IS NOT NULL
        AND routing_route <> ''
        AND matched_rule_id IS NOT NULL
        AND matched_rule_id <> ''
        AND routing_error IS NULL
      )
      OR (
        routing_status = 'fallback'
        AND routing_route IS NOT NULL
        AND routing_route <> ''
        AND matched_rule_id IS NULL
        AND routing_error IS NULL
      )
      OR (
        routing_status = 'failed'
        AND routing_route IS NULL
        AND matched_rule_id IS NULL
        AND routing_error IS NOT NULL
        AND routing_error <> ''
      )
    )
  );

CREATE TABLE form_event_deliveries (
  team_id uuid NOT NULL,
  form_id uuid NOT NULL,
  publication_version bigint,
  submission_id uuid NOT NULL,
  event_id text NOT NULL CHECK (event_id <> '' AND length(event_id) <= 256),
  event_type text NOT NULL CHECK (event_type IN (
    'routing.evaluation.before',
    'routing.evaluation.after',
    'routing.matched',
    'submission.before_save',
    'submission.accepted'
  )),
  event_occurred_at timestamp with time zone NOT NULL,
  event_payload jsonb NOT NULL CHECK (
    jsonb_typeof(event_payload) = 'object' AND pg_column_size(event_payload) <= 262144
  ),
  delivery_kind text NOT NULL CHECK (delivery_kind IN ('routing_action', 'event_handler')),
  registration_name text NOT NULL CHECK (
    registration_name <> '' AND length(registration_name) <= 128
  ),
  delivery_key text NOT NULL CHECK (delivery_key <> '' AND length(delivery_key) <= 384),
  sequence integer NOT NULL CHECK (sequence BETWEEN 0 AND 99),
  stream_sequence integer NOT NULL CHECK (stream_sequence BETWEEN 0 AND 99),
  status text NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'running', 'succeeded', 'failed')
  ),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 3),
  last_error text CHECK (last_error IS NULL OR length(last_error) <= 128),
  output jsonb CHECK (output IS NULL OR pg_column_size(output) <= 131072),
  next_attempt_at timestamp with time zone NOT NULL DEFAULT now(),
  lease_expires_at timestamp with time zone,
  started_at timestamp with time zone,
  completed_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, event_id, delivery_key),
  CONSTRAINT form_event_delivery_sequence_key UNIQUE (team_id, event_id, sequence),
  CONSTRAINT form_event_delivery_stream_sequence_key
    UNIQUE (team_id, submission_id, stream_sequence),
  CONSTRAINT form_event_delivery_submission_fkey
    FOREIGN KEY (team_id, form_id, submission_id)
    REFERENCES form_submissions (team_id, form_id, id)
    ON DELETE CASCADE,
  CONSTRAINT form_event_delivery_publication_fkey
    FOREIGN KEY (team_id, form_id, publication_version)
    REFERENCES form_definition_versions (team_id, form_id, version)
);

CREATE INDEX form_event_delivery_pending_idx
  ON form_event_deliveries (next_attempt_at, created_at)
  WHERE status = 'pending' AND attempt_count < 3;

CREATE INDEX form_event_delivery_running_lease_idx
  ON form_event_deliveries (lease_expires_at, created_at)
  WHERE status = 'running';

CREATE INDEX form_event_delivery_team_form_created_idx
  ON form_event_deliveries (team_id, form_id, created_at DESC);

ALTER TABLE form_event_deliveries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can read team form event deliveries"
  ON form_event_deliveries
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM team_members
      WHERE team_members.team_id = form_event_deliveries.team_id
        AND team_members.user_id = auth.uid()
    )
  );
