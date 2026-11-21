/**
 * Headless entry point: document model, transactions, commands, extensions and serializers.
 * Safe to import in Node.js and during SSR (no DOM access).
 */
import { Editor, EditorOptions } from './core/editor';
import type { Extension, TypeaheadItem } from './core/extension';
import {
  autolinkExtension,
  baseExtension,
  codeExtension,
  emojiExtension,
  equationExtension,
  hashtagExtension,
  layoutExtension,
  listExtension,
  markdownShortcutsExtension,
  mediaExtension,
  mentionNode,
  pagesExtension,
  tableExtension,
} from './core/builtin';
import { commentsExtension, suggestionsExtension } from './features/review';
import { characterLimitExtension, getText as getTextOf } from './features/text';
import { blocksToHTML, htmlToBlocks, ExportOptions } from './core/html';
import { blocksToMarkdown, markdownToBlocks } from './core/markdown';
import { textSel } from './core/selection';
import type { BlockJSON } from './core/model';

export interface Features {
  lists: boolean;
  code: boolean;
  tables: boolean;
  /** callouts, toggles and columns */
  layout: boolean;
  /** images, files and embeds */
  media: boolean;
  equation: boolean;
  mentions: boolean;
  hashtag: boolean;
  emoji: boolean;
  markdownShortcuts: boolean;
  autolink: boolean;
  /** multi-page documents and page breaks */
  pages: boolean;
  comments: boolean;
  suggestions: boolean;
}

export interface MentionOptions {
  /** host-provided people search; may be async. Aborted via `signal` when the query changes. */
  search?: (query: string, ctx: { signal: AbortSignal }) => TypeaheadItem[] | Promise<TypeaheadItem[]>;
  trigger?: string;
}
/** Mentions: an inline `mention` node plus an `@` typeahead backed by the host's search. */
export function mentionsExtension(opts: MentionOptions = {}): Extension {
  return {
    name: 'mentions',
    requires: ['base'],
    nodes: [mentionNode],
    typeahead: opts.search
      ? [
          {
            name: 'mention',
            trigger: opts.trigger ?? '@',
            debounce: 120,
            search: (q, { signal }) => opts.search!(q, { signal }),
            select: (editor, item, range) => {
              editor.update((tr) => {
                tr.replaceText(range.id, range.from, range.to, [{ atom: 'mention', attrs: { id: item.id, label: item.label } }, { text: ' ' }]);
                tr.select(textSel(range.id, range.from + 2));
              });
            },
          },
        ]
      : [],
  };
}

/** The default extension set, filtered by feature flags. */
export function defaultExtensions(features: Partial<Features> = {}, opts: { mentions?: MentionOptions; characterLimit?: number } = {}): Extension[] {
  const f = (k: keyof Features) => features[k] !== false;
  const out: Extension[] = [baseExtension];
  if (f('lists')) out.push(listExtension);
  if (f('code')) out.push(codeExtension);
  if (f('tables')) out.push(tableExtension);
  if (f('layout')) out.push(layoutExtension);
  if (f('media')) out.push(mediaExtension);
  if (f('equation')) out.push(equationExtension);
  if (f('mentions')) out.push(mentionsExtension(opts.mentions));
  if (f('hashtag')) out.push(hashtagExtension);
  if (f('emoji')) out.push(emojiExtension);
  if (f('markdownShortcuts')) out.push(markdownShortcutsExtension);
  if (f('autolink')) out.push(autolinkExtension);
  if (f('pages')) out.push(pagesExtension);
  if (f('comments')) out.push(commentsExtension);
  if (f('suggestions')) out.push(suggestionsExtension);
  if (opts.characterLimit) out.push(characterLimitExtension(opts.characterLimit));
  return out;
}

export interface HeadlessOptions extends EditorOptions {
  features?: Partial<Features>;
  mentions?: MentionOptions;
}

/** Create an editor without a view. Works in Node.js. */
export function createHeadlessEditor(options: HeadlessOptions = {}): Editor {
  return new Editor({
    ...options,
    baseExtensions: options.baseExtensions ?? defaultExtensions(options.features, { mentions: options.mentions, characterLimit: options.characterLimit }),
  });
}

/* ------------------------------------------------------------------ serializer helpers */

export function toHTML(editor: Editor, opts?: ExportOptions): string {
  return blocksToHTML(editor.schema, editor.doc.blocks, opts);
}
export function toMarkdown(editor: Editor): string {
  return blocksToMarkdown(editor.schema, editor.doc.blocks);
}
export function fromHTML(editor: Editor, html: string): BlockJSON[] {
  return htmlToBlocks(editor.schema, html);
}
export function fromMarkdown(editor: Editor, md: string): BlockJSON[] {
  return markdownToBlocks(editor.schema, md);
}
/** Replace the document with imported HTML (resets history unless `history: true`). */
export function setHTML(editor: Editor, html: string, opts?: { history?: boolean }): void {
  editor.setJSON(htmlToBlocks(editor.schema, html), opts);
}
export function setMarkdown(editor: Editor, md: string, opts?: { history?: boolean }): void {
  editor.setJSON(markdownToBlocks(editor.schema, md), opts);
}

/**
 * Render a stored document to semantic, sanitized HTML without a browser — for server-side
 * rendering, static sites, search indexing and e-mail. The same serializers produce the
 * clipboard and export HTML, so what crawlers see is what the editor exports.
 *
 * `ids: true` adds `id` attributes to blocks so `#block-id` links work on the static page.
 */
export function renderToHTML(content: unknown, options: HeadlessOptions & ExportOptions = {}): string {
  const editor = createHeadlessEditor({ ...options, content: content as any });
  try {
    return blocksToHTML(editor.schema, editor.doc.blocks, options);
  } finally {
    editor.destroy();
  }
}
/** Plain text of a stored document (meta descriptions, search indexes, notifications). */
export function renderToText(content: unknown, options: HeadlessOptions = {}): string {
  const editor = createHeadlessEditor({ ...options, content: content as any });
  try {
    return getTextOf(editor);
  } finally {
    editor.destroy();
  }
}

export { copyPayload, cutPayload, pasteData, insertContent, insertInlineContent, parseTSV, tableToMatrix } from './core/clipboard';
export { Editor, Transaction, setIdGenerator } from './core/editor';
export type { EditorOptions, EditorMode, EditorEvents, TransactionEvent, UpdateOptions, CommandFn, Commands, HistoryProvider } from './core/editor';
export * from './core/model';
export { Schema, safeUrl, DOC_VERSION, clone } from './core/schema';
export type { NodeSpec, MarkSpec, AttrSpec, NodeKind, ParseRule, HtmlEl, Migration } from './core/schema';
export { applyStep, mapOffset, StepError } from './core/steps';
export type { Step } from './core/steps';
export * from './core/selection';
export { API_VERSION, defineExtension, normalizeKey, resolveExtensions } from './core/extension';
export type { Extension, InputRule, PasteRule, PasteData, ToolbarItem, SlashItem, BlockAction, TypeaheadSource, TypeaheadItem } from './core/extension';
export {
  deleteRange,
  isMarkActive,
  isBlockActive,
  markValue,
  markRangeAt,
  selectedRanges,
  selectedBlocks,
  focusBlock,
  typingMarks,
  runInputRules,
  nextGrapheme,
  prevDeleteBoundary,
  coreCommands,
} from './core/commands';
export { tableMap, tableContext, cellsInSelection, cellMatrix, selectionRect, repairTable, createTable, findTable, findCell } from './core/table';
export type { TableMap, CellPos, CellMatrix } from './core/table';
export {
  baseExtension,
  listExtension,
  codeExtension,
  tableExtension,
  layoutExtension,
  mediaExtension,
  equationExtension,
  hashtagExtension,
  emojiExtension,
  markdownShortcutsExtension,
  autolinkExtension,
  pagesExtension,
  mentionNode,
  defaultEmbedProviders,
  resolveEmbed,
  getPages,
  activePage,
  pageOf,
  emptyId,
  v as validators,
  FONT_FAMILIES,
  FONT_SIZES,
  EMOJI,
  URL_RE,
} from './core/builtin';
export type { EmbedProvider } from './core/builtin';
export { parseHTML, htmlToBlocks, blocksToHTML, inlineToHTML, extractEmbeddedJSON, esc as escapeHTML, decodeEntities } from './core/html';
export type { HTMLContext, ExportOptions } from './core/html';
export { blocksToMarkdown, markdownToBlocks, inlineToMarkdown, parseInlineMarkdown } from './core/markdown';
export { getText, blockText, getCounts, getHeadings, graphemeCount, findAll, replaceMatch, replaceAll, characterLimitExtension } from './features/text';
export type { Counts, FindOptions, Match, HeadingEntry } from './features/text';
export { commentsExtension, suggestionsExtension, createComments, createSuggestions, createVersions, memoryCommentStore, memoryVersionStore } from './features/review';
export type {
  ReviewUser,
  Permissions,
  Comment,
  CommentThread,
  CommentStore,
  CommentsController,
  ThreadView,
  AnchorRange,
  Suggestion,
  SuggestionsController,
  Version,
  VersionStore,
  VersionsController,
} from './features/review';
export { createAutosave, createUploads, latestRunner } from './features/persist';
export type { Autosave, AutosaveOptions, SaveStatus, Draft, DraftStorage, Uploads, UploadsOptions, UploadHandler, UploadResult, LatestRunner } from './features/persist';
