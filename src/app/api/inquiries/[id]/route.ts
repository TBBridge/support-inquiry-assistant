import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { sql } from '@/lib/db';
import { embedDocuments } from '@/lib/rag/embeddings';
import { insertDocument } from '@/lib/rag/vectorstore';

const CorrectionSchema = z.object({
  correctedResponse: z.string().min(1).max(10000),
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUuid(id: string): boolean {
  return UUID_RE.test(id);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json();
    const { correctedResponse } = CorrectionSchema.parse(body);
    const inquiryId = params.id;

    if (!isValidUuid(inquiryId)) {
      return NextResponse.json({ error: 'Invalid inquiry ID format' }, { status: 400 });
    }

    // Fetch original inquiry
    const inquiryResult = await sql`
      SELECT id, query, generated_response, language FROM inquiries WHERE id = ${inquiryId}
    `;

    if (inquiryResult.rows.length === 0) {
      return NextResponse.json({ error: 'Inquiry not found' }, { status: 404 });
    }

    const inquiry = inquiryResult.rows[0];
    const originalQuery = inquiry.query as string;

    // Create Q&A pair document for future RAG retrieval
    const qaContent = `Q: ${originalQuery}\n\nA: ${correctedResponse}`;
    const title = `修正済み回答: ${originalQuery.slice(0, 60)}${originalQuery.length > 60 ? '...' : ''}`;

    const [embedding] = await embedDocuments([qaContent]);

    const correctionDocId = await insertDocument({
      source_type: 'qa_correction',
      title,
      content: qaContent,
      embedding,
      metadata: {
        original_inquiry_id: inquiryId,
        priority: 'high',
        original_query: originalQuery,
      },
    });

    // Update inquiry record
    await sql`
      UPDATE inquiries
      SET
        final_response = ${correctedResponse},
        was_corrected = TRUE,
        correction_doc_id = ${correctionDocId}::uuid
      WHERE id = ${inquiryId}
    `;

    return NextResponse.json({
      success: true,
      correctionDocId,
      message: '修正内容を保存し、RAGに反映しました。',
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues }, { status: 400 });
    }
    console.error('Correction error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!isValidUuid(params.id)) {
    return NextResponse.json({ error: 'Invalid inquiry ID format' }, { status: 400 });
  }
  try {
    const result = await sql`
      SELECT id, query, generated_response, final_response, was_corrected,
             retrieved_doc_ids, language, created_at
      FROM inquiries WHERE id = ${params.id}
    `;

    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    return NextResponse.json(result.rows[0]);
  } catch (error) {
    console.error('Get inquiry error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
