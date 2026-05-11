import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { embedDocuments } from "@/lib/rag/embeddings";
import { insertDocuments } from "@/lib/rag/vectorstore";
import { scrapeUrl, scrapeGitBook } from "@/lib/ingestion/web";
import { parseMarkdown } from "@/lib/ingestion/markdown";

const IngestWebSchema = z.object({
  type: z.enum(["web", "gitbook"]),
  url: z.string().url(),
  title: z.string().optional(),
});

const IngestMarkdownSchema = z.object({
  type: z.literal("markdown"),
  content: z.string().min(1),
  title: z.string().min(1),
  filename: z.string().optional(),
});

export async function POST(request: NextRequest) {
  const contentType = request.headers.get("content-type") ?? "";

  try {
    if (contentType.includes("multipart/form-data")) {
      // PDF upload
      return await handlePdfIngest(request);
    } else {
      // JSON: web URL or markdown text
      const body = await request.json();

      if (body.type === "web" || body.type === "gitbook") {
        return await handleWebIngest(IngestWebSchema.parse(body));
      } else if (body.type === "markdown") {
        return await handleMarkdownIngest(IngestMarkdownSchema.parse(body));
      }

      return NextResponse.json({ error: "Invalid type" }, { status: 400 });
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues }, { status: 400 });
    }
    console.error("Ingest error:", error);
    return NextResponse.json(
      { error: (error as Error).message || "Ingest failed" },
      { status: 500 },
    );
  }
}

async function handlePdfIngest(request: NextRequest): Promise<NextResponse> {
  const formData = await request.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  if (!file.name.endsWith(".pdf")) {
    return NextResponse.json({ error: "File must be a PDF" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const { parsePdf } = await import("@/lib/ingestion/pdf");
  const { title, chunks } = await parsePdf(buffer, file.name);

  const texts = chunks.map((c) => c.content);
  const embeddings = await embedDocuments(texts);

  await insertDocuments(
    chunks.map((chunk, i) => ({
      source_type: "pdf" as const,
      title: chunks.length > 1 ? `${title} (${i + 1}/${chunks.length})` : title,
      content: chunk.content,
      embedding: embeddings[i],
      metadata: {
        chunk_index: chunk.index,
        total_chunks: chunk.total,
        filename: file.name,
      },
    })),
  );

  return NextResponse.json({ success: true, docCount: chunks.length, title });
}

async function handleWebIngest(
  input: z.infer<typeof IngestWebSchema>,
): Promise<NextResponse> {
  const { type, url } = input;
  const sourceType = type === "gitbook" ? "gitbook" : "web";

  if (type === "gitbook") {
    const pages = await scrapeGitBook(url);

    // ページ単位のループ呼び出し（N+1）を解消:
    // 全ページのチャンクをまとめて収集 → 一括 embed → 一括 insert
    type DocMeta = {
      source_url: string;
      title: string;
      content: string;
      metadata: Record<string, unknown>;
    };
    const allDocsMeta: DocMeta[] = pages.flatMap((page) =>
      page.chunks.map((chunk, i) => ({
        source_url: page.url,
        title:
          page.chunks.length > 1
            ? `${page.title} (${i + 1}/${page.chunks.length})`
            : page.title,
        content: chunk.content,
        metadata: { chunk_index: chunk.index, total_chunks: chunk.total },
      })),
    );

    const allTexts = allDocsMeta.map((d) => d.content);
    const allEmbeddings = await embedDocuments(allTexts); // API 呼び出しを 1 回に削減

    await insertDocuments(
      allDocsMeta.map((d, i) => ({
        source_type: sourceType as "gitbook" | "web",
        source_url: d.source_url,
        title: d.title,
        content: d.content,
        embedding: allEmbeddings[i],
        metadata: d.metadata,
      })),
    );

    return NextResponse.json({
      success: true,
      docCount: allDocsMeta.length,
      pageCount: pages.length,
    });
  } else {
    const page = await scrapeUrl(url);
    const texts = page.chunks.map((c) => c.content);
    const embeddings = await embedDocuments(texts);

    await insertDocuments(
      page.chunks.map((chunk, i) => ({
        source_type: sourceType as "web",
        source_url: url,
        title:
          page.chunks.length > 1
            ? `${page.title} (${i + 1}/${page.chunks.length})`
            : page.title,
        content: chunk.content,
        embedding: embeddings[i],
        metadata: { chunk_index: chunk.index, total_chunks: chunk.total },
      })),
    );

    return NextResponse.json({
      success: true,
      docCount: page.chunks.length,
      title: page.title,
    });
  }
}

async function handleMarkdownIngest(
  input: z.infer<typeof IngestMarkdownSchema>,
): Promise<NextResponse> {
  const { content, title, filename } = input;
  const doc = parseMarkdown(content, filename);

  const texts = doc.chunks.map((c) => c.content);
  const embeddings = await embedDocuments(texts);

  await insertDocuments(
    doc.chunks.map((chunk, i) => ({
      source_type: "markdown" as const,
      title:
        doc.chunks.length > 1
          ? `${title} (${i + 1}/${doc.chunks.length})`
          : title,
      content: chunk.content,
      embedding: embeddings[i],
      metadata: {
        chunk_index: chunk.index,
        total_chunks: chunk.total,
        filename: filename ?? null,
        frontmatter: doc.frontmatter,
      },
    })),
  );

  return NextResponse.json({
    success: true,
    docCount: doc.chunks.length,
    title: doc.title,
  });
}
