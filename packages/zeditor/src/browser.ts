/**
 * Single-file browser module (`dist/zeditor.browser.js`) for pages without a build step.
 * Includes the editor, default UI and syntax highlighting. Collaboration and the framework
 * adapters are separate modules.
 */
export * from './index';
export { codeHighlightExtension, tokenize } from './code-highlight';
