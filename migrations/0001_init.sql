-- MONpass D1 schema (ported from /Users/hide/MONpass/main.py init_db()).
-- See PLAN.md section 2 for migration rationale and added indexes.

CREATE TABLE students (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  class TEXT,
  password_hash TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE tickets (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(id),
  guest_name TEXT NOT NULL,
  is_valid INTEGER DEFAULT 1,
  used INTEGER DEFAULT 0,
  used_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_tickets_student_id ON tickets(student_id);
CREATE INDEX idx_tickets_used ON tickets(used);
CREATE INDEX idx_tickets_is_valid ON tickets(is_valid);
CREATE INDEX idx_tickets_created_at ON tickets(created_at);
CREATE INDEX idx_tickets_used_at ON tickets(used_at);

CREATE TABLE staff (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL
);

CREATE TABLE temp_promotions (
  id TEXT PRIMARY KEY,
  promote_token TEXT UNIQUE,
  token_used INTEGER DEFAULT 0,
  session_id TEXT NOT NULL,
  student_id TEXT NOT NULL REFERENCES students(id),
  promoted_by_type TEXT NOT NULL,
  promoted_by_id TEXT NOT NULL,
  promoted_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);
CREATE INDEX idx_temp_promotions_token ON temp_promotions(promote_token);

CREATE TABLE offline_scan_queue (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES tickets(id),
  scanned_at TEXT NOT NULL,
  session_id TEXT NOT NULL,
  synced INTEGER DEFAULT 0,
  synced_at TEXT,
  conflict INTEGER DEFAULT 0
);
CREATE INDEX idx_offline_queue_ticket_id ON offline_scan_queue(ticket_id);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE login_failures (
  user_key TEXT PRIMARY KEY,
  failure_count INTEGER DEFAULT 0,
  locked_at REAL
);

-- Replaces app.state.last_import_passwords (in-process memory in the old
-- FastAPI app, broken under multiple workers/isolates by design).
CREATE TABLE last_import_passwords (
  student_id TEXT PRIMARY KEY,
  password TEXT NOT NULL,
  name TEXT NOT NULL,
  class TEXT,
  imported_at TEXT DEFAULT (datetime('now'))
);
