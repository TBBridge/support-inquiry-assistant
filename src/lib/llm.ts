/**
 * LLM 抽象層 — Gemini / Ollama / Hugging Face を環境変数で切り替え
 *
 * LLM_PROVIDER=gemini       → Google Gemini API (無料枠あり)
 * LLM_PROVIDER=ollama       → ローカル Ollama (完全無料)
 * LLM_PROVIDER=huggingface  → Hugging Face Inference Providers API
 */

import { GoogleGenerativeAI } from "@google/generative-ai";

// ─────────────────────────────────────────────
// 型定義
// ─────────────────────────────────────────────

export type LLMProvider = "gemini" | "ollama" | "huggingface";

export type GenerateResponseInput = {
  query: string;
  context: string;
  language?: "ja" | "en" | "zh";
};

export type GenerateResponseOutput = {
  response: string;
  /** 使用トークン数 (Ollama は prompt_eval_count / eval_count) */
  usage: { inputTokens: number; outputTokens: number };
  /** 実際に使用したプロバイダとモデル名 */
  provider: LLMProvider;
  model: string;
};

// ─────────────────────────────────────────────
// システムプロンプト（共通）
// ─────────────────────────────────────────────

const SYSTEM_PROMPTS: Record<string, string> = {
  ja: `あなたはカスタマーサポートの専門家です。
提供されたドキュメントやナレッジベースの情報を参照して、お客様の問い合わせに対して正確で丁寧な回答案を作成してください。

ガイドライン:
- 参照情報に基づいて回答し、推測で情報を補わないこと
- 回答が不確かな場合は「詳細については担当者にご確認ください」と追記すること
- 日本語で丁寧かつ明確に回答すること
- Markdownを使用して見やすく整形すること
- 参照したソースを明示すること`,

  en: `You are a customer support specialist.
Using the provided documents and knowledge base information, create accurate and polite response drafts for customer inquiries.

Guidelines:
- Base your response on the reference information; do not fill in gaps with speculation
- If uncertain, add "Please confirm with our team for details"
- Respond clearly and professionally in English
- Use Markdown formatting for readability
- Cite the sources you referenced`,

  zh: `您是客户支持专家。
请参考提供的文档和知识库信息，为客户咨询生成准确、礼貌的回答草稿。

回答规范：
- 基于参考信息进行回答，不要凭推测补充信息
- 如有不确定之处，请注明"详情请联系相关负责人确认"
- 使用礼貌、清晰的中文进行回答
- 使用 Markdown 格式使回答更易阅读
- 明确标注所参考的资料来源`,
};

function buildUserMessage(
  query: string,
  context: string,
  language: string,
): string {
  const templates: Record<string, string> = {
    ja: `以下の参照情報を使用して、お客様の問い合わせに回答してください。

## 参照情報
${context}

## お客様の問い合わせ
${query}

上記の参照情報に基づいて、回答案を作成してください。`,

    en: `Using the reference information below, please respond to the customer inquiry.

## Reference Information
${context}

## Customer Inquiry
${query}

Please create a response draft based on the reference information above.`,

    zh: `请使用以下参考资料，回答客户的咨询问题。

## 参考资料
${context}

## 客户咨询
${query}

请根据以上参考资料，生成回答草稿。`,
  };
  return templates[language] ?? templates["ja"];
}

// ─────────────────────────────────────────────
// プロバイダ解決
// ─────────────────────────────────────────────

function getProvider(): LLMProvider {
  const p = (process.env.LLM_PROVIDER ?? "gemini").toLowerCase();
  if (p !== "gemini" && p !== "ollama" && p !== "huggingface") {
    throw new Error(
      `Invalid LLM_PROVIDER: "${p}". Must be "gemini", "ollama", or "huggingface".`,
    );
  }
  return p;
}

// ─────────────────────────────────────────────
// Gemini 実装
// ─────────────────────────────────────────────

// HMR 対応のシングルトン
declare global {
  // eslint-disable-next-line no-var
  var __geminiClient: GoogleGenerativeAI | undefined;
}

function getGeminiClient(): GoogleGenerativeAI {
  if (globalThis.__geminiClient) return globalThis.__geminiClient;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY environment variable is required when LLM_PROVIDER=gemini",
    );
  }
  globalThis.__geminiClient = new GoogleGenerativeAI(apiKey);
  return globalThis.__geminiClient;
}

async function generateWithGemini(
  input: GenerateResponseInput,
): Promise<GenerateResponseOutput> {
  const { query, context, language = "ja" } = input;
  const modelName = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
  const systemPrompt = SYSTEM_PROMPTS[language] ?? SYSTEM_PROMPTS["ja"];
  const userMessage = buildUserMessage(query, context, language);

  const genModel = getGeminiClient().getGenerativeModel({
    model: modelName,
    systemInstruction: systemPrompt,
  });

  const result = await genModel.generateContent(userMessage);
  const response = result.response.text();

  return {
    response,
    usage: {
      inputTokens: result.response.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: result.response.usageMetadata?.candidatesTokenCount ?? 0,
    },
    provider: "gemini",
    model: modelName,
  };
}

// ─────────────────────────────────────────────
// Ollama 実装
// ─────────────────────────────────────────────

type OllamaChatResponse = {
  message: { role: string; content: string };
  prompt_eval_count?: number;
  eval_count?: number;
  done: boolean;
};

async function generateWithOllama(
  input: GenerateResponseInput,
): Promise<GenerateResponseOutput> {
  const { query, context, language = "ja" } = input;
  const baseUrl = (
    process.env.OLLAMA_BASE_URL ?? "http://localhost:11434"
  ).replace(/\/$/, "");
  const modelName = process.env.OLLAMA_MODEL ?? "qwen3:8b";
  const systemPrompt = SYSTEM_PROMPTS[language] ?? SYSTEM_PROMPTS["ja"];
  const userMessage = buildUserMessage(query, context, language);

  const res = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: modelName,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      stream: false,
      options: { temperature: 0.7, num_ctx: 8192 },
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Ollama API error ${res.status}: ${text}. Is Ollama running at ${baseUrl}?`,
    );
  }

  const data = (await res.json()) as OllamaChatResponse;

  return {
    response: data.message.content,
    usage: {
      inputTokens: data.prompt_eval_count ?? 0,
      outputTokens: data.eval_count ?? 0,
    },
    provider: "ollama",
    model: modelName,
  };
}

// ─────────────────────────────────────────────
// Hugging Face 実装
// ─────────────────────────────────────────────

type HuggingFaceChatResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
};

function getHuggingFaceApiKey(): string {
  const apiKey = process.env.HUGGINGFACE_API_KEY ?? process.env.HF_TOKEN;
  if (!apiKey) {
    throw new Error(
      "HUGGINGFACE_API_KEY or HF_TOKEN environment variable is required when LLM_PROVIDER=huggingface",
    );
  }
  return apiKey;
}

function getOptionalNumberEnv(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function generateWithHuggingFace(
  input: GenerateResponseInput,
): Promise<GenerateResponseOutput> {
  const { query, context, language = "ja" } = input;
  const baseUrl = (
    process.env.HUGGINGFACE_BASE_URL ?? "https://router.huggingface.co/v1"
  ).replace(/\/$/, "");
  const modelName =
    process.env.HUGGINGFACE_MODEL ?? "google/gemma-4-26B-A4B-it:fastest";
  const systemPrompt = SYSTEM_PROMPTS[language] ?? SYSTEM_PROMPTS["ja"];
  const userMessage = buildUserMessage(query, context, language);

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getHuggingFaceApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: modelName,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      max_tokens: getOptionalNumberEnv("HUGGINGFACE_MAX_TOKENS", 1024),
      temperature: getOptionalNumberEnv("HUGGINGFACE_TEMPERATURE", 0.7),
      stream: false,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Hugging Face API error ${res.status}: ${text.slice(0, 500)}. ` +
        "Check HUGGINGFACE_API_KEY / HF_TOKEN and model access.",
    );
  }

  const data = (await res.json()) as HuggingFaceChatResponse;
  const response = data.choices?.[0]?.message?.content;
  if (!response) {
    throw new Error("Hugging Face API returned an empty response");
  }

  return {
    response,
    usage: {
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
    },
    provider: "huggingface",
    model: modelName,
  };
}

// ─────────────────────────────────────────────
// 公開 API
// ─────────────────────────────────────────────

export async function generateResponse(
  input: GenerateResponseInput,
): Promise<GenerateResponseOutput> {
  const provider = getProvider();
  switch (provider) {
    case "gemini":
      return generateWithGemini(input);
    case "ollama":
      return generateWithOllama(input);
    case "huggingface":
      return generateWithHuggingFace(input);
  }
}
