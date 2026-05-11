import { chunkText, type Chunk } from './chunk';

type LegacyPdfParser = (buf: Buffer) => Promise<{ text: string; numpages: number }>;

type ModernPdfParseInstance = {
  getText: () => Promise<
    | string
    | {
        text?: string;
        numpages?: number;
        total?: number;
      }
  >;
  destroy?: () => Promise<void> | void;
};

type ModernPdfParseConstructor = new (opts: { data: Buffer }) => ModernPdfParseInstance;

async function parsePdfBuffer(buffer: Buffer): Promise<{ text: string; numpages: number }> {
  // Avoid top-level CJS require so Node 24 / Vercel can load this module safely.
  const mod: unknown = await import('pdf-parse');
  const moduleObj = mod as {
    default?: unknown;
    PDFParse?: ModernPdfParseConstructor;
  };

  // pdf-parse v2 style
  const modernCtor =
    (moduleObj.PDFParse as ModernPdfParseConstructor | undefined) ??
    ((moduleObj.default as { PDFParse?: ModernPdfParseConstructor } | undefined)?.PDFParse);
  if (modernCtor) {
    const parser = new modernCtor({ data: buffer });
    try {
      const parsed = await parser.getText();
      if (typeof parsed === 'string') {
        return { text: parsed, numpages: 0 };
      }
      return {
        text: parsed.text ?? '',
        numpages: Number(parsed.numpages ?? parsed.total ?? 0),
      };
    } finally {
      await parser.destroy?.();
    }
  }

  // pdf-parse v1 style
  const legacy =
    (moduleObj.default as LegacyPdfParser | undefined) ??
    (moduleObj as LegacyPdfParser);
  if (typeof legacy === 'function') {
    return legacy(buffer);
  }

  throw new Error('Unsupported pdf-parse module format');
}

export type PdfDocument = {
  title: string;
  chunks: Chunk[];
  pageCount: number;
};

export async function parsePdf(
  buffer: Buffer,
  filename: string
): Promise<PdfDocument> {
  const data = await parsePdfBuffer(buffer);

  const title = extractTitle(data.text, filename);
  const cleanedText = cleanPdfText(data.text);
  const chunks = chunkText(cleanedText);

  return {
    title,
    chunks,
    pageCount: data.numpages,
  };
}

function extractTitle(text: string, filename: string): string {
  // Try to extract title from first non-empty line
  const firstLine = text
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 3 && l.length < 200);

  if (firstLine) return firstLine;

  // Fall back to filename without extension
  return filename.replace(/\.pdf$/i, '');
}

function cleanPdfText(text: string): string {
  return text
    .replace(/\f/g, '\n') // Form feed to newline
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ') // Collapse horizontal whitespace
    .replace(/\n{3,}/g, '\n\n') // Collapse excessive newlines
    .trim();
}
