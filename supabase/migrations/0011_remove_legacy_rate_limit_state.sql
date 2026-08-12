-- Earlier development builds used a separate counter table. Keep this cleanup
-- migration so linked projects and fresh local databases share one history.
DROP FUNCTION IF EXISTS consume_form_rate_limit(uuid, text, integer, integer);
DROP TABLE IF EXISTS form_rate_limits;
ALTER TABLE forms DROP COLUMN IF EXISTS rate_limit_per_minute;
