-- Withdrawing a request should be rare and serious. Several withdrawals in a short time pause new
-- requests until Patiamor has checked in with the adopter (src/requests.ts holds the limit). An admin
-- clears that by setting this date: withdrawals before it no longer count.
ALTER TABLE users ADD COLUMN requests_cleared_at TEXT;
