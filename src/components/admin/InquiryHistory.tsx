'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { RefreshCw, ChevronDown, ChevronUp, Search, X } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';

type Inquiry = {
  id: string;
  query: string;
  generated_response: string;
  final_response: string | null;
  was_corrected: boolean;
  language: string;
  created_at: string;
};

const LANGUAGE_LABELS: Record<string, string> = {
  ja: '日本語',
  en: 'English',
  zh: '中文',
};

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 400;

export function InquiryHistory() {
  const [inquiries, setInquiries] = useState<Inquiry[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // UI 用の即時反映 state
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCorrected, setFilterCorrected] = useState<'all' | 'corrected' | 'original'>('all');
  const [filterLanguage, setFilterLanguage] = useState<'all' | 'ja' | 'en' | 'zh'>('all');
  const [page, setPage] = useState(0);

  // 検索はデバウンスして API に渡す
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { toast } = useToast();

  // searchQuery が変わったらデバウンス後に debouncedSearch を更新 & page をリセット
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(searchQuery);
      setPage(0);
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchQuery]);

  // サーバーサイドでフィルタ・ページネーションを行う fetch
  const fetchInquiries = useCallback(
    async (pg: number, search: string, corrected: string, lang: string) => {
      setIsLoading(true);
      try {
        const params = new URLSearchParams({
          limit: String(PAGE_SIZE),
          offset: String(pg * PAGE_SIZE),
        });
        if (search) params.set('search', search);
        if (corrected !== 'all') params.set('corrected', corrected);
        if (lang !== 'all') params.set('language', lang);

        const res = await fetch(`/api/inquiries?${params}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setInquiries(data.inquiries ?? []);
        setTotal(data.total ?? 0);
      } catch {
        toast({ title: 'エラー', description: '履歴の取得に失敗しました', variant: 'destructive' });
      } finally {
        setIsLoading(false);
      }
    },
    [toast]
  );

  // フィルタ・ページ変化時に再取得
  useEffect(() => {
    fetchInquiries(page, debouncedSearch, filterCorrected, filterLanguage);
  }, [fetchInquiries, page, debouncedSearch, filterCorrected, filterLanguage]);

  const totalPages = Math.ceil(total / PAGE_SIZE);
  // サーバーサイドで既にフィルタ済みなので paginated = inquiries
  const paginated = inquiries;

  function handleSearchChange(value: string) {
    setSearchQuery(value);
    // page リセットは debouncedSearch の useEffect 内で行う
  }

  function handleClearFilters() {
    setSearchQuery('');
    setFilterCorrected('all');
    setFilterLanguage('all');
    setPage(0);
  }

  const hasActiveFilters =
    searchQuery.trim() !== '' || filterCorrected !== 'all' || filterLanguage !== 'all';

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[...Array(5)].map((_, i) => (
          <Card key={i}>
            <CardContent className="pt-4">
              <Skeleton className="h-4 w-3/4 mb-2" />
              <Skeleton className="h-3 w-1/2" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filter Bar */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            placeholder="問い合わせ内容・回答内容で検索..."
            value={searchQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="pl-8 text-sm"
          />
        </div>
        <Select
          value={filterLanguage}
          onValueChange={(v) => { setFilterLanguage(v as typeof filterLanguage); setPage(0); /* サーバー再取得は useEffect が担当 */ }}
        >
          <SelectTrigger className="w-32">
            <SelectValue placeholder="言語" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全言語</SelectItem>
            <SelectItem value="zh">中文</SelectItem>
            <SelectItem value="ja">日本語</SelectItem>
            <SelectItem value="en">English</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={filterCorrected}
          onValueChange={(v) => { setFilterCorrected(v as typeof filterCorrected); setPage(0); }}
        >
          <SelectTrigger className="w-36">
            <SelectValue placeholder="修正状況" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全て</SelectItem>
            <SelectItem value="corrected">修正済みのみ</SelectItem>
            <SelectItem value="original">未修正のみ</SelectItem>
          </SelectContent>
        </Select>
        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={handleClearFilters} className="gap-1 shrink-0">
            <X className="h-3.5 w-3.5" />
            クリア
          </Button>
        )}
      </div>

      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">
          {hasActiveFilters
            ? `${total} 件（フィルタ適用中）`
            : `全 ${total} 件の問い合わせ`}
        </p>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => fetchInquiries(page, debouncedSearch, filterCorrected, filterLanguage)}
          className="gap-2"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          更新
        </Button>
      </div>

      {paginated.length === 0 ? (
        <Card>
          <CardContent className="text-center py-12 text-gray-500">
            {hasActiveFilters
              ? '条件に一致する問い合わせが見つかりませんでした。'
              : '問い合わせ履歴がありません。'}
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="space-y-2">
            {paginated.map((inquiry) => {
              const isExpanded = expandedId === inquiry.id;
              return (
                <Card key={inquiry.id} className={inquiry.was_corrected ? 'border-amber-200' : ''}>
                  <CardHeader
                    className="pb-2 cursor-pointer"
                    onClick={() => setExpandedId(isExpanded ? null : inquiry.id)}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          {inquiry.was_corrected && (
                            <Badge className="bg-amber-100 text-amber-700 text-xs shrink-0">
                              修正済み
                            </Badge>
                          )}
                          <Badge variant="outline" className="text-xs shrink-0">
                            {LANGUAGE_LABELS[inquiry.language] ?? inquiry.language}
                          </Badge>
                          <span className="text-xs text-gray-400">
                            {new Date(inquiry.created_at).toLocaleString('ja-JP')}
                          </span>
                        </div>
                        <p className="text-sm font-medium text-gray-900 line-clamp-2">
                          {inquiry.query}
                        </p>
                      </div>
                      <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0">
                        {isExpanded ? (
                          <ChevronUp className="h-4 w-4" />
                        ) : (
                          <ChevronDown className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </CardHeader>

                  {isExpanded && (
                    <CardContent className="pt-0 space-y-4">
                      <div>
                        <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                          自動生成された回答案
                        </h4>
                        <pre className="text-xs text-gray-700 whitespace-pre-wrap bg-gray-50 rounded p-3 max-h-48 overflow-y-auto">
                          {inquiry.generated_response}
                        </pre>
                      </div>

                      {inquiry.was_corrected && inquiry.final_response && (
                        <div>
                          <h4 className="text-xs font-semibold text-amber-600 uppercase tracking-wide mb-1">
                            修正後の回答（ナレッジベースに反映済み）
                          </h4>
                          <pre className="text-xs text-gray-700 whitespace-pre-wrap bg-amber-50 rounded p-3 max-h-48 overflow-y-auto border border-amber-200">
                            {inquiry.final_response}
                          </pre>
                        </div>
                      )}
                    </CardContent>
                  )}
                </Card>
              );
            })}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
              >
                前へ
              </Button>
              <span className="text-sm text-gray-500">
                {page + 1} / {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
              >
                次へ
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
