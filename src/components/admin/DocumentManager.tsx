'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import {
  Loader2, Trash2, Upload, Link2, FileText, RefreshCw,
  ChevronLeft, ChevronRight, FileUp,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';

type Document = {
  id: string;
  source_type: string;
  source_url: string | null;
  title: string;
  created_at: string;
};

const SOURCE_TYPE_LABELS: Record<string, string> = {
  pdf: 'PDF',
  gitbook: 'GitBook',
  web: 'Web',
  markdown: 'Markdown',
  qa_correction: '修正済み Q&A',
};

const SOURCE_TYPE_COLORS: Record<string, string> = {
  pdf: 'bg-red-100 text-red-700',
  gitbook: 'bg-purple-100 text-purple-700',
  web: 'bg-blue-100 text-blue-700',
  markdown: 'bg-green-100 text-green-700',
  qa_correction: 'bg-amber-100 text-amber-700',
};

const PAGE_SIZE = 20;
const MAX_PDF_MB = 20;

export function DocumentManager() {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isIngesting, setIsIngesting] = useState(false);
  const [page, setPage] = useState(0);

  // PDF upload state
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Web / GitBook
  const [webUrl, setWebUrl] = useState('');
  const [webType, setWebType] = useState<'web' | 'gitbook'>('web');

  // Markdown
  const [mdTitle, setMdTitle] = useState('');
  const [mdContent, setMdContent] = useState('');

  const { toast } = useToast();

  const fetchDocuments = useCallback(async (targetPage = 0) => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/documents?limit=${PAGE_SIZE}&offset=${targetPage * PAGE_SIZE}`);
      const data = await res.json();
      setDocuments(data.documents ?? []);
      setTotal(data.total ?? 0);
    } catch {
      toast({ title: 'エラー', description: 'ドキュメントの取得に失敗しました', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchDocuments(page);
  }, [fetchDocuments, page]);

  function handlePageChange(newPage: number) {
    setPage(newPage);
    fetchDocuments(newPage);
  }

  // ---------- PDF drag-and-drop handlers ----------
  function handleDragEnter(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const files = Array.from(e.dataTransfer.files);
    const pdf = files.find((f) => f.name.toLowerCase().endsWith('.pdf'));
    if (!pdf) {
      toast({ title: 'エラー', description: 'PDF ファイルをドロップしてください', variant: 'destructive' });
      return;
    }
    if (pdf.size > MAX_PDF_MB * 1024 * 1024) {
      toast({ title: 'エラー', description: `ファイルサイズは ${MAX_PDF_MB}MB 以下にしてください`, variant: 'destructive' });
      return;
    }
    setPdfFile(pdf);
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    if (file && file.size > MAX_PDF_MB * 1024 * 1024) {
      toast({ title: 'エラー', description: `ファイルサイズは ${MAX_PDF_MB}MB 以下にしてください`, variant: 'destructive' });
      e.target.value = '';
      return;
    }
    setPdfFile(file);
  }

  // ---------- Ingest handlers ----------
  async function handleDeleteDocument(id: string, title: string) {
    if (!confirm(`「${title}」を削除しますか？`)) return;
    try {
      const res = await fetch(`/api/documents/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('削除に失敗しました');
      toast({ title: '削除しました', description: title });
      fetchDocuments(page);
    } catch (error) {
      toast({ title: 'エラー', description: (error as Error).message, variant: 'destructive' });
    }
  }

  async function handlePdfIngest() {
    if (!pdfFile) return;
    setIsIngesting(true);
    try {
      const formData = new FormData();
      formData.append('file', pdfFile);

      const res = await fetch('/api/documents/ingest', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '取り込みに失敗しました');

      toast({ title: '取り込み完了', description: `${data.docCount} チャンク取り込みました: ${data.title}` });
      setPdfFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      fetchDocuments(0);
      setPage(0);
    } catch (error) {
      toast({ title: 'エラー', description: (error as Error).message, variant: 'destructive' });
    } finally {
      setIsIngesting(false);
    }
  }

  async function handleWebIngest() {
    if (!webUrl.trim()) return;
    setIsIngesting(true);
    try {
      const res = await fetch('/api/documents/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: webType, url: webUrl.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '取り込みに失敗しました');

      const msg = webType === 'gitbook'
        ? `${data.pageCount} ページ、${data.docCount} チャンク取り込みました`
        : `${data.docCount} チャンク取り込みました: ${data.title}`;
      toast({ title: '取り込み完了', description: msg });
      setWebUrl('');
      fetchDocuments(0);
      setPage(0);
    } catch (error) {
      toast({ title: 'エラー', description: (error as Error).message, variant: 'destructive' });
    } finally {
      setIsIngesting(false);
    }
  }

  async function handleMarkdownIngest() {
    if (!mdTitle.trim() || !mdContent.trim()) return;
    setIsIngesting(true);
    try {
      const res = await fetch('/api/documents/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'markdown', title: mdTitle.trim(), content: mdContent.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '取り込みに失敗しました');

      toast({ title: '取り込み完了', description: `${data.docCount} チャンク取り込みました: ${data.title}` });
      setMdTitle('');
      setMdContent('');
      fetchDocuments(0);
      setPage(0);
    } catch (error) {
      toast({ title: 'エラー', description: (error as Error).message, variant: 'destructive' });
    } finally {
      setIsIngesting(false);
    }
  }

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="space-y-6">
      {/* Ingest Section */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">ドキュメントを追加</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="pdf">
            <TabsList className="mb-4">
              <TabsTrigger value="pdf" className="gap-1.5">
                <Upload className="h-3.5 w-3.5" /> PDF
              </TabsTrigger>
              <TabsTrigger value="web" className="gap-1.5">
                <Link2 className="h-3.5 w-3.5" /> Web / GitBook
              </TabsTrigger>
              <TabsTrigger value="markdown" className="gap-1.5">
                <FileText className="h-3.5 w-3.5" /> Markdown
              </TabsTrigger>
            </TabsList>

            {/* PDF Tab */}
            <TabsContent value="pdf" className="space-y-3">
              <div className="space-y-2">
                <Label>PDF ファイル <span className="text-xs text-gray-400">（最大 {MAX_PDF_MB}MB）</span></Label>
                <div
                  className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors cursor-pointer ${
                    isDragOver
                      ? 'border-blue-400 bg-blue-50'
                      : pdfFile
                      ? 'border-green-400 bg-green-50'
                      : 'border-gray-300 hover:border-blue-400'
                  }`}
                  onClick={() => fileInputRef.current?.click()}
                  onDragEnter={handleDragEnter}
                  onDragLeave={handleDragLeave}
                  onDragOver={handleDragOver}
                  onDrop={handleDrop}
                >
                  {pdfFile ? (
                    <div className="flex items-center justify-center gap-2">
                      <FileUp className="h-6 w-6 text-green-500" />
                      <div className="text-left">
                        <p className="text-sm font-medium text-green-700">{pdfFile.name}</p>
                        <p className="text-xs text-gray-500">
                          {(pdfFile.size / 1024 / 1024).toFixed(2)} MB
                        </p>
                      </div>
                      <button
                        className="ml-2 text-gray-400 hover:text-red-500 text-xs"
                        onClick={(e) => {
                          e.stopPropagation();
                          setPdfFile(null);
                          if (fileInputRef.current) fileInputRef.current.value = '';
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  ) : (
                    <>
                      <Upload className="h-8 w-8 mx-auto text-gray-400 mb-2" />
                      <p className="text-sm text-gray-600">
                        クリックまたはドラッグ＆ドロップで PDF をアップロード
                      </p>
                      <p className="text-xs text-gray-400 mt-1">PDF ファイルのみ対応</p>
                    </>
                  )}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf"
                    className="hidden"
                    onChange={handleFileSelect}
                  />
                </div>
              </div>
              <Button
                onClick={handlePdfIngest}
                disabled={!pdfFile || isIngesting}
                className="gap-2"
              >
                {isIngesting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                取り込む
              </Button>
            </TabsContent>

            {/* Web / GitBook Tab */}
            <TabsContent value="web" className="space-y-3">
              <div className="space-y-2">
                <Label>取り込みタイプ</Label>
                <div className="flex gap-2">
                  <Button
                    variant={webType === 'web' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setWebType('web')}
                  >
                    Web ページ（1 ページ）
                  </Button>
                  <Button
                    variant={webType === 'gitbook' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setWebType('gitbook')}
                  >
                    GitBook（サイト全体）
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="web-url">URL</Label>
                <Input
                  id="web-url"
                  type="url"
                  placeholder="https://docs.example.com"
                  value={webUrl}
                  onChange={(e) => setWebUrl(e.target.value)}
                />
                {webType === 'gitbook' && (
                  <p className="text-xs text-amber-600">
                    ⚠️ GitBook 取り込みは最大 50 ページまで対応。時間がかかる場合があります。
                  </p>
                )}
              </div>
              <Button
                onClick={handleWebIngest}
                disabled={!webUrl.trim() || isIngesting}
                className="gap-2"
              >
                {isIngesting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
                取り込む
              </Button>
            </TabsContent>

            {/* Markdown Tab */}
            <TabsContent value="markdown" className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="md-title">タイトル</Label>
                <Input
                  id="md-title"
                  placeholder="ドキュメントのタイトル"
                  value={mdTitle}
                  onChange={(e) => setMdTitle(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="md-content">Markdown コンテンツ</Label>
                <Textarea
                  id="md-content"
                  placeholder={`# 見出し\n\nコンテンツをここに入力...`}
                  className="min-h-[200px] font-mono text-sm"
                  value={mdContent}
                  onChange={(e) => setMdContent(e.target.value)}
                />
                <p className="text-xs text-gray-400 text-right">{mdContent.length} 文字</p>
              </div>
              <Button
                onClick={handleMarkdownIngest}
                disabled={!mdTitle.trim() || !mdContent.trim() || isIngesting}
                className="gap-2"
              >
                {isIngesting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                取り込む
              </Button>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Document List */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">
            登録済みドキュメント
            <span className="ml-2 text-sm font-normal text-gray-500">{total} 件</span>
          </CardTitle>
          <Button variant="ghost" size="icon" onClick={() => fetchDocuments(page)} title="更新">
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          </Button>
        </CardHeader>
        <CardContent>
          {documents.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-8">
              ドキュメントがありません。上のフォームから追加してください。
            </p>
          ) : (
            <>
              <div className="rounded-md border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>種類</TableHead>
                      <TableHead>タイトル</TableHead>
                      <TableHead>URL</TableHead>
                      <TableHead>登録日時</TableHead>
                      <TableHead className="w-10"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {documents.map((doc) => (
                      <TableRow key={doc.id}>
                        <TableCell>
                          <span
                            className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                              SOURCE_TYPE_COLORS[doc.source_type] ?? 'bg-gray-100 text-gray-700'
                            }`}
                          >
                            {SOURCE_TYPE_LABELS[doc.source_type] ?? doc.source_type}
                          </span>
                        </TableCell>
                        <TableCell className="max-w-[200px] truncate text-sm">{doc.title}</TableCell>
                        <TableCell className="max-w-[150px]">
                          {doc.source_url ? (() => {
                            try {
                              return (
                                <a
                                  href={doc.source_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-xs text-blue-500 hover:underline truncate block"
                                >
                                  {new URL(doc.source_url).hostname}
                                </a>
                              );
                            } catch {
                              return <span className="text-xs text-gray-500">{doc.source_url}</span>;
                            }
                          })() : (
                            <span className="text-xs text-gray-400">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-gray-500">
                          {new Date(doc.created_at).toLocaleString('ja-JP')}
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-red-500 hover:text-red-700 hover:bg-red-50"
                            onClick={() => handleDeleteDocument(doc.id, doc.title)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between mt-4">
                  <p className="text-xs text-gray-500">
                    {page * PAGE_SIZE + 1}〜{Math.min((page + 1) * PAGE_SIZE, total)} 件 / 全 {total} 件
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handlePageChange(page - 1)}
                      disabled={page === 0}
                      className="gap-1"
                    >
                      <ChevronLeft className="h-4 w-4" />
                      前へ
                    </Button>
                    <span className="text-sm text-gray-500">{page + 1} / {totalPages}</span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handlePageChange(page + 1)}
                      disabled={page >= totalPages - 1}
                      className="gap-1"
                    >
                      次へ
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
