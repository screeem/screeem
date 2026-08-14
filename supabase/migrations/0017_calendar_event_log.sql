-- Append-only social calendar event log. Current state is always derived by replay.
CREATE TABLE calendar_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  aggregate_id uuid NOT NULL,
  client_event_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN (
    'post.created', 'title.changed', 'copy.changed', 'schedule.changed',
    'colour.changed', 'target.added', 'target.removed', 'change.reverted'
  )),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  reverts_event_id bigint REFERENCES calendar_events(id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CHECK ((event_type = 'change.reverted') = (reverts_event_id IS NOT NULL))
);

ALTER TABLE calendar_events ADD CONSTRAINT calendar_events_team_client_key
  UNIQUE (team_id, client_event_id);

CREATE INDEX calendar_events_team_id_id_idx ON calendar_events(team_id, id);
CREATE INDEX calendar_events_aggregate_id_id_idx ON calendar_events(team_id, aggregate_id, id);

ALTER TABLE calendar_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can read calendar events" ON calendar_events
  FOR SELECT USING (is_team_member(team_id));
CREATE POLICY "Members can append calendar events" ON calendar_events
  FOR INSERT WITH CHECK (is_team_member(team_id) AND actor_id = auth.uid());

CREATE FUNCTION reject_calendar_event_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'calendar_events_are_immutable';
END;
$$;

CREATE TRIGGER calendar_events_immutable
  BEFORE UPDATE OR DELETE ON calendar_events
  FOR EACH ROW EXECUTE FUNCTION reject_calendar_event_mutation();
