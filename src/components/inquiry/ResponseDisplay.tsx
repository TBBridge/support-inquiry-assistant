'use client';

import { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Copy, Check, Edit2, Save, X, ExternalLink, Loader2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';
import type { InquiryResult } from './InquiryPanel';

const SOURCE_TYPE_LABELS: Record<string, string> = {
  pdf: 'PDF',
  gitbook: 'GitBook',
  web: 'Web',
  markdown: 'ノウハウ',
  qa_correction: '修正済み Q&A',
};

const SOURCE_TYPE_COLORS: Record<string, string> = {
  pdf: 'bg-red-100 text-red-700',
  gitbook: 'bg-purple-100 text-purple-700',
  web: 'bg-blue-100 text-blue-700',
  markdown: 'bg-green-100 text-green-700',
  qa_correction: 'bg-amber-100 text-amber-700',
};

type Props = {
  result: InquiryResult | null;
  isLoading: boolean;
};

export function ResponseDisplay({ result, isLoading }: Props) {
  const [isEditing, setIsEditing] = useState(false);
  const [editedResponse, setEditedResponse] = useState('');
  // Track the latest confirmed/saved response separately from the AI draft
  const [savedResponse, setSavedResponse] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [correctionCount, setCorrectionCount] = useState(0);
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  // The text currently shown (saved correction overrides original AI draft)
  const displayResponse = savedResponse ?? result?.response ?? '';

  // 新しい問い合わせ結果が到着したら編集状態をリセット（競合防止）
  useEffect(() => {
    setIsEditing(false);
    setSavedResponse(null);
    setCorrectionCount(0);
  }, [result?.id]);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(displayResponse);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API が使えない環境（非 HTTPS / 古いブラウザ）への対応
      toast({
        title: 'コピーに失敗しました',
        description: 'テキストを手動で選択してコピーしてください。',
        variant: 'destructive',
      });
    }
  }

  function handleEdit() {
    // Start editing from the currently displayed text (not always the original)
    setEditedResponse(displayResponse);
    setIsEditing(true);
  }

  function handleCancel() {
    setIsEditing(false);
  }

  async function handleSave() {
    if (!result) return;
    setIsSaving(true);
    try {
      const res = await fetch(`/api/inquiries/${result.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ correctedResponse: editedResponse }),
      });

      if (!res.ok) throw new Error('保存に失敗しました');

      setSavedResponse(editedResponse);
      setCorrectionCount((c) => c + 1);
      setIsEditing(false);
      toast({
        title: '修正を保存しました',
        description: '次回の回答精度向上に活用されます。',
      });
    } catch (error) {
      toast({
        title: 'エラー',
        description: (error as Error).message,
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  }

  // Reset to original AI draft
  function handleResetToOriginal() {
    setSavedResponse(null);
    setCorrectionCount(0);
  }

  if (isLoading) {
    return (
      <Card className="h-full">
        <CardHeader>
          <CardTitle className="text-lg">回答案</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-4/6" />
          <Skeleton className="h-4 w-full mt-4" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-5/6" />
          <div className="flex items-center gap-2 mt-4">
            <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
            <span className="text-sm text-gray-500">AI が回答を生成しています...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!result) {
    return (
      <Card className="h-full border-dashed">
        <CardContent className="flex flex-col items-center justify-center h-64 text-center">
          <div className="text-4xl mb-3">💬</div>
          <p className="text-gray-500 text-sm">
            左の入力フォームに問い合わせ内容を入力して
            <br />「回答案を生成」ボタンを押してください。
          </p>
        </CardContent>
      </Card>
    );
  }

  const isCorrected = correctionCount > 0;

  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 flex-wrap">
            <CardTitle className="text-lg">回答案</CardTitle>
            {isCorrected && (
              <Badge className="bg-amber-100 text-amber-700 text-xs">
                修正済み {correctionCount > 1 ? `(${correctionCount}回)` : ''}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1">
            {isCorrected && !isEditing && (
              <Button
                variant="ghost"
                size="icon"
                onClick={handleResetToOriginal}
                title="元の AI 回答に戻す"
                className="text-gray-400 hover:text-gray-600"
              >
                <RotateCcw className="h-4 w-4" />
              </Button>
            )}
            <Button variant="ghost" size="icon" onClick={handleCopy} title="コピー">
              {copied ? (
                <Check className="h-4 w-4 text-green-500" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </Button>
            {!isEditing && (
              <Button variant="ghost" size="icon" onClick={handleEdit} title="編集">
                <Edit2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {isEditing ? (
          <div className="space-y-2">
            <Textarea
              value={editedResponse}
              onChange={(e) => setEditedResponse(e.target.value)}
              className="min-h-[300px] text-sm font-mono resize-none"
              placeholder="回答内容を編集してください..."
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={handleSave}
                disabled={isSaving || !editedResponse.trim()}
                className="gap-2"
              >
                {isSaving ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Save className="h-3 w-3" />
                )}
                修正を保存
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleCancel}
                className="gap-2"
              >
                <X className="h-3 w-3" />
                キャンセル
              </Button>
            </div>
          </div>
        ) : (
          <div className="prose prose-sm max-w-none text-gray-800">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                // Override default elements for better styling in a card context
                h1: ({ children }) => <h1 className="text-lg font-bold mt-3 mb-1">{children}</h1>,
                h2: ({ children }) => <h2 className="text-base font-bold mt-3 mb-1">{children}</h2>,
                h3: ({ children }) => <h3 className="text-sm font-semibold mt-2 mb-1">{children}</h3>,
                p: ({ children }) => <p className="mb-2 leading-relaxed text-sm">{children}</p>,
                ul: ({ children }) => <ul className="list-disc pl-5 mb-2 space-y-1 text-sm">{children}</ul>,
                ol: ({ children }) => <ol className="list-decimal pl-5 mb-2 space-y-1 text-sm">{children}</ol>,
                li: ({ children }) => <li className="text-sm">{children}</li>,
                strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                code: ({ children, className }) => {
                  const isBlock = className?.includes('language-');
                  return isBlock ? (
                    <code className="block bg-gray-100 rounded p-2 text-xs font-mono overflow-x-auto whitespace-pre">
                      {children}
                    </code>
                  ) : (
                    <code className="bg-gray-100 rounded px-1 py-0.5 text-xs font-mono">{children}</code>
                  );
                },
                pre: ({ children }) => (
                  <pre className="bg-gray-100 rounded p-3 text-xs overflow-x-auto mb-2">{children}</pre>
                ),
                blockquote: ({ children }) => (
                  <blockquote className="border-l-4 border-gray-300 pl-3 italic text-gray-600 my-2">
                    {children}
                  </blockquote>
                ),
                hr: () => <hr className="my-3 border-gray-200" />,
                a: ({ href, children }) => (
                  <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">
                    {children}
                  </a>
                ),
              }}
            >
              {displayResponse}
            </ReactMarkdown>
          </div>
        )}

        {result.sources.length > 0 && (
          <>
            <Separator />
            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-2">参照ソース</h3>
              <div className="space-y-2">
                {result.sources.map((source, i) => (
                  <div
                    key={source.id}
                    className="flex items-start gap-2 text-xs text-gray-600 p-2 bg-gray-50 rounded-md"
                  >
                    <span className="font-mono text-gray-400 mt-0.5">[{i + 1}]</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1 flex-wrap">
                        <span
                          className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                            SOURCE_TYPE_COLORS[source.source_type] ?? 'bg-gray-100 text-gray-700'
                          }`}
                        >
                          {SOURCE_TYPE_LABELS[source.source_type] ?? source.source_type}
                        </span>
                        <span className="font-medium truncate">{source.title}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        {source.source_url && (() => {
                          try {
                            return (
                              <a
                                href={source.source_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-500 hover:underline flex items-center gap-0.5 truncate max-w-[200px]"
                              >
                                {new URL(source.source_url).hostname}
                                <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                              </a>
                            );
                          } catch {
                            return <span className="text-gray-400 truncate max-w-[200px]">{source.source_url}</span>;
                          }
                        })()}
                        <span className="text-gray-400">
                          関連度 {Math.round(source.similarity * 100)}%
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {result.sources.length === 0 && (
          <p className="text-xs text-amber-600 bg-amber-50 p-2 rounded">
            ⚠️ 参照できるドキュメントが見つかりませんでした。ドキュメントを追加するとより精度の高い回答が生成されます。
          </p>
        )}
      </CardContent>
    </Card>
  );
}
