import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { retrieveRelevantDocs } from '@/lib/rag/retrieval';
import { generateResponse } from '@/lib/llm';
import { listDocuments, countDocuments } from '@/lib/rag/vectorstore';
import { sql } from '@/lib/db';

// MCP over HTTP (Streamable HTTP Transport)
// This endpoint acts as an MCP server accessible via HTTP

type MCPTool = {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required: string[];
  };
};

const TOOLS: MCPTool[] = [
  {
    name: 'generate_response',
    description:
      'お客様の問い合わせに対してRAGを使用して回答案を生成します。製品マニュアル、ナレッジベース、過去の修正済み回答を参照して回答を作成します。',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'お客様からの問い合わせ内容',
        },
        language: {
          type: 'string',
          enum: ['ja', 'en', 'zh'],
          description: '回答言語 (ja: 日本語, en: 英語, zh: 中文)',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'list_documents',
    description: 'RAGに登録されているドキュメントの一覧を取得します。',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: '取得する最大件数 (デフォルト: 20)',
        },
      },
      required: [],
    },
  },
  {
    name: 'get_inquiry_history',
    description: '過去の問い合わせ履歴を取得します。',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: '取得する最大件数 (デフォルト: 10)',
        },
      },
      required: [],
    },
  },
];

function verifyApiKey(request: NextRequest): boolean {
  const mcpApiKey = process.env.MCP_API_KEY;
  if (!mcpApiKey) {
    // 本番環境ではキー未設定 = アクセス拒否。開発環境のみ許可。
    if (process.env.NODE_ENV === 'production') {
      console.warn('[MCP] MCP_API_KEY is not set. Denying access in production.');
      return false;
    }
    return true; // 開発環境のみオープンアクセス
  }

  const authHeader = request.headers.get('authorization');
  if (!authHeader) return false;

  const token = authHeader.replace(/^Bearer\s+/, '');
  return token === mcpApiKey;
}

export async function POST(request: NextRequest) {
  if (!verifyApiKey(request)) {
    return NextResponse.json(
      { jsonrpc: '2.0', error: { code: -32600, message: 'Unauthorized' } },
      { status: 401 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' } },
      { status: 400 }
    );
  }

  const rpc = body as { jsonrpc: string; method: string; params?: unknown; id?: string | number };

  try {
    switch (rpc.method) {
      case 'initialize':
        return NextResponse.json({
          jsonrpc: '2.0',
          id: rpc.id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: { name: 'support-inquiry-assistant', version: '1.0.0' },
          },
        });

      case 'tools/list':
        return NextResponse.json({
          jsonrpc: '2.0',
          id: rpc.id,
          result: { tools: TOOLS },
        });

      case 'tools/call': {
        const { name, arguments: args } = rpc.params as {
          name: string;
          arguments: Record<string, unknown>;
        };

        const result = await callTool(name, args);
        return NextResponse.json({
          jsonrpc: '2.0',
          id: rpc.id,
          result: {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          },
        });
      }

      default:
        return NextResponse.json({
          jsonrpc: '2.0',
          id: rpc.id,
          error: { code: -32601, message: 'Method not found' },
        });
    }
  } catch (error) {
    console.error('MCP error:', error);
    return NextResponse.json({
      jsonrpc: '2.0',
      id: rpc.id,
      error: {
        code: -32603,
        message: (error as Error).message || 'Internal error',
      },
    });
  }
}

async function callTool(
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  switch (name) {
    case 'generate_response': {
      const schema = z.object({
        query: z.string().min(1),
        language: z.enum(['ja', 'en', 'zh']).optional().default('ja'),
      });
      const { query, language } = schema.parse(args);

      const { documents, context } = await retrieveRelevantDocs(query, 5);
      const { response } = await generateResponse({ query, context, language });

      // Store in DB
      const retrievedIdsLiteral = `{${documents.map((d) => d.id).join(',')}}`;
      const result = await sql`
        INSERT INTO inquiries (query, generated_response, retrieved_doc_ids, language)
        VALUES (${query}, ${response}, ${retrievedIdsLiteral}::uuid[], ${language})
        RETURNING id
      `;

      if (!result.rows[0]) {
        throw new Error('Failed to create inquiry record: INSERT returned no rows');
      }
      return {
        inquiry_id: result.rows[0].id,
        response,
        sources: documents.map((d) => ({
          title: d.title,
          source_type: d.source_type,
          source_url: d.source_url,
          similarity: Math.round(d.similarity * 100) / 100,
        })),
      };
    }

    case 'list_documents': {
      const schema = z.object({ limit: z.number().optional().default(20) });
      const { limit } = schema.parse(args);
      const [documents, total] = await Promise.all([
        listDocuments(limit),
        countDocuments(),
      ]);
      return {
        documents: documents.map((d) => ({
          id: d.id,
          title: d.title,
          source_type: d.source_type,
          source_url: d.source_url,
          created_at: d.created_at,
        })),
        total,
      };
    }

    case 'get_inquiry_history': {
      const schema = z.object({ limit: z.number().optional().default(10) });
      const { limit } = schema.parse(args);
      const result = await sql`
        SELECT id, query, generated_response, final_response, was_corrected, language, created_at
        FROM inquiries ORDER BY created_at DESC LIMIT ${limit}
      `;
      return { inquiries: result.rows };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// For MCP discovery
export async function GET() {
  return NextResponse.json({
    name: 'support-inquiry-assistant',
    version: '1.0.0',
    description: '問い合わせ支援 AI アシスタント MCP サーバー',
    tools: TOOLS.map((t) => ({ name: t.name, description: t.description })),
  });
}
