/**
 * 後方互換シム — claude.ts は llm.ts に移行しました。
 * 既存のインポートが壊れないよう、llm.ts から再エクスポートします。
 */
export type { GenerateResponseInput, GenerateResponseOutput } from './llm';
export { generateResponse } from './llm';
