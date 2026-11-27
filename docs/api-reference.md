# API reference

_Generated from the TypeScript sources by `scripts/api-docs.mjs` (`pnpm docs:api`). Do not edit by
hand._ Guides explain how these fit together: [user guide](user-guide.md),
[commands and the Editor API](commands.md), [events and sync](events-and-sync.md),
[extensions](extensions.md), [serialization](serialization.md), [databases](databases.md),
[collaboration](collaboration.md).

Each entry shows the signature, the source file, and the doc comment where there is one. Types and
interfaces list their members.

- [`@buffmomo/zeditor/core`](#buffmomozeditorcore) — 290 exports
- [`@buffmomo/zeditor`](#buffmomozeditor) — 44 exports
- [`@buffmomo/zeditor/react`](#buffmomozeditorreact) — 9 exports
- [`@buffmomo/zeditor/vue`](#buffmomozeditorvue) — 6 exports
- [`@buffmomo/zeditor/collab`](#buffmomozeditorcollab) — 19 exports
- [`@buffmomo/zeditor/code-highlight`](#buffmomozeditorcodehighlight) — 6 exports

## `@buffmomo/zeditor/core`

Headless core: document model, commands, extensions, serializers, databases, sync. Works in Node.js.

### Functions

#### `activePage`

```ts
activePage(editor: Editor): Block | null
```

<sub>src/core/builtin.ts</sub>

#### `applyBlockChanges`

```ts
applyBlockChanges(editor: Editor, batch: Partial<SyncBatch>, opts?: { origin?: string | undefined; }): boolean
```

Apply a batch received from the server. Blocks are created, updated, moved or deleted to match; parents missing from the document put new blocks at the top level. Not an undo step; tagged with origin 'remote' (pass another `origin` if you need to tell sources apart). Text is changed only where it differs, so the user's caret keeps its place in a block somebody else edited (text added exactly at the caret goes after it).

<sub>src/features/sync.ts</sub>

#### `applyStep`

```ts
applyStep(doc: Doc, step: Step): Step
```

Apply a step in place and return its inverse. Throws StepError when it does not fit.

<sub>src/core/steps.ts</sub>

#### `blockFromPlain`

```ts
blockFromPlain(j: BlockJSON): Block
```

<sub>src/core/model.ts</sub>

#### `blocksBetween`

```ts
blocksBetween(doc: Doc, fromId: string, toId: string): Block[]
```

All blocks (any kind) from `from` to `to` inclusive, in document order.

<sub>src/core/selection.ts</sub>

#### `blockSel`

```ts
blockSel(ids: string[], anchor?: string | undefined): BlockSelection
```

<sub>src/core/selection.ts</sub>

#### `blocksToHTML`

```ts
blocksToHTML(schema: Schema, blocks: readonly (BlockJSON | Block)[], opts?: ExportOptions): string
```

<sub>src/core/html.ts</sub>

#### `blocksToMarkdown`

```ts
blocksToMarkdown(schema: Schema, blocks: readonly (BlockJSON | Block)[]): string
```

<sub>src/core/markdown.ts</sub>

#### `blockText`

```ts
blockText(editor: Editor, b: Block): string
```

Plain text of a block's inline content; atoms use their `toText`.

<sub>src/features/text.ts</sub>

#### `calculate`

```ts
calculate(rows: any[], prop: DbProperty, calc: DbCalc, ctx?: DbContext | undefined): string
```

<sub>src/core/database.ts</sub>

#### `cellMatrix`

```ts
cellMatrix(editor: Editor, sel: CellSelection): { matrix: CellMatrix; spans: ({ colspan: number; rowspan: number; header: boolean; } | null)[][]; }
```

Contents of the selected rectangle. Positions covered by a merged cell (not its origin) are null.

<sub>src/core/table.ts</sub>

#### `cellsInSelection`

```ts
cellsInSelection(editor: Editor, sel: CellSelection): Block[]
```

<sub>src/core/table.ts</sub>

#### `cellText`

```ts
cellText(row: any, prop: DbProperty, ctx?: DbContext): string
```

Display text of a cell (also what filters, sorts and exports use).

<sub>src/core/database.ts</sub>

#### `cellValue`

```ts
cellValue(row: any, prop: DbProperty, ctx?: DbContext): any
```

<sub>src/core/database.ts</sub>

#### `characterLimitExtension`

```ts
characterLimitExtension(limit: number): Extension
```

Reject local edits that would push the document past `limit` characters. Edits that shrink an over-long document are always allowed.

<sub>src/features/text.ts</sub>

#### `checkFormula`

```ts
checkFormula(src: string): string | null
```

`null` when the formula parses, otherwise the error message (for editors).

<sub>src/core/formula.ts</sub>

#### `cleanMarks`

```ts
cleanMarks(m: MarkSet | undefined): MarkSet | undefined
```

<sub>src/core/model.ts</sub>

#### `clone`

```ts
clone<T>(v: T) => T
```

<sub>src/core/schema.ts</sub>

#### `cloneWithNewIds`

```ts
cloneWithNewIds(j: BlockJSON, idMap?: Map<string, string> | undefined): BlockJSON
```

Deep clone block JSON with fresh ids. `idMap` receives old -> new.

<sub>src/core/model.ts</sub>

#### `comparePoints`

```ts
comparePoints(doc: Doc, a: Point, b: Point): number
```

<sub>src/core/selection.ts</sub>

#### `contentLength`

```ts
contentLength(content: readonly Inline[] | undefined): number
```

<sub>src/core/model.ts</sub>

#### `contentText`

```ts
contentText(content: readonly Inline[] | undefined, atomText?: string | ((a: InlineAtom) => string)): string
```

Text of inline content. Atoms become `atomText` (default U+FFFC) so offsets stay aligned.

<sub>src/core/model.ts</sub>

#### `copyPayload`

```ts
copyPayload(editor: Editor): ClipboardPayload | null
```

Serialize the current selection for the clipboard. Returns null when nothing is selected.

<sub>src/core/clipboard.ts</sub>

#### `createAutosave`

```ts
createAutosave(editor: Editor, opts: AutosaveOptions): Autosave
```

<sub>src/features/persist.ts</sub>

#### `createBlockSync`

```ts
createBlockSync(editor: Editor, opts: BlockSyncOptions): BlockSync
```

<sub>src/features/sync.ts</sub>

#### `createComments`

```ts
createComments(editor: Editor, opts: { store?: CommentStore | undefined; user: ReviewUser; permissions?: Permissions | undefined; }): CommentsController
```

<sub>src/features/review.ts</sub>

#### `createDatabase`

```ts
createDatabase(editor: Editor, opts?: { title?: string | undefined; view?: DbViewType | undefined; properties?: Omit<DbProperty, "id">[] | undefined; rows?: Record<string, any>[] | undefined; }): BlockJSON
```

Build database JSON. `rows` are records keyed by property *name*.

<sub>src/core/database.ts</sub>

#### `createHeadlessEditor`

```ts
createHeadlessEditor(options?: HeadlessOptions): Editor
```

Create an editor without a view. Works in Node.js.

<sub>src/core.ts</sub>

#### `createSuggestions`

```ts
createSuggestions(editor: Editor, opts: { user: ReviewUser; permissions?: Permissions | undefined; }): SuggestionsController
```

Suggestions cover inline text insertions and deletions. Structural edits (splitting, moving, converting blocks, table operations) made while suggesting are applied directly.

<sub>src/features/review.ts</sub>

#### `createTable`

```ts
createTable(editor: Editor, rows: number, cols: number, header?: boolean, fill?: ((r: number, c: number) => string) | undefined): BlockJSON
```

<sub>src/core/table.ts</sub>

#### `createUploads`

```ts
createUploads(editor: Editor, opts: UploadsOptions): Uploads
```

Upload manager. - a placeholder block (image or file) is inserted immediately, tagged with `uploadId` - deleting the block while its upload runs aborts the upload - a result that arrives after its block was removed is kept, so undoing the removal shows the finished upload instead of a dead placeholder - failures leave the block in `status: 'error'` for `retry` The final attribute update is not an undo step.

<sub>src/features/persist.ts</sub>

#### `createVersions`

```ts
createVersions(editor: Editor, opts?: { store?: VersionStore | undefined; user?: ReviewUser | undefined; }): VersionsController
```

<sub>src/features/review.ts</sub>

#### `currentDatabase`

```ts
currentDatabase(editor: Editor): Block | null
```

Database that contains the selection (or is selected).

<sub>src/core/database.ts</sub>

#### `cutPayload`

```ts
cutPayload(editor: Editor): ClipboardPayload | null
```

Copy, then delete the selection (cut). Returns the payload that was removed.

<sub>src/core/clipboard.ts</sub>

#### `dbActiveView`

```ts
dbActiveView(db: Block): DbView
```

<sub>src/core/database.ts</sub>

#### `dbContext`

```ts
dbContext(db: any, parent?: DbContext | undefined): DbContext
```

<sub>src/core/database.ts</sub>

#### `dbProperties`

```ts
dbProperties(db: Block): DbProperty[]
```

<sub>src/core/database.ts</sub>

#### `dbRows`

```ts
dbRows(db: Block): Block[]
```

<sub>src/core/database.ts</sub>

#### `dbTypeSpec`

```ts
dbTypeSpec(type: string): DbTypeSpec | undefined
```

<sub>src/core/database.ts</sub>

#### `dbViews`

```ts
dbViews(db: Block): DbView[]
```

<sub>src/core/database.ts</sub>

#### `decodeEntities`

```ts
decodeEntities(s: string): string
```

<sub>src/core/html.ts</sub>

#### `defaultExtensions`

```ts
defaultExtensions(features?: Partial<Features>, opts?: { mentions?: MentionOptions | undefined; characterLimit?: number | undefined; }): Extension[]
```

The default extension set, filtered by feature flags.

<sub>src/core.ts</sub>

#### `defineExtension`

```ts
defineExtension<T extends Extension>(ext: T) => T
```

<sub>src/core/extension.ts</sub>

#### `deleteRange`

```ts
deleteRange(tr: Transaction, from: Point, to: Point): Point
```

Delete everything between two points (from <= to in document order) and join the blocks. Returns the caret position after deletion.

<sub>src/core/commands.ts</sub>

#### `diffInline`

```ts
diffInline(old: readonly Inline[] | undefined, next: readonly Inline[] | undefined): InlineChange | null
```

The smallest single span in which two versions of a block's text differ (characters or marks), or null when they are equal. Never splits a surrogate pair.

<sub>src/core/model.ts</sub>

#### `emptyId`

```ts
emptyId(editor: Editor, id: string): string | undefined
```

id of the block if it is an empty paragraph (so inserts replace it), else undefined

<sub>src/core/builtin.ts</sub>

#### `escapeHTML`

```ts
esc(s: string): string
```

<sub>src/core/html.ts</sub>

#### `extractEmbeddedJSON`

```ts
extractEmbeddedJSON(html: string): any
```

Extract the internal structured payload embedded by `toClipboardHTML`, if any.

<sub>src/core/html.ts</sub>

#### `findAll`

```ts
findAll(editor: Editor, query: string, opts?: FindOptions): Match[]
```

All matches in document order. Matches never span blocks.

<sub>src/features/text.ts</sub>

#### `findCell`

```ts
findCell(editor: Editor, b: Block | null | undefined): Block | null
```

<sub>src/core/table.ts</sub>

#### `findTable`

```ts
findTable(editor: Editor, b: Block | null | undefined): Block | null
```

<sub>src/core/table.ts</sub>

#### `firstTextBlock`

```ts
firstTextBlock(doc: Doc, schema: Schema, within?: Block | undefined): Block | null
```

<sub>src/core/selection.ts</sub>

#### `fixSelection`

```ts
fixSelection(sel: Selection | null, doc: Doc, schema: Schema): Selection | null
```

Make a selection valid for the document (clamp offsets, drop missing blocks).

<sub>src/core/selection.ts</sub>

#### `focusBlock`

```ts
focusBlock(editor: Editor): Block | null
```

The text block holding the selection focus, if any.

<sub>src/core/commands.ts</sub>

#### `formatDate`

```ts
formatDate(iso: string, locale?: string | undefined): string
```

<sub>src/core/notion.ts</sub>

#### `fromHTML`

```ts
fromHTML(editor: Editor, html: string): BlockJSON[]
```

<sub>src/core.ts</sub>

#### `fromMarkdown`

```ts
fromMarkdown(editor: Editor, md: string): BlockJSON[]
```

<sub>src/core.ts</sub>

#### `getCounts`

```ts
getCounts(editor: Editor): Counts
```

<sub>src/features/text.ts</sub>

#### `getHeadings`

```ts
getHeadings(editor: Editor): HeadingEntry[]
```

Headings in document order: the data for a table of contents (link to `#id` / `revealBlock`).

<sub>src/features/text.ts</sub>

#### `getPages`

```ts
getPages(editor: Editor): Block[]
```

Page blocks of the document, in order (empty when the document is not paged).

<sub>src/core/builtin.ts</sub>

#### `getText`

```ts
getText(editor: Editor, blocks?: readonly Block[]): string
```

Plain text of the document: one line per text block, tables as tab-separated rows.

<sub>src/features/text.ts</sub>

#### `globalId`

```ts
globalId(): string
```

the process-wide generator, ignoring any editor-scoped one

<sub>src/core/model.ts</sub>

#### `graphemeCount`

```ts
graphemeCount(s: string): number
```

Number of user-perceived characters (grapheme clusters).

<sub>src/features/text.ts</sub>

#### `htmlToBlocks`

```ts
htmlToBlocks(schema: Schema, html: string): BlockJSON[]
```

Convert an HTML string into validated block JSON.

<sub>src/core/html.ts</sub>

#### `inlineAt`

```ts
inlineAt(content: readonly Inline[] | undefined, offset: number): Inline | undefined
```

<sub>src/core/model.ts</sub>

#### `inlineLen`

```ts
inlineLen(n: Inline): number
```

<sub>src/core/model.ts</sub>

#### `inlineToHTML`

```ts
inlineToHTML(schema: Schema, content: readonly Inline[] | undefined): string
```

<sub>src/core/html.ts</sub>

#### `inlineToMarkdown`

```ts
inlineToMarkdown(schema: Schema, content: readonly Inline[] | undefined): string
```

<sub>src/core/markdown.ts</sub>

#### `insertContent`

```ts
insertContent(editor: Editor, input: BlockJSON[]): boolean
```

Insert blocks at the selection the way a paste should behave: - a single plain paragraph is inserted inline - otherwise the current block is split at the caret, a leading paragraph joins the text before the caret, and the text after the caret follows the pasted blocks

<sub>src/core/clipboard.ts</sub>

#### `insertInlineContent`

```ts
insertInlineContent(editor: Editor, content: Inline[]): boolean
```

Insert inline content at the selection (replacing it).

<sub>src/core/clipboard.ts</sub>

#### `isAtom`

```ts
isAtom(n: Inline): n is InlineAtom
```

<sub>src/core/model.ts</sub>

#### `isBlockActive`

```ts
isBlockActive(editor: Editor, type: string, attrs?: Attrs | undefined): boolean
```

<sub>src/core/commands.ts</sub>

#### `isCollapsed`

```ts
isCollapsed(sel: Selection | null): boolean
```

<sub>src/core/selection.ts</sub>

#### `isMarkActive`

```ts
isMarkActive(editor: Editor, type: string, value?: any): boolean
```

True when every selected character has the mark (or stored/typing marks for a caret).

<sub>src/core/commands.ts</sub>

#### `jsonEq`

```ts
jsonEq(a: any, b: any): boolean
```

Deterministic structural equality for plain JSON values.

<sub>src/core/model.ts</sub>

#### `lastTextBlock`

```ts
lastTextBlock(doc: Doc, schema: Schema, within?: Block | undefined): Block | null
```

<sub>src/core/selection.ts</sub>

#### `latestRunner`

```ts
latestRunner<T>(search: (query: string, signal: AbortSignal) => T | Promise<T>, debounce?: number) => LatestRunner<T>
```

Wraps an async search so only the latest request can deliver results; older ones are aborted.

<sub>src/features/persist.ts</sub>

#### `mapMarks`

```ts
mapMarks(content: readonly Inline[] | undefined, from: number, to: number, fn: (marks: MarkSet | undefined, node: Inline) => MarkSet | undefined): Inline[]
```

Apply `fn` to the marks of every inline in [from, to).

<sub>src/core/model.ts</sub>

#### `mapOffset`

```ts
mapOffset(step: Step, id: string, offset: number, assoc?: 1 | -1): number
```

Map an offset in block `id` through a step. `assoc` decides the side at an insertion point.

<sub>src/core/steps.ts</sub>

#### `mapSelection`

```ts
mapSelection(sel: Selection | null, steps: readonly Step[], doc: Doc, schema: Schema, foreign?: boolean): Selection | null
```

Map a selection through steps that were already applied to `doc`. `foreign` marks steps the user did not make (another author, a server update). Text such a step inserts exactly at the caret goes *after* the caret, and text inserted at an edge of a selection stays outside it. Without this, two people typing at one position push each other's caret forward and their characters interleave.

<sub>src/core/selection.ts</sub>

#### `markdownToBlocks`

```ts
markdownToBlocks(schema: Schema, md: string): BlockJSON[]
```

<sub>src/core/markdown.ts</sub>

#### `markRangeAt`

```ts
markRangeAt(block: Block, offset: number, type: string): { from: number; to: number; value: any; } | null
```

Range of the run around `offset` carrying mark `type` with one value.

<sub>src/core/commands.ts</sub>

#### `markRanges`

```ts
markRanges(content: readonly Inline[] | undefined, type: string): { from: number; to: number; value: any; }[]
```

Iterate ranges of a mark: yields [from, to, attrs] for maximal runs with equal mark value.

<sub>src/core/model.ts</sub>

#### `marksAt`

```ts
marksAt(content: readonly Inline[] | undefined, offset: number): MarkSet | undefined
```

Marks of the character before `offset` (or after it at offset 0).

<sub>src/core/model.ts</sub>

#### `marksEq`

```ts
marksEq(a: MarkSet | undefined, b: MarkSet | undefined): boolean
```

<sub>src/core/model.ts</sub>

#### `markValue`

```ts
markValue(editor: Editor, type: string): any
```

Value of a mark at the selection start (e.g. link href, color).

<sub>src/core/commands.ts</sub>

#### `memoryCommentStore`

```ts
memoryCommentStore(initial?: CommentThread[]): CommentStore
```

<sub>src/features/review.ts</sub>

#### `memoryVersionStore`

```ts
memoryVersionStore(): VersionStore
```

<sub>src/features/review.ts</sub>

#### `mentionsExtension`

```ts
mentionsExtension(opts?: MentionOptions): Extension
```

Mentions: an inline `mention` node plus an `@` typeahead backed by the host's search.

<sub>src/core.ts</sub>

#### `newId`

```ts
newId(): string
```

<sub>src/core/model.ts</sub>

#### `nextGrapheme`

```ts
nextGrapheme(text: string, offset: number): number
```

Offset of the next grapheme cluster boundary after `offset`.

<sub>src/core/commands.ts</sub>

#### `nextTextBlock`

```ts
nextTextBlock(doc: Doc, schema: Schema, b: Block): Block | null
```

<sub>src/core/selection.ts</sub>

#### `normalizeInline`

```ts
normalizeInline(content: readonly Inline[]): Inline[]
```

Merge adjacent equal-mark spans and drop empty text. Returns a new array.

<sub>src/core/model.ts</sub>

#### `normalizeKey`

```ts
normalizeKey(key: string): string
```

Normalize 'ctrl+B', 'Mod-b', 'Cmd-Shift-Z' to 'Mod-Shift-z' style with fixed modifier order.

<sub>src/core/extension.ts</sub>

#### `pageOf`

```ts
pageOf(editor: Editor, b: Block | null | undefined): Block | null
```

<sub>src/core/builtin.ts</sub>

#### `pagePath`

```ts
pagePath(editor: Editor, id: string): Block[]
```

Ancestors of a page from the top level down, ending with the page itself (breadcrumbs).

<sub>src/core/builtin.ts</sub>

#### `pageTree`

```ts
pageTree(editor: Editor): { page: Block; depth: number; }[]
```

Pages in tree order (each page followed by its sub-pages) with their depth.

<sub>src/core/builtin.ts</sub>

#### `parentPage`

```ts
parentPage(editor: Editor, page: Block): Block | null
```

Parent page of a sub-page (null for top-level pages or when the parent no longer exists).

<sub>src/core/builtin.ts</sub>

#### `parseFormula`

```ts
parseFormula(src: string): Node
```

<sub>src/core/formula.ts</sub>

#### `parseHTML`

```ts
parseHTML(html: string): HtmlEl
```

Parse an HTML string into a lightweight element tree (root tag '#root').

<sub>src/core/html.ts</sub>

#### `parseInlineMarkdown`

```ts
parseInlineMarkdown(schema: Schema, src: string, marks?: MarkSet | undefined): Inline[]
```

<sub>src/core/markdown.ts</sub>

#### `parseTSV`

```ts
parseTSV(editor: Editor, text: string): CellMatrix
```

Parse tab-separated text (spreadsheets) into a cell matrix. Handles quoted cells.

<sub>src/core/clipboard.ts</sub>

#### `pasteData`

```ts
pasteData(editor: Editor, data: PasteData): boolean
```

Apply pasted data. Order: extension paste rules, structured payload, table ranges, URL-on-selection, HTML, plain text. Files are left to the host (uploads).

<sub>src/core/clipboard.ts</sub>

#### `prevDeleteBoundary`

```ts
prevDeleteBoundary(text: string, offset: number): number
```

Offset where Backspace should stop. Emoji sequences are removed as a whole; otherwise one code point is removed, matching native behaviour for combining marks and Indic scripts.

<sub>src/core/commands.ts</sub>

#### `prevTextBlock`

```ts
prevTextBlock(doc: Doc, schema: Schema, b: Block): Block | null
```

<sub>src/core/selection.ts</sub>

#### `queryDatabase`

```ts
queryDatabase(db: Block, viewId?: string | undefined, opts?: { search?: string | undefined; }): DbResult
```

Evaluate a view: filter, sort, group and calculate. Pure; does not touch the document.

<sub>src/core/database.ts</sub>

#### `registerDbPropertyType`

```ts
registerDbPropertyType(spec: DbTypeSpec): void
```

Register a custom database property type (global: available to every editor).

<sub>src/core/database.ts</sub>

#### `relatedRows`

```ts
relatedRows(row: any, prop: DbProperty, ctx?: DbContext): any[]
```

Rows a relation cell points at (only rows that still exist in the target database).

<sub>src/core/database.ts</sub>

#### `renderToHTML`

```ts
renderToHTML(content: unknown, options?: HeadlessOptions & ExportOptions): string
```

Render a stored document to semantic, sanitized HTML without a browser — for server-side rendering, static sites, search indexing and e-mail. The same serializers produce the clipboard and export HTML, so what crawlers see is what the editor exports. `ids: true` adds `id` attributes to blocks so `#block-id` links work on the static page.

<sub>src/core.ts</sub>

#### `renderToText`

```ts
renderToText(content: unknown, options?: HeadlessOptions): string
```

Plain text of a stored document (meta descriptions, search indexes, notifications).

<sub>src/core.ts</sub>

#### `repairTable`

```ts
repairTable(tr: Transaction, table: Block): boolean
```

Pad short rows so the table is rectangular. Returns true if steps were added.

<sub>src/core/table.ts</sub>

#### `replaceAll`

```ts
replaceAll(editor: Editor, query: string, replaceWith: string, opts?: FindOptions): number
```

Replace every match in a single undoable transaction. Returns the number of replacements.

<sub>src/features/text.ts</sub>

#### `replaceInline`

```ts
replaceInline(content: readonly Inline[] | undefined, from: number, to: number, insert: readonly Inline[]): Inline[]
```

<sub>src/core/model.ts</sub>

#### `replaceMatch`

```ts
replaceMatch(editor: Editor, m: Match, query: string, replaceWith: string, opts?: FindOptions): boolean
```

<sub>src/features/text.ts</sub>

#### `resolveEmbed`

```ts
resolveEmbed(editor: Editor, url: string): { provider: string; src: string; aspect?: number | undefined; } | null
```

Resolve an embed URL through the configured providers.

<sub>src/core/builtin.ts</sub>

#### `resolveExtensions`

```ts
resolveExtensions(list: Extension[], schema: Schema): ResolvedExtensions
```

Order extensions (dependencies first, then by priority), detect conflicts and merge their contributions. An extension with the same name as an earlier one replaces it, which lets hosts reconfigure a default extension.

<sub>src/core/extension.ts</sub>

#### `runFormula`

```ts
runFormula(src: string, prop: (name: string) => FormulaValue): FormulaValue
```

Parse (cached) and evaluate. Errors are returned as a `#ERR: …` string, never thrown.

<sub>src/core/formula.ts</sub>

#### `runInputRules`

```ts
runInputRules(editor: Editor): boolean
```

Apply the first matching input rule at the caret. The rule becomes its own undo entry.

<sub>src/core/commands.ts</sub>

#### `safeUrl`

```ts
safeUrl(url: unknown, opts?: { image?: boolean | undefined; }): string
```

Returns the URL if it uses an allowed scheme, otherwise ''.

<sub>src/core/schema.ts</sub>

#### `selectedBlocks`

```ts
selectedBlocks(editor: Editor, sel?: Selection | null): Block[]
```

Top-most blocks touched by the selection, in document order.

<sub>src/core/commands.ts</sub>

#### `selectedRanges`

```ts
selectedRanges(editor: Editor, sel?: Selection | null): TextRange[]
```

Text ranges covered by the current selection (text, block or cell selection).

<sub>src/core/commands.ts</sub>

#### `selectionRect`

```ts
selectionRect(map: TableMap, a: string, b: string): { r0: number; r1: number; c0: number; c1: number; } | null
```

Rectangle covered by a cell selection, expanded to include merged cells completely.

<sub>src/core/table.ts</sub>

#### `selEq`

```ts
selEq(a: Selection | null, b: Selection | null): boolean
```

<sub>src/core/selection.ts</sub>

#### `selRange`

```ts
selRange(doc: Doc, sel: TextSelection): Range
```

<sub>src/core/selection.ts</sub>

#### `setHTML`

```ts
setHTML(editor: Editor, html: string, opts?: { history?: boolean | undefined; } | undefined): void
```

Replace the document with imported HTML (resets history unless `history: true`).

<sub>src/core.ts</sub>

#### `setIdGenerator`

```ts
setIdGenerator(fn: () => string): void
```

Replace the process-wide id generator (useful for deterministic tests).

<sub>src/core/model.ts</sub>

#### `setMarkdown`

```ts
setMarkdown(editor: Editor, md: string, opts?: { history?: boolean | undefined; } | undefined): void
```

<sub>src/core.ts</sub>

#### `sliceInline`

```ts
sliceInline(content: readonly Inline[] | undefined, from: number, to?: number): Inline[]
```

<sub>src/core/model.ts</sub>

#### `splitsPair`

```ts
splitsPair(content: readonly Inline[] | undefined, offset: number): boolean
```

Is `offset` between the two halves of a surrogate pair?

<sub>src/core/model.ts</sub>

#### `summarizeTransaction`

```ts
summarizeTransaction(steps: Step[], inverse: Step[], doc: Doc, origin: string): BlockChanges
```

Net block changes of one transaction. `steps[i]` was applied with inverse `inverse[i]`; `doc` is the document after the transaction.

<sub>src/core/events.ts</sub>

#### `tableContext`

```ts
tableContext(editor: Editor, sel?: Selection | null): Ctx | null
```

Table context of the current selection.

<sub>src/core/table.ts</sub>

#### `tableMap`

```ts
tableMap(table: Block): TableMap
```

<sub>src/core/table.ts</sub>

#### `tableToMatrix`

```ts
tableToMatrix(table: BlockJSON): CellMatrix
```

Convert an imported table block into a matrix; covered positions of merged cells become null.

<sub>src/core/clipboard.ts</sub>

#### `textBlocksBetween`

```ts
textBlocksBetween(doc: Doc, schema: Schema, fromId: string, toId: string): Block[]
```

Text blocks from `from` to `to` inclusive, in document order.

<sub>src/core/selection.ts</sub>

#### `textSel`

```ts
textSel(id: string, offset: number, focusId?: string, focusOffset?: number): TextSelection
```

<sub>src/core/selection.ts</sub>

#### `tocEntries`

```ts
tocEntries(editor: Editor, tocId: string): HeadingEntry[]
```

Entries for a `toc` block: headings of the page that contains it (or of the document).

<sub>src/core/notion.ts</sub>

#### `toHTML`

```ts
toHTML(editor: Editor, opts?: ExportOptions | undefined): string
```

<sub>src/core.ts</sub>

#### `toMarkdown`

```ts
toMarkdown(editor: Editor): string
```

<sub>src/core.ts</sub>

#### `topMost`

```ts
topMost(doc: Doc, ids: Iterable<string>): Block[]
```

Reduce a list of blocks to the top-most ones (drop blocks whose ancestor is also listed), in doc order.

<sub>src/core/selection.ts</sub>

#### `toSyncBlock`

```ts
toSyncBlock(b: Block): SyncBlock
```

Shallow description of a block for a block store.

<sub>src/features/sync.ts</sub>

#### `typingMarks`

```ts
typingMarks(editor: Editor, block: Block, offset: number): MarkSet | undefined
```

Marks that newly typed text gets at `offset` (respects non-inclusive marks such as links).

<sub>src/core/commands.ts</sub>

#### `withIdGenerator`

```ts
withIdGenerator<T>(gen: (() => string) | null | undefined, fn: () => T) => T
```

Run `fn` with `gen` as the id generator (nested calls keep the innermost).

<sub>src/core/model.ts</sub>

### Classes

#### `Block`

```ts
class Block
```

<sub>src/core/model.ts</sub>

| Member | Description |
| --- | --- |
| `parent: Block \| null` |  |
| `id: string` |  |
| `type: string` |  |
| `attrs: Attrs` |  |
| `content: Inline[] \| undefined` |  |
| `children: Block[] \| undefined` |  |
| `get index: number` |  |
| `get length: number` |  |
| `get text: string` |  |
| `get prevSibling: Block \| null` |  |
| `get nextSibling: Block \| null` |  |
| `toJSON(): BlockJSON` |  |

#### `Doc`

```ts
class Doc
```

Mutable document tree with an id index. Mutate only through steps.

<sub>src/core/model.ts</sub>

| Member | Description |
| --- | --- |
| `root: Block` |  |
| `index(b: Block): void` |  |
| `unindex(b: Block): void` |  |
| `get(id: string): Block \| undefined` |  |
| `has(id: string): boolean` |  |
| `get size: number` |  |
| `get blocks: Block[]` |  |
| `next(b: Block, skipChildren?: boolean): Block \| null` | Next block in document order (pre-order). |
| `prev(b: Block): Block \| null` | Previous block in document order. |
| `first(): Block \| null` |  |
| `last(): Block \| null` |  |
| `descendants(of?: Block): Generator<Block, any, any>` |  |
| `compare(a: Block, b: Block): number` | -1 if a is before b in document order, 1 if after, 0 if same. |
| `path(b: Block): number[]` |  |
| `isAncestor(anc: Block, b: Block): boolean` |  |
| `ancestors(b: Block): Block[]` |  |
| `closest(b: Block \| null \| undefined, pred: (b: Block) => boolean): Block \| null` |  |
| `toJSON(): BlockJSON[]` |  |

#### `Editor`

```ts
class Editor
```

The headless editor: document, selection, history, commands and extensions. It has no DOM dependency; `EditorView` renders it in a browser.

<sub>src/core/editor.ts</sub>

| Member | Description |
| --- | --- |
| `schema: Schema` |  |
| `doc: Doc` |  |
| `selection: Selection \| null` |  |
| `storedMarks: MarkSet \| null` | marks applied to the next typed text (set by toggling a mark with a collapsed selection) |
| `mode: EditorMode` |  |
| `readOnly: boolean` |  |
| `options: EditorOptions` |  |
| `commands: CommandMap` |  |
| `extensions: Extension[]` |  |
| `inputRules: InputRule[]` |  |
| `pasteRules: PasteRule[]` |  |
| `keymaps: { key: string; run: (editor: Editor, event?: any) => boolean; priority: number; ext: string; }[]` |  |
| `toolbarItems: ToolbarItem[]` |  |
| `slashItems: SlashItem[]` |  |
| `blockActions: BlockAction[]` |  |
| `typeaheads: TypeaheadSource[]` |  |
| `labels: Record<string, string>` |  |
| `filters: ((tr: Transaction) => boolean)[]` | return false to reject a transaction (it is rolled back) |
| `appenders: ((tr: Transaction) => void)[]` | run inside every local transaction before commit; may add steps |
| `view: any` | attached view, if any (set by EditorView) |
| `storage: Record<string, any>` | free-form per-extension storage |
| `history: HistoryProvider` |  |
| `destroyed: boolean` |  |
| `revision: number` | incremented on every committed transaction that changed the document |
| `on<K extends keyof EditorEvents>(event: K, fn: (payload: EditorEvents[K]) => void): () => void` |  |
| `emit<K extends keyof EditorEvents>(event: K, payload?: EditorEvents[K] \| undefined): void` |  |
| `hasListener(event: string): boolean` | whether anything listens to `event` (UI parts use it to detect a missing handler) |
| `listenerCount(): number` | number of registered listeners (for leak tests) |
| `onDestroy(fn: () => void): void` | Register a cleanup to run on destroy. |
| `getJSON(): DocJSON` |  |
| `setJSON(content: unknown, opts?: { history?: boolean \| undefined; origin?: string \| undefined; }): string[]` | Replace the whole document. By default this resets history (loading a file); pass `{ history: true }` to make the replacement an undoable edit. |
| `validate(content: unknown): string[]` | Issues found while validating the given JSON, without loading it. |
| `get isEmpty: boolean` |  |
| `update(fn: (tr: Transaction) => void, opts?: UpdateOptions): boolean` | Run `fn` against a transaction and commit it. Nested calls join the outer transaction. Returns false when the transaction was rejected or threw (the document is rolled back). |
| `get activeBlockId: string \| null` | id of the block holding the caret (or the first selected block) |
| `remapIds(map: Record<string, string>): boolean` | Rename blocks, e.g. to the ids your backend assigned after saving them. References to the old ids inside other blocks (relations, synced copies, sub-page parents, page links) are updated too, and so are the undo / redo history and the selection. The rename is not an undo step. Returns false (and changes nothing) when a new id is invalid, already used, or an old id does not exist. |
| `setSelection(sel: Selection \| null, opts?: { scroll?: boolean \| undefined; }): void` |  |
| `cutHistory(): void` | Start a new undo entry at the next change. |
| `undo(): boolean` |  |
| `redo(): boolean` |  |
| `canUndo(): boolean` |  |
| `canRedo(): boolean` |  |
| `setMode(mode: EditorMode): void` | Switch editing mode. Not a document change: no undo entry, selection and scroll are kept. |
| `setReadOnly(readOnly: boolean): void` |  |
| `setStoredMarks(marks: MarkSet \| null): void` |  |
| `exec(name: string, ...args: any[]): boolean` | Run a command by name. Unknown names return false. |
| `label(key: string, fallback?: string \| undefined): string` |  |
| `focus(): void` |  |
| `hasExtension(name: string): boolean` |  |
| `destroy(): void` |  |

#### `Schema`

```ts
class Schema
```

<sub>src/core/schema.ts</sub>

| Member | Description |
| --- | --- |
| `idGenerator: (() => string) \| null` | per-editor id generator (EditorOptions.idGenerator); falls back to the process-wide one |
| `nodes: Map<string, NodeSpec>` |  |
| `marks: Map<string, MarkSpec>` |  |
| `migrations: Migration[]` |  |
| `extensionVersions: Record<string, number>` | extension name -> schemaVersion, written into saved documents |
| `extensionMigrations: Record<string, (doc: DocJSON, from: number) => DocJSON>` |  |
| `node(type: string): NodeSpec \| undefined` |  |
| `kind(b: { type: string; }): NodeKind \| undefined` |  |
| `isText(b: { type: string; } \| null \| undefined): boolean` |  |
| `isContainer(b: { type: string; } \| null \| undefined): boolean` |  |
| `isAtom(b: { type: string; } \| null \| undefined): boolean` |  |
| `canContain(parent: { type: string; }, type: string): boolean` | Can `parent` hold a child of `type`? |
| `defaults(type: string, attrs?: Attrs \| undefined): Attrs` |  |
| `create(type: string, attrs?: Attrs \| undefined, content?: string \| Inline[] \| undefined, children?: BlockJSON[] \| undefined): BlockJSON` | Build block JSON with a fresh id and default attrs. Containers get a default child. |
| `defaultChild(spec: NodeSpec): string` |  |
| `migrate(input: DocJSON): DocJSON` |  |
| `parse(input: unknown): { blocks: Block[]; issues: string[]; }` | Validate and sanitize untrusted JSON. Never throws for malformed blocks: bad parts are repaired or dropped and reported in `issues`. Unknown block types are preserved as inert `unknown` blocks which serialize back to their original JSON. |
| `parseBlock(raw: any, seen: Set<string>, issues: string[]): Block \| null` |  |
| `parseAttrs(specs: Record<string, AttrSpec> \| undefined, raw: any, keepExtra: boolean): Attrs` |  |
| `parseMarks(raw: any): MarkSet \| undefined` |  |
| `parseInline(raw: any, spec: NodeSpec \| undefined, issues: string[]): Inline[]` |  |
| `serializeBlock(b: Block): BlockJSON` | Serialize a block for storage; unknown blocks return their original JSON. |
| `serialize(doc: Doc): DocJSON` |  |
| `sanitizeBlocks(list: BlockJSON[], doc?: Doc \| undefined): BlockJSON[]` | Validate block JSON for insertion (paste, commands). Ids colliding with `doc` are regenerated. |

#### `StepError`

```ts
class StepError
```

<sub>src/core/steps.ts</sub>

| Member | Description |
| --- | --- |
| `name: string` |  |
| `message: string` |  |
| `stack?: string \| undefined` |  |

#### `Transaction`

```ts
class Transaction
```

<sub>src/core/editor.ts</sub>

| Member | Description |
| --- | --- |
| `steps: Step[]` |  |
| `inverse: Step[]` | inverse of each step, same order |
| `selection: Selection \| null \| undefined` | `undefined` means: map the previous selection through the steps |
| `meta: Record<string, any>` |  |
| `dirty: Set<string>` | ids of blocks whose attrs/content/children changed |
| `selectionBefore: Selection \| null` |  |
| `scrollIntoView: boolean` |  |
| `editor: Editor` |  |
| `get doc: Doc` |  |
| `get schema: Schema` |  |
| `get docChanged: boolean` |  |
| `step(s: Step): Transaction` |  |
| `replaceText(id: string, from: number, to: number, insert?: string \| Inline[], marks?: MarkSet \| undefined): Transaction` | Replace inline content of a text block. Strings inherit `marks`. |
| `setAttrs(id: string, patch: Attrs): Transaction` | Shallow-merge attrs. `undefined` values delete keys. |
| `setType(id: string, type: string, attrs?: Attrs \| undefined, keep?: string[]): Transaction` | Change the type of a block within the same kind. Attrs are reset to the new type's defaults plus `attrs`. |
| `insert(parentId: string, index: number, blocks: BlockJSON[]): Transaction` |  |
| `insertAfter(id: string, blocks: BlockJSON[]): Transaction` |  |
| `insertBefore(id: string, blocks: BlockJSON[]): Transaction` |  |
| `remove(id: string): Transaction` |  |
| `removeAt(parentId: string, index: number, count?: number): Transaction` |  |
| `move(ids: string[], parentId: string, index: number): boolean` | Move blocks (with their subtrees) to `parentId` at `index`, where `index` refers to the child list before the move. Returns false (and does nothing) for invalid moves such as moving a block into itself or one of its descendants. |
| `replaceBlock(id: string, blocks: BlockJSON[]): Transaction` | Replace a block by other blocks (may be of a different kind). |
| `select(sel: Selection \| null): Transaction` |  |
| `setMeta(key: string, value: any): Transaction` |  |
| `scroll(): Transaction` |  |

### Constants

#### `API_VERSION`

```ts
const API_VERSION: 1
```

Engine extension API version. Bumped on breaking changes to the extension contract.

<sub>src/core/extension.ts</sub>

#### `autolinkExtension`

```ts
const autolinkExtension: Extension
```

<sub>src/core/builtin.ts</sub>

#### `baseExtension`

```ts
const baseExtension: Extension
```

<sub>src/core/builtin.ts</sub>

#### `BLOCK_EVENTS`

```ts
const BLOCK_EVENTS: readonly ["blocks", "block:created", "block:updated", "block:deleted", "block:moved", "block:completed", "block:uncompleted"]
```

names of the per-block events, for `editor.on(...)`

<sub>src/core/events.ts</sub>

#### `BLOCK_ID`

```ts
const BLOCK_ID: RegExp
```

Valid block id: 1–64 letters, digits, `_`, `:`, `.` or `-` (UUIDs and numeric ids fit).

<sub>src/core/model.ts</sub>

#### `codeExtension`

```ts
const codeExtension: Extension
```

<sub>src/core/builtin.ts</sub>

#### `commentsExtension`

```ts
const commentsExtension: Extension
```

<sub>src/features/review.ts</sub>

#### `coreCommands`

```ts
const coreCommands: Record<string, CommandFn>
```

<sub>src/core/commands.ts</sub>

#### `databaseCommands`

```ts
const databaseCommands: Record<string, CommandFn>
```

<sub>src/core/database.ts</sub>

#### `databaseExtension`

```ts
const databaseExtension: Extension
```

<sub>src/core/database.ts</sub>

#### `DB_CALCS`

```ts
const DB_CALCS: DbCalc[]
```

<sub>src/core/database.ts</sub>

#### `DB_COLORS`

```ts
const DB_COLORS: readonly ["gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"]
```

<sub>src/core/database.ts</sub>

#### `DB_FILTER_OPS`

```ts
const DB_FILTER_OPS: DbFilterOp[]
```

<sub>src/core/database.ts</sub>

#### `DB_PROPERTY_TYPES`

```ts
const DB_PROPERTY_TYPES: DbPropertyType[]
```

Built-in types plus any registered with `registerDbPropertyType`.

<sub>src/core/database.ts</sub>

#### `DB_VIEW_TYPES`

```ts
const DB_VIEW_TYPES: DbViewType[]
```

<sub>src/core/database.ts</sub>

#### `defaultEmbedProviders`

```ts
const defaultEmbedProviders: EmbedProvider[]
```

<sub>src/core/builtin.ts</sub>

#### `DOC_VERSION`

```ts
const DOC_VERSION: 1
```

<sub>src/core/schema.ts</sub>

#### `EMOJI`

```ts
const EMOJI: [string, string, string][]
```

<sub>src/core/builtin.ts</sub>

#### `emojiExtension`

```ts
const emojiExtension: Extension
```

<sub>src/core/builtin.ts</sub>

#### `equationExtension`

```ts
const equationExtension: Extension
```

<sub>src/core/builtin.ts</sub>

#### `FONT_FAMILIES`

```ts
const FONT_FAMILIES: readonly ["serif", "sans-serif", "monospace", "cursive"]
```

<sub>src/core/builtin.ts</sub>

#### `FONT_SIZES`

```ts
const FONT_SIZES: readonly ["12px", "14px", "16px", "18px", "24px", "32px"]
```

<sub>src/core/builtin.ts</sub>

#### `FORMULA_FUNCTIONS`

```ts
const FORMULA_FUNCTIONS: string[]
```

<sub>src/core/formula.ts</sub>

#### `hashtagExtension`

```ts
const hashtagExtension: Extension
```

<sub>src/core/builtin.ts</sub>

#### `layoutExtension`

```ts
const layoutExtension: Extension
```

<sub>src/core/builtin.ts</sub>

#### `listExtension`

```ts
const listExtension: Extension
```

<sub>src/core/builtin.ts</sub>

#### `markdownShortcutsExtension`

```ts
const markdownShortcutsExtension: Extension
```

<sub>src/core/builtin.ts</sub>

#### `mediaExtension`

```ts
const mediaExtension: Extension
```

<sub>src/core/builtin.ts</sub>

#### `mentionNode`

```ts
const mentionNode: NodeSpec
```

<sub>src/core/builtin.ts</sub>

#### `notionExtension`

```ts
const notionExtension: Extension
```

<sub>src/core/notion.ts</sub>

#### `OBJ`

```ts
const OBJ: "￼"
```

Placeholder character used when inline atoms are flattened to text.

<sub>src/core/model.ts</sub>

#### `pagesExtension`

```ts
const pagesExtension: Extension
```

<sub>src/core/builtin.ts</sub>

#### `ROOT_ID`

```ts
const ROOT_ID: "root"
```

<sub>src/core/model.ts</sub>

#### `suggestionsExtension`

```ts
const suggestionsExtension: Extension
```

<sub>src/features/review.ts</sub>

#### `tableExtension`

```ts
const tableExtension: Extension
```

<sub>src/core/builtin.ts</sub>

#### `URL_RE`

```ts
const URL_RE: RegExp
```

<sub>src/core/builtin.ts</sub>

#### `validators`

```ts
const v: { enumOf: <T extends string>(...vals: T[]) => (x: any) => T | undefined; int: (min: number, max: number) => (x: any) => number | undefined; str: (max?: number) => (x: any) => string | undefined; bool: (x: any) => boolean | undefined; color: (x: any) => string | undefined; url: (x: any) => string | u …
```

<sub>src/core/builtin.ts</sub>

### Interfaces

#### `AnchorRange`

```ts
interface AnchorRange
```

<sub>src/features/review.ts</sub>

| Member | Description |
| --- | --- |
| `id: string` |  |
| `from: number` |  |
| `to: number` |  |

#### `AttrSpec`

```ts
interface AttrSpec
```

<sub>src/core/schema.ts</sub>

| Member | Description |
| --- | --- |
| `default?: any` |  |
| `validate?: ((value: any) => any) \| undefined` | Return the sanitized value, or `undefined` to fall back to the default. |

#### `Autosave`

```ts
interface Autosave
```

<sub>src/features/persist.ts</sub>

| Member | Description |
| --- | --- |
| `status: SaveStatus` |  |
| `error: unknown` |  |
| `flush(): Promise<boolean>` | save now (if dirty) and resolve when the document as of this call is persisted or failed |
| `retry(): Promise<boolean>` |  |
| `getDraft(): Draft \| null` | a local draft newer than what was last confirmed saved, if any |
| `recoverDraft(): boolean` | load the draft into the editor (undoable) |
| `clearDraft(): void` |  |
| `subscribe(fn: (status: SaveStatus) => void): () => void` |  |
| `destroy(): void` |  |

#### `AutosaveOptions`

```ts
interface AutosaveOptions
```

<sub>src/features/persist.ts</sub>

| Member | Description |
| --- | --- |
| `save: (doc: DocJSON, ctx: { revision: number; signal: AbortSignal; }) => unknown` | persist the document. Reject (or throw) on failure. `signal` aborts when the autosave is destroyed. |
| `debounce?: number \| undefined` | quiet period after the last edit before saving (ms, default 800) |
| `maxWait?: number \| undefined` | save at least this often while edits keep coming (ms, default 5000) |
| `draftKey?: string \| undefined` | keep a local draft under this key until the save succeeds |
| `draftStorage?: DraftStorage \| undefined` | defaults to localStorage when available |
| `retryDelays?: number[] \| undefined` | retry delays after a failed save (ms). Default [1000, 3000, 10000, 30000] |
| `onStatus?: ((status: SaveStatus, error?: unknown) => void) \| undefined` |  |
| `isOnline?: (() => boolean) \| undefined` |  |

#### `BlockAction`

```ts
interface BlockAction
```

<sub>src/core/extension.ts</sub>

| Member | Description |
| --- | --- |
| `id: string` |  |
| `label: string` |  |
| `icon?: string \| undefined` |  |
| `run: (editor: Editor, ids: string[]) => void` |  |
| `enabled?: ((editor: Editor, ids: string[]) => boolean) \| undefined` |  |

#### `BlockChanges`

```ts
interface BlockChanges
```

<sub>src/core/events.ts</sub>

| Member | Description |
| --- | --- |
| `origin: string` | who made the change: 'local', 'remote', 'history', 'paste', 'load', 'remap' or a custom origin |
| `created: BlockCreated[]` |  |
| `updated: BlockUpdated[]` |  |
| `deleted: BlockDeleted[]` |  |
| `moved: BlockMoved[]` |  |
| `completed: BlockCompleted[]` | blocks whose `checked` attribute became true (check-list items) |
| `uncompleted: BlockCompleted[]` | blocks whose `checked` attribute became false |

#### `BlockCompleted`

```ts
interface BlockCompleted
```

<sub>src/core/events.ts</sub>

| Member | Description |
| --- | --- |
| `id: string` |  |
| `type: string` |  |
| `block: Block` |  |

#### `BlockCreated`

```ts
interface BlockCreated
```

<sub>src/core/events.ts</sub>

| Member | Description |
| --- | --- |
| `id: string` |  |
| `type: string` |  |
| `json: BlockJSON` | the block as JSON, children included (descendants are not reported separately) |
| `ids: string[]` | ids of the block and all of its descendants |
| `parentId: string \| null` |  |
| `index: number` |  |
| `afterId: string \| null` | id of the previous sibling, `null` when the block is first (handy for "insert after" APIs) |

#### `BlockDeleted`

```ts
interface BlockDeleted
```

<sub>src/core/events.ts</sub>

| Member | Description |
| --- | --- |
| `id: string` |  |
| `type: string` |  |
| `parentId: string \| null` | where it was before the transaction |
| `index: number` |  |
| `json: BlockJSON` | the deleted block as JSON, children included |
| `ids: string[]` | ids of the block and all of its descendants |

#### `BlockJSON`

```ts
interface BlockJSON
```

<sub>src/core/model.ts</sub>

| Member | Description |
| --- | --- |
| `id: string` |  |
| `type: string` |  |
| `attrs?: Attrs \| undefined` |  |
| `content?: Inline[] \| undefined` |  |
| `children?: BlockJSON[] \| undefined` |  |

#### `BlockMoved`

```ts
interface BlockMoved
```

<sub>src/core/events.ts</sub>

| Member | Description |
| --- | --- |
| `id: string` |  |
| `type: string` |  |
| `from: { parentId: string \| null; index: number; }` |  |
| `to: BlockPosition` |  |

#### `BlockPosition`

```ts
interface BlockPosition
```

Where a block sits: parent (`null` = top level), index among its siblings, previous sibling.

<sub>src/core/events.ts</sub>

| Member | Description |
| --- | --- |
| `parentId: string \| null` |  |
| `index: number` |  |
| `afterId: string \| null` | id of the previous sibling, `null` when the block is first (handy for "insert after" APIs) |

#### `BlockSelection`

```ts
interface BlockSelection
```

One or more whole blocks. `ids` are top-most selected blocks in document order.

<sub>src/core/selection.ts</sub>

| Member | Description |
| --- | --- |
| `type: "block"` |  |
| `ids: string[]` |  |
| `anchor?: string \| undefined` | block where the selection started (for shift-extension) |

#### `BlockSync`

```ts
interface BlockSync
```

<sub>src/features/sync.ts</sub>

| Member | Description |
| --- | --- |
| `flush(): Promise<void>` | push now (resolves when the pending changes are saved, or rejects on failure) |
| `pending: number` | number of blocks waiting to be pushed |
| `status: SyncStatus` |  |
| `destroy(): void` |  |

#### `BlockSyncOptions`

```ts
interface BlockSyncOptions
```

<sub>src/features/sync.ts</sub>

| Member | Description |
| --- | --- |
| `push(batch: SyncBatch): void \| Promise<void \| { ids?: Record<string, string> \| undefined; }>` | send a batch to the server; reject / throw to retry later |
| `delay?: number \| undefined` | quiet time before a push, in ms (default 800) |
| `maxDelay?: number \| undefined` | longest wait while edits keep coming, in ms (default 5000) |
| `shouldPush` | which change origins to push (default: all but 'remote', 'load' and 'remap') |
| `onStatus` |  |

#### `BlockUpdated`

```ts
interface BlockUpdated
```

<sub>src/core/events.ts</sub>

| Member | Description |
| --- | --- |
| `id: string` |  |
| `type: string` |  |
| `changes: BlockChangeKind[]` | what changed: the text ('content'), the attributes ('attrs'), the block type ('type') |
| `attrsBefore?: Attrs \| undefined` | attributes before and after the transaction (present when attrs or type changed) |
| `attrsAfter?: Attrs \| undefined` |  |
| `typeBefore?: string \| undefined` |  |
| `cells?: string[] \| undefined` | database rows: ids of the properties whose cell value changed |
| `block: Block` |  |

#### `CellPos`

```ts
interface CellPos
```

<sub>src/core/table.ts</sub>

| Member | Description |
| --- | --- |
| `row: number` |  |
| `col: number` |  |
| `rowspan: number` |  |
| `colspan: number` |  |

#### `CellSelection`

```ts
interface CellSelection
```

Rectangular range of table cells between two cells of the same table.

<sub>src/core/selection.ts</sub>

| Member | Description |
| --- | --- |
| `type: "cell"` |  |
| `table: string` |  |
| `anchor: string` |  |
| `focus: string` |  |

#### `Commands`

```ts
interface Commands
```

Augment this interface from extensions to type `editor.commands`.

<sub>src/core/editor.ts</sub>

| Member | Description |
| --- | --- |
| `insertTable(rows?: number \| undefined, cols?: number \| undefined, opts?: { header?: boolean \| undefined; } \| undefined): boolean` |  |
| `addRow(where?: "before" \| "after" \| undefined): boolean` |  |
| `addColumn(where?: "before" \| "after" \| undefined): boolean` |  |
| `deleteRow(): boolean` |  |
| `deleteColumn(): boolean` |  |
| `deleteTable(): boolean` |  |
| `mergeCells(): boolean` |  |
| `splitCell(): boolean` |  |
| `toggleHeaderRow(): boolean` |  |
| `toggleHeaderColumn(): boolean` |  |
| `setColumnWidth(tableId: string, col: number, width: number): boolean` |  |
| `nextCell(dir?: 1 \| -1 \| undefined): boolean` |  |
| `pasteCells(matrix: CellMatrix): boolean` |  |
| `selectTable(): boolean` |  |
| `insertText(text: string, opts?: { marks?: MarkSet \| undefined; rules?: boolean \| undefined; } \| undefined): boolean` |  |
| `insertLineBreak(): boolean` |  |
| `splitBlock(): boolean` |  |
| `deleteSelection(): boolean` |  |
| `deleteBackward(unit?: "char" \| "word" \| "line" \| undefined): boolean` |  |
| `deleteForward(unit?: "char" \| "word" \| "line" \| undefined): boolean` |  |
| `insertBlocks(blocks: BlockJSON[], opts?: { select?: boolean \| undefined; after?: string \| undefined; replace?: string \| undefined; } \| undefined): boolean` |  |
| `insertBlock(type: string, attrs?: Attrs \| undefined, opts?: { select?: boolean \| undefined; after?: string \| undefined; replace?: string \| undefined; } \| undefined): boolean` |  |
| `insertInline(atom: InlineAtom, opts?: { trailingSpace?: boolean \| undefined; } \| undefined): boolean` |  |
| `setMark(type: string, value?: any): boolean` |  |
| `unsetMark(type: string): boolean` |  |
| `toggleMark(type: string, value?: any): boolean` |  |
| `clearFormatting(): boolean` |  |
| `setLink(href: string, opts?: { text?: string \| undefined; title?: string \| undefined; } \| undefined): boolean` |  |
| `unsetLink(): boolean` |  |
| `setBlockType(type: string, attrs?: Attrs \| undefined, ids?: string[] \| undefined): boolean` |  |
| `toggleBlockType(type: string, attrs?: Attrs \| undefined): boolean` |  |
| `setAlign(align: "left" \| "center" \| "right" \| "justify"): boolean` |  |
| `indent(): boolean` |  |
| `outdent(): boolean` |  |
| `toggleCheck(id?: string \| undefined): boolean` |  |
| `deleteBlocks(ids?: string[] \| undefined): boolean` |  |
| `duplicateBlocks(ids?: string[] \| undefined): boolean` |  |
| `moveBlocksUp(ids?: string[] \| undefined): boolean` |  |
| `moveBlocksDown(ids?: string[] \| undefined): boolean` |  |
| `moveBlocksTo(ids: string[], targetId: string, place?: "before" \| "after" \| "inside" \| undefined): boolean` |  |
| `selectBlocks(ids: string[]): boolean` |  |
| `selectAll(): boolean` |  |
| `wrapIn(type: string, attrs?: Attrs \| undefined, ids?: string[] \| undefined): boolean` |  |
| `unwrap(id?: string \| undefined): boolean` |  |
| `setBlockAttrs(id: string, attrs: Attrs): boolean` |  |
| `undo(): boolean` |  |
| `redo(): boolean` |  |
| `selectCurrentBlock(): boolean` |  |
| `clearDocument(): boolean` |  |
| `insertColumns(count?: number \| undefined): boolean` |  |
| `toggleOpen(id?: string \| undefined): boolean` |  |
| `insertImage(attrs: Attrs): boolean` |  |
| `insertEmbed(url: string): boolean` |  |
| `insertFile(attrs: Attrs): boolean` |  |
| `insertEquation(tex?: string \| undefined, inline?: boolean \| undefined): boolean` |  |
| `enablePages(): boolean` |  |
| `disablePages(): boolean` |  |
| `addPage(title?: string \| undefined, afterId?: string \| undefined): boolean` |  |
| `removePage(id?: string \| undefined): boolean` |  |
| `renamePage(id: string, title: string): boolean` |  |
| `addSubPage(parentId?: string \| undefined, title?: string \| undefined): boolean` |  |
| `setPageParent(id: string, parentId: string \| null): boolean` |  |
| `movePage(id: string, index: number): boolean` |  |
| `duplicatePage(id?: string \| undefined): boolean` |  |
| `setActivePage(id: string): boolean` |  |
| `insertPageBreak(): boolean` |  |
| `insertDatabase(view?: DbViewType \| undefined, opts?: { title?: string \| undefined; properties?: Omit<DbProperty, "id">[] \| undefined; rows?: Record<string, any>[] \| undefined; at?: { replace?: string \| undefined; after?: string \| undefined; } \| undefined; } \|  …` |  |
| `dbSetTitle(dbId: string, title: string): boolean` |  |
| `dbAddRow(dbId: string, cells?: Record<string, any> \| undefined, index?: number \| undefined): boolean` |  |
| `dbDeleteRow(rowId: string): boolean` |  |
| `dbDuplicateRow(rowId: string): boolean` |  |
| `dbMoveRow(rowId: string, targetRowId: string, place?: "before" \| "after" \| undefined): boolean` |  |
| `dbSetCell(rowId: string, propId: string, value: any): boolean` |  |
| `dbAddProperty(dbId: string, def?: Partial<DbProperty> \| undefined): boolean` |  |
| `dbUpdateProperty(dbId: string, propId: string, patch: Partial<DbProperty>): boolean` |  |
| `dbDeleteProperty(dbId: string, propId: string): boolean` |  |
| `dbAddOption(dbId: string, propId: string, name: string, color?: "gray" \| "brown" \| "orange" \| "yellow" \| "green" \| "blue" \| "purple" \| "pink" \| "red" \| undefined): boolean` |  |
| `dbMoveProperty(dbId: string, propId: string, toIndex: number): boolean` |  |
| `dbFilterMode(dbId: string, mode: "and" \| "or", viewId?: string \| undefined): boolean` |  |
| `dbAddView(dbId: string, type?: DbViewType \| undefined, name?: string \| undefined): boolean` |  |
| `dbUpdateView(dbId: string, viewId: string \| undefined, patch: Partial<DbView>): boolean` |  |
| `dbDeleteView(dbId: string, viewId: string): boolean` |  |
| `dbSetView(dbId: string, viewId: string): boolean` |  |
| `dbSort(dbId: string, propId: string \| null, dir?: "asc" \| "desc" \| undefined, viewId?: string \| undefined): boolean` |  |
| `dbFilter(dbId: string, filters: DbFilter[] \| null, viewId?: string \| undefined): boolean` |  |
| `dbGroupBy(dbId: string, propId: string \| null, viewId?: string \| undefined): boolean` |  |
| `dbToggleProperty(dbId: string, propId: string, viewId?: string \| undefined): boolean` |  |
| `dbCalculate(dbId: string, propId: string, calc: DbCalc \| null, viewId?: string \| undefined): boolean` |  |
| `dbOpenRow(rowId: string, open?: boolean \| undefined): boolean` |  |
| `insertToc(): boolean` |  |
| `insertSyncedCopy(sourceId?: string \| undefined, at?: { after?: string \| undefined; } \| undefined): boolean` |  |
| `insertBookmark(url: string, at?: { replace?: string \| undefined; after?: string \| undefined; } \| undefined): boolean` |  |
| `insertDate(date?: string \| undefined): boolean` |  |
| `insertPageLink(pageId: string): boolean` |  |
| `saveAsTemplate(ids?: string[] \| undefined, label?: string \| undefined): boolean` |  |
| `useTemplate(buttonId: string): boolean` |  |
| `setToggleLevel(level: number \| null, id?: string \| undefined): boolean` |  |

#### `Comment`

```ts
interface Comment
```

<sub>src/features/review.ts</sub>

| Member | Description |
| --- | --- |
| `id: string` |  |
| `author: ReviewUser` |  |
| `body: string` |  |
| `createdAt: number` |  |
| `editedAt?: number \| undefined` |  |

#### `CommentsController`

```ts
interface CommentsController
```

<sub>src/features/review.ts</sub>

| Member | Description |
| --- | --- |
| `addThread(body: string): CommentThread \| null` | create a thread anchored to the current text selection |
| `reply(threadId: string, body: string): Comment \| null` |  |
| `editComment(threadId: string, commentId: string, body: string): boolean` |  |
| `deleteComment(threadId: string, commentId: string): boolean` |  |
| `resolve(threadId: string, resolved?: boolean \| undefined): boolean` |  |
| `removeThread(threadId: string): boolean` |  |
| `threads(): ThreadView[]` |  |
| `anchors(threadId: string): AnchorRange[]` |  |
| `threadsAtSelection(): string[]` | threads whose anchor contains the caret |
| `goTo(threadId: string): boolean` | move the selection to a thread's anchor |
| `subscribe(fn: () => void): () => void` |  |
| `store: CommentStore` |  |
| `destroy(): void` |  |

#### `CommentStore`

```ts
interface CommentStore
```

Host storage adapter for threads. The default keeps them in memory.

<sub>src/features/review.ts</sub>

| Member | Description |
| --- | --- |
| `list(): CommentThread[]` |  |
| `get(id: string): CommentThread \| undefined` |  |
| `put(thread: CommentThread): void` |  |
| `remove(id: string): void` |  |
| `subscribe(fn: () => void): () => void` |  |

#### `CommentThread`

```ts
interface CommentThread
```

<sub>src/features/review.ts</sub>

| Member | Description |
| --- | --- |
| `id: string` |  |
| `quote: string` | text that was selected when the thread was created |
| `comments: Comment[]` |  |
| `resolved: boolean` |  |
| `createdAt: number` |  |

#### `Counts`

```ts
interface Counts
```

<sub>src/features/text.ts</sub>

| Member | Description |
| --- | --- |
| `characters: number` |  |
| `charactersNoSpaces: number` |  |
| `words: number` |  |
| `blocks: number` |  |

#### `DbContext`

```ts
interface DbContext
```

Evaluation context: lets computed cells (formula, relation, rollup) see the rest of the document.

<sub>src/core/database.ts</sub>

| Member | Description |
| --- | --- |
| `db: any` |  |
| `props: DbProperty[]` |  |
| `find: (id: string) => any` | look up any block of the document by id (index built lazily, once per context) |
| `depth: number` |  |

#### `DbFilter`

```ts
interface DbFilter
```

<sub>src/core/database.ts</sub>

| Member | Description |
| --- | --- |
| `prop: string` |  |
| `op: DbFilterOp` |  |
| `value?: string \| undefined` |  |

#### `DbGroup`

```ts
interface DbGroup
```

<sub>src/core/database.ts</sub>

| Member | Description |
| --- | --- |
| `option: DbOption \| null` | option of the group-by property; null for rows without a value |
| `rows: Block[]` |  |

#### `DbOption`

```ts
interface DbOption
```

<sub>src/core/database.ts</sub>

| Member | Description |
| --- | --- |
| `id: string` |  |
| `name: string` |  |
| `color: "gray" \| "brown" \| "orange" \| "yellow" \| "green" \| "blue" \| "purple" \| "pink" \| "red"` |  |

#### `DbProperty`

```ts
interface DbProperty
```

<sub>src/core/database.ts</sub>

| Member | Description |
| --- | --- |
| `id: string` |  |
| `name: string` |  |
| `type: DbPropertyType` |  |
| `options?: DbOption[] \| undefined` |  |
| `width?: number \| undefined` |  |
| `formula?: string \| undefined` | formula source, see core/formula.ts |
| `relation?: { database: string; } \| undefined` | relation: id of the database whose rows this property links to |
| `rollup?: { relation: string; target: string; calc: DbCalc \| "show"; } \| undefined` | rollup: follow `relation` (a relation property of this database) and summarize `target` there |

#### `DbResult`

```ts
interface DbResult
```

<sub>src/core/database.ts</sub>

| Member | Description |
| --- | --- |
| `view: DbView` |  |
| `properties: DbProperty[]` | all properties, title first |
| `visible: DbProperty[]` | properties shown in this view |
| `rows: Block[]` | rows after filters and sorts |
| `groups: DbGroup[] \| null` | present when the view is grouped (always for boards with a select property) |
| `groupBy: DbProperty \| null` |  |
| `calc: Record<string, string>` |  |
| `total: number` |  |
| `dateProp: DbProperty \| null` | date property used by calendar / timeline views, if any |
| `endProp: DbProperty \| null` |  |
| `ctx: DbContext` | evaluation context, reusable for `cellValue` / `cellText` on these rows |

#### `DbSort`

```ts
interface DbSort
```

<sub>src/core/database.ts</sub>

| Member | Description |
| --- | --- |
| `prop: string` |  |
| `dir: "asc" \| "desc"` |  |

#### `DbTypeSpec`

```ts
interface DbTypeSpec
```

A custom property type. Values are stored in the row's cells as JSON; the type decides how they are validated, shown as text, ordered and (optionally) rendered.

<sub>src/core/database.ts</sub>

| Member | Description |
| --- | --- |
| `type: string` |  |
| `label: string` |  |
| `icon?: string \| undefined` | icon name or SVG markup shown in headers and menus |
| `coerce: (value: any) => string \| number \| boolean \| string[] \| undefined` | sanitize a value coming from the UI or from a stored document; return undefined to clear |
| `text: (value: any) => string` |  |
| `compare?: ((a: any, b: any) => number) \| undefined` |  |
| `render?: ((ctx: { value: any; set: (v: any) => void; readOnly: boolean; label: string; }) => any) \| undefined` | optional DOM cell renderer: (ctx: { value, set, readOnly, label }) => HTMLElement |

#### `DbView`

```ts
interface DbView
```

<sub>src/core/database.ts</sub>

| Member | Description |
| --- | --- |
| `id: string` |  |
| `name: string` |  |
| `type: DbViewType` |  |
| `filters?: DbFilter[] \| undefined` |  |
| `filterMode?: "and" \| "or" \| undefined` | 'and' (default): every filter must match; 'or': any filter |
| `dateProp?: string \| undefined` | calendar / timeline: the date property rows are placed by (default: the first date property) |
| `endProp?: string \| undefined` | timeline: optional end date property |
| `sorts?: DbSort[] \| undefined` |  |
| `groupBy?: string \| undefined` | select property to group by (board columns; optional sections in other views) |
| `hidden?: string[] \| undefined` | property ids hidden in this view |
| `calc?: Record<string, DbCalc> \| undefined` |  |
| `hideEmptyGroups?: boolean \| undefined` | board / grouped views: hide groups without rows |

#### `DocJSON`

```ts
interface DocJSON
```

<sub>src/core/model.ts</sub>

| Member | Description |
| --- | --- |
| `format: "zeditor"` |  |
| `version: number` |  |
| `extensions?: Record<string, number> \| undefined` | schema versions of extensions that were installed when the document was saved |
| `blocks: BlockJSON[]` |  |

#### `Draft`

```ts
interface Draft
```

<sub>src/features/persist.ts</sub>

| Member | Description |
| --- | --- |
| `doc: DocJSON` |  |
| `savedAt: number` |  |

#### `DraftStorage`

```ts
interface DraftStorage
```

<sub>src/features/persist.ts</sub>

| Member | Description |
| --- | --- |
| `getItem(key: string): string \| null` |  |
| `setItem(key: string, value: string): void` |  |
| `removeItem(key: string): void` |  |

#### `EditorEvents`

```ts
interface EditorEvents
```

<sub>src/core/editor.ts</sub>

| Member | Description |
| --- | --- |
| `transaction: TransactionEvent` | fired after every committed transaction, before 'change' / 'selection' |
| `change: TransactionEvent` |  |
| `selection: { selection: Selection \| null; }` |  |
| `update: undefined` | anything consumers may render from changed: doc, selection, mode, readOnly, stored marks |
| `mode: { mode: EditorMode; }` |  |
| `readonly: { readOnly: boolean; }` |  |
| `focus: undefined` |  |
| `blur: undefined` |  |
| `issues: { issues: string[]; }` |  |
| `destroy: undefined` |  |
| `blocks: BlockChanges` | every block change of one transaction (see core/events.ts) |
| `block:created: BlockCreated & { origin: string; }` |  |
| `block:updated: BlockUpdated & { origin: string; }` |  |
| `block:deleted: BlockDeleted & { origin: string; }` |  |
| `block:moved: BlockMoved & { origin: string; }` |  |
| `block:completed: BlockCompleted & { origin: string; }` | a check-list item (any block with a `checked` attribute) was checked |
| `block:uncompleted: BlockCompleted & { origin: string; }` |  |
| `block:focus: { id: string \| null; previous: string \| null; }` | the caret / block selection moved into another block (`id` null: no selection) |
| `ids:remapped: { map: Record<string, string>; }` | block ids were renamed with `remapIds` (old id → new id) |

#### `EditorOptions`

```ts
interface EditorOptions
```

<sub>src/core/editor.ts</sub>

| Member | Description |
| --- | --- |
| `content?: BlockJSON[] \| DocJSON \| null \| undefined` | initial document (validated and sanitized) |
| `extensions?: Extension[] \| undefined` |  |
| `baseExtensions?: Extension[] \| undefined` | replace the default extension set entirely (advanced) |
| `mode?: EditorMode \| undefined` |  |
| `readOnly?: boolean \| undefined` |  |
| `history?: false \| { delay?: number \| undefined; depth?: number \| undefined; } \| undefined` | `false` disables the built-in history (collaboration installs its own) |
| `characterLimit?: number \| undefined` | maximum number of characters; transactions that exceed it are rejected |
| `labels?: Record<string, string> \| undefined` | label overrides, merged over the defaults |
| `locale?: string \| undefined` |  |
| `idGenerator?: (() => string) \| undefined` | Make ids for new blocks, e.g. `() => crypto.randomUUID()` or ids reserved by your backend. Must return 1–64 characters of letters, digits, `_ : . -`; an invalid or already used id falls back to the built-in generator (with a console warning). |

#### `EmbedProvider`

```ts
interface EmbedProvider
```

<sub>src/core/builtin.ts</sub>

| Member | Description |
| --- | --- |
| `name: string` |  |
| `match: (url: string) => string \| null` | return an https iframe URL for a pasted/entered URL, or null |
| `aspect?: number \| undefined` |  |

#### `ExportOptions`

```ts
interface ExportOptions
```

<sub>src/core/html.ts</sub>

| Member | Description |
| --- | --- |
| `ids?: boolean \| undefined` | emit `id="..."` on blocks (block links) |

#### `Extension`

```ts
interface Extension
```

<sub>src/core/extension.ts</sub>

| Member | Description |
| --- | --- |
| `name: string` |  |
| `version?: string \| undefined` | informational package version |
| `schemaVersion?: number \| undefined` | version of this extension's node data; saved into documents and passed to `migrate` |
| `apiVersion?: number \| undefined` | engine extension API version this extension was written for (default: current) |
| `requires?: string[] \| undefined` | names of extensions that must be installed (and set up first) |
| `priority?: number \| undefined` | higher priority keymaps / rules run first (default 0) |
| `override?: boolean \| undefined` | allow replacing node / mark / command definitions registered by earlier extensions |
| `nodes?: NodeSpec[] \| undefined` |  |
| `marks?: MarkSpec[] \| undefined` |  |
| `extendNode?: Record<string, (spec: NodeSpec) => NodeSpec> \| undefined` | add behaviour to an existing node without replacing it |
| `extendMark?: Record<string, (spec: MarkSpec) => MarkSpec> \| undefined` |  |
| `commands?: Record<string, CommandFn> \| undefined` |  |
| `keymap?: Record<string, string \| ((editor: Editor, event?: any) => boolean)> \| undefined` | key (e.g. 'Mod-b', 'Shift-Enter') -> command name or handler returning true when handled |
| `inputRules?: InputRule[] \| undefined` |  |
| `pasteRules?: PasteRule[] \| undefined` |  |
| `toolbar?: ToolbarItem[] \| undefined` |  |
| `slashItems?: SlashItem[] \| undefined` |  |
| `blockActions?: BlockAction[] \| undefined` |  |
| `typeahead?: TypeaheadSource[] \| undefined` |  |
| `labels?: Record<string, string> \| undefined` |  |
| `migrate?: ((doc: DocJSON, fromVersion: number) => DocJSON) \| undefined` | upgrade documents saved with an older `schemaVersion` of this extension |
| `normalize?: ((tr: Transaction) => boolean \| void) \| undefined` | structural fix-ups run inside each transaction; return true if steps were added |
| `setup?: ((editor: Editor) => void \| (() => void)) \| undefined` | called once per editor; return a cleanup function |

#### `Features`

```ts
interface Features
```

<sub>src/core.ts</sub>

| Member | Description |
| --- | --- |
| `lists: boolean` |  |
| `code: boolean` |  |
| `tables: boolean` |  |
| `layout: boolean` | callouts, toggles and columns |
| `media: boolean` | images, files and embeds |
| `equation: boolean` |  |
| `mentions: boolean` |  |
| `hashtag: boolean` |  |
| `emoji: boolean` |  |
| `markdownShortcuts: boolean` |  |
| `autolink: boolean` |  |
| `pages: boolean` | multi-page documents and page breaks |
| `comments: boolean` |  |
| `suggestions: boolean` |  |
| `database: boolean` | Notion-style databases: typed properties, table / board / list / gallery views |
| `notion: boolean` | table of contents, bookmarks, page links, dates, template buttons, toggle headings |

#### `FindOptions`

```ts
interface FindOptions
```

<sub>src/features/text.ts</sub>

| Member | Description |
| --- | --- |
| `caseSensitive?: boolean \| undefined` |  |
| `wholeWord?: boolean \| undefined` |  |
| `regex?: boolean \| undefined` |  |

#### `HeadingEntry`

```ts
interface HeadingEntry
```

<sub>src/features/text.ts</sub>

| Member | Description |
| --- | --- |
| `id: string` |  |
| `level: number` |  |
| `text: string` |  |

#### `HeadlessOptions`

```ts
interface HeadlessOptions
```

<sub>src/core.ts</sub>

| Member | Description |
| --- | --- |
| `features?: Partial<Features> \| undefined` |  |
| `mentions?: MentionOptions \| undefined` |  |
| `content?: BlockJSON[] \| DocJSON \| null \| undefined` | initial document (validated and sanitized) |
| `extensions?: Extension[] \| undefined` |  |
| `baseExtensions?: Extension[] \| undefined` | replace the default extension set entirely (advanced) |
| `mode?: EditorMode \| undefined` |  |
| `readOnly?: boolean \| undefined` |  |
| `history?: false \| { delay?: number \| undefined; depth?: number \| undefined; } \| undefined` | `false` disables the built-in history (collaboration installs its own) |
| `characterLimit?: number \| undefined` | maximum number of characters; transactions that exceed it are rejected |
| `labels?: Record<string, string> \| undefined` | label overrides, merged over the defaults |
| `locale?: string \| undefined` |  |
| `idGenerator?: (() => string) \| undefined` | Make ids for new blocks, e.g. `() => crypto.randomUUID()` or ids reserved by your backend. Must return 1–64 characters of letters, digits, `_ : . -`; an invalid or already used id falls back to the built-in generator (with a console warning). |

#### `HistoryProvider`

```ts
interface HistoryProvider
```

<sub>src/core/editor.ts</sub>

| Member | Description |
| --- | --- |
| `undo(): boolean` |  |
| `redo(): boolean` |  |
| `canUndo(): boolean` |  |
| `canRedo(): boolean` |  |
| `clear` |  |
| `cut` | start a new undo entry at the next change |

#### `HTMLContext`

```ts
interface HTMLContext
```

<sub>src/core/html.ts</sub>

| Member | Description |
| --- | --- |
| `schema: Schema` |  |
| `esc: (s: string) => string` |  |
| `inline: (b: { content?: Inline[] \| undefined; }) => string` | inline content of a text block as HTML |
| `children: (b: { children?: BlockJSON[] \| Block[] \| undefined; }) => string` | child blocks as HTML |
| `style: (b: { attrs?: Attrs \| undefined; }, extra?: string \| undefined) => string` | ` style="..."` for alignment / indentation, or '' |
| `ids: boolean` | include `id` attributes for block links |
| `id: (b: { id: string; }) => string` |  |

#### `HtmlEl`

```ts
interface HtmlEl
```

Minimal element shape produced by the built-in HTML parser.

<sub>src/core/schema.ts</sub>

| Member | Description |
| --- | --- |
| `tag: string` |  |
| `attrs: Record<string, string>` |  |
| `children: (string \| HtmlEl)[]` |  |
| `style: Record<string, string>` |  |
| `classes: string[]` |  |
| `parent?: HtmlEl \| undefined` |  |

#### `InlineAtom`

```ts
interface InlineAtom
```

<sub>src/core/model.ts</sub>

| Member | Description |
| --- | --- |
| `atom: string` |  |
| `attrs?: Attrs \| undefined` |  |
| `marks?: MarkSet \| undefined` |  |

#### `InlineChange`

```ts
interface InlineChange
```

<sub>src/core/model.ts</sub>

| Member | Description |
| --- | --- |
| `from: number` | `[from, to)` of the old content is replaced by `insert` |
| `to: number` |  |
| `insert: Inline[]` |  |
| `formats: { from: number; to: number; marks: Record<string, any>; }[] \| null` | Set when the replaced text and `insert` have the same characters and only marks differ: the mark changes as ranges (absolute offsets; `null` removes a mark). |

#### `InputRule`

```ts
interface InputRule
```

<sub>src/core/extension.ts</sub>

| Member | Description |
| --- | --- |
| `name?: string \| undefined` |  |
| `match: RegExp` | tested against the text of the current block before the caret (must end with `$`) |
| `run: (editor: Editor, match: RegExpExecArray, ctx: { block: Block; from: number; to: number; }) => boolean` | apply the rule; `from`/`to` are offsets of the match in `block` |
| `inCode?: boolean \| undefined` | also run inside code blocks (default false) |

#### `LatestRunner`

```ts
interface LatestRunner
```

<sub>src/features/persist.ts</sub>

| Member | Description |
| --- | --- |
| `run(query: string): Promise<{ stale: boolean; query: string; result?: T \| undefined; error?: unknown; }>` | Run a query. Resolves with `{ stale: true }` if a newer query started meanwhile. |
| `cancel(): void` |  |

#### `LinkPreview`

```ts
interface LinkPreview
```

<sub>src/core/notion.ts</sub>

| Member | Description |
| --- | --- |
| `title?: string \| undefined` |  |
| `description?: string \| undefined` |  |
| `image?: string \| undefined` |  |
| `site?: string \| undefined` |  |

#### `MarkSpec`

```ts
interface MarkSpec
```

<sub>src/core/schema.ts</sub>

| Member | Description |
| --- | --- |
| `type: string` |  |
| `attrs?: Record<string, AttrSpec> \| undefined` |  |
| `inclusive?: boolean \| undefined` | typing at the end of the mark extends it (default true) |
| `excludes?: string[] \| undefined` | mark types removed when this one is applied |
| `rank?: number \| undefined` | outer-to-inner render order, lower renders outermost (default 50) |
| `render?: any` |  |
| `parseHTML?: ParseRule[] \| undefined` |  |
| `toHTML?: ((value: any) => [open: string, close: string]) \| undefined` |  |
| `toMarkdown?: ((value: any) => [open: string, close: string]) \| undefined` |  |
| `extension?: string \| undefined` |  |

#### `Match`

```ts
interface Match
```

<sub>src/features/text.ts</sub>

| Member | Description |
| --- | --- |
| `id: string` |  |
| `from: number` |  |
| `to: number` |  |

#### `MentionOptions`

```ts
interface MentionOptions
```

<sub>src/core.ts</sub>

| Member | Description |
| --- | --- |
| `search?: ((query: string, ctx: { signal: AbortSignal; }) => TypeaheadItem[] \| Promise<TypeaheadItem[]>) \| undefined` | host-provided people search; may be async. Aborted via `signal` when the query changes. |
| `trigger?: string \| undefined` |  |

#### `Migration`

```ts
interface Migration
```

<sub>src/core/schema.ts</sub>

| Member | Description |
| --- | --- |
| `from: number` | document version this migration upgrades from (to `from + 1`) |
| `migrate: (doc: DocJSON) => DocJSON` |  |

#### `NodeSpec`

```ts
interface NodeSpec
```

<sub>src/core/schema.ts</sub>

| Member | Description |
| --- | --- |
| `type: string` |  |
| `kind: NodeKind` |  |
| `attrs?: Record<string, AttrSpec> \| undefined` |  |
| `children?: boolean \| string[] \| undefined` | container: allowed child types (default: any block). text: `true` allows nested child blocks. |
| `marks?: boolean \| undefined` | text blocks: allow marks (default true) |
| `code?: boolean \| undefined` | text blocks: plain text, whitespace preserved, Enter inserts a newline |
| `isolating?: boolean \| undefined` | selection and joins do not cross this node's boundary (table cells, columns) |
| `parents?: string[] \| undefined` | only valid inside these parent types |
| `defaultChild?: string \| undefined` | child type created to keep a container non-empty (default 'paragraph') |
| `allowEmpty?: boolean \| undefined` | container may have zero children (table rows fully covered by merged cells) |
| `continues?: boolean \| undefined` | Enter on this text block continues with the same type (lists) |
| `render?: any` | DOM renderer, see view/render.ts NodeRenderer |
| `parseHTML?: ParseRule[] \| undefined` |  |
| `toHTML?: ((node: any, ctx: any) => string) \| undefined` |  |
| `toMarkdown?: ((node: any, ctx: any) => string) \| undefined` |  |
| `toText?: ((node: any) => string) \| undefined` |  |
| `extension?: string \| undefined` | name of the extension that registered the spec |

#### `ParseRule`

```ts
interface ParseRule
```

<sub>src/core/schema.ts</sub>

| Member | Description |
| --- | --- |
| `tag: string` | lower-case tag name, or '*' |
| `match?: ((el: HtmlEl) => boolean) \| undefined` | extra predicate; return false to skip |
| `getAttrs?: ((el: HtmlEl) => false \| Attrs \| undefined) \| undefined` | attrs for the created node / mark; return false to skip the rule |
| `priority?: number \| undefined` |  |

#### `PasteData`

```ts
interface PasteData
```

<sub>src/core/extension.ts</sub>

| Member | Description |
| --- | --- |
| `text: string` |  |
| `html: string` |  |
| `files: File[]` |  |
| `json?: any` | internal structured clipboard payload, if present |

#### `PasteRule`

```ts
interface PasteRule
```

<sub>src/core/extension.ts</sub>

| Member | Description |
| --- | --- |
| `name?: string \| undefined` |  |
| `run: (editor: Editor, data: PasteData) => boolean` | handle the paste and return true to stop further processing |

#### `Permissions`

```ts
interface Permissions
```

<sub>src/features/review.ts</sub>

| Member | Description |
| --- | --- |
| `canEdit?: ((user: ReviewUser) => boolean) \| undefined` | may change the document at all |
| `canComment?: ((user: ReviewUser) => boolean) \| undefined` |  |
| `canModerate?: ((user: ReviewUser) => boolean) \| undefined` | may resolve / delete threads or comments written by someone else |
| `canReview?: ((user: ReviewUser) => boolean) \| undefined` | may accept or reject suggestions |

#### `Point`

```ts
interface Point
```

<sub>src/core/selection.ts</sub>

| Member | Description |
| --- | --- |
| `id: string` |  |
| `offset: number` |  |

#### `Range`

```ts
interface Range
```

<sub>src/core/selection.ts</sub>

| Member | Description |
| --- | --- |
| `from: Point` |  |
| `to: Point` |  |
| `backward: boolean` |  |
| `collapsed: boolean` |  |

#### `ReviewUser`

```ts
interface ReviewUser
```

<sub>src/features/review.ts</sub>

| Member | Description |
| --- | --- |
| `id: string` |  |
| `name: string` |  |
| `color?: string \| undefined` |  |

#### `SlashItem`

```ts
interface SlashItem
```

<sub>src/core/extension.ts</sub>

| Member | Description |
| --- | --- |
| `id: string` |  |
| `title: string` |  |
| `description?: string \| undefined` |  |
| `keywords?: string[] \| undefined` |  |
| `icon?: string \| undefined` |  |
| `group?: string \| undefined` |  |
| `run: (editor: Editor, ctx: { blockId: string; }) => void` | insert / convert. `blockId` is the block that held the slash query (already cleared). |
| `order?: number \| undefined` |  |

#### `Suggestion`

```ts
interface Suggestion
```

<sub>src/features/review.ts</sub>

| Member | Description |
| --- | --- |
| `id: string` |  |
| `kind: "insert" \| "delete"` |  |
| `author: string` |  |
| `at: number` |  |
| `text: string` |  |
| `ranges: AnchorRange[]` |  |

#### `SuggestionsController`

```ts
interface SuggestionsController
```

<sub>src/features/review.ts</sub>

| Member | Description |
| --- | --- |
| `setSuggesting(on: boolean): void` | while on, typing and deleting create suggestions instead of changing the text |
| `isSuggesting(): boolean` |  |
| `list(): Suggestion[]` |  |
| `accept(id: string): boolean` |  |
| `reject(id: string): boolean` |  |
| `acceptAll(): number` |  |
| `rejectAll(): number` |  |
| `subscribe(fn: () => void): () => void` |  |
| `destroy(): void` |  |

#### `SyncBatch`

```ts
interface SyncBatch
```

<sub>src/features/sync.ts</sub>

| Member | Description |
| --- | --- |
| `upserted: SyncBlock[]` | created or changed blocks, parents before children |
| `deleted: string[]` | ids of deleted blocks (descendants included) |
| `order: { parentId: string \| null; children: string[]; }[]` | new child order of each parent whose children changed (`parentId: null` = top level) |

#### `SyncBlock`

```ts
interface SyncBlock
```

<sub>src/features/sync.ts</sub>

| Member | Description |
| --- | --- |
| `id: string` |  |
| `type: string` |  |
| `parentId: string \| null` | `null` for top-level blocks |
| `index: number` |  |
| `afterId: string \| null` | previous sibling, `null` when first |
| `attrs?: Attrs \| undefined` |  |
| `content?: Inline[] \| undefined` | inline content of text blocks |

#### `TableMap`

```ts
interface TableMap
```

<sub>src/core/table.ts</sub>

| Member | Description |
| --- | --- |
| `rows: number` |  |
| `cols: number` |  |
| `grid: (string \| null)[][]` | cell id at each grid position, or null where no cell exists |
| `pos: Map<string, CellPos>` |  |

#### `TextSelection`

```ts
interface TextSelection
```

<sub>src/core/selection.ts</sub>

| Member | Description |
| --- | --- |
| `type: "text"` |  |
| `anchor: Point` |  |
| `focus: Point` |  |

#### `TextSpan`

```ts
interface TextSpan
```

<sub>src/core/model.ts</sub>

| Member | Description |
| --- | --- |
| `text: string` |  |
| `marks?: MarkSet \| undefined` |  |

#### `ThreadView`

```ts
interface ThreadView
```

<sub>src/features/review.ts</sub>

| Member | Description |
| --- | --- |
| `anchored: boolean` |  |
| `ranges: AnchorRange[]` |  |
| `id: string` |  |
| `quote: string` | text that was selected when the thread was created |
| `comments: Comment[]` |  |
| `resolved: boolean` |  |
| `createdAt: number` |  |

#### `ToolbarItem`

```ts
interface ToolbarItem
```

<sub>src/core/extension.ts</sub>

| Member | Description |
| --- | --- |
| `id: string` |  |
| `group?: string \| undefined` | items with the same group are rendered together |
| `label: string` | label key (looked up in editor labels) or literal text |
| `icon?: string \| undefined` | icon name from the icon set, or raw SVG markup |
| `type?: "select" \| "button" \| "color" \| "custom" \| undefined` |  |
| `command?: string \| undefined` | command name to execute, with `args` |
| `args?: any[] \| undefined` |  |
| `run?: ((editor: Editor, value?: any) => void) \| undefined` |  |
| `active?: ((editor: Editor) => boolean) \| undefined` |  |
| `enabled?: ((editor: Editor) => boolean) \| undefined` |  |
| `value?: ((editor: Editor) => string) \| undefined` | select / color: current value |
| `options?: { value: string; label: string; }[] \| undefined` |  |
| `render?: ((editor: Editor) => HTMLElement) \| undefined` | custom: build the control |
| `shortcut?: string \| undefined` |  |
| `floating?: boolean \| undefined` | show in the floating selection toolbar too |
| `order?: number \| undefined` |  |

#### `TransactionEvent`

```ts
interface TransactionEvent
```

<sub>src/core/editor.ts</sub>

| Member | Description |
| --- | --- |
| `tr: Transaction` |  |
| `docChanged: boolean` |  |
| `selectionChanged: boolean` |  |
| `origin: string` |  |

#### `TypeaheadItem`

```ts
interface TypeaheadItem
```

<sub>src/core/extension.ts</sub>

| Member | Description |
| --- | --- |
| `id: string` |  |
| `label: string` |  |
| `description?: string \| undefined` |  |
| `icon?: string \| undefined` |  |

#### `TypeaheadSource`

```ts
interface TypeaheadSource
```

<sub>src/core/extension.ts</sub>

| Member | Description |
| --- | --- |
| `name: string` |  |
| `trigger: string` | character that opens the menu, e.g. '@' |
| `allowSpaces?: boolean \| undefined` | allow spaces inside the query (default false) |
| `debounce?: number \| undefined` | only open at block start (slash menu style) |
| `search: (query: string, ctx: { signal: AbortSignal; editor: Editor; }) => TypeaheadItem[] \| Promise<TypeaheadItem[]>` | may be async; `signal` aborts when the query changes or the menu closes |
| `select: (editor: Editor, item: TypeaheadItem, range: { id: string; from: number; to: number; }) => void` | replace the query range [from, to) in block `id` |
| `renderItem?: ((item: TypeaheadItem) => string \| HTMLElement) \| undefined` |  |
| `emptyLabel?: string \| undefined` |  |

#### `UpdateOptions`

```ts
interface UpdateOptions
```

<sub>src/core/editor.ts</sub>

| Member | Description |
| --- | --- |
| `history?: boolean \| undefined` | record in undo history (default true) |
| `group?: string \| undefined` | consecutive transactions with the same group merge into one undo entry |
| `origin?: string \| undefined` | who produced the change: 'local' (default), 'remote', 'history', or a custom string. With 'remote' (or `tr.setMeta('foreign', true)` under a custom origin) text inserted exactly at the user's caret lands after it, so the caret does not jump over other people's typing. |

#### `UploadResult`

```ts
interface UploadResult
```

<sub>src/features/persist.ts</sub>

| Member | Description |
| --- | --- |
| `url: string` |  |
| `name?: string \| undefined` |  |
| `size?: number \| undefined` |  |
| `mime?: string \| undefined` |  |
| `alt?: string \| undefined` |  |
| `width?: number \| undefined` |  |

#### `Uploads`

```ts
interface Uploads
```

<sub>src/features/persist.ts</sub>

| Member | Description |
| --- | --- |
| `uploadFiles(files: Iterable<File>, at?: { after?: string \| undefined; replace?: string \| undefined; } \| undefined): string[]` | insert placeholder blocks and start uploading. Returns the upload ids. |
| `retry(uploadId: string): boolean` |  |
| `cancel(uploadId: string): boolean` |  |
| `progress(uploadId: string): number \| undefined` | 0..1, or undefined when unknown / finished |
| `pending(): string[]` |  |
| `destroy(): void` |  |

#### `UploadsOptions`

```ts
interface UploadsOptions
```

<sub>src/features/persist.ts</sub>

| Member | Description |
| --- | --- |
| `upload: UploadHandler` |  |
| `maxSize?: number \| undefined` | reject files larger than this many bytes |
| `accept?: ((file: File) => boolean) \| undefined` | return false to reject a file |
| `preview?: ((file: File) => string) \| undefined` | create a preview URL for an image (default URL.createObjectURL) |
| `revokePreview?: ((url: string) => void) \| undefined` |  |

#### `Version`

```ts
interface Version
```

<sub>src/features/review.ts</sub>

| Member | Description |
| --- | --- |
| `id: string` |  |
| `label: string` |  |
| `createdAt: number` |  |
| `author?: ReviewUser \| undefined` |  |
| `doc: DocJSON` |  |

#### `VersionsController`

```ts
interface VersionsController
```

<sub>src/features/review.ts</sub>

| Member | Description |
| --- | --- |
| `save(label?: string \| undefined): Promise<Version>` |  |
| `list(): Promise<Version[]>` |  |
| `restore(id: string): Promise<boolean>` | Replace the document with a saved version. This is one undoable edit. |
| `remove(id: string): Promise<void>` |  |

#### `VersionStore`

```ts
interface VersionStore
```

Host storage adapter for versions. May be async.

<sub>src/features/review.ts</sub>

| Member | Description |
| --- | --- |
| `list(): Version[] \| Promise<Version[]>` |  |
| `put(v: Version): void \| Promise<void>` |  |
| `remove(id: string): void \| Promise<void>` |  |

### Types

#### `Attrs`

```ts
type Attrs = Record<string, any>;
```

Document model. Browser independent. A document is a tree of blocks. A block is one of four kinds (declared by its NodeSpec): - text: has inline `content`, and optionally nested `children` blocks - container: has `children` blocks only - atom: has neither (image, divider, embed ...) Inline content is a flat array of text spans and inline atoms. Each inline atom occupies exactly one offset unit; text occupies one unit per UTF-16 code unit.

<sub>src/core/model.ts</sub>

#### `BlockChangeKind`

```ts
type BlockChangeKind = 'content' | 'attrs' | 'type';
```

<sub>src/core/events.ts</sub>

#### `CellMatrix`

```ts
type CellMatrix = (BlockJSON[] | null)[][];
```

<sub>src/core/table.ts</sub>

#### `CommandFn`

```ts
type CommandFn = (editor: Editor, ...args: any[]) => boolean;
```

<sub>src/core/editor.ts</sub>

#### `DbCalc`

```ts
type DbCalc = 'count' | 'filled' | 'empty' | 'unique' | 'sum' | 'avg' | 'min' | 'max' | 'checked' | 'percent_checked';
```

<sub>src/core/database.ts</sub>

#### `DbColor`

```ts
type DbColor = (typeof DB_COLORS)[number];
```

<sub>src/core/database.ts</sub>

#### `DbFilterOp`

```ts
type DbFilterOp = 'contains' | 'not_contains' | 'is' | 'is_not' | 'empty' | 'not_empty' | 'gt' | 'lt' | 'checked' | 'unchecked';
```

<sub>src/core/database.ts</sub>

#### `DbPropertyType`

```ts
type DbPropertyType = 'title' | 'text' | 'number' | 'select' | 'multi_select' | 'checkbox' | 'date' | 'url' | 'email' | 'person' | 'formula' | 'relation' | 'rollup' | (string & {});
```

<sub>src/core/database.ts</sub>

#### `DbViewType`

```ts
type DbViewType = 'table' | 'board' | 'list' | 'gallery' | 'calendar' | 'timeline';
```

<sub>src/core/database.ts</sub>

#### `EditorMode`

```ts
type EditorMode = 'classic' | 'block';
```

<sub>src/core/editor.ts</sub>

#### `FormulaValue`

```ts
type FormulaValue = number | string | boolean | null;
```

A small, safe expression language for database formula properties. Parsed by hand (no `eval`, no `Function`): numbers, strings, booleans, `prop("Name")`, arithmetic, comparisons, `and` / `or` / `not`, and a fixed set of functions. prop("Points") * 2 if(prop("Done"), "✔ " + prop("Name"), prop("Name")) round(prop("Price") * prop("Qty"), 2) dateDiff(prop("Due"), today())

<sub>src/core/formula.ts</sub>

#### `Inline`

```ts
type Inline = TextSpan | InlineAtom;
```

<sub>src/core/model.ts</sub>

#### `LinkPreviewHandler`

```ts
type LinkPreviewHandler = (url: string, ctx: { signal: AbortSignal }) => Promise<LinkPreview | null> | LinkPreview | null;
```

Host adapter: resolve metadata for a bookmarked URL (the editor never fetches URLs itself).

<sub>src/core/notion.ts</sub>

#### `MarkSet`

```ts
type MarkSet = Record<string, any>;
```

mark type -> `true` or an attrs object

<sub>src/core/model.ts</sub>

#### `NodeKind`

```ts
type NodeKind = 'text' | 'container' | 'atom' | 'inline';
```

<sub>src/core/schema.ts</sub>

#### `SaveStatus`

```ts
type SaveStatus = 'saved' | 'dirty' | 'saving' | 'error' | 'offline';
```

<sub>src/features/persist.ts</sub>

#### `Selection`

```ts
type Selection = TextSelection | BlockSelection | CellSelection;
```

<sub>src/core/selection.ts</sub>

#### `Step`

```ts
type Step = /** replace inline content [from, to) of a text block */ | { t: 'text'; id: string; from: number; to: number; insert: Inline[] } /** replace the type and/or the whole attrs object of a block */ | { t: 'attrs'; id: string; type?: string; attrs?: Attrs } /** insert blocks as children of `parent` ('root' for top level) */ | { t: 'insert'; parent: string; index: number; blocks: Bloc …
```

<sub>src/core/steps.ts</sub>

#### `SyncStatus`

```ts
type SyncStatus = 'idle' | 'pending' | 'saving' | 'error';
```

<sub>src/features/sync.ts</sub>

#### `UploadHandler`

```ts
type UploadHandler = (file: File, ctx: { signal: AbortSignal; onProgress: (fraction: number) => void }) => Promise<UploadResult>;
```

Host upload function. Must honour `signal`; report progress as a 0..1 fraction.

<sub>src/features/persist.ts</sub>

## `@buffmomo/zeditor`

Browser entry: everything in `/core`, plus `createEditor`, the view and the default UI parts. Only the exports that are not in `/core` are listed here.

### Functions

#### `createBlockHandles`

```ts
createBlockHandles(editor: Editor, host: HTMLElement, opts?: BlockHandleOptions): { destroy(): void; }
```

Insert button and drag grip next to the hovered block — or next to the block that holds the selection, so the controls are reachable by keyboard and on touch screens.

<sub>src/ui/menus.ts</sub>

#### `createEditor`

```ts
createEditor(options: CreateEditorOptions): ZEditor
```

Mount a ready-made editor.

<sub>src/index.ts</sub>

#### `createFindPanel`

```ts
createFindPanel(editor: Editor, host: HTMLElement): Disposable & { open(): void; close(): void; }
```

<sub>src/ui/panels.ts</sub>

#### `createFloatingToolbar`

```ts
createFloatingToolbar(editor: Editor, host: HTMLElement, opts?: { items?: string[] | undefined; icons?: Record<string, string> | undefined; when?: (() => boolean) | undefined; }): UIHandle
```

Toolbar that follows a non-collapsed text selection. Needs no hover, so it works on touch.

<sub>src/ui/toolbar.ts</sub>

#### `createLinkPopover`

```ts
createLinkPopover(editor: Editor, host: HTMLElement): { destroy(): void; }
```

Link editor: opens on the `ui:link` event (toolbar button or Mod-K).

<sub>src/ui/toolbar.ts</sub>

#### `createMediaUI`

```ts
createMediaUI(editor: Editor, host: HTMLElement, uploads: Uploads | null): Disposable
```

Wires the `ui:image` / `ui:file` / `ui:embed` / `ui:files` events to pickers and the upload manager.

<sub>src/ui/panels.ts</sub>

#### `createNotices`

```ts
createNotices(editor: Editor, host: HTMLElement, opts?: { timeout?: number | undefined; }): Disposable & { show(message: string, kind?: "error" | "info" | undefined): void; }
```

Short messages for the user: `ui:error` and `ui:notice` events ({ message }), failed or rejected uploads. Shown bottom-right inside the editor, announced to screen readers, closed after a few seconds. Turn off with `ui: { notices: false }` to show them your own way.

<sub>src/ui/panels.ts</sub>

#### `createPageTabs`

```ts
createPageTabs(editor: Editor, host: HTMLElement): Disposable
```

Page tabs for multi-page documents (like sheets in a spreadsheet or pages in a notebook). Tabs follow the ARIA tabs pattern: arrow keys move, Enter/Space activates, F2 renames, Delete removes, Alt+Arrow reorders.

<sub>src/ui/panels.ts</sub>

#### `createReviewPanel`

```ts
createReviewPanel(editor: Editor, container: HTMLElement, ctl: { comments?: CommentsController | undefined; suggestions?: SuggestionsController | undefined; }): Disposable
```

A simple comments + suggestions sidebar. Hosts can build their own from the controllers.

<sub>src/ui/panels.ts</sub>

#### `createStatusBar`

```ts
createStatusBar(editor: Editor, host: HTMLElement): Disposable
```

<sub>src/ui/panels.ts</sub>

#### `createTableTools`

```ts
createTableTools(editor: Editor, host: HTMLElement): Disposable
```

<sub>src/ui/panels.ts</sub>

#### `createToolbar`

```ts
createToolbar(editor: Editor, opts?: ToolbarOptions): UIHandle
```

<sub>src/ui/toolbar.ts</sub>

#### `createTypeahead`

```ts
createTypeahead(editor: Editor, host: HTMLElement, opts?: TypeaheadOptions): { destroy(): void; isOpen(): boolean; }
```

<sub>src/ui/menus.ts</sub>

#### `el`

```ts
h<K extends keyof HTMLElementTagNameMap>(tag: K, props?: Record<string, any> | null | undefined, ...children: Child[]) => HTMLElementTagNameMap[K]
h(tag: string, props?: Record<string, any> | null | undefined, ...children: Child[]): HTMLElement
```

Tiny hyperscript helper. `class`, `style` (string), `dataset`, `on*` listeners and attributes.

<sub>src/view/dom.ts</sub>

#### `formatShortcut`

```ts
formatShortcut(s: string): string
```

Human readable shortcut, e.g. 'Mod-Shift-z' -> 'Ctrl+Shift+Z' / '⌘⇧Z'.

<sub>src/view/dom.ts</sub>

#### `getEditorState`

```ts
getEditorState(editor: Editor): EditorState
```

Immutable snapshot of what controls usually render from. The same object is returned until the editor emits `update`, so it can back `useSyncExternalStore` and Vue refs directly.

<sub>src/index.ts</sub>

#### `icon`

```ts
icon(name: string | undefined, overrides?: Record<string, string> | undefined): string
```

SVG markup for an icon name; raw markup (starting with '<') is returned unchanged.

<sub>src/ui/icons.ts</sub>

#### `inlinePrompt`

```ts
inlinePrompt(anchor: HTMLElement, opts: { value: string; label: string; multiline?: boolean | undefined; onSubmit: (v: string) => void; onCancel?: (() => void) | undefined; }): void
```

Open a small inline editor for a text value (caption, equation, embed url).

<sub>src/view/render.ts</sub>

#### `keyName`

```ts
keyName(e: KeyboardEvent): string
```

'Mod-Shift-z' style key name for a keyboard event.

<sub>src/view/dom.ts</sub>

#### `place`

```ts
place(el: HTMLElement, anchor: { left: number; top: number; bottom: number; right?: number | undefined; }, opts?: { above?: boolean | undefined; align?: "center" | "start" | undefined; }): void
```

Position a floating element near an anchor rect, kept inside the viewport. Uses fixed positioning.

<sub>src/view/dom.ts</sub>

#### `renderMath`

```ts
renderMath(editor: Editor, tex: string, el: HTMLElement, display: boolean): void
```

<sub>src/view/render.ts</sub>

#### `revealBlock`

```ts
revealBlock(editor: Editor, id: string): boolean
```

Scroll to and flash the block named in the URL hash (direct links to blocks).

<sub>src/ui/panels.ts</sub>

#### `setIcons`

```ts
setIcons(map: Record<string, string>): void
```

Replace or add icons globally. Values are SVG markup (trusted, provided by the host).

<sub>src/ui/icons.ts</sub>

#### `subscribe`

```ts
subscribe(editor: Editor, fn: () => void) => (): void
```

Subscribe to state changes (document, selection, mode, focus...). Returns an unsubscribe function.

<sub>src/index.ts</sub>

### Classes

#### `EditorView`

```ts
class EditorView
```

<sub>src/view/view.ts</sub>

| Member | Description |
| --- | --- |
| `root: HTMLElement` |  |
| `ctx: RenderContext` |  |
| `composing: boolean` |  |
| `pageView: "tabs" \| "paged"` |  |
| `editor: Editor` |  |
| `options: ViewOptions` |  |
| `hasFocus(): boolean` |  |
| `focus(): void` |  |
| `domOf(id: string): HTMLElement \| null` | outer DOM element of a block |
| `contentOf(id: string): HTMLElement \| null` |  |
| `blockIdAt(node: Node \| null): string \| null` | id of the closest block containing a DOM node |
| `setRenderer(type: string, renderer: NodeRenderer \| null): void` |  |
| `refresh(id: string): void` | Re-render one block from scratch (used by host-rendered node views). |
| `setPageView(mode: "tabs" \| "paged"): void` |  |
| `applyPages(): void` | Show only the active page in 'tabs' mode; show all pages as sheets in 'paged' mode. |
| `pointFromDOM(node: Node \| null, offset: number): Point \| null` |  |
| `domFromPoint(p: Point): { node: Node; offset: number; } \| null` |  |
| `rangeFor(id: string, from: number, to: number): Range \| null` | DOM Range for a span of text inside one block. |
| `coordsAt(p: Point): DOMRect \| null` | Viewport rectangle of a caret position. |
| `selectionRect(): DOMRect \| null` | Bounding rectangle of the current selection, for floating UI. |
| `selectionFromDOM(): Selection \| null` |  |
| `syncSelectionToDOM(force?: boolean): void` | Push the model selection into the DOM. Does nothing while the editor is not focused. |
| `addHighlightSource(key: string, source: HighlightSource): () => void` | Register a decoration source. It returns named ranges which are painted with the CSS Custom Highlight API (`::highlight(name)`), so decorations never touch the editable DOM. Where the API is missing, names starting with 'z-find' / 'z-remote' fall back to overlays. |
| `scheduleHighlights(): void` |  |
| `rerender(): void` | Rebuild the whole DOM from the model (recovery path for unexpected native edits). |
| `destroy(): void` |  |

### Constants

#### `CLIPBOARD_MIME`

```ts
const MIME: "application/x-zeditor+json"
```

<sub>src/core/clipboard.ts</sub>

#### `HIGHLIGHTS`

```ts
const HIGHLIGHTS: string[]
```

<sub>src/ui/toolbar.ts</sub>

#### `inlineRenderers`

```ts
const inlineRenderers: Record<string, InlineRenderer>
```

<sub>src/view/render.ts</sub>

#### `markRenderers`

```ts
const markRenderers: Record<string, MarkRenderer>
```

<sub>src/view/render.ts</sub>

#### `nodeRenderers`

```ts
const nodeRenderers: Record<string, NodeRenderer>
```

<sub>src/view/render.ts</sub>

#### `PALETTE`

```ts
const PALETTE: string[]
```

<sub>src/ui/toolbar.ts</sub>

### Interfaces

#### `CreateEditorOptions`

```ts
interface CreateEditorOptions
```

<sub>src/index.ts</sub>

| Member | Description |
| --- | --- |
| `element: string \| HTMLElement` | element (or selector) to mount into |
| `editor?: Editor \| undefined` | attach to an existing headless editor instead of creating one (the caller keeps ownership) |
| `ui?: false \| { toolbar?: boolean \| string[] \| undefined; floatingToolbar?: boolean \| string[] \| undefined; slashMenu?: false \| "block" \| "always" \| undefined; blockHandles?: boolean \| undefined; tableTools?: boolean \| undefined; find?: boolean \| undefined; sta …` | Default controls. `false` renders only the editable surface (headless UI); individual parts can be switched off or configured. |
| `theme?: "light" \| "dark" \| "auto" \| undefined` | 'auto' follows prefers-color-scheme |
| `unstyled?: boolean \| undefined` | skip the default visual theme; structural styles still apply |
| `icons?: Record<string, string> \| undefined` | replace icons by name with SVG markup |
| `upload?: UploadHandler \| undefined` | host upload function; enables pasted / dropped / picked files |
| `uploadOptions?: Omit<UploadsOptions, "upload"> \| undefined` |  |
| `autosave?: AutosaveOptions \| undefined` |  |
| `renderMath?: ((tex: string, el: HTMLElement, display: boolean) => void) \| undefined` | render LaTeX into an element (e.g. with KaTeX). Without it equations show their source. |
| `linkPreview?: LinkPreviewHandler \| undefined` | resolve title / description / image for bookmarked links (the editor never fetches URLs itself) |
| `maxHeight?: string \| undefined` | max height of the scroll area, e.g. '60vh' |
| `onChange?: ((editor: Editor) => void) \| undefined` |  |
| `onSelectionChange?: ((editor: Editor) => void) \| undefined` |  |
| `onReady?: ((instance: ZEditor) => void) \| undefined` |  |
| `features?: Partial<Features> \| undefined` |  |
| `mentions?: MentionOptions \| undefined` |  |
| `content?: BlockJSON[] \| DocJSON \| null \| undefined` | initial document (validated and sanitized) |
| `extensions?: Extension[] \| undefined` |  |
| `baseExtensions?: Extension[] \| undefined` | replace the default extension set entirely (advanced) |
| `mode?: EditorMode \| undefined` |  |
| `readOnly?: boolean \| undefined` |  |
| `history?: false \| { delay?: number \| undefined; depth?: number \| undefined; } \| undefined` | `false` disables the built-in history (collaboration installs its own) |
| `characterLimit?: number \| undefined` | maximum number of characters; transactions that exceed it are rejected |
| `labels?: Record<string, string> \| undefined` | label overrides, merged over the defaults |
| `locale?: string \| undefined` |  |
| `idGenerator?: (() => string) \| undefined` | Make ids for new blocks, e.g. `() => crypto.randomUUID()` or ids reserved by your backend. Must return 1–64 characters of letters, digits, `_ : . -`; an invalid or already used id falls back to the built-in generator (with a console warning). |
| `renderers?: Record<string, NodeRenderer> \| undefined` | host overrides for block rendering, by node type |
| `inlineRenderers?: Record<string, InlineRenderer> \| undefined` |  |
| `markRenderers?: Record<string, MarkRenderer> \| undefined` |  |
| `placeholder?: string \| undefined` |  |
| `spellcheck?: boolean \| undefined` |  |
| `autofocus?: boolean \| undefined` |  |
| `ariaLabel?: string \| undefined` |  |
| `pageView?: "tabs" \| "paged" \| undefined` | 'tabs' shows one page at a time, 'paged' shows all pages as sheets |

#### `EditorState`

```ts
interface EditorState
```

<sub>src/index.ts</sub>

| Member | Description |
| --- | --- |
| `mode: "classic" \| "block"` |  |
| `readOnly: boolean` |  |
| `selection: Selection \| null` |  |
| `marks: MarkSet` | marks active at the caret, or common to the whole selection |
| `blockType: string \| null` | type of the block holding the selection focus |
| `blockAttrs: Record<string, any>` |  |
| `canUndo: boolean` |  |
| `canRedo: boolean` |  |
| `isEmpty: boolean` |  |
| `focused: boolean` |  |
| `revision: number` | increments with every document change |
| `pages: { id: string; title: string; }[]` |  |
| `activePage: string \| null` |  |
| `suggesting: boolean` |  |

#### `HighlightRange`

```ts
interface HighlightRange
```

<sub>src/view/view.ts</sub>

| Member | Description |
| --- | --- |
| `id: string` |  |
| `from: number` |  |
| `to: number` |  |

#### `NodeViewHandle`

```ts
interface NodeViewHandle
```

<sub>src/view/render.ts</sub>

| Member | Description |
| --- | --- |
| `dom: HTMLElement` | outer element of the block |
| `contentDOM?: HTMLElement \| undefined` | element that receives inline content (text blocks) |
| `childrenDOM?: HTMLElement \| undefined` | element that receives child blocks; may be created lazily via `ensureChildren` |
| `update?: ((block: Block) => boolean \| void) \| undefined` | called when attrs changed. Return false to have the view re-created. |
| `destroy?: (() => void) \| undefined` |  |

#### `RenderContext`

```ts
interface RenderContext
```

<sub>src/view/render.ts</sub>

| Member | Description |
| --- | --- |
| `editor: Editor` |  |
| `view: any` | the EditorView (typed loosely to avoid a cycle) |
| `label: (key: string, fallback?: string \| undefined) => string` |  |

#### `ToolbarOptions`

```ts
interface ToolbarOptions
```

<sub>src/ui/toolbar.ts</sub>

| Member | Description |
| --- | --- |
| `items?: string[] \| undefined` | item ids to show, in order ('\|' inserts a separator). Default: all registered items. |
| `floating?: boolean \| undefined` | only items flagged `floating` |
| `icons?: Record<string, string> \| undefined` |  |
| `label?: string \| undefined` |  |
| `insert?: boolean \| undefined` | show the "Insert" menu built from the slash-menu items (default true) |

#### `UIHandle`

```ts
interface UIHandle
```

<sub>src/ui/toolbar.ts</sub>

| Member | Description |
| --- | --- |
| `dom: HTMLElement` |  |
| `update(): void` |  |
| `destroy(): void` |  |

#### `ViewOptions`

```ts
interface ViewOptions
```

<sub>src/view/view.ts</sub>

| Member | Description |
| --- | --- |
| `renderers?: Record<string, NodeRenderer> \| undefined` | host overrides for block rendering, by node type |
| `inlineRenderers?: Record<string, InlineRenderer> \| undefined` |  |
| `markRenderers?: Record<string, MarkRenderer> \| undefined` |  |
| `placeholder?: string \| undefined` |  |
| `spellcheck?: boolean \| undefined` |  |
| `autofocus?: boolean \| undefined` |  |
| `ariaLabel?: string \| undefined` |  |
| `pageView?: "tabs" \| "paged" \| undefined` | 'tabs' shows one page at a time, 'paged' shows all pages as sheets |

#### `ZEditor`

```ts
interface ZEditor
```

<sub>src/index.ts</sub>

| Member | Description |
| --- | --- |
| `editor: Editor` |  |
| `view: EditorView` |  |
| `element: HTMLElement` | outer element created inside the mount point |
| `commands: CommandMap` |  |
| `uploads: Uploads \| null` |  |
| `autosave: Autosave \| null` |  |
| `getJSON(): DocJSON` |  |
| `setJSON(doc: unknown): string[]` |  |
| `getState(): EditorState` |  |
| `subscribe(fn: () => void): () => void` |  |
| `setMode(mode: "classic" \| "block"): void` |  |
| `setReadOnly(readOnly: boolean): void` |  |
| `focus(): void` |  |
| `destroy(): void` |  |

### Types

#### `HighlightSource`

```ts
type HighlightSource = () => Record<string, HighlightRange[]>;
```

<sub>src/view/view.ts</sub>

#### `InlineRenderer`

```ts
type InlineRenderer = (atom: InlineAtom, ctx: RenderContext) => HTMLElement;
```

<sub>src/view/render.ts</sub>

#### `MarkRenderer`

```ts
type MarkRenderer = (value: any, ctx: RenderContext) => HTMLElement | null;
```

<sub>src/view/render.ts</sub>

#### `NodeRenderer`

```ts
type NodeRenderer = (block: Block, ctx: RenderContext) => NodeViewHandle;
```

<sub>src/view/render.ts</sub>

## `@buffmomo/zeditor/react`

React adapter.

### Functions

#### `NodeContent`

```ts
NodeContent({ element, className }: { element: HTMLElement | null; className?: string | undefined; }): Element
```

Slot for the editable part of a custom node view (child blocks or inline content).

<sub>src/react.tsx</sub>

#### `useEditor`

```ts
useEditor(): ZEditor | null
```

The editor instance from the nearest <ZEditor>, or null before it has mounted.

<sub>src/react.tsx</sub>

#### `useEditorState`

```ts
useEditorState<T = EditorState>(instance: Editor | ZEditor | null | undefined, selector?: ((s: EditorState) => T) | undefined) => T
```

Subscribe to editor state. Pass a selector to re-render only when the selected value changes (compared with Object.is; return primitives or stable references).

<sub>src/react.tsx</sub>

### Constants

#### `ZEditor`

```ts
const ZEditor: ForwardRefExoticComponent<ZEditorProps & RefAttributes<ZEditor | null>>
```

Mounts an editor. `content` is the *initial* document: later changes to that prop are ignored on purpose (use `ref.current.setJSON()` to load another document), so parent re-renders can never reset the document or the caret. `mode` and `readOnly` are live.

<sub>src/react.tsx</sub>

### Interfaces

#### `EditorState`

```ts
interface EditorState
```

<sub>src/index.ts</sub>

| Member | Description |
| --- | --- |
| `mode: "classic" \| "block"` |  |
| `readOnly: boolean` |  |
| `selection: Selection \| null` |  |
| `marks: MarkSet` | marks active at the caret, or common to the whole selection |
| `blockType: string \| null` | type of the block holding the selection focus |
| `blockAttrs: Record<string, any>` |  |
| `canUndo: boolean` |  |
| `canRedo: boolean` |  |
| `isEmpty: boolean` |  |
| `focused: boolean` |  |
| `revision: number` | increments with every document change |
| `pages: { id: string; title: string; }[]` |  |
| `activePage: string \| null` |  |
| `suggesting: boolean` |  |

#### `InlineViewProps`

```ts
interface InlineViewProps
```

<sub>src/react.tsx</sub>

| Member | Description |
| --- | --- |
| `editor: Editor` |  |
| `atom: InlineAtom` |  |

#### `NodeViewProps`

```ts
interface NodeViewProps
```

<sub>src/react.tsx</sub>

| Member | Description |
| --- | --- |
| `editor: Editor` |  |
| `block: { id: string; type: string; attrs: Record<string, any>; }` | current block (attrs, id, type). A new object identity is passed whenever attrs change. |
| `updateAttrs: (attrs: Record<string, any>) => void` | shallow-merge attrs into the block (undoable) |
| `contentElement: HTMLElement \| null` | element that holds the block's editable content / child blocks; place it with <NodeContent /> |

#### `ZEditorInstance`

```ts
interface ZEditor
```

<sub>src/index.ts</sub>

| Member | Description |
| --- | --- |
| `editor: Editor` |  |
| `view: EditorView` |  |
| `element: HTMLElement` | outer element created inside the mount point |
| `commands: CommandMap` |  |
| `uploads: Uploads \| null` |  |
| `autosave: Autosave \| null` |  |
| `getJSON(): DocJSON` |  |
| `setJSON(doc: unknown): string[]` |  |
| `getState(): EditorState` |  |
| `subscribe(fn: () => void): () => void` |  |
| `setMode(mode: "classic" \| "block"): void` |  |
| `setReadOnly(readOnly: boolean): void` |  |
| `focus(): void` |  |
| `destroy(): void` |  |

#### `ZEditorProps`

```ts
interface ZEditorProps
```

<sub>src/react.tsx</sub>

| Member | Description |
| --- | --- |
| `className?: string \| undefined` |  |
| `style?: CSSProperties \| undefined` |  |
| `nodeViews?: Record<string, ComponentType<NodeViewProps>> \| undefined` | React components for block node types (rendered through portals) |
| `inlineViews?: Record<string, ComponentType<InlineViewProps>> \| undefined` | React components for inline atom types |
| `renderers?: Record<string, NodeRenderer> \| undefined` | DOM-level renderers, as accepted by `createEditor` |
| `inlineRenderers?: Record<string, InlineRenderer> \| undefined` |  |
| `children?: ReactNode` | rendered inside the editor context, e.g. a custom toolbar |
| `mode?: EditorMode \| undefined` |  |
| `content?: BlockJSON[] \| DocJSON \| null \| undefined` | initial document (validated and sanitized) |
| `upload?: UploadHandler \| undefined` | host upload function; enables pasted / dropped / picked files |
| `editor?: Editor \| undefined` | attach to an existing headless editor instead of creating one (the caller keeps ownership) |
| `ui?: false \| { toolbar?: boolean \| string[] \| undefined; floatingToolbar?: boolean \| string[] \| undefined; slashMenu?: false \| "block" \| "always" \| undefined; blockHandles?: boolean \| undefined; tableTools?: boolean \| undefined; find?: boolean \| undefined; sta …` | Default controls. `false` renders only the editable surface (headless UI); individual parts can be switched off or configured. |
| `theme?: "light" \| "dark" \| "auto" \| undefined` | 'auto' follows prefers-color-scheme |
| `unstyled?: boolean \| undefined` | skip the default visual theme; structural styles still apply |
| `icons?: Record<string, string> \| undefined` | replace icons by name with SVG markup |
| `uploadOptions?: Omit<UploadsOptions, "upload"> \| undefined` |  |
| `autosave?: AutosaveOptions \| undefined` |  |
| `renderMath?: ((tex: string, el: HTMLElement, display: boolean) => void) \| undefined` | render LaTeX into an element (e.g. with KaTeX). Without it equations show their source. |
| `linkPreview?: LinkPreviewHandler \| undefined` | resolve title / description / image for bookmarked links (the editor never fetches URLs itself) |
| `maxHeight?: string \| undefined` | max height of the scroll area, e.g. '60vh' |
| `onChange?: ((editor: Editor) => void) \| undefined` |  |
| `onSelectionChange?: ((editor: Editor) => void) \| undefined` |  |
| `onReady?: ((instance: ZEditor) => void) \| undefined` |  |
| `features?: Partial<Features> \| undefined` |  |
| `mentions?: MentionOptions \| undefined` |  |
| `extensions?: Extension[] \| undefined` |  |
| `baseExtensions?: Extension[] \| undefined` | replace the default extension set entirely (advanced) |
| `readOnly?: boolean \| undefined` |  |
| `history?: false \| { delay?: number \| undefined; depth?: number \| undefined; } \| undefined` | `false` disables the built-in history (collaboration installs its own) |
| `characterLimit?: number \| undefined` | maximum number of characters; transactions that exceed it are rejected |
| `labels?: Record<string, string> \| undefined` | label overrides, merged over the defaults |
| `locale?: string \| undefined` |  |
| `idGenerator?: (() => string) \| undefined` | Make ids for new blocks, e.g. `() => crypto.randomUUID()` or ids reserved by your backend. Must return 1–64 characters of letters, digits, `_ : . -`; an invalid or already used id falls back to the built-in generator (with a console warning). |
| `markRenderers?: Record<string, MarkRenderer> \| undefined` |  |
| `placeholder?: string \| undefined` |  |
| `spellcheck?: boolean \| undefined` |  |
| `autofocus?: boolean \| undefined` |  |
| `ariaLabel?: string \| undefined` |  |
| `pageView?: "tabs" \| "paged" \| undefined` | 'tabs' shows one page at a time, 'paged' shows all pages as sheets |

## `@buffmomo/zeditor/vue`

Vue 3 adapter.

### Functions

#### `useEditor`

```ts
useEditor(): ShallowRef<ZEditor | null>
```

The editor instance provided by the nearest <ZEditor> (a shallow ref, null until mounted).

<sub>src/vue.ts</sub>

#### `useEditorState`

```ts
useEditorState(source: Editor | ZEditor | Ref<Editor | ZEditor | null | undefined, Editor | ZEditor | null | undefined> | null): ShallowRef<EditorState | null>
```

Reactive editor state. Accepts an instance, an editor, or a ref to either.

<sub>src/vue.ts</sub>

### Constants

#### `NodeContent`

```ts
const NodeContent: DefineComponent<ExtractPropTypes<{ element: { type: PropType<HTMLElement | null>; default: null; }; }>, () => VNode<RendererNode, RendererElement, { [key: string]: any; }>, {}, {}, {}, ComponentOptionsMixin, ComponentOptionsMixin, {}, string, PublicProps, ToResolvedProps<ExtractPropTypes<{ element:  …
```

Slot for the editable part of a custom node view: mounts the element the editor renders into.

<sub>src/vue.ts</sub>

#### `ZEditor`

```ts
const ZEditor: DefineComponent<ExtractPropTypes<{ options: { type: PropType<Omit<CreateEditorOptions, "element">>; default: () => {}; }; mode: { type: PropType<"classic" | "block">; default: undefined; }; readOnly: { type: BooleanConstructor; default: undefined; }; nodeViews: { type: PropType<Record<string, Compon …
```

<sub>src/vue.ts</sub>

### Interfaces

#### `EditorState`

```ts
interface EditorState
```

<sub>src/index.ts</sub>

| Member | Description |
| --- | --- |
| `mode: "classic" \| "block"` |  |
| `readOnly: boolean` |  |
| `selection: Selection \| null` |  |
| `marks: MarkSet` | marks active at the caret, or common to the whole selection |
| `blockType: string \| null` | type of the block holding the selection focus |
| `blockAttrs: Record<string, any>` |  |
| `canUndo: boolean` |  |
| `canRedo: boolean` |  |
| `isEmpty: boolean` |  |
| `focused: boolean` |  |
| `revision: number` | increments with every document change |
| `pages: { id: string; title: string; }[]` |  |
| `activePage: string \| null` |  |
| `suggesting: boolean` |  |

#### `ZEditorInstance`

```ts
interface ZEditor
```

<sub>src/index.ts</sub>

| Member | Description |
| --- | --- |
| `editor: Editor` |  |
| `view: EditorView` |  |
| `element: HTMLElement` | outer element created inside the mount point |
| `commands: CommandMap` |  |
| `uploads: Uploads \| null` |  |
| `autosave: Autosave \| null` |  |
| `getJSON(): DocJSON` |  |
| `setJSON(doc: unknown): string[]` |  |
| `getState(): EditorState` |  |
| `subscribe(fn: () => void): () => void` |  |
| `setMode(mode: "classic" \| "block"): void` |  |
| `setReadOnly(readOnly: boolean): void` |  |
| `focus(): void` |  |
| `destroy(): void` |  |

## `@buffmomo/zeditor/collab`

Real-time collaboration (Yjs).

### Functions

#### `broadcastChannelTransport`

```ts
broadcastChannelTransport(name: string): Transport
```

Cross-tab transport in one browser profile.

<sub>src/collab.ts</sub>

#### `connectSync`

```ts
connectSync(doc: Doc, awareness: Awareness | null, transport: Transport): SyncHandle
```

Keep a Y.Doc (and awareness) in sync over a transport. Edits made while disconnected stay in the local document and are merged when the connection returns.

<sub>src/collab.ts</sub>

#### `createCollab`

```ts
createCollab(editor: Editor, opts: CollabOptions): Collab
```

<sub>src/collab.ts</sub>

#### `localStoragePersistence`

```ts
localStoragePersistence(key: string, storage?: { getItem(k: string): string | null; setItem(k: string, v: string): void; }): DocPersistence
```

Reference persistence adapter on top of localStorage (small documents; use IndexedDB in production).

<sub>src/collab.ts</sub>

#### `memoryHub`

```ts
memoryHub(): { endpoint(): Transport; }
```

In-memory hub: every connected endpoint receives what the others send. For demos and tests.

<sub>src/collab.ts</sub>

#### `persistDoc`

```ts
persistDoc(doc: Doc, store: DocPersistence, debounce?: number) => Promise<(): void>
```

Persist the shared document locally so offline edits survive a reload. Returns a disposer.

<sub>src/collab.ts</sub>

#### `sharedBlocks`

```ts
sharedBlocks(doc: Doc, editor: Editor): BlockJSON[]
```

The shared document as block JSON (useful on a server, or to verify an editor is in sync).

<sub>src/collab.ts</sub>

#### `webSocketTransport`

```ts
webSocketTransport(url: string, opts?: { reconnectDelay?: number | undefined; maxDelay?: number | undefined; WebSocketImpl?: any; }): Transport
```

WebSocket transport with automatic reconnect. The server only needs to relay binary frames to the other clients of the same room (see docs/collaboration.md for a 30-line relay and for what a production server must add: authentication, authorization and persistence).

<sub>src/collab.ts</sub>

#### `yCommentStore`

```ts
yCommentStore(doc: Doc): CommentStore
```

Comment threads stored in the shared document, so every participant sees them.

<sub>src/collab.ts</sub>

### Classes

#### `Awareness`

```ts
class Awareness
```

The Awareness class implements a simple shared state protocol that can be used for non-persistent data like awareness information (cursor, username, status, ..). Each client can update its own local state and listen to state changes of remote clients. Every client may set a state of a remote peer to `null` to mark the client as offline. Each client is identified by a unique client id (something we borrow from `doc.clientID`). A client can override its own state by propagating a message with an increasing timestamp (`clock`). If such a message is received, it is applied if the known state of that client is older than the new state (`clock < newClock`). If a client thinks that a remote client is offline, it may propagate a message with `{ clock: currentClientClock, state: null, client: remoteClient }`. If such a message is received, and the known clock of that client equals the received clock, it will override the state with `null`. Before a client disconnects, it should propagate a `null` state with an updated clock. Awareness states must be updated every 30 seconds. Otherwise the Awareness instance will delete the client state.

<sub>re-exported from `y-protocols`</sub>

| Member | Description |
| --- | --- |
| `doc: Doc` |  |
| `clientID: number` |  |
| `states: Map<number, { [x: string]: any; }>` | Maps from client id to client state |
| `meta: Map<number, MetaClientState>` |  |
| `_checkInterval: any` |  |
| `getLocalState(): { [x: string]: any; } \| null` |  |
| `setLocalState(state: { [x: string]: any; } \| null): void` |  |
| `setLocalStateField(field: string, value: any): void` |  |
| `getStates(): Map<number, { [x: string]: any; }>` |  |
| `_observers: Map<string, any>` | Some desc. |
| `on(name: string, f: Function): void` |  |
| `once(name: string, f: Function): void` |  |
| `off(name: string, f: Function): void` |  |
| `emit(name: string, args: any[]): void` | Emit a named event. All registered event listeners that listen to the specified name will receive the event. |
| `destroy(): void` |  |

### Constants

#### `Y`

```ts
const Y: typeof import("yjs")
```

<sub>re-exported from `yjs`</sub>

### Interfaces

#### `Collab`

```ts
interface Collab
```

<sub>src/collab.ts</sub>

| Member | Description |
| --- | --- |
| `doc: Doc` |  |
| `awareness: Awareness` |  |
| `seed(): boolean` | push the editor's content into an empty shared document. Returns false if it was not empty. |
| `isEmpty(): boolean` |  |
| `remoteStates(): RemoteState[]` | other users currently present |
| `onPresence(fn: (states: RemoteState[]) => void): () => void` |  |
| `undoManager: UndoManager \| null` |  |
| `destroy(): void` |  |

#### `CollabOptions`

```ts
interface CollabOptions
```

<sub>src/collab.ts</sub>

| Member | Description |
| --- | --- |
| `doc: Doc` |  |
| `awareness?: Awareness \| undefined` |  |
| `user: CollabUser` |  |
| `seed?: boolean \| undefined` | What to do when the shared document is empty at bind time: - true: push the editor's current content immediately - false (default): wait; call `collab.seed()` once the provider reports its first sync |
| `permissions?: CollabPermissions \| undefined` |  |
| `undo?: boolean \| undefined` | install collaborative undo (per-user, via Y.UndoManager). Default true. |
| `presence?: boolean \| undefined` | render remote carets and selections. Default true. |

#### `CollabPermissions`

```ts
interface CollabPermissions
```

<sub>src/collab.ts</sub>

| Member | Description |
| --- | --- |
| `canEdit?: ((user: CollabUser) => boolean) \| undefined` | may this user change the document? When false the editor is read-only. |

#### `CollabUser`

```ts
interface CollabUser
```

<sub>src/collab.ts</sub>

| Member | Description |
| --- | --- |
| `color?: string \| undefined` |  |
| `id: string` |  |
| `name: string` |  |

#### `DocPersistence`

```ts
interface DocPersistence
```

<sub>src/collab.ts</sub>

| Member | Description |
| --- | --- |
| `load(): Uint8Array<ArrayBufferLike> \| Promise<Uint8Array<ArrayBufferLike> \| null> \| null` |  |
| `save(state: Uint8Array<ArrayBufferLike>): void \| Promise<void>` |  |

#### `RemoteState`

```ts
interface RemoteState
```

<sub>src/collab.ts</sub>

| Member | Description |
| --- | --- |
| `clientId: number` |  |
| `user: CollabUser` |  |
| `selection: Selection \| null` |  |

#### `SyncHandle`

```ts
interface SyncHandle
```

<sub>src/collab.ts</sub>

| Member | Description |
| --- | --- |
| `synced: boolean` |  |
| `connected: boolean` |  |
| `whenSynced(timeout?: number \| undefined): Promise<boolean>` | resolves after the first state exchange with a peer (or `timeout` ms when alone) |
| `onStatus(fn: (s: { connected: boolean; synced: boolean; }) => void): () => void` |  |
| `connect(): void` |  |
| `disconnect(): void` |  |
| `destroy(): void` |  |

#### `Transport`

```ts
interface Transport
```

Host transport adapter: an unreliable-until-open, ordered, binary message channel.

<sub>src/collab.ts</sub>

| Member | Description |
| --- | --- |
| `send(data: Uint8Array<ArrayBufferLike>): void` |  |
| `onMessage(fn: (data: Uint8Array<ArrayBufferLike>) => void): () => void` |  |
| `onOpen(fn: () => void): () => void` |  |
| `onClose(fn: () => void): () => void` |  |
| `connected: boolean` |  |
| `connect(): void` |  |
| `disconnect(): void` |  |

## `@buffmomo/zeditor/code-highlight`

Syntax highlighting for code blocks.

### Functions

#### `codeHighlightExtension`

```ts
codeHighlightExtension(opts?: CodeHighlightOptions): Extension
```

<sub>src/code-highlight.ts</sub>

#### `tokenize`

```ts
tokenize(code: string, language: string): Token[]
```

Built-in tokenizer. Unknown languages get strings / numbers / comments only.

<sub>src/code-highlight.ts</sub>

### Interfaces

#### `CodeHighlightOptions`

```ts
interface CodeHighlightOptions
```

<sub>src/code-highlight.ts</sub>

| Member | Description |
| --- | --- |
| `tokenizers?: Record<string, Tokenizer> \| undefined` | custom tokenizers by language name; they take precedence over the built-in one |
| `maxLength?: number \| undefined` | skip highlighting for code blocks longer than this many characters (default 20000) |

#### `Token`

```ts
interface Token
```

<sub>src/code-highlight.ts</sub>

| Member | Description |
| --- | --- |
| `from: number` |  |
| `to: number` |  |
| `type: TokenType` |  |

### Types

#### `Tokenizer`

```ts
type Tokenizer = (code: string) => Token[];
```

<sub>src/code-highlight.ts</sub>

#### `TokenType`

```ts
type TokenType = 'keyword' | 'string' | 'comment' | 'number' | 'function' | 'tag';
```

<sub>src/code-highlight.ts</sub>
