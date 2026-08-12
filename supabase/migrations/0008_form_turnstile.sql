ALTER TABLE forms
  ADD COLUMN requires_turnstile boolean NOT NULL DEFAULT false;
