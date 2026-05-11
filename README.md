# 問い合わせ支援 AI アシスタント

お客様からの問い合わせに対して、製品マニュアル・ナレッジベース・ノウハウを RAG で参照し、回答案を自動生成する Web アプリです。

## 主な機能

- **RAG による回答自動生成** — PDF・GitBook・Web ページ・Markdown を取り込み、AI が回答案を生成
- **回答修正 & フィードバックループ** — 修正を保存すると Q&A ペアとして RAG に自動追加し、次回以降の精度が向上
- **参照ソース表示** — 参照したドキュメントと関連度スコアを表示
- **多言語対応** — 日本語・英語・中文での回答生成
- **MCP サーバー** — Claude Desktop などから stdio / HTTP 経由で呼び出し可能
- **管理画面** — ドキュメント管理・履歴確認・検索フィルタ（Google OAuth 認証）

---

## 技術スタック

| 用途 | 技術 |
|------|------|
| フレームワーク | Next.js 14 (App Router) + TypeScript |
| Vector DB | Supabase PostgreSQL + pgvector |
| **LLM** | **Google Gemini または Ollama（環境変数で切り替え）** |
| **Embeddings** | **Ollama または Gemini（無料・環境変数で切り替え）** |
| 認証 | NextAuth.js v5 (Google OAuth) |
| スタイリング | Tailwind CSS + shadcn/ui |
| MCP | @modelcontextprotocol/sdk |

---

## AI プロバイダの選択

### LLM（回答生成）

| `LLM_PROVIDER` | 実体 | 推奨モデル | 費用 | 特徴 |
|----------------|------|-----------|------|------|
| `gemini`（デフォルト） | Google Gemini API | `gemini-2.5-flash` | **無料枠あり**<br>1日 1,500 req | APIキーのみで即使用可 |
| `ollama` | ローカル Ollama | `qwen3:8b` | **完全無料** | 完全ローカル・プライベート |

### Embeddings（ベクトル変換）

| `EMBEDDING_PROVIDER` | モデル | 次元 | DB 移行 | 費用 |
|----------------------|--------|------|---------|------|
| `ollama`（デフォルト・推奨）| `mxbai-embed-large` | **1024d** | **不要** | 完全無料 |
| `ollama` | `nomic-embed-text` | 768d | 必要 | 完全無料 |
| `gemini` | `gemini-embedding-001` | **1024d** | **不要** | 無料枠あり |

> **推奨構成**: `EMBEDDING_PROVIDER=ollama` + `OLLAMA_EMBED_MODEL=mxbai-embed-large` は DB 移行が不要でそのまま使えます。

---

## セットアップ

### 前提条件

- Node.js 18+
- Supabase アカウント（PostgreSQL + pgvector）
- Google OAuth 2.0 クライアント（管理画面ログイン用）

### 1. リポジトリのクローン

```bash
git clone <repository-url>
cd support-inquery-assistant
npm install
```

### 2. 環境変数の設定

```bash
cp .env.local.example .env.local
```

`.env.local` を編集して構成を選択します（詳細は [環境変数リファレンス](#環境変数リファレンス) 参照）。

### 3. Supabase のセットアップ

[Supabase](https://supabase.com) でプロジェクトを作成後、接続文字列を `DATABASE_URL` に設定してください。

```bash
# pgvector + スキーマ作成（初回のみ）
psql "$DATABASE_URL" -f scripts/migrate.sql
```

768 次元の Embedding モデルに切り替える場合は追加で実行:

```bash
# Gemini / nomic-embed-text を使う場合のみ（既存ドキュメントは要再インジェスト）
psql "$DATABASE_URL" -f scripts/migrate-768.sql
```

### 4. Ollama のセットアップ（ローカル使用時）

[Ollama](https://ollama.ai) をインストール後、使用するモデルを取得します。

```bash
# LLM モデル（LLM_PROVIDER=ollama の場合）
ollama pull qwen3:8b         # 日本語対応・高品質（推奨）
# ollama pull qwen3:4b      # 軽量・高速
# ollama pull qwen3:14b     # 高精度・要スペック

# Embedding モデル（EMBEDDING_PROVIDER=ollama の場合）
ollama pull mxbai-embed-large  # 1024d（DB 移行不要・推奨）
# ollama pull nomic-embed-text # 768d（軽量）
```

### 5. ローカル開発サーバー起動

```bash
npm run dev
# → http://localhost:3000
```

---

## 環境変数リファレンス

### LLM 設定

```env
# LLM プロバイダ選択（必須）
LLM_PROVIDER=gemini          # gemini | ollama

# ─ Gemini（LLM_PROVIDER=gemini の場合）─
# 取得先: https://aistudio.google.com/apikey（無料）
GEMINI_API_KEY=AIza...
GEMINI_MODEL=gemini-2.0-flash  # 省略可（デフォルト）

# ─ Ollama（LLM_PROVIDER=ollama の場合）─
OLLAMA_BASE_URL=http://localhost:11434  # 省略可（デフォルト）
OLLAMA_MODEL=qwen3:8b                  # 省略可（デフォルト）
```

### Embedding 設定

```env
# Embedding プロバイダ選択（必須）
EMBEDDING_PROVIDER=ollama    # ollama | gemini

# ─ Ollama Embedding ─
OLLAMA_EMBED_MODEL=mxbai-embed-large   # 1024d（省略可・デフォルト）
# OLLAMA_EMBED_MODEL=nomic-embed-text  # 768d（migrate-768.sql が必要）

# ─ Gemini Embedding（GEMINI_API_KEY は上記と共通）─
GEMINI_EMBED_MODEL=gemini-embedding-001  # 1024d（DB 移行不要）

# DB の vector 列次元数と一致させること（デフォルト: 1024）
EMBEDDING_DIM=1024
```

### データベース・認証

```env
# Supabase 接続文字列（Transaction Pooler: ポート 6543 推奨）
DATABASE_URL=postgresql://postgres.[ref]:[pass]@aws-0-[region].pooler.supabase.com:6543/postgres

# NextAuth.js
NEXTAUTH_URL=http://localhost:3000
AUTH_SECRET=<openssl rand -base64 32>
NEXTAUTH_SECRET=<openssl rand -base64 32>

# Google OAuth（https://console.cloud.google.com/）
GOOGLE_CLIENT_ID=....apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-...

# MCP エンドポイントのアクセス制御（本番環境では必須）
MCP_API_KEY=your-mcp-api-key
```

### おすすめ構成パターン

<details>
<summary>① 完全無料・ローカル（Ollama のみ）</summary>

```env
LLM_PROVIDER=ollama
OLLAMA_MODEL=qwen2.5:7b

EMBEDDING_PROVIDER=ollama
OLLAMA_EMBED_MODEL=mxbai-embed-large
EMBEDDING_DIM=1024
# → DB 移行不要
```
</details>

<details>
<summary>② クラウド無料枠（Gemini のみ）</summary>

```env
LLM_PROVIDER=gemini
GEMINI_API_KEY=AIza...
GEMINI_MODEL=gemini-2.5-flash

EMBEDDING_PROVIDER=gemini
GEMINI_EMBED_MODEL=gemini-embedding-001
EMBEDDING_DIM=1024
# → DB 移行不要
```
</details>

<details>
<summary>③ 混合（LLM: Gemini + Embedding: Ollama）</summary>

```env
# Gemini で高品質な回答、Embedding は完全ローカル
LLM_PROVIDER=gemini
GEMINI_API_KEY=AIza...

EMBEDDING_PROVIDER=ollama
OLLAMA_EMBED_MODEL=mxbai-embed-large
EMBEDDING_DIM=1024
# → DB 移行不要
```
</details>

---

## デプロイ（Vercel）

```bash
# 1. GitHub にプッシュ
# 2. Vercel でプロジェクトをインポート
# 3. 環境変数を Vercel Dashboard で設定
# 4. Supabase で migrate.sql を実行済みであることを確認
```

> **Ollama をクラウドで使う場合**: Vercel のサーバーレス環境からは `localhost` に接続できません。Ollama を [Fly.io](https://fly.io) や VPS に立て `OLLAMA_BASE_URL` に外部 URL を指定してください。

---

## MCP サーバーの使用方法

### Claude Desktop から（stdio 経由）

```bash
cd mcp-server
npm install && npm run build
```

`claude_desktop_config.json` に追加:

```json
{
  "mcpServers": {
    "support-inquiry": {
      "command": "node",
      "args": ["/path/to/mcp-server/dist/index.js"],
      "env": {
        "APP_URL": "https://your-app.vercel.app",
        "MCP_API_KEY": "your-mcp-api-key"
      }
    }
  }
}
```

### HTTP 経由（外部サービスから）

```bash
curl -X POST https://your-app.vercel.app/api/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $MCP_API_KEY" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "generate_response",
      "arguments": { "query": "返品ポリシーを教えてください" }
    },
    "id": 1
  }'
```

> **セキュリティ**: `MCP_API_KEY` が未設定の場合、本番環境ではアクセスが拒否されます（開発環境のみオープン）。

### MCP ツール一覧

| ツール名 | 説明 |
|---------|------|
| `generate_response` | 問い合わせを受け取り RAG で回答案を生成（言語選択可） |
| `list_documents` | 登録済みドキュメント一覧を取得 |
| `get_inquiry_history` | 過去の問い合わせ履歴を取得 |

---

## フィードバックループの仕組み

```
問い合わせ受信
    ↓
RAG: pgvector で類似ドキュメント検索
    ↓
LLM (Gemini / Ollama) で回答案生成
    ↓
オペレーターが確認・修正して「修正を保存」
    ↓
修正内容を「Q: 問い合わせ / A: 修正回答」として pgvector に保存
    ↓
次回の同様問い合わせで修正済み Q&A が優先参照される（精度向上）
```

---

## プロジェクト構成

```
src/
├── app/
│   ├── api/
│   │   ├── inquiries/        # 問い合わせ API（GET: サーバーサイドフィルタ・ページネーション）
│   │   ├── documents/        # ドキュメント取り込み API
│   │   └── mcp/              # MCP over HTTP エンドポイント
│   └── (admin)/              # 管理画面（Google OAuth 保護）
├── lib/
│   ├── llm.ts                # LLM 抽象層（Gemini / Ollama 切り替え）
│   ├── claude.ts             # llm.ts への後方互換シム
│   ├── db.ts                 # postgres.js ラッパー
│   └── rag/
│       ├── embeddings.ts     # Embedding 抽象層（Ollama / Gemini）
│       ├── vectorstore.ts    # pgvector CRUD
│       └── retrieval.ts      # 類似検索 + コンテキスト構築
├── components/
│   ├── inquiry/              # 問い合わせフォーム・回答表示
│   └── admin/                # ドキュメント管理・履歴画面
scripts/
├── migrate.sql               # 初期スキーマ（vector(1024)）
└── migrate-768.sql           # 768d 移行スクリプト（Gemini / nomic-embed-text 用）
mcp-server/                   # スタンドアロン MCP サーバー（stdio）
```

---

## ライセンス

MIT
