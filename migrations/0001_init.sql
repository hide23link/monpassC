-- MONpassの初期スキーマ(旧Python版(FastAPI + SQLite)のinit_db()を移植したもの)。
-- 生徒/チケット/スタッフ/設定の4テーブルのみで構成される(以前存在した
-- スタッフ一時昇格・オフラインスキャン記録・ログインロックアウト・
-- CSV自動パスワード配布用の各テーブルは、機能自体の廃止に伴い
-- 0003_drop_removed_tables.sqlで削除される)。

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

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
