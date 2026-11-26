// zeditor documentation site: theme, mobile navigation, copy buttons, table of contents, search.
(() => {
  const root = document.documentElement;
  const base = root.dataset.base || './';

  // ---- theme (the initial value is set inline in <head> to avoid a flash) ----
  document.querySelectorAll('[data-theme-toggle]').forEach((b) =>
    b.addEventListener('click', () => {
      const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
      root.dataset.theme = next;
      try { localStorage.setItem('zdocs-theme', next); } catch {}
      document.dispatchEvent(new CustomEvent('zdocs:theme', { detail: next }));
    }),
  );

  // ---- mobile navigation ----
  const menu = document.querySelector('[data-menu-toggle]');
  if (menu) {
    menu.addEventListener('click', () => {
      const open = document.body.classList.toggle('nav-open');
      menu.setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('click', (e) => {
      if (document.body.classList.contains('nav-open') && !e.target.closest('.sidebar, [data-menu-toggle]')) {
        document.body.classList.remove('nav-open');
        menu.setAttribute('aria-expanded', 'false');
      }
    });
  }
  document.querySelector('.sidebar [aria-current="page"]')?.scrollIntoView({ block: 'center' });

  // ---- copy buttons ----
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('.copy');
    if (!btn) return;
    const text = btn.dataset.text ?? btn.closest('.code')?.querySelector('pre')?.innerText ?? '';
    try {
      await navigator.clipboard.writeText(text);
      btn.textContent = 'Copied';
      btn.classList.add('done');
    } catch {
      btn.textContent = 'Press Ctrl+C';
    }
    setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('done'); }, 1600);
  });

  // ---- table of contents: highlight the section in view ----
  const tocLinks = [...document.querySelectorAll('.toc a')];
  if (tocLinks.length && 'IntersectionObserver' in window) {
    const byId = new Map(tocLinks.map((a) => [decodeURIComponent(a.hash.slice(1)), a]));
    const heads = [...byId.keys()].map((id) => document.getElementById(id)).filter(Boolean);
    const visible = new Set();
    const io = new IntersectionObserver((entries) => {
      for (const en of entries) en.isIntersecting ? visible.add(en.target) : visible.delete(en.target);
      let current = heads.find((h) => visible.has(h));
      if (!current) current = [...heads].reverse().find((h) => h.getBoundingClientRect().top < 120);
      tocLinks.forEach((a) => a.classList.remove('active'));
      const link = current && byId.get(current.id);
      if (link) {
        link.classList.add('active');
        const toc = link.closest('.toc');
        const r = link.getBoundingClientRect(), t = toc.getBoundingClientRect();
        if (r.top < t.top + 40 || r.bottom > t.bottom - 40) toc.scrollTop += r.top - t.top - t.height / 3;
      }
    }, { rootMargin: '-60px 0px -60% 0px' });
    heads.forEach((h) => io.observe(h));
  }

  // ---- tabs (landing page quick start) ----
  document.querySelectorAll('[role=tablist]').forEach((list) => {
    const tabs = [...list.querySelectorAll('[role=tab]')];
    const select = (tab) => {
      tabs.forEach((t) => {
        const on = t === tab;
        t.setAttribute('aria-selected', String(on));
        t.tabIndex = on ? 0 : -1;
        document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
      });
    };
    tabs.forEach((t, i) => {
      t.addEventListener('click', () => select(t));
      t.addEventListener('keydown', (e) => {
        const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (!d) return;
        const n = tabs[(i + d + tabs.length) % tabs.length];
        select(n);
        n.focus();
      });
    });
  });

  // ---- search ----
  const dialog = document.getElementById('search');
  if (!dialog) return;
  const input = dialog.querySelector('input');
  const list = dialog.querySelector('.search-results');
  let index = null;
  let sel = 0;
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const load = () => (index ??= fetch(base + 'search.json').then((r) => r.json()).catch(() => []));
  const open = () => {
    load();
    if (!dialog.open) dialog.showModal();
    input.select();
    render();
  };
  document.querySelectorAll('[data-search-open]').forEach((b) => b.addEventListener('click', open));
  document.addEventListener('keydown', (e) => {
    if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !e.target.closest('input, textarea, [contenteditable]'))) {
      e.preventDefault();
      open();
    }
  });
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });

  const highlight = (text, terms) => {
    let out = esc(text);
    for (const t of terms) out = out.replace(new RegExp('(' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi'), '<mark>$1</mark>');
    return out;
  };
  const snippet = (text, terms) => {
    const lower = text.toLowerCase();
    const at = Math.min(...terms.map((t) => { const i = lower.indexOf(t); return i < 0 ? Infinity : i; }));
    if (!isFinite(at) || at < 60) return text.slice(0, 180);
    return '…' + text.slice(at - 50, at + 130);
  };
  async function render() {
    const q = input.value.trim().toLowerCase();
    if (!q) {
      list.innerHTML = '<li class="search-empty">Search the guides, commands and API reference.</li>';
      return;
    }
    const data = await load();
    const terms = q.split(/\s+/).filter(Boolean);
    const scored = [];
    for (const it of data) {
      const h = it.h.toLowerCase(), p = it.p.toLowerCase(), x = it.x.toLowerCase();
      let score = 0;
      let all = true;
      for (const t of terms) {
        let s = 0;
        if (h === t) s += 30;
        if (h.startsWith(t)) s += 12;
        if (h.includes(t)) s += 10;
        if (p.includes(t)) s += 3;
        if (x.includes(t)) s += 2;
        if (!s) { all = false; break; }
        score += s;
      }
      if (all) scored.push([score - it.d * 0.5, it]);
    }
    scored.sort((a, b) => b[0] - a[0]);
    const top = scored.slice(0, 40);
    sel = 0;
    list.innerHTML = top.length
      ? top.map(([, it], i) => `<li><a href="${base}${it.u}" class="${i === 0 ? 'sel' : ''}"><div class="r-page">${esc(it.p)}</div><div class="r-head">${highlight(it.h, terms)}</div>${it.x ? `<div class="r-text">${highlight(snippet(it.x, terms), terms)}</div>` : ''}</a></li>`).join('')
      : `<li class="search-empty">No results for “${esc(input.value)}”</li>`;
  }
  input.addEventListener('input', render);
  input.addEventListener('keydown', (e) => {
    const links = [...list.querySelectorAll('a')];
    if (!links.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      links[sel]?.classList.remove('sel');
      sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + links.length) % links.length;
      links[sel].classList.add('sel');
      links[sel].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      links[sel].click();
      dialog.close();
    }
  });
  list.addEventListener('click', (e) => { if (e.target.closest('a')) dialog.close(); });
})();
