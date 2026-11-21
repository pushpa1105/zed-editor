# Serialization

## Native JSON (lossless)

```jsonc
{
  "format": "zeditor",
  "version": 1,                         // document format version
  "extensions": { "issue-ref": 1 },     // schemaVersion of extensions that define node data
  "blocks": [
    { "id": "b1", "type": "heading", "attrs": { "level": 2 }, "content": [{ "text": "Title" }] },
    { "id": "b2", "type": "paragraph", "content": [
      { "text": "bold", "marks": { "bold": true } },
      { "atom": "mention", "attrs": { "id": "u1", "label": "Ada" } }
    ] }
  ]
}
```

`editor.getJSON()` / `editor.setJSON()` round-trip everything: ids, attributes, nesting, marks,
custom node data, and unknown nodes (which are written back exactly as they were read).
Unknown attributes on known nodes are kept.

**Treat stored documents as untrusted.** `setJSON` (and the `content` option) validate and
sanitize: attribute validators run, unsafe URLs are removed (`javascript:`, `data:text/html`,
obfuscated schemes), structure is repaired, duplicate ids regenerated. `editor.validate(json)`
returns the list of issues without loading. Loading never throws on malformed content.

**Limits.** No hard limits are imposed; practical ones are browser layout cost (see
[benchmarks](./benchmarks.md)) and your storage. Ids must match `[\w:.-]{1,64}`. Block
attributes must be JSON values. `blob:` image URLs (upload previews) are stripped from exported
HTML because they do not outlive the page.

## HTML

`toHTML(editor)` / `renderToHTML(doc)` produce semantic HTML; `fromHTML(editor, html)` /
`setHTML` import it. Import parses with a built-in tokenizer and converts through an
allow-list — imported markup is never inserted into the live document, so scripts, event
handlers, `iframe`, `object`, `style`, forms and unknown elements cannot survive.

| Feature | Export | Import |
| --- | --- | --- |
| paragraphs, headings, quotes, dividers, line breaks | `p`, `h1`–`h6`, `blockquote`, `hr`, `br` | ✓ |
| bold, italic, underline, strike, code, sub, sup | `strong`, `em`, `u`, `s`, `code`, `sub`, `sup` | ✓ incl. `b`/`i`/`del`/`ins` and inline styles |
| text colour, highlight | `span style`, `mark` | ✓ (default black / white backgrounds are ignored) |
| font size / family | `span data-font-size` / `data-font-family` | only from our own export (pasted documents size every span) |
| links | `a href rel="noopener noreferrer nofollow"` | ✓ safe URLs only |
| lists, nested lists, checklists | `ul`/`ol`/`li`, `data-type="checklist"`, `data-checked` | ✓ incl. GitHub task lists, Google Docs sibling lists, Word `mso-list` paragraphs |
| alignment, indentation | `style="text-align"`, `margin-left` | alignment ✓, indentation ✗ (margins are not interpreted) |
| code blocks | `pre data-language > code.language-x` | ✓ |
| tables, header cells, merged cells, column widths | `table`, `th`, `colspan`/`rowspan`, `colgroup` | ✓ (widths are not imported) |
| images with alt, caption, width | `figure > img + figcaption` | ✓ (`img` anywhere becomes an image block) |
| files, embeds, equations, mentions | `a[data-file]`, `div[data-embed]`, `div[data-equation]`, `span[data-mention]` | ✓ from our own export |
| callouts, toggles, columns, pages, page breaks | `div[data-callout]`, `details`, `div[data-columns]`, `section[data-page]`, `div[data-page-break]` | ✓ |
| children nested under non-list blocks | `div[data-z-children]` | ✓ (other tools show an indented block) |
| comments, suggestions | `span[data-comment]`, `ins`/`del[data-suggestion]` | ✓ (anchors only; thread bodies live in the comment store) |
| custom nodes without their own serializer | `data-z-type` + `data-z-attrs` | ✓ lossless |
| unknown nodes (missing extension) | `div[data-z-raw]` | ✓ lossless |

Not represented in HTML: block ids (unless `ids: true`), collapsed state beyond `details open`,
upload state.

## Markdown

`toMarkdown(editor)` / `fromMarkdown(editor, md)` implement CommonMark's common subset plus GFM
tables, task lists and strikethrough.

| Feature | Markdown | Notes |
| --- | --- | --- |
| headings, paragraphs, hard breaks, dividers | `#`, blank line, `\` + newline, `---` | setext headings import |
| bold, italic, strike, inline code, links | `**`, `*`, `~~`, `` ` ``, `[t](u "title")` | |
| underline, sub, sup, highlight | `<u>`, `<sub>`, `<sup>`, `<mark>` | inline HTML; highlight colour is lost |
| text colour, font size / family, hashtags | — | **lost** (plain text remains) |
| lists, nested lists, task lists | `-`, `1.`, `- [x]` | start numbers kept |
| quotes | `>` | one quote block per paragraph |
| code blocks | fenced, with language | |
| tables | GFM | merged cells are flattened; cells holding several blocks are joined with `<br>`; alignment is lost |
| images | `![alt](src "caption")` | width and alignment are lost |
| files, embeds | links | become plain links on import |
| equations | `$$…$$`, `$…$` | |
| mentions | `@label` | become plain text on import |
| callouts | GitHub alerts `> [!NOTE]` | the icon is lost; 5 tones map to 5 alert kinds |
| toggles | `<details><summary>` | |
| columns | content in order | **layout lost** |
| pages | `<!-- page: Title -->` markers | lossless |
| page breaks | `<!-- pagebreak -->` | lossless |
| alignment, indentation, block ids, comments, suggestions | — | **lost** |
| custom / unknown nodes without `toMarkdown` | `<!-- zeditor:block {json} -->` | lossless |

## Clipboard

Copy writes three flavours: `text/plain`, `text/html` and `application/x-zeditor+json`. The
JSON payload is also embedded in the HTML (`data-zeditor-json`) for browsers that drop custom
types. Paste prefers, in order: extension paste rules → the structured payload → a table range
(when the selection is in a table) → a URL pasted onto selected text (becomes a link) → HTML →
plain text. Pasted screenshots and files go to the host's `upload` handler.

Comment and suggestion marks are stripped when content is pasted into a different editor
instance and kept for cut/paste within the same one (so anchors move with the text).

**Tables and spreadsheets.** A copied cell range is written as an HTML `<table>` and as
tab-separated text. Pasting a range into a table:

- starts at the top-left cell of the selection and **grows the table** (rows, then columns)
  when the range extends past its edge;
- accepts **uneven rows**: missing cells leave the destination untouched;
- **merged source cells** land on their first position; the positions they covered are skipped;
- a **merged destination cell** receives data only at its origin position;
- a single copied cell pasted onto a cell selection fills every selected cell;
- is one undoable edit.

## Paste from Word and Google Docs

Covered by fixtures in `test/fixtures/paste.ts` (representative clipboard HTML): headings,
bold/italic, links, nested lists and tables are preserved from both; Word's conditional
comments, `<o:p>` and `mso-list` paragraphs (bullets, numbers, nesting levels) and Google Docs'
`<b style="font-weight:normal">` wrapper and style-only formatting are handled. Fonts, sizes,
default colours, page layout, footnotes, tracked changes and drawing objects are dropped.
