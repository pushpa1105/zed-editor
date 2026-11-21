import type { Extension, DocJSON } from '@z-packages/zeditor';

export interface Issue {
  key: string;
  title: string;
  status?: 'open' | 'done';
}
export const DEMO_ISSUES: Issue[];
export function issueRefExtension(options?: { search?: (query: string, ctx: { signal: AbortSignal }) => Promise<Issue[]> | Issue[] }): Extension;
export function calloutExtension(): Extension;
export const SHARED_DOCUMENT: DocJSON;
