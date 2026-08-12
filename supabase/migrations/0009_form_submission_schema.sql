ALTER TABLE forms
  ADD COLUMN submission_schema jsonb
  CHECK (submission_schema IS NULL OR jsonb_typeof(submission_schema) = 'object');
