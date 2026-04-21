import postgres from 'postgres';

// Lazy initialization + dev hot-reload safe:
// In development, Next.js re-evaluates modules on every HMR cycle, which
// causes multiple connection pool instances. We store the singleton on
// globalThis so it survives module re-evaluation.
declare global {
  // eslint-disable-next-line no-var
  var __pgClient: ReturnType<typeof postgres> | undefined;
}

function getClient(): ReturnType<typeof postgres> {
  if (globalThis.__pgClient) return globalThis.__pgClient;

  const connectionString = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is required');
  }

  // pgBouncer (Transaction pooler, port 6543) では prepare: false が必要
  const isPooler = connectionString.includes(':6543/');
  const client = postgres(connectionString, {
    ssl: connectionString.includes('localhost') ? false : 'require',
    max: isPooler ? 1 : 10,  // Transaction pooler は接続数を抑える
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: !isPooler,  // Transaction pooler では prepared statements 無効
  });

  globalThis.__pgClient = client;
  return client;
}

// @vercel/postgres 互換ラッパー: sql`...` テンプレートタグが同じように使えます
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const sql = (strings: TemplateStringsArray, ...values: any[]) =>
  getClient()(strings, ...values).then((rows) => ({
    rows: rows as Record<string, unknown>[],
  }));

export type Document = {
  id: string;
  source_type: 'pdf' | 'gitbook' | 'web' | 'markdown' | 'qa_correction';
  source_url: string | null;
  title: string;
  content: string;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type Inquiry = {
  id: string;
  query: string;
  generated_response: string;
  final_response: string | null;
  was_corrected: boolean;
  retrieved_doc_ids: string[];
  correction_doc_id: string | null;
  user_id: string | null;
  language: string;
  created_at: string;
};
