# zeditor user guide

What every toolbar button, menu, shortcut and block in zeditor does, for people writing in an
app that embeds the editor and for developers who want to know what each control is for.
Developer references: [architecture](./architecture.md), [extensions](./extensions.md),
[serialization](./serialization.md), [databases API](./databases.md),
[collaboration and review](./collaboration.md), [package README](../packages/zeditor/README.md).

"Ctrl" in this guide means **Ctrl** on Windows / Linux and **⌘ Cmd** on macOS; "Alt" is **⌥ Option**
on macOS. Tooltips in the editor show the right symbols for your system.

## Contents

1. [What zeditor is: Classic and Blocks mode](#1-what-zeditor-is-classic-and-blocks-mode)
2. [The main toolbar](#2-the-main-toolbar)
3. [The Insert menu and the slash (/) menu](#3-the-insert-menu-and-the-slash--menu)
4. [The floating (selection) toolbar](#4-the-floating-selection-toolbar)
5. [Block handles: + and ⋮⋮](#5-block-handles--and-)
6. [Keyboard shortcuts and Markdown shortcuts](#6-keyboard-shortcuts-and-markdown-shortcuts)
7. [Text and block features](#7-text-and-block-features)
8. [Tables](#8-tables)
9. [Pages, sub-pages and page breaks](#9-pages-sub-pages-and-page-breaks)
10. [Databases](#10-databases)
11. [Comments, suggestions, find & replace, saving and limits](#11-comments-suggestions-find--replace-saving-and-limits)
12. [Import, export, copy and paste](#12-import-export-copy-and-paste)
13. [Accessibility and touch](#13-accessibility-and-touch)
14. [Configuration cheat sheet](#14-configuration-cheat-sheet)
15. [Known limitations](#15-known-limitations)

---

## 1. What zeditor is: Classic and Blocks mode

zeditor is a rich-text editor and a block editor in one. The same document can be edited in two
modes; switching keeps the text, the caret, the scroll position and the undo history.

| | **Classic** (default) | **Blocks** |
| --- | --- | --- |
| Feels like | a word processor | Notion-style block editor |
| Main toolbar | shown | shown |
| Floating toolbar on selected text | hidden while the main toolbar is shown | shown |
| Slash (`/`) menu | off (use the toolbar's **Insert** menu) | on |
| Block handles (+ and ⋮⋮ next to each block) | hidden | shown |
| Tab on a paragraph | indents it (up to 8 levels, as a margin) | nests it under the block above |
| Escape while typing | — | selects the whole block (see [block selection](#block-selection-blocks-mode)) |

Lists nest with Tab in both modes. Everything else — formatting, tables, databases, pages,
shortcuts — works the same in both.

There is **no built-in mode switch button**: the host app decides the mode (`mode: 'block'` when
creating the editor, or `setMode('classic' | 'block')` later). Ask your app's developer if you do
not see the mode you want.

---

## 2. The main toolbar

The toolbar sits above the text and stays visible while you scroll. Buttons appear in this order;
vertical separators split them into groups. A button is greyed out when it cannot act (for
example Undo with nothing to undo) and **every** button is disabled in read-only documents.
Buttons whose feature is switched off by the host do not appear.

| # | Control | What it does | Shortcut |
| --- | --- | --- | --- |
| 1 | **Undo** (↶) | Undo the last change | Ctrl+Z |
| 2 | **Redo** (↷) | Redo | Ctrl+Y, Ctrl+Shift+Z |
| — | **+ Insert** | Searchable menu of every block you can insert (same list as the slash menu, see [§3](#3-the-insert-menu-and-the-slash--menu)) | — |
| 3 | **Block type** (drop-down) | Turn the current block(s) into Paragraph, Heading 1, Heading 2, Heading 3 or Quote. When the caret is in another kind of block (a list item, code…), that type is shown as a greyed entry | Ctrl+Alt+0 … Ctrl+Alt+6 |
| 4 | **Bold** | Toggle bold | Ctrl+B |
| 5 | **Italic** | Toggle italic | Ctrl+I |
| 6 | **Underline** | Toggle underline | Ctrl+U |
| 7 | **Strikethrough** | Toggle strikethrough | Ctrl+Shift+X (also Ctrl+Shift+S) |
| 8 | **Inline code** | Toggle monospace code inside a line | Ctrl+E |
| 9 | **Link** | Open the link editor for the selection or the link under the caret ([details](#links)) | Ctrl+K |
| 10 | **Subscript** | Toggle subscript (turns superscript off) | Ctrl+, |
| 11 | **Superscript** | Toggle superscript (turns subscript off) | Ctrl+. |
| 12 | **Font size** (drop-down) | Default, 12px, 14px, 16px, 18px, 24px, 32px | — |
| 13 | **Font family** (drop-down) | Default, serif, sans-serif, monospace, cursive | — |
| 14 | **Text color** | Palette of 10 colours plus **Default** (⦸) to remove the colour. The bar under the icon shows the current colour | — |
| 15 | **Highlight** | Palette of 8 background colours plus **Default** (⦸) to remove it | Ctrl+Shift+H toggles the default highlight |
| 16 | **Bulleted list** | Toggle a bullet list | Ctrl+Shift+8 |
| 17 | **Numbered list** | Toggle a numbered list | Ctrl+Shift+7 |
| 18 | **Checklist** | Toggle a to-do list with checkboxes | Ctrl+Shift+9 |
| 19 | **Code block** | Toggle a multi-line code block | Ctrl+Alt+C |
| 20–23 | **Align left / center / right / justify** | Align the current paragraph(s); also aligns a selected image | Ctrl+Shift+L / E / R / J |
| 24 | **Outdent** | Decrease indentation / un-nest | Shift+Tab, Ctrl+[ |
| 25 | **Indent** | Increase indentation / nest | Tab, Ctrl+] |
| 26 | **Insert table** | Insert a 3 × 3 table with a header row | — |
| 27 | **Insert image** | Pick an image file to upload, or — when the app has no upload handler — type an image URL | — |
| 28 | **Divider** | Insert a horizontal rule | type `---` |
| 29 | **Comment** | Comment on the selected text. Enabled only with text selected. Needs comments set up by the app ([§11](#comments)); otherwise it shows the message "Comments are not available in this editor" | — |
| 30 | **Clear formatting** | Remove all inline formatting (bold, colours, sizes, links…) and alignment from the selection. Comments and suggestions are kept | Ctrl+\ |
| 31 | **Find and replace** (magnifier) | Open the find & replace panel ([§11](#find--replace)) | Ctrl+F / ⌘F |

Notes

- Hover a button to see its name and shortcut.
- Formatting buttons light up (pressed state) when the selection already has that format.
- With nothing selected, toggling bold/italic/etc. applies to the text you type next.
- Keyboard users: **Alt+F10** moves focus from the text to the toolbar, arrow keys / Home / End move
  between buttons, **Escape** returns to the text.

---

## 3. The Insert menu and the slash (/) menu

Both list the same items. Use **+ Insert** on the toolbar (both modes) or type **/** in Blocks mode.

**Slash menu.** Type `/` at the start of a line or after a space, then keep typing to filter
(`/tab`, `/todo`, `/board`). ↑ / ↓ move, **Enter** or **Tab** inserts, **Escape** closes the
menu and leaves the `/` as text. If nothing matches and you have typed a space, the menu gets out
of the way. Matching uses the title, the item id and keywords (for example `/ul`, `/kanban`,
`/latex`).

**Insert menu.** Click **+ Insert**, type in the search box, press ↓ to enter the list or Enter to
insert the first match. Items are inserted at the block holding the caret (or at the end of the
document).

Inserting into an empty paragraph replaces it; otherwise the new block goes below.

| Group | Item | What it inserts | Needs feature |
| --- | --- | --- | --- |
| Basic | **Text** | Plain paragraph (turns the current block into one) | — |
| | **Heading 1 / 2 / 3** | Turns the current block into a heading | — |
| | **Bulleted list**, **Numbered list**, **To-do list** | Turns the current block into a list item | `lists` |
| | **Quote** | Turns the current block into a quote | — |
| | **Divider** | Horizontal rule | — |
| | **Code block** | Turns the current block into a code block | `code` |
| | **Table** | 3 × 3 table with a header row | `tables` |
| | **Callout** | Highlighted note box. If the current block has text, it is wrapped in the callout | `layout` |
| | **Toggle** | Collapsible block (turns the current block into the toggle's title) | `layout` |
| Layout | **2 columns**, **3 columns** | Side-by-side columns | `layout` |
| | **Page break** | Splits the current page at the caret (or adds a page-break marker in a single-page document, see [§9](#9-pages-sub-pages-and-page-breaks)) | `pages` |
| | **New page** | Adds a page (turns the document into a multi-page document if needed) | `pages` |
| Media | **Image** | Upload an image, or enter its URL | `media` |
| | **File** | Upload any file, or enter its URL | `media` |
| | **Embed** | Asks for a link: YouTube and Vimeo become players, other links a link card | `media` |
| | **Equation** | Display LaTeX equation (click it to edit) | `equation` |
| | **Inline equation** | LaTeX inside the line, starts as `x^2` (click it to edit) | `equation` |
| Database | **Database – table / board / list / gallery / calendar / timeline** | A new database opened in that view ([§10](#10-databases)) | `database` |
| Advanced | **Table of contents** | Live outline of the headings on this page | `notion` |
| | **Bookmark** | Asks for a link and shows it as a preview card | `notion` |
| | **Date** | Today's date as a chip; click it to change the date | `notion` |
| | **Template button** | A button that inserts a fresh unchecked to-do each time it is clicked | `notion` |
| | **Toggle heading 1 / 2 / 3** | A collapsible section whose title looks like a heading | `notion` + `layout` |

Apps can add their own items through extensions; they appear in both menus.

### Other typeahead menus

Like the slash menu, these open while you type and use the same keys (↑ ↓ Enter Tab Escape):

| Type | Opens | Notes |
| --- | --- | --- |
| `@` | People to mention | Only when the app provides a people search (`mentions.search`); otherwise `@` is plain text |
| `:` + letters | Emoji (`:rocket` → 🚀) | Built-in list of about 50 common emoji |
| `[[` | Pages of this document to link to | Shows "No pages — use "New page" first" in a single-page document |

---

## 4. The floating (selection) toolbar

A small toolbar that appears **above selected text**. It shows when the editor is in Blocks mode,
or in Classic mode when the main toolbar is turned off. It needs no hover, so it works with touch.

| Button | Same as |
| --- | --- |
| Bold, Italic, Underline, Strikethrough, Inline code | main toolbar |
| Link | main toolbar / Ctrl+K |
| Highlight | main toolbar |
| Comment | main toolbar (only when comments are set up) |

It hides while you are still dragging the selection and in read-only documents.

---

## 5. Block handles: + and ⋮⋮

In **Blocks mode**, two buttons appear to the left of the block under the mouse — or of the block
holding the caret, so keyboard and touch users can reach them too.

| Handle | Action |
| --- | --- |
| **+** (Add block below) | Adds an empty line below (or reuses the current one if it is empty) and opens the slash menu there |
| **⋮⋮** click (or Enter / Space when focused) | Opens the block menu (below) |
| **⋮⋮** drag | Moves the block. A blue line shows where it will land. Drop above or below another block; drop slightly to the right on a block that can hold children (a list item, toggle, paragraph) to **nest** it inside. Works with mouse, pen and touch, and scrolls the page at the window edges |
| **⋮⋮** + Alt+↑ / Alt+↓ (when focused) | Moves the block up / down |

If several blocks are selected (see [block selection](#block-selection-blocks-mode)) the menu
and dragging act on all of them.

**Block menu items**

| Item | What it does |
| --- | --- |
| **Duplicate** | Insert a copy below (Ctrl+Shift+D) |
| **Delete** | Remove the block(s) |
| **Move up / Move down** | Swap with the neighbouring block (Alt+↑ / Alt+↓) |
| **Copy link to block** | Copies the page address + `#block-id` to the clipboard. Opening that address scrolls to the block and flashes it (expanding collapsed toggles on the way) |
| **Create synced copy** | Inserts a read-only live mirror of the block below it ([synced copies](#synced-copies)) — `notion` feature |
| **Save as template button** | Creates a button that inserts copies of these blocks ([template buttons](#template-buttons)) — `notion` feature |
| **Turn into →** Paragraph, Heading 1–3, Bulleted list, Numbered list, Checklist, Quote, Code block | Change the block type (shown for text blocks only) |

Rows, cells, columns and pages are structural: the handle points at the table, column set or
database that contains them.

---

## 6. Keyboard shortcuts and Markdown shortcuts

### Keyboard shortcuts

| Action | Windows / Linux | macOS |
| --- | --- | --- |
| **History** | | |
| Undo | Ctrl+Z | ⌘Z |
| Redo | Ctrl+Y or Ctrl+Shift+Z | ⌘Y or ⌘⇧Z |
| **Text formatting** | | |
| Bold / Italic / Underline | Ctrl+B / Ctrl+I / Ctrl+U | ⌘B / ⌘I / ⌘U |
| Strikethrough | Ctrl+Shift+X or Ctrl+Shift+S | ⌘⇧X or ⌘⇧S |
| Inline code | Ctrl+E | ⌘E |
| Superscript / Subscript | Ctrl+. / Ctrl+, | ⌘. / ⌘, |
| Highlight (default colour) | Ctrl+Shift+H | ⌘⇧H |
| Link | Ctrl+K | ⌘K |
| Clear formatting | Ctrl+\ | ⌘\ |
| **Block types** | | |
| Paragraph | Ctrl+Alt+0 | ⌘⌥0 |
| Heading 1 – 6 | Ctrl+Alt+1 … 6 | ⌘⌥1 … 6 |
| Quote (toggle) | Ctrl+Shift+B | ⌘⇧B |
| Code block (toggle) | Ctrl+Alt+C | ⌘⌥C |
| Numbered / Bulleted / Checklist (toggle) | Ctrl+Shift+7 / 8 / 9 | ⌘⇧7 / 8 / 9 |
| Check / uncheck a to-do | Ctrl+Enter | ⌘↩ |
| Expand / collapse a toggle | Ctrl+Alt+O | ⌘⌥O |
| Line break inside a block | Shift+Enter | ⇧↩ |
| **Layout** | | |
| Align left / center / right / justify | Ctrl+Shift+L / E / R / J | ⌘⇧L / E / R / J |
| Indent / nest | Tab or Ctrl+] | Tab or ⌘] |
| Outdent / un-nest | Shift+Tab or Ctrl+[ | ⇧Tab or ⌘[ |
| **Blocks** | | |
| Move block(s) up / down | Alt+↑ / Alt+↓, or Ctrl+Shift+↑ / ↓ | ⌥↑ / ⌥↓, or ⌘⇧↑ / ↓ |
| Duplicate block(s) | Ctrl+Shift+D | ⌘⇧D |
| Select all | Ctrl+A | ⌘A |
| **Pages** | | |
| Page break (split the page here) | Ctrl+Shift+Enter | ⌘⇧↩ |
| Next / previous page | Ctrl+Alt+PageDown / PageUp | ⌘⌥PageDown / PageUp |
| **Other** | | |
| Find & replace | Ctrl+F (while the editor has focus) | ⌘F |
| Open a link | Ctrl+click | ⌘+click |
| Move focus to the toolbar | Alt+F10 | ⌥F10 |
| Leave the editor with the keyboard | Escape, then Tab / Shift+Tab | same |

Tab indents, so it does not move focus out of the editor; press **Escape first** and the next Tab
leaves the editor.

**In tables** — Tab / Shift+Tab: next / previous cell (Tab in the last cell adds a row);
Shift+Arrow at the edge of a cell: start or extend a cell selection; Escape: back to the text.
See [§8](#8-tables).

**In code blocks** — Tab / Shift+Tab indent / outdent the selected lines by two spaces; Enter keeps
the current line's indentation; Enter on an empty last line leaves the code block.

#### Block selection (Blocks mode)

| Key | Action |
| --- | --- |
| Escape (while typing) | Select the whole block |
| ↑ / ↓ | Select the previous / next block |
| Shift+↑ / Shift+↓ | Extend the selection over neighbouring blocks |
| ← / → | Back to typing, before / after the selection |
| Enter | Edit the selected block (caret at its end); for an image or divider, add a paragraph after it |
| Backspace / Delete | Delete the selected blocks |
| Any character | Replace the selected blocks with that text |

Clicking an image, divider, equation or other non-text block also selects it as a block, in either
mode. With the caret at the edge of a text block, ↑ / ↓ / ← / → step onto a neighbouring
non-text block.

### Markdown shortcuts (typed)

Feature `markdownShortcuts` (on by default). The block shortcuts work at the start of a
paragraph; type the characters and then a **space** (except the divider).

| Type | Becomes |
| --- | --- |
| `# ` … `###### ` | Heading 1 … 6 |
| `> ` | Quote |
| `- `, `* ` or `+ ` | Bulleted list |
| `1. ` or `1) ` (any number) | Numbered list starting at that number |
| `[] `, `[ ] `, `[x] ` (also after `- `) | To-do item, unchecked / checked |
| ` ``` ` + space, or ` ```js ` + space | Code block (with language) |
| `---`, `***` or `___` (alone on a line) | Divider |
| `**text**` or `__text__` | **bold** |
| `*text*` or `_text_` | *italic* |
| `~~text~~` | strikethrough |
| `` `text` `` | inline code |
| `:name:` | emoji (for names in the built-in list, e.g. `:tada:`) |
| a URL or `www.…` followed by a space | link (feature `autolink`) |
| an e-mail address followed by a space | `mailto:` link (feature `autolink`) |

Each shortcut is its own undo step: press Ctrl+Z right after it to get the typed characters back.
Shortcuts do not run inside code blocks.

---

## 7. Text and block features

### Formatting marks

Bold, italic, underline, strikethrough, inline code, subscript, superscript, text colour,
highlight, font size and font family — see [§2](#2-the-main-toolbar). Font size and family are
kept in zeditor's own HTML export; they are not taken from pasted Word / Google Docs content.

### Links

Open the link editor with the **Link** button or **Ctrl+K**.

- Type or paste an address and press **Apply** (or Enter). Without a scheme, `https://` is added
  (`example.com` → `https://example.com`).
- With the caret inside an existing link, the editor shows that link with **Remove link** and
  **Open link** buttons. Applying an empty field also removes the link.
- With nothing selected and the caret outside a link, the address itself is inserted as linked
  text.
- Pasting a single URL while text is selected turns the selection into a link.
- Unsafe addresses (`javascript:` and similar) are refused.
- In the editor, a plain click on a link places the caret; **Ctrl/⌘+click** opens it in a new tab.
  In read-only documents a plain click opens it.

### Colours and highlight

Choose from the palettes on the toolbar. **Default** (⦸) removes the colour. Highlight colour is
lost in Markdown export (it becomes `<mark>`); text colour is lost entirely in Markdown.

### Alignment and indentation

Alignment applies to paragraphs, headings, quotes and images. Indentation: Tab / Shift+Tab or the
Indent / Outdent buttons. Lists always nest. In Classic mode other paragraphs get a left margin
(up to 8 steps); in Blocks mode they nest under the block above (and move with it when it is
dragged). Indentation is not kept in Markdown and is not read back from imported HTML.

### Lists and checklists

- Bulleted, numbered and to-do lists; nest with Tab, un-nest with Shift+Tab.
- Enter on an empty list item un-nests it, or ends the list at the top level.
- Click a checkbox (or Ctrl+Enter) to check / uncheck. A numbered list keeps its start number.

### Quotes

`> ` or the Block type drop-down or Ctrl+Shift+B. Exported as `<blockquote>` / `> `.

### Code blocks and highlighting

A code block has a **language** drop-down (plain, javascript, typescript, html, css, json, python,
java, c, cpp, csharp, go, rust, ruby, php, sql, bash, yaml, markdown, xml, swift, kotlin) and a
**Copy code** button. Formatting marks are not allowed inside code.

Colour highlighting is optional: the app must add `codeHighlightExtension()` from
`@z-packages/zeditor/code-highlight`. It colours keywords, strings, comments, numbers, function
calls and tags, and needs a browser with the CSS Custom Highlight API; others show plain code.

### Callouts

A tinted box that holds any blocks. **Click its icon** to cycle the style:
Note 💡 → Info ℹ️ → Success ✅ → Warning ⚠️ → Danger ⛔. Press Enter on an empty last line to
leave the callout. Markdown export uses GitHub alerts (`> [!NOTE]` …).

### Toggles and toggle headings

A toggle's first line is its title; the blocks nested under it are hidden when collapsed. Click the
▸ arrow or press Ctrl+Alt+O. Indenting a block under a collapsed toggle opens it. Collapsed state
is saved in the document and can be changed in read-only documents too. **Toggle heading 1–3**
(Insert / slash menu) is the same with a heading-styled title.

### Columns

**2 columns** / **3 columns** place blocks side by side; each column holds any blocks. Column
widths can be set through the API (`width` attribute); there is no drag handle for them. In
Markdown the columns become sequential content.

### Dividers

Toolbar **Divider**, `/divider`, or type `---`.

### Equations

Needs feature `equation`. **Equation** inserts a display formula, **Inline equation** one inside
the text. Click either to edit its LaTeX in a small box. The app renders the maths by passing
`renderMath` (for example with KaTeX); without it you see the LaTeX source.

### Images

- Insert with the toolbar, `/image`, by **pasting** a screenshot or **dropping** image files —
  uploads need the app's `upload` handler. Without one, the image button and `/image` ask for an
  image URL instead, and dropped / pasted files are ignored.
- While uploading, the image shows progress; a failed upload shows **Retry**.
- **Resize:** drag the handle on the image's right edge (it appears on hover or when the image
  is selected), or focus it and press ← / →.
- **Caption:** type in the field under the image; Enter saves, Escape cancels.
- **ALT** button: set the description read by screen readers.
- Align an image with the alignment buttons after clicking it.

### Files and embeds

- **File** (`/file`): upload any file (or give its URL). Shown as a download link with its size.
- **Embed** (`/embed`): paste a link. YouTube and Vimeo links become an embedded player
  (`youtube-nocookie.com`); other links become a link card. Apps can register more providers.

### Mentions (@)

Type `@` and pick a person. Available only when the app connects its user directory
(`mentions: { search }`). A mention is a single unit (Backspace removes it whole).

### Hashtags and issue references (#)

With feature `hashtag`, any `#word` in normal text is styled as a tag automatically — there is no
menu. Hashtag styling is not kept in Markdown. A `#` menu for issue references (`#ZED-1`) is **not
built in**; it is an example extension (`examples/shared/extensions.js`) an app can add.

### Emoji

Type `:` followed by a name to open the emoji menu, or type a full code like `:rocket:` for direct
replacement. The built-in list has about 50 common emoji; apps can supply their own list.

### Links to pages ([[)

In a multi-page document, type `[[` and choose a page. The link shows the page's **current**
title (renaming the page updates it); clicking it shows that page. A link to a deleted page is
shown as missing.

### Dates

`/date` inserts today's date as a chip that reads "@Today", "@Tomorrow", "@Yesterday" or a short
date. Click it to pick another date (Enter to confirm). Stored as `YYYY-MM-DD`.

### Table of contents

`/toc` inserts a live outline of the headings **on the same page**, indented by level. Click an
entry to jump to the heading. In exported HTML / Markdown it is an empty marker, not a list of
links.

### Bookmarks

`/bookmark` asks for a link and shows a card with title, description, image and site name.
The editor never fetches web pages itself: the details come from the app's `linkPreview`
function. Without it the card shows just the address.

### Template buttons

A button that inserts **fresh copies** of stored blocks below itself each time it is clicked.

- `/template` creates a "New to-do" button that inserts an unchecked to-do.
- To make your own: select blocks, open the ⋮⋮ menu → **Save as template button**.
- **Double-click** the button to rename it.

### Synced copies

⋮⋮ menu → **Create synced copy** inserts a read-only mirror of a block below it. The copy follows
every change to the original. You cannot edit the copy: use its **Synced copy · Go to original**
button. If the original is deleted, the copy says so. (One-way only; exported HTML contains an
empty marker, not the mirrored content.)

---

## 8. Tables


**Complex tables.** A cell can hold any block: several paragraphs, lists and check lists, code,
images, callouts, even **another table** (put the caret in a cell and use **Insert → Table** or
the table button). The table tools always act on the table holding the caret; when tables are
nested, that table is outlined and the tools bar sits above the outermost table so it never
covers the cell you are in. Cells can be merged across rows and columns (select them, then
**Merge**), any row or column can be a header, and cells can be coloured. Tables pasted from web
pages, Word, Google Docs or spreadsheets keep merged cells, header rows and columns, colours,
alignment, column widths, captions and nested tables (see
[serialization.md](./serialization.md)). The playground's **Complex tables** section has
examples.
Insert with the toolbar's **Insert table**, `/table`, or by pasting a table. New tables are
3 × 3 with a header row.

**Table tools.** While the caret is in a table, a small toolbar appears above it:

| Button | Action |
| --- | --- |
| ↑+ | Insert row above |
| ↓+ | Insert row below |
| ←+ | Insert column left |
| →+ | Insert column right |
| −▭ | Delete row |
| −▯ | Delete column |
| ⊞ | Merge cells (enabled only with several cells selected) |
| ⊟ | Split a merged cell |
| H▭ | Toggle header row |
| H▯ | Toggle header column |
| ✕ | Delete table |

With several cells selected, row / column buttons act on all selected rows / columns.

**Selecting cells.** Drag across cells with the mouse, or hold Shift and use the arrow keys at the
edge of a cell. Arrow keys in a cell selection move to a single cell; Escape returns to typing.
Copying a cell selection gives a table (HTML) and tab-separated text (for spreadsheets).

**Moving between cells.** Tab / Shift+Tab; Tab in the last cell adds a new row.

**Column width.** Thin handles on the column borders: drag them, or focus one with Tab and press
← / → (16 px per step). The first resize fixes all columns at their current widths so only the
dragged one changes.

**Pasting.**
- Copied spreadsheet cells (Excel, Google Sheets, tab-separated text) pasted into a table fill
  cells starting at the caret / selected cell and **grow the table** when needed.
- A single copied cell pasted onto a cell selection fills every selected cell.
- A cell range pasted outside a table becomes a new table.
- Each paste is one undo step.

Cells can hold any blocks (lists, images…). Cell background colours exist in the data model and in
HTML import / export but have no toolbar control (API: `setBlockAttrs(cellId, { background })`).

---

## 9. Pages, sub-pages and page breaks

A document can be **one continuous page** (default) or **multi-page** — like sheets in a
spreadsheet or pages in a notebook. Feature `pages`.

**Making a document multi-page.** Use **New page** (Insert / slash menu). The existing content
becomes "Page 1" and a new page is added. Merging pages back into one document is an API call
(`disablePages()`); there is no button for it.

**Page tabs** appear above the text once the document has pages:

| Control | Action |
| --- | --- |
| Tab (number + title) | Show that page. Sub-pages are indented and marked ↳ |
| Double-click a tab, or F2 | Rename |
| **⋯** on the active tab, right click, Shift+F10 or the Menu key | Page menu: **Rename**, **Add sub-page**, **Move to top level** (sub-pages only), **Duplicate page**, **Move left**, **Move right**, **Delete page** (not the last page) |
| **+** | Add a page after the current one |
| ← / → , Home / End (on tabs) | Move between tabs |
| Alt+← / Alt+→ (on a tab) | Reorder |
| Delete (on a tab) | Delete that page (undoable) |
| **Page X of Y** | Where you are |
| **One page at a time / All pages** | Switch between showing only the active page and showing every page as a sheet, one under another |

**Sub-pages.** "Add sub-page" nests a page under another. A breadcrumb trail (Parent / Child) under
the tabs shows the path of the active page; click a crumb to go there. Deleting a page moves its
sub-pages up one level.

**Page breaks.** **Ctrl+Shift+Enter** or `/page break`:
- in a multi-page document, the current page is split at the caret into a new page;
- in a single-page document, a "Page break" marker block is inserted (it becomes a printed page
  break in exported HTML: `break-after: page`).

Find & replace, the table of contents (per page), page links and undo all switch to the right
page when needed.

---

## 10. Databases

### What a database is for

A database is a **collection of items that all have the same fields** — a spreadsheet where every
row is also a page you can write in. Use one whenever you would otherwise keep a list and wish you
could sort it, filter it, or see it as cards or on a calendar.

- **Rows** are the items (a task, an article, a book, a customer).
- **Properties** are the fields every row has (Status, Due date, Owner, Price…). Each property
  has a type, so a date is a real date and a number can be summed.
- **Views** are saved ways of looking at the same rows: a table to edit fields, a board to drag
  tasks between statuses, a calendar to plan by date… Changing a row in one view changes it
  everywhere, because there is only one set of rows.
- **Each row is a page.** Open a row to write notes, checklists, images — anything — inside it.

### Examples

| Use | Properties | Useful views |
| --- | --- | --- |
| **Task tracker** | Name (title), Status (select: To do / In progress / Done), Assignee (person), Due (date), Points (number), Done (checkbox) | **Board** grouped by Status to drag tasks along; **Table** with a *sum* of Points; **Calendar** by Due; a table view filtered to "Done unchecked" |
| **Content calendar** | Title, Channel (multi-select: Blog, Newsletter, Social), Status (select), Draft from (date), Publish on (date), Link (URL) | **Calendar** by Publish on; **Timeline** from Draft from to Publish on; **Board** by Status |
| **Reading list** | Title, Author (text), Kind (select: Book / Article / Paper), Rating (number), Finished (checkbox), Link (URL) | **Gallery** (the cover is the first image in each row's page — paste a cover image there); a **List** filtered to "Finished unchecked", sorted by Rating |
| **Simple CRM** | *Companies* database: Name, Industry (select), Total pipeline (rollup). *Deals* database: Deal, Company (relation → Companies), Amount (number), Stage (select), Close date (date), Contact e-mail (email) | Deals **Board** by Stage; Deals **Timeline** by Close date; Companies **Table** whose *Total pipeline* rollup sums Amount of related deals |

The row page holds the detail: meeting notes for a deal, the outline of an article, quotes from a
book.

### Creating a database

Insert menu / slash menu → **Database – table / board / list / gallery / calendar / timeline**. A
new database has three properties (Name, Status with To do / In progress / Done, Tags) and **three
empty rows**, so it starts as a blank grid: click a row's Name cell and type.

**Anatomy**

| Part | What it does |
| --- | --- |
| Title field | Name the database ("Untitled database" until you do) |
| Count | Number of rows; "3 of 10" when a filter or search hides some |
| View tabs | One per saved view. Click to switch; click the **active** tab again for its menu; **+** adds a view |
| Magnifier | Quick search ([below](#quick-search)) |
| **Filter**, **Sort**, **Group**, **Properties** | View settings; a button looks pressed when that setting is active, Filter shows how many filters |
| **+ New** | Add a row (also at the bottom of a table / list, under each board column and on calendar days) |

> **"I clicked New and nothing happened."** A new row is empty and only its title cell is focused
> (with the placeholder "Untitled"), so it is easy to miss — type a name. The editor tries to make
> new rows visible: on a board the row goes into the first column, on a calendar or timeline it is
> dated today and the view jumps to it, an active quick search is cleared, and a filter of the form
> "*select property* is *option*" is pre-filled. Any **other** filter (for example "Points gt 3")
> can hide the new, empty row immediately — look at the count ("3 of 4") and the Filter badge.

### Views

| View | Good for | How it works |
| --- | --- | --- |
| **Table** | Editing many fields quickly, totals | One row per item, one column per property. Column headers open property settings. Calculations show in a footer row. The title column stays put when you scroll sideways |
| **Board** | Workflows (status, stage, priority) | One column per option of a **select** property, cards inside. **Drag a card** to another column to change its value; drop it on another card to reorder (unsorted views only). A "No value" column holds rows without a value. Uses the Group setting, else the first select property |
| **List** | Compact lists of pages (notes, docs) | Title plus filled-in properties on one line |
| **Gallery** | Visual collections (reading list, designs, recipes) | Cards in a grid. The cover is the **first image** in the row's page, or the start of its text. Empty properties are hidden until the card is opened |
| **Calendar** | Scheduling by a single date | A month grid; rows sit on the day of a **date** property. **◀ / Today / ▶** change month. **+** on a day adds a row dated that day. **Drag an entry** to another day to change its date |
| **Timeline** | Plans with a start and an end | A 28-day window; rows are bars from a date to an optional **End date**. **Drag a bar** to shift its dates; **drag its right end** to change the end date (needs an End date property, see below). ◀ / Today / ▶ move the window |

Calendar and timeline views need a date property; adding one of these views to a database without
dates creates a "Date" property. Rows without a date, or outside the shown range, are not drawn —
a note under the view says how many ("2 not shown…").

**View menu** (click the active tab): rename, change type, and for calendar / timeline pick the
**Date** property; timeline also picks the **End date** property. **Delete view** (not the last
one). Each view keeps its own filters, sorts, grouping, hidden properties and calculations. The
active view is saved in the document.

### Properties

Click a column header in a **table** view to open its settings; **Properties** (toolbar) shows /
hides properties in the current view and has **Add property**. In a table, **+** at the end of the
header row also adds one; new properties open their settings immediately.

| Type | Holds | Edit by |
| --- | --- | --- |
| **Title** | The row's name. Exactly one, always first; cannot be hidden, moved or deleted | typing |
| **Text** | Free text | typing |
| **Number** | A number (anything else clears the cell) | typing |
| **Select** | One option from a coloured list | picker: search, click, or type a new name and **Create "…"**; **Clear** empties |
| **Multi-select** | Several options (tags) | same picker; click to add / remove |
| **Checkbox** | Done / not done | click |
| **Date** | A day | the browser's date field |
| **URL** | A web link | typing; an ↗ icon opens it |
| **Email** | An e-mail address | typing; an ↗ icon opens a `mailto:` link |
| **Person** | A name (free text, not linked to user accounts) | typing |
| **Formula** | A value **computed** from other properties of the same row | read-only; write the formula in the property settings |
| **Relation** | Links to rows of a database in the same document (or the same database) | picker listing the target database's rows; click to link / unlink |
| **Rollup** | A summary of one property of the **related** rows (needs a relation) | read-only; configured in the property settings |

Apps can register their own property types; they then appear in the type list.

**Property settings** (click a table header)

| Setting | What it does |
| --- | --- |
| Name field | Rename the property |
| **Type** | Change the type. Changing text to select / multi-select turns the existing values into options |
| **Formula** box (formula only) | The expression, checked as you type. Example: `prop("Points") * 2`, `if(prop("Done"), "✓", "")`, `dateDiff(prop("Due"), today())`. Functions: `if`, `concat`, `length`, `lower`, `upper`, `contains`, `replace`, `empty`, `toNumber`, `round`, `floor`, `ceil`, `abs`, `min`, `max`, `today`, `now`, `dateDiff`, `dateAdd`; operators `+ - * / %`, comparisons, `and or not`. Errors show as `#ERR: …` in the cell |
| **Related to** (relation only) | Which database the links point to |
| **Relation / Property / Calculate** (rollup only) | Which relation to follow, which property of the related rows to summarise, and how: *show values* (comma-separated list) or any calculation (sum, avg…) |
| **Calculate** | Footer calculation for this column in the table view: count, filled, empty, unique, sum, avg, min, max, checked, percent checked |
| **Sort ascending / descending** | Sort the view by this property |
| **Move left / Move right** | Reorder (or drag the header sideways) |
| **Hide in this view** | Hide the column here only (show it again from **Properties**) |
| **Delete property** | Removes the property, its values and every filter / sort / group that used it — one undoable step |

Drag a header's right edge to resize the column.

Relations are one-way (no automatic back-link) and only within the same document. Formula and
rollup cells cannot be typed into, but they can be sorted, filtered and calculated.

### Filter, sort, group, calculate

| Tool | What it does |
| --- | --- |
| **Filter** | **+ Filter** adds a rule: property, condition, value. Conditions: contains, not contains, is, is not, empty, not empty, gt (greater than), lt (less than), checked, unchecked. Values are matched against the text shown in the cell, ignoring case (for selects: the option name). With two or more filters, **Match** chooses *all filters* or *any filter*. ✕ removes a rule |
| **Sort** | One property and a direction. Selects sort in option order, text naturally ("item 2" before "item 10"), empty values always last. *None* removes the sort. Sorting never changes the stored order of rows |
| **Group** | Pick a select property. A **board** uses it for its columns (a board is always grouped, so it has no *None*). A **table, list or gallery** shows a section per value: click a section header to fold it. **Hide empty groups** hides columns / sections with no rows. Calendars and timelines have no Group button |
| **Properties** | Checkboxes to show / hide properties in this view, plus **Add property** |
| Calculations | Set per column from the table header ("Calculate"); shown in the table footer |

### Quick search

The magnifier in the database toolbar opens a search field. Every word you type must appear in
some property of a row (option names included). **Enter** jumps to the first match's title;
**Escape** clears the search. It is not saved in the document and also works in read-only
documents.

### Working with rows

- **Open a row as a page:** the **Open** button in the title cell (it appears on hover / focus), or
  **Open** in the row menu. The row's page opens under the row (full width in board, gallery,
  calendar and timeline views); write anything in it, including another database. The same
  button, or **Close** in the row menu, closes it. Open / closed is not saved.
- **Row menu:** the **⋯** button at the end of a table or list row and in the corner of a board /
  gallery card, or **right-click** anywhere on a row (also calendar entries and timeline bars). A
  field with selected text keeps the browser's own menu.

  | Item | Action |
  | --- | --- |
  | **Open / Close** | Show or hide the row's page |
  | **Insert above / Insert below** | Add an empty row next to it (in stored order; a sorted view may show it elsewhere) |
  | **Duplicate row** | Copy the row, including its page |
  | **Delete row** | Remove it (undoable) |

- **Keyboard in cells:** **Enter** saves and moves to the same cell of the next row (like a
  spreadsheet); **↓ / ↑** move down / up the column in the order the view shows; **Escape**
  cancels the edit. (Date fields keep their own arrow keys.)
- **Dragging:** board cards between columns (changes the select value) and onto other cards
  (reorders, when the view is not sorted); calendar entries to another day; timeline bars to shift
  start and end together, or by their **right end** to change only the end date. A click without
  movement still edits the title.

Everything a database does is undoable. Find & replace searches the text in row pages, not cell
values (use quick search for those). Read-only documents show databases without editing controls (quick search still
works). For the data model, commands (`insertDatabase`, `dbAddRow`, `dbSetCell`…), formulas,
custom property types and collaboration behaviour see **[databases.md](./databases.md)**.

---

## 11. Comments, suggestions, find & replace, saving and limits

### Comments

The **Comment** button (toolbar and floating toolbar) is enabled when text is selected. It works
only if the app has set up comments — `createComments(editor, { user })` plus a panel such as the
built-in `createReviewPanel(...)`. Then:

1. Select text → **Comment** → type in the box → submit. The text is underlined as commented.
2. The **Comments** panel lists threads with the quoted text. Click the quote to jump to it.
3. **Reply**, **Resolve** / **Reopen**, **Delete** per thread.

Comments follow the text when it is edited or moved. If all commented text is deleted, the
thread stays in the panel marked "The commented text was deleted" (undo re-attaches it). Details:
[collaboration.md](./collaboration.md#comments).

### Suggestions (track changes)

With suggestions set up (`createSuggestions`) and **Suggesting** turned on (button in the review
panel or the app's own switch), typed text is shown as an insertion and deleted text stays visible
as a deletion instead of disappearing. The review panel lists each change with **Accept** /
**Reject**, plus **Accept all** / **Reject all**. Only typing and deleting text is tracked;
formatting, block moves, table edits and block-type changes apply directly.

### Version history

API only: `createVersions(editor, { store })` → `save(label)` and `restore(id)`. Restoring is one
undoable edit. There is no built-in version list; the playground shows a simple example.

### Find & replace

**Ctrl+F** while the editor has focus (overrides the browser's find for the editor). Text selected
within one block is searched immediately.

| Control | Action |
| --- | --- |
| Find field | Search as you type; "2 / 7" shows the current match and total |
| ↑ / ↓ buttons, Shift+Enter / Enter | Previous / next match (switches page if needed) |
| **Aa** | Match case |
| **W** | Whole word |
| **.\*** | Regular expression |
| Replace field + **Replace** (or Enter in the field) | Replace the current match |
| **Replace all** | Replace every match (one undo step) |
| ✕ / Escape | Close |

### Autosave and draft recovery

When the app passes `autosave: { save, draftKey }`, changes are saved shortly after you stop
typing and the status is shown in the status bar: **Saved**, **Saving…**, **Unsaved changes**,
**Save failed** (it retries) or **Offline — changes kept locally**. With `draftKey`, a copy is also
kept in the browser until the server confirms the save; after a crash the app can offer to
restore it (`autosave.getDraft()` / `recoverDraft()` — no built-in prompt).

### Character limit

With `characterLimit: n`, edits that would go past the limit are refused. The status bar shows
"characters / limit" and flashes when an edit is refused.

### Status bar

Off by default (`ui: { statusBar: true }`). Shows word and character counts, the character limit
(if any) and the save status.

### Read-only

When the app makes the document read-only, all editing controls are disabled or hidden; you can
still select, copy, search (Ctrl+F), follow links with a plain click, collapse toggles and switch
pages.

---

## 12. Import, export, copy and paste

zeditor has no import / export buttons of its own; the app calls the API (the playground's
"Copy HTML / Markdown / JSON" and "Import…" buttons are examples).

| Format | Export | Import | Fidelity |
| --- | --- | --- | --- |
| **JSON** | `getJSON()` | `setJSON(doc)` | Lossless — use this for storage |
| **HTML** | `toHTML(editor)`, server-side `renderToHTML(doc)` | `setHTML(editor, html)` | Semantic and sanitized; re-importing zeditor's own HTML is lossless for almost everything |
| **Markdown** | `toMarkdown(editor)` | `setMarkdown(editor, md)` | CommonMark + GFM tables / task lists. Loses colours, fonts, alignment, indentation, column layout, comments and database structure |
| Plain text | `renderToText(doc)` | — | — |

Full feature-by-feature tables: [serialization.md](./serialization.md).

**Copy** writes HTML, plain text and zeditor's own format, so pasting inside zeditor keeps
everything (comments only within the same editor).

**Paste**, in order of preference:

1. zeditor content → pasted exactly.
2. Spreadsheet / table cells while in a table → fills cells ([§8](#8-tables)).
3. A single URL over selected text → turns the text into a link.
4. HTML (web pages, Word, Google Docs) → converted: headings, bold / italic, links, lists
   (including Word and Google Docs lists), tables and images are kept; fonts, sizes, default
   colours and page layout are dropped. Scripts and unsafe markup never get in.
5. Plain text → one paragraph per line, bare URLs become links. Pasted plain text is **not**
   interpreted as Markdown.

Screenshots and files pasted or dropped go to the app's upload handler. Dropping text or HTML
inserts it at the drop point.

---

## 13. Accessibility and touch

**Keyboard**

- Toolbars use one Tab stop with arrow-key navigation (roving focus); Alt+F10 jumps to the main
  toolbar and Escape returns to the text.
- Escape then Tab leaves the editor (Tab alone indents).
- Slash / mention / emoji menus are announced as listboxes; the highlighted item is exposed with
  `aria-activedescendant`.
- Block handles follow the caret; the ⋮⋮ handle is an ordinary button (Enter / Space opens its
  menu, Alt+↑ / ↓ moves the block).
- Page tabs follow the ARIA tabs pattern (arrows, Home / End, F2, Delete, Alt+arrows, Shift+F10).
- Table column handles, the image resize handle and database column headers are focusable and
  work with arrow keys / Enter.
- Database view tabs move with ← / →; popups close with Escape and return focus.

**Screen readers** — controls have labels (all overridable through `labels`), status messages
(match counts, save status) are live regions, checkboxes are exposed as checkboxes, images have an
**ALT** button.

**Touch** — the floating toolbar needs no hover; block handles follow the selection; block
dragging, image resize, board / calendar / timeline dragging and column resizing use pointer
events and work with touch and pen; menu items are chosen on tap without closing the keyboard.

Tested browsers, screen readers and the manual checklist: [testing.md](./testing.md).

---

## 14. Configuration cheat sheet

```js
import { createEditor } from '@z-packages/zeditor';
import '@z-packages/zeditor/style.css';

const z = createEditor({
  element: '#editor',
  mode: 'block',                       // 'classic' (default) | 'block'
  readOnly: false,
  placeholder: 'Write something…',
  theme: 'auto',                       // 'light' (default) | 'dark' | 'auto'
  features: { equation: false, database: true },   // every feature is on unless set to false
  ui: {
    toolbar: ['undo', 'redo', '|', 'blockType', 'bold', 'italic', 'link', '|', 'insert'],
    floatingToolbar: true,
    slashMenu: 'block',                // 'block' | 'always' | false
    blockHandles: true,
    tableTools: true,
    find: true,
    statusBar: true,
    pageTabs: true,
  },
  upload: async (file, { signal, onProgress }) => ({ url: await myUpload(file, signal, onProgress) }),
  mentions: { search: async (query, { signal }) => findPeople(query, signal) },
  linkPreview: async (url, { signal }) => fetchPreview(url, signal),
  renderMath: (tex, el, display) => katex.render(tex, el, { displayMode: display }),
  autosave: { save: (doc) => api.save(doc), draftKey: 'doc-42' },
  characterLimit: 10000,
  labels: { 'mark.bold': 'Fett' },     // rename any UI text
  icons: { bold: '<svg>…</svg>' },     // replace any icon
});
```

The React `<ZEditor>` takes the same options as props; the Vue `<ZEditor>` takes them as
`:options`.

### `ui` options

| Option | Default | Controls |
| --- | --- | --- |
| `ui: false` | — | No built-in controls at all (headless UI); build your own from `getState()` and `commands` |
| `toolbar` | `true` | Main toolbar. `false` hides it; an array picks items and order (`'|'` = separator). The Insert menu is included only if the array contains `'insert'`, at that position |
| `floatingToolbar` | `true` | Selection toolbar. An array picks among: `bold`, `italic`, `underline`, `strike`, `code`, `link`, `highlight`, `comment` |
| `slashMenu` | `'block'` | `/` menu only in Blocks mode, `'always'`, or `false` |
| `blockHandles` | `true` | + and ⋮⋮ handles (Blocks mode only) |
| `tableTools` | `true` | Table toolbar and column-resize handles |
| `find` | `true` | Find & replace panel, its toolbar button and Ctrl+F |
| `notices` | `true` | Small messages in the bottom-right corner for problems the user should know about: an upload failed or was rejected, files dropped where uploads are not set up, an invalid link, Comment without comments set up. Set `false` to show them your own way: listen to the `ui:error` / `ui:notice` events (`{ message }`) |
| `statusBar` | `false` | Word / character count, limit, save status |
| `pageTabs` | `true` | Page tabs and breadcrumbs (shown only for multi-page documents) |

**Toolbar item ids** (for `ui.toolbar`): `undo`, `redo`, `insert`, `blockType`, `bold`, `italic`,
`underline`, `strike`, `code`, `link`, `sub`, `sup`, `fontSize`, `fontFamily`, `color`,
`highlight`, `list-bullet`, `list-ordered`, `list-check`, `codeBlock`, `align-left`,
`align-center`, `align-right`, `align-justify`, `outdent`, `indent`, `table`, `image`, `divider`,
`comment`, `clear`, `find`, `|`.

### `features` flags

All default to `true`; set one to `false` to remove the feature, its toolbar buttons, menu items,
shortcuts and Markdown shortcuts.

| Flag | Turns on |
| --- | --- |
| `lists` | bulleted, numbered and to-do lists |
| `code` | code blocks |
| `tables` | tables and table tools |
| `layout` | callouts, toggles, columns |
| `media` | images, files, embeds |
| `equation` | block and inline LaTeX |
| `mentions` | the `@` mention node (the menu also needs `mentions.search`) |
| `hashtag` | automatic `#tag` styling |
| `emoji` | `:` emoji menu and `:code:` replacement |
| `markdownShortcuts` | typed Markdown shortcuts |
| `autolink` | typed URLs / e-mail addresses become links |
| `pages` | multi-page documents, page breaks, page tabs |
| `comments` | comment anchors and the Comment button (also needs `createComments`) |
| `suggestions` | track-changes marks (also needs `createSuggestions`) |
| `database` | databases |
| `notion` | table of contents, bookmarks, `[[` page links, dates, template buttons, toggle headings, synced copies |

### Other options

| Option | Effect |
| --- | --- |
| `content` | Initial document (JSON) |
| `readOnly`, `setReadOnly()` | Read-only mode |
| `mode`, `setMode()` | Classic / Blocks |
| `pageView` | `'tabs'` (one page at a time, default) or `'paged'` (all pages) |
| `upload`, `uploadOptions` (`maxSize`, `accept`) | Enables uploads for images / files / paste / drop |
| `autosave` | Saving, status, drafts |
| `characterLimit` | Maximum characters |
| `linkPreview` | Bookmark card details |
| `renderMath` | Equation rendering |
| `mentions` | `{ search, trigger }` for the `@` menu |
| `theme`, `unstyled`, `icons`, `labels`, `maxHeight` | Look and text |
| `extensions` | Add your own blocks, marks, shortcuts, menu items ([extensions.md](./extensions.md)); e.g. `codeHighlightExtension()` from `@z-packages/zeditor/code-highlight` |
| `onChange`, `onSelectionChange`, `onReady` | Callbacks |

---

## 15. Known limitations

Behaviour that can be surprising, verified against the current code:

- **Calculations show only in table views** (the footer row), and are set from the table column
  header.
- **Timeline: resizing a bar by its right end needs an End date property** chosen in the view
  menu. Without one, the resize grip is not shown and dragging moves the bar instead.
- **The Comment button needs app setup.** It is shown whenever the `comments` feature is on (the
  default); until the app calls `createComments` and shows a review panel (or listens to
  `ui:comment`), pressing it shows "Comments are not available in this editor". Apps that do not
  use comments should set `features: { comments: false }`.
- **Files need an upload handler.** Without the app's `upload` function, dropped or pasted files
  are not added; a message says so, and the image / file buttons ask for a link instead.
- **No built-in mode switch, import / export buttons, version list or draft-recovery prompt** —
  these are API calls for the host app.
- **Small built-in emoji list** (about 50); apps can replace it.
- Not implemented (see [databases.md](./databases.md#not-implemented)): nested filter groups,
  two-way relations, relations across documents, linked databases, week / year calendars, two-way
  synced blocks, page icons and covers.
