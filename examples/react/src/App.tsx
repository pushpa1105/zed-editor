import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ZEditor, useEditorState, type ZEditorInstance, type InlineViewProps } from '@buffmomo/zeditor/react';
import type { Extension } from '@buffmomo/zeditor';
import { issueRefExtension, calloutExtension, DEMO_ISSUES, SHARED_DOCUMENT } from '../../shared/extensions.js';

/** Pretend backend: answers after a delay and honours cancellation. */
function searchIssues(query: string, { signal }: { signal: AbortSignal }) {
  return new Promise<typeof DEMO_ISSUES>((resolve, reject) => {
    const q = query.toLowerCase();
    // shorter queries answer slower, so a stale answer can arrive after a newer one
    const timer = setTimeout(() => resolve(DEMO_ISSUES.filter((i) => i.key.toLowerCase().includes(q) || i.title.toLowerCase().includes(q))), 400 - Math.min(300, query.length * 100));
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('aborted', 'AbortError'));
    });
  });
}

/** Host rendering for the shared `issue` node: a React component instead of the default DOM. */
function IssueChip({ atom }: InlineViewProps) {
  const done = atom.attrs?.status === 'done';
  return (
    <span className="issue-chip" data-status={atom.attrs?.status} title={atom.attrs?.title} style={{ background: done ? '#dcfce7' : '#fef3c7', color: done ? '#166534' : '#92400e', borderRadius: 6, padding: '1px 6px', fontWeight: 600, fontSize: '0.85em' }}>
      {done ? '✓ ' : '● '}
      {atom.attrs?.key}
    </span>
  );
}

/** A small custom control built only from public state and commands. */
function Summary({ instance }: { instance: ZEditorInstance | null }) {
  const revision = useEditorState(instance, (s) => s.revision);
  const blockType = useEditorState(instance, (s) => s.blockType);
  const bold = useEditorState(instance, (s) => !!s.marks.bold);
  return (
    <p data-testid="summary" style={{ color: '#4b5563', fontSize: 14 }}>
      revision {revision} · block: {blockType ?? '–'} ·{' '}
      <button type="button" aria-pressed={bold} onMouseDown={(e) => e.preventDefault()} onClick={() => instance?.commands.toggleMark('bold')}>
        Bold (custom React button)
      </button>
    </p>
  );
}

const KEY = 'zeditor-react-example';

export function App() {
  const ref = useRef<ZEditorInstance | null>(null);
  const [instance, setInstance] = useState<ZEditorInstance | null>(null);
  const [mode, setMode] = useState<'classic' | 'block'>('block');
  const [renders, setRenders] = useState(0);
  // a stable ref callback: an inline one would be re-invoked (null, then instance) on every render
  const attach = useCallback((z: ZEditorInstance | null) => {
    ref.current = z;
    setInstance(z);
    (window as any).__z = z; // handy in the console
  }, []);
  // extensions are created once; re-rendering <App> must not rebuild the editor
  const extensions = useMemo<Extension[]>(() => [issueRefExtension({ search: searchIssues }), calloutExtension()], []);
  const initial = useMemo(() => {
    const saved = localStorage.getItem(KEY);
    return saved ? JSON.parse(saved) : SHARED_DOCUMENT;
  }, []);

  return (
    <main style={{ maxWidth: 860, margin: '24px auto', padding: '0 16px', fontFamily: 'system-ui, sans-serif' }}>
      <h1>zeditor — React</h1>
      <div role="group" aria-label="Editor controls" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <button onClick={() => setMode(mode === 'block' ? 'classic' : 'block')}>Mode: {mode}</button>
        <button onClick={() => localStorage.setItem(KEY, JSON.stringify(ref.current?.getJSON()))}>Save</button>
        <button onClick={() => ref.current?.setJSON(JSON.parse(localStorage.getItem(KEY) ?? 'null') ?? SHARED_DOCUMENT)}>Reload saved</button>
        <button onClick={() => ref.current?.setJSON(SHARED_DOCUMENT)}>Load shared document</button>
        <button onClick={() => setRenders((n) => n + 1)}>Re-render parent ({renders})</button>
      </div>
      <ZEditor
        ref={attach}
        content={initial}
        mode={mode}
        extensions={extensions}
        inlineViews={{ issue: IssueChip }}
        ui={{ statusBar: true }}
        placeholder="Type # to reference an issue…"
      >
        <Summary instance={instance} />
      </ZEditor>
    </main>
  );
}
