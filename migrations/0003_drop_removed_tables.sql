-- プロジェクトの単純化のために廃止した機能(スタッフ一時昇格・オフライン
-- スキャン記録・ログインロックアウト・CSV自動パスワード配布)が使っていた
-- テーブルを削除する。新規インストールでは0001_init.sqlがそもそもこれらの
-- テーブルを作らないため、このマイグレーションは実質no-op(既存デプロイの
-- クリーンアップ専用)。
DROP TABLE IF EXISTS temp_promotions;
DROP TABLE IF EXISTS offline_scan_queue;
DROP TABLE IF EXISTS login_failures;
DROP TABLE IF EXISTS last_import_passwords;
