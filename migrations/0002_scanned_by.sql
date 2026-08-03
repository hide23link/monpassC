-- Tracks which staff/admin performed each scan, for the "自分のスキャン履歴"
-- (my scans) feature — the original schema had no way to attribute a scan
-- to a specific staff member (only offline_scan_queue.session_id, a random
-- per-tab id, existed).
ALTER TABLE tickets ADD COLUMN scanned_by TEXT;
CREATE INDEX idx_tickets_scanned_by ON tickets(scanned_by);
