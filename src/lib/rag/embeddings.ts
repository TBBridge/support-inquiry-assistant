/**
 * Embedding 抽象層 — Ollama または Gemini を環境変数で切り替え（VoyageAI 不使用）
 *
 * EMBEDDING_PROVIDER=ollama (デフォルト・推奨)
 *   - OLLAMA_EMBED_MODEL=mxbai-embed-large  → 1024 次元 (DB migration 不要)
 *   - OLLAMA_EMBED_MODEL=nomic-embed-text   → 768 次元  (migration-768.sql が必要)
 *   - OLLAMA_BASE_URL=http://localhost:11434
 *
 * EMBEDDING_PROVIDER=gemini
 *   - GEMINI_EMBED_MODEL=gemini-embedding-001 → 768 次元  (migration-768.sql が必要)
 *   - GEMINI_API_KEY=...
 *
 * 次元数を変更する場合は scripts/migrate-768.sql を実行してから
 * 全ドキュメントを再インジェストしてください。
 */

// ─────────────────────────────────────────────
// 設定解決
// ─────────────────────────────────────────────

type EmbeddingProvider = 'ollama' | 'gemini';
type GeminiTaskType = 'RETRIEVAL_QUERY' | 'RETRIEVAL_DOCUMENT';

const DEFAULT_GEMINI_EMBED_MODEL = 'gemini-embedding-001';
const LEGACY_GEMINI_EMBED_MODELS = new Set([
  'embedding-001',
  'text-embedding-004',
  'text-embedding-005',
  'text-multilingual-embedding-002',
]);

function getEmbeddingProvider(): EmbeddingProvider {
  const p = (process.env.EMBEDDING_PROVIDER ?? 'ollama').toLowerCase();
  if (p !== 'ollama' && p !== 'gemini') {
    throw new Error(
      `Invalid EMBEDDING_PROVIDER: "${p}". Must be "ollama" or "gemini".`
    );
  }
  return p;
}

/** 期待する埋め込み次元数（環境変数 EMBEDDING_DIM で上書き可能） */
function getExpectedDim(): number {
  const envDim = process.env.EMBEDDING_DIM;
  if (envDim) {
    const n = parseInt(envDim, 10);
    if (!isNaN(n) && n > 0) return n;
  }
  const provider = getEmbeddingProvider();
  if (provider === 'gemini') return 768; // DB の既定 migration に合わせる
  // Ollama
  const model = process.env.OLLAMA_EMBED_MODEL ?? 'mxbai-embed-large';
  return model === 'mxbai-embed-large' ? 1024 : 768;
}

function getGeminiEmbedModel(): string {
  const configuredModel = process.env.GEMINI_EMBED_MODEL?.trim();
  if (!configuredModel) return DEFAULT_GEMINI_EMBED_MODEL;

  const model = configuredModel.replace(/^models\//, '');
  if (LEGACY_GEMINI_EMBED_MODELS.has(model)) {
    return DEFAULT_GEMINI_EMBED_MODEL;
  }
  return model;
}

// ─────────────────────────────────────────────
// バリデーション
// ─────────────────────────────────────────────

function validateEmbedding(emb: unknown, expectedDim: number, ctx: string): number[] {
  if (!Array.isArray(emb) || emb.length === 0) {
    throw new Error(`Empty embedding returned (${ctx})`);
  }
  if (emb.length !== expectedDim) {
    throw new Error(
      `Dimension mismatch at ${ctx}: got ${emb.length}, expected ${expectedDim}. ` +
      `Check EMBEDDING_DIM / EMBEDDING_PROVIDER / OLLAMA_EMBED_MODEL and DB schema.`
    );
  }
  return emb as number[];
}

// ─────────────────────────────────────────────
// Ollama Embedding 実装
// ─────────────────────────────────────────────

type OllamaEmbedResponse = {
  embeddings: number[][];
};

/**
 * Ollama /api/embed エンドポイントを使用してバッチ埋め込みを生成します。
 * Ollama 0.5+ が必要です。
 */
async function embedWithOllama(texts: string[]): Promise<number[][]> {
  const baseUrl = (process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434').replace(/\/$/, '');
  const model = process.env.OLLAMA_EMBED_MODEL ?? 'mxbai-embed-large';

  const res = await fetch(`${baseUrl}/api/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, input: texts }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `Ollama embed error ${res.status}: ${text}. ` +
      `Is Ollama running at ${baseUrl} with model "${model}" pulled?`
    );
  }

  const data = (await res.json()) as OllamaEmbedResponse;

  if (!data.embeddings || data.embeddings.length !== texts.length) {
    throw new Error(
      `Ollama returned ${data.embeddings?.length ?? 0} embeddings for ${texts.length} inputs`
    );
  }

  return data.embeddings;
}

// ─────────────────────────────────────────────
// Gemini Embedding 実装
// ─────────────────────────────────────────────

type GeminiBatchEmbedResponse = {
  embeddings?: Array<{
    values?: number[];
  }>;
};

function getGeminiApiKey(): string {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY environment variable is required when EMBEDDING_PROVIDER=gemini'
    );
  }
  return apiKey;
}

function shouldSendGeminiTaskType(model: string): boolean {
  return model !== 'gemini-embedding-2';
}

async function postGeminiBatchEmbeddings(
  texts: string[],
  taskType: GeminiTaskType
): Promise<number[][]> {
  const model = getGeminiEmbedModel();
  const dim = getExpectedDim();
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:batchEmbedContents`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': getGeminiApiKey(),
      },
      body: JSON.stringify({
        requests: texts.map((text) => ({
          model: `models/${model}`,
          content: { parts: [{ text }] },
          outputDimensionality: dim,
          ...(shouldSendGeminiTaskType(model) ? { taskType } : {}),
        })),
      }),
    }
  );

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `Gemini embed error ${res.status}: ${text.slice(0, 500)}. ` +
      `Check GEMINI_EMBED_MODEL / GEMINI_API_KEY.`
    );
  }

  const data = (await res.json()) as GeminiBatchEmbedResponse;
  if (!data.embeddings || data.embeddings.length !== texts.length) {
    throw new Error(
      `Gemini returned ${data.embeddings?.length ?? 0} embeddings for ${texts.length} inputs`
    );
  }

  return data.embeddings.map((embedding, index) => {
    if (!embedding.values) {
      throw new Error(`Gemini returned an empty embedding at index ${index}`);
    }
    return embedding.values;
  });
}

/**
 * Gemini で埋め込みを生成します。
 *
 * text-embedding-004 などの旧モデル名は Gemini API v1beta で 404 になるため、
 * 現行の gemini-embedding-001 に正規化し、DB 既定の 768 次元で取得します。
 */
async function embedWithGemini(
  texts: string[],
  taskType: GeminiTaskType
): Promise<number[][]> {
  const BATCH = 100;
  const embeddings: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = texts.slice(i, i + BATCH);
    const batchEmbeds = await postGeminiBatchEmbeddings(batch, taskType);
    embeddings.push(...batchEmbeds);
  }

  return embeddings;
}

// ─────────────────────────────────────────────
// 公開 API
// ─────────────────────────────────────────────

/**
 * 1 件のクエリテキストを埋め込みベクトルに変換します。
 */
export async function embedText(text: string): Promise<number[]> {
  const provider = getEmbeddingProvider();
  const dim = getExpectedDim();

  let embeddings: number[][];
  if (provider === 'ollama') {
    embeddings = await embedWithOllama([text]);
  } else {
    embeddings = await embedWithGemini([text], 'RETRIEVAL_QUERY');
  }

  return validateEmbedding(embeddings[0], dim, 'embedText');
}

/**
 * 複数のドキュメントテキストを一括で埋め込みベクトルに変換します。
 *
 * - Ollama:  バッチサイズ 64 件ずつ処理
 * - Gemini:  バッチサイズ 100 件ずつ処理
 */
export async function embedDocuments(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const provider = getEmbeddingProvider();
  const dim = getExpectedDim();
  const allEmbeddings: number[][] = [];

  if (provider === 'ollama') {
    const BATCH = 64;
    for (let i = 0; i < texts.length; i += BATCH) {
      const batch = texts.slice(i, i + BATCH);
      const batchEmbeds = await embedWithOllama(batch);
      allEmbeddings.push(...batchEmbeds);
    }
  } else {
    const geminiEmbeds = await embedWithGemini(texts, 'RETRIEVAL_DOCUMENT');
    allEmbeddings.push(...geminiEmbeds);
  }

  // 全件の次元数を検証
  allEmbeddings.forEach((emb, i) =>
    validateEmbedding(emb, dim, `embedDocuments[${i}]`)
  );

  return allEmbeddings;
}
