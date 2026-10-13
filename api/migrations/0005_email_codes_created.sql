-- The daily sign-in email cap counts codes from the last 24 hours; index it so that count reads ~100 rows,
-- not the whole table (D1 bills rows read).
CREATE INDEX email_codes_created ON email_codes (created_at);
