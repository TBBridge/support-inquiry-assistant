import { sql } from '../db';
import type { Document } from '../db';

export type DocumentInsert = {
  source_type: Document['source_type'];
  source_url?: string;
  title: string;
  content: string;
  embedding: number[];
  metadata?: Record<string, unknown>;
};

export type DocumentWithScore = Document & { similarity: number };

export async function insertDocument(doc: DocumentInsert): Promise<string> {
  const embeddingStr = `[${doc.embedding.join(',')}]`;

  const result = await sql`
    INSERT INTO documents (source_type, source_url, title, content, embedding, metadata)
    VALUES (
      ${doc.source_type},
      ${doc.source_url ?? null},
      ${doc.title},
      ${doc.content},
      ${embeddingStr}::vector,
      ${JSON.stringify(doc.metadata ?? {})}::jsonb
    )
    RETURNING id
  `;
  return result.rows[0].id as string;
}

export async function insertDocuments(docs: DocumentInsert[]): Promise<string[]> {
  // 直列ではなく並列 INSERT でスループットを改善
  return Promise.all(docs.map((doc) => insertDocument(doc)));
}

export async function similaritySearch(
  queryEmbedding: number[],
  limit = 5,
  sourceTypeFilter?: Document['source_type'][]
): Promise<DocumentWithScore[]> {
  const embeddingStr = `[${queryEmbedding.join(',')}]`;

  let result;
  if (sourceTypeFilter && sourceTypeFilter.length > 0) {
    // Format as PostgreSQL array literal
    const filterLiteral = `{${sourceTypeFilter.join(',')}}`;
    result = await sql`
      SELECT
        id, source_type, source_url, title, content, metadata, created_at,
        1 - (embedding <=> ${embeddingStr}::vector) AS similarity
      FROM documents
      WHERE source_type = ANY(${filterLiteral}::text[])
        AND embedding IS NOT NULL
      ORDER BY embedding <=> ${embeddingStr}::vector
      LIMIT ${limit}
    `;
  } else {
    result = await sql`
      SELECT
        id, source_type, source_url, title, content, metadata, created_at,
        1 - (embedding <=> ${embeddingStr}::vector) AS similarity
      FROM documents
      WHERE embedding IS NOT NULL
      ORDER BY embedding <=> ${embeddingStr}::vector
      LIMIT ${limit}
    `;
  }

  return result.rows as DocumentWithScore[];
}

export async function listDocuments(limit = 100, offset = 0): Promise<Document[]> {
  const result = await sql`
    SELECT id, source_type, source_url, title, content, metadata, created_at
    FROM documents
    WHERE source_type != 'qa_correction'
    ORDER BY created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `;
  return result.rows as Document[];
}

export async function countDocuments(): Promise<number> {
  const result = await sql`SELECT COUNT(*) as count FROM documents WHERE source_type != 'qa_correction'`;
  return parseInt(result.rows[0].count as string);
}

export async function deleteDocument(id: string): Promise<void> {
  await sql`DELETE FROM documents WHERE id = ${id}`;
}

export async function getDocument(id: string): Promise<Document | null> {
  const result = await sql`SELECT * FROM documents WHERE id = ${id}`;
  return (result.rows[0] as Document) ?? null;
}
