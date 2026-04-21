-- ============================================================
-- Migration: 埋め込みベクトルの次元数を 1024 → 768 に変更
-- ============================================================
-- 対象: Gemini text-embedding-004 または nomic-embed-text を使用する場合
-- 条件: EMBEDDING_PROVIDER=gemini または OLLAMA_EMBED_MODEL=nomic-embed-text
--
-- ⚠️  実行前の確認事項:
--   1. すべての documents を削除するか、再インジェストの準備ができていること
--   2. pgvector 拡張がインストール済みであること
--   3. 既存のインデックスを削除してから実行すること
--
-- 実行コマンド例:
--   psql $DATABASE_URL -f scripts/migrate-768.sql
-- ============================================================

BEGIN;

-- Step 1: 既存のベクトルインデックスを削除（次元数変更に伴い再作成が必要）
DROP INDEX IF EXISTS documents_embedding_idx;

-- Step 2: embedding カラムの次元数を変更
--   注意: 既存データがある場合は USING キャストが失敗することがあります。
--   事前に documents テーブルをクリアするか、以下の TRUNCATE を実行してください。
-- TRUNCATE TABLE documents CASCADE;  -- ← 既存ドキュメントを全削除する場合はコメントを外す

ALTER TABLE documents
  ALTER COLUMN embedding TYPE vector(768)
  USING embedding::text::vector(768);

-- Step 3: 新しい次元数でインデックスを再作成
CREATE INDEX documents_embedding_idx
  ON documents USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

COMMIT;

-- ============================================================
-- 実行後の手順:
--   1. .env.local で EMBEDDING_DIM=768 を設定
--   2. アプリを再起動
--   3. 管理画面からドキュメントを再インジェスト
-- ============================================================
