'use client';

import { useState } from 'react';
import { Send, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import type { InquiryResult } from './InquiryPanel';

type Props = {
  onResult: (result: InquiryResult) => void;
  onLoading: (loading: boolean) => void;
  isLoading: boolean;
};

export function InquiryForm({ onResult, onLoading, isLoading }: Props) {
  const [query, setQuery] = useState('');
  const [language, setLanguage] = useState<'ja' | 'en' | 'zh'>('zh');

  const MAX_CHARS = 2000;
  const charCount = query.length;
  const isNearLimit = charCount >= MAX_CHARS * 0.9;
  const isOverLimit = charCount > MAX_CHARS;
  const { toast } = useToast();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) {
      toast({ title: 'エラー', description: '問い合わせ内容を入力してください。', variant: 'destructive' });
      return;
    }

    onLoading(true);
    try {
      const res = await fetch('/api/inquiries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: trimmed, language }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Server error');
      }

      const data: InquiryResult = await res.json();
      onResult(data);
    } catch (error) {
      toast({
        title: 'エラーが発生しました',
        description: (error as Error).message,
        variant: 'destructive',
      });
    } finally {
      onLoading(false);
    }
  }

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="text-lg">お客様からの問い合わせ</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="query">問い合わせ内容</Label>
            <Textarea
              id="query"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="お客様からの問い合わせ内容をここに入力してください...&#10;&#10;例: 製品の返品ポリシーについて教えてください。"
              className="min-h-[300px] resize-none text-sm"
              disabled={isLoading}
              maxLength={MAX_CHARS}
            />
            <p
              className={`text-xs text-right font-medium transition-colors ${
                isOverLimit
                  ? 'text-red-500'
                  : isNearLimit
                  ? 'text-amber-500'
                  : 'text-gray-400'
              }`}
            >
              {charCount} / {MAX_CHARS}
              {isNearLimit && !isOverLimit && (
                <span className="ml-1">（上限まで残り {MAX_CHARS - charCount} 文字）</span>
              )}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="language">回答言語</Label>
            <Select
              value={language}
              onValueChange={(v) => setLanguage(v as 'ja' | 'en' | 'zh')}
              disabled={isLoading}
            >
              <SelectTrigger id="language" className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="zh">中文</SelectItem>
                <SelectItem value="ja">日本語</SelectItem>
                <SelectItem value="en">English</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Button
            type="submit"
            disabled={isLoading || !query.trim() || isOverLimit}
            className="w-full"
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                回答案を生成中...
              </>
            ) : (
              <>
                <Send className="mr-2 h-4 w-4" />
                回答案を生成
              </>
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
