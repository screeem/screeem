-- Private bucket for team-owned objects. Paths are always
-- teams/<team_id>/<scope>/<...>, which the application enforces before any
-- request reaches Storage; these policies enforce the same shape in the
-- database so a leaked publishable key cannot read another team's objects.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('team-objects', 'team-objects', false, 52428800)
ON CONFLICT (id) DO NOTHING;

-- The second path segment is the owning team. Bad or non-uuid paths return
-- NULL, so membership never matches and access is denied by default.
CREATE OR REPLACE FUNCTION storage_object_team_id(object_name text)
RETURNS uuid
LANGUAGE plpgsql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  segments text[];
BEGIN
  segments := string_to_array(object_name, '/');

  IF array_length(segments, 1) < 4 OR segments[1] <> 'teams' THEN
    RETURN NULL;
  END IF;

  BEGIN
    RETURN segments[2]::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN NULL;
  END;
END;
$$;

REVOKE ALL ON FUNCTION storage_object_team_id(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION storage_object_team_id(text) TO authenticated;

CREATE POLICY "Members can read team objects" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'team-objects'
    AND is_team_member(storage_object_team_id(name))
  );

-- Writes go through the server, which holds the service role key and applies
-- the scope policy. Managers may also write directly using signed uploads.
CREATE POLICY "Managers can write team objects" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'team-objects'
    AND can_manage_team(storage_object_team_id(name))
  );

CREATE POLICY "Managers can replace team objects" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'team-objects'
    AND can_manage_team(storage_object_team_id(name))
  ) WITH CHECK (
    bucket_id = 'team-objects'
    AND can_manage_team(storage_object_team_id(name))
  );

CREATE POLICY "Managers can delete team objects" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'team-objects'
    AND can_manage_team(storage_object_team_id(name))
  );
