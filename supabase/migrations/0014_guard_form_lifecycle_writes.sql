-- Managers may still update ordinary form metadata through the existing RLS
-- policy, but versioned lifecycle state must only change through the privileged
-- RPCs that enforce tenant locks and optimistic revisions.
CREATE OR REPLACE FUNCTION guard_form_lifecycle_writes()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user IN ('anon', 'authenticated') THEN
    IF TG_OP = 'INSERT' THEN
      IF
        NEW.draft_definition IS NOT NULL
        OR NEW.routing_draft IS NOT NULL
        OR NEW.draft_revision <> 0
        OR NEW.published_version IS NOT NULL
        OR NEW.last_published_draft_revision IS NOT NULL
        OR NOT NEW.legacy_unstructured
        OR NEW.definition_availability <> 'draft'
      THEN
        RAISE EXCEPTION 'form_lifecycle_fields_require_rpc';
      END IF;
    ELSIF
      NEW.draft_definition IS DISTINCT FROM OLD.draft_definition
      OR NEW.routing_draft IS DISTINCT FROM OLD.routing_draft
      OR NEW.draft_revision IS DISTINCT FROM OLD.draft_revision
      OR NEW.published_version IS DISTINCT FROM OLD.published_version
      OR NEW.last_published_draft_revision IS DISTINCT FROM OLD.last_published_draft_revision
      OR NEW.legacy_unstructured IS DISTINCT FROM OLD.legacy_unstructured
      OR NEW.definition_availability IS DISTINCT FROM OLD.definition_availability
    THEN
      RAISE EXCEPTION 'form_lifecycle_fields_require_rpc';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER forms_lifecycle_writes_use_rpcs
  BEFORE INSERT OR UPDATE ON forms
  FOR EACH ROW EXECUTE FUNCTION guard_form_lifecycle_writes();
