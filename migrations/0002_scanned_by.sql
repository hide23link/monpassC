-- どのスタッフ/管理者が各チケットをスキャンしたかを記録する列を追加する。
-- 「自分のスキャン履歴」機能(GET /ticket/my-scans)のために必要で、
-- 初期スキーマにはスキャンした人物を特定する手段が無かった。
ALTER TABLE tickets ADD COLUMN scanned_by TEXT;
CREATE INDEX idx_tickets_scanned_by ON tickets(scanned_by);
