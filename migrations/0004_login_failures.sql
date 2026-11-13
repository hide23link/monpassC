-- ログイン失敗によるアカウントロック(2026-11-14に復活)。
-- 0003で一度削除したlogin_failuresテーブルを、列を整理して作り直す。
-- user_keyは "student:<学籍番号>" / "staff:<スタッフID>"。
-- locked_untilはロック解除時刻(UNIX秒)。ロックしていなければNULL。
CREATE TABLE IF NOT EXISTS login_failures (
    user_key TEXT PRIMARY KEY,
    failure_count INTEGER NOT NULL DEFAULT 0,
    locked_until INTEGER
);
