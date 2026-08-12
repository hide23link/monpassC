-- Drops tables for features removed to simplify the project (temp staff
-- promotion, offline scan queue, login lockout, CSV auto-password logging).
-- No-op on fresh installs (0001_init.sql no longer creates these tables).
DROP TABLE IF EXISTS temp_promotions;
DROP TABLE IF EXISTS offline_scan_queue;
DROP TABLE IF EXISTS login_failures;
DROP TABLE IF EXISTS last_import_passwords;
