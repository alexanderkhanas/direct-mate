import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { appBundlePath } from './ext-apps';

/** What `try_agent` hands the preview, as the tool result's structured content. */
export interface ChatPreview {
  store: string;
  messages: Array<{ role: 'customer' | 'bot'; text: string; images: string[] }>;
  handedToManager: boolean;
}

let cached: string | null = null;
let cachedUri: string | null = null;

/**
 * The page's address carries a hash of its content. Claude keeps its own copy
 * of an app's page by address, even across reconnecting the connector, so a
 * changed page needs a new address to be picked up.
 */
export function chatPreviewUri(): string {
  if (!cachedUri) {
    const hash = createHash('sha256').update(chatPreviewHtml()).digest('hex').slice(0, 12);
    cachedUri = `ui://directmate/chat-preview-${hash}.html`;
  }
  return cachedUri;
}

/**
 * The test conversation drawn the way the customer sees it in Instagram
 * Direct, shown inside Claude next to `try_agent`'s result. One HTML file
 * with everything inline: the host renders it in a sandbox with no network
 * access except the image hosts the resource declares.
 *
 * Everything in the conversation is untrusted text, so it is only ever put
 * on the page with `textContent`, and an image only when its address is
 * http(s).
 */
export function chatPreviewHtml(): string {
  if (cached) return cached;
  // The bundle is an ES module ending in `export{…,xx as App}`. Inlined, the
  // export means nothing, so the class is picked up by its local name.
  const bundle = readFileSync(appBundlePath(), 'utf8');
  const local = /([\w$]+) as App[,}]/.exec(bundle)?.[1];
  if (!local) throw new Error('MCP Apps bundle: the App export was not found');
  const lib = `${bundle}\n;globalThis.__dmApp = ${local};`.replace(/<\/script/gi, '<\\/script');
  cached = PAGE.replace('/*__LIB__*/', () => lib);
  return cached;
}

const PAGE = `<!doctype html>
<html lang="uk">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>DirectMate</title>
<style>
  :root {
    --bg: #ffffff; --ink: #0f1419; --muted: #6b7280; --line: #e5e7eb;
    --them: #efefef; --them-ink: #0f1419; --me: #3797f0; --me-ink: #ffffff; --note: #6b7280;
  }
  :root[data-theme="dark"] {
    --bg: #121212; --ink: #f5f5f5; --muted: #a8a8a8; --line: #2a2a2a;
    --them: #262626; --them-ink: #f5f5f5; --me: #3797f0; --me-ink: #ffffff; --note: #a8a8a8;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; background: transparent; }
  body { font: 15px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: var(--ink); }
  /* At most 520px tall: the conversation scrolls inside, opened at the newest message like Direct. */
  .phone { display: flex; flex-direction: column; max-width: 420px; max-height: 520px; margin: 0 auto; background: var(--bg);
           border: 1px solid var(--line); border-radius: 18px; overflow: hidden; }
  .head { flex: none; display: flex; align-items: center; gap: 10px; padding: 12px 14px; border-bottom: 1px solid var(--line); }
  .avatar { width: 36px; height: 36px; border-radius: 50%; flex: none; display: grid; place-items: center; color: #fff; font-weight: 600;
            background: linear-gradient(45deg, #f9ce34, #ee2a7b 50%, #6228d7); }
  .name { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sub { font-size: 12px; color: var(--muted); }
  .chat { flex: 1 1 auto; min-height: 0; overflow-y: auto; scrollbar-width: thin;
          display: flex; flex-direction: column; gap: 4px; padding: 14px; }
  .row { display: flex; flex-direction: column; max-width: 78%; }
  .row.customer { align-self: flex-end; align-items: flex-end; }
  .row.bot { align-self: flex-start; align-items: flex-start; }
  .row + .row.turn { margin-top: 8px; }
  .bubble { padding: 8px 12px; border-radius: 18px; white-space: pre-wrap; overflow-wrap: anywhere; }
  .customer .bubble { background: var(--me); color: var(--me-ink); }
  .bot .bubble { background: var(--them); color: var(--them-ink); }
  /* Compact photos: one at 160px, several as square thumbnails in one row. Sizes are fixed
     before the pictures load, so the scroll position doesn't jump. */
  .photos { display: grid; gap: 4px; margin-bottom: 3px; }
  .photos img { display: block; width: 100%; object-fit: cover; background: var(--them); }
  .photos.one img { width: 160px; max-width: 100%; aspect-ratio: 4 / 5; border-radius: 16px; }
  .photos.many { grid-template-columns: repeat(var(--n), minmax(0, 96px)); }
  .photos.many img { aspect-ratio: 1; border-radius: 12px; }
  .note { align-self: center; margin-top: 10px; font-size: 12px; color: var(--note); text-align: center; }
  .empty { padding: 28px 14px; text-align: center; color: var(--muted); }
</style>
</head>
<body>
<div class="phone">
  <div class="head">
    <div class="avatar" id="avatar"></div>
    <div style="min-width:0">
      <div class="name" id="name">DirectMate</div>
      <div class="sub">AI-агент · тестовий чат</div>
    </div>
  </div>
  <div class="chat" id="chat"><div class="empty">Чекаю на відповідь AI-агента…</div></div>
</div>
<script type="module">
/*__LIB__*/
{
  const App = globalThis.__dmApp;
  const chat = document.getElementById('chat');
  const el = (tag, cls) => { const n = document.createElement(tag); if (cls) n.className = cls; return n; };
  const isHttp = (u) => { try { return ['http:', 'https:'].includes(new URL(u).protocol); } catch { return false; } };

  // Opened at the newest message; kept there while pictures load or the width
  // changes, unless the owner has scrolled up to read.
  let pinned = true;
  const toBottom = () => { chat.scrollTop = chat.scrollHeight; };
  const keepPinned = () => { if (pinned) toBottom(); };
  chat.addEventListener('scroll', () => { pinned = chat.scrollHeight - chat.scrollTop - chat.clientHeight < 48; });
  window.addEventListener('resize', keepPinned);
  // The host may draw the card while it is still hidden (no layout, no
  // animation frames): scroll down once the chat gets a size.
  if (typeof ResizeObserver === 'function') new ResizeObserver(keepPinned).observe(chat);

  function render(preview) {
    if (!preview || !Array.isArray(preview.messages)) return;
    const store = typeof preview.store === 'string' && preview.store ? preview.store : 'DirectMate';
    document.getElementById('name').textContent = store;
    document.getElementById('avatar').textContent = store.trim().charAt(0).toUpperCase();
    chat.replaceChildren();
    let last = null;
    for (const m of preview.messages) {
      const role = m.role === 'customer' ? 'customer' : 'bot';
      const row = el('div', 'row ' + role + (last && last !== role ? ' turn' : ''));
      const images = (Array.isArray(m.images) ? m.images : []).filter(isHttp).slice(0, 4);
      if (images.length) {
        const photos = el('div', 'photos ' + (images.length > 1 ? 'many' : 'one'));
        photos.style.setProperty('--n', String(images.length));
        for (const src of images) {
          const img = el('img');
          img.alt = '';
          img.loading = 'lazy';
          img.referrerPolicy = 'no-referrer';
          img.addEventListener('load', keepPinned);
          img.addEventListener('error', () => { img.remove(); keepPinned(); });
          img.src = src;
          photos.append(img);
        }
        row.append(photos);
      }
      if (typeof m.text === 'string' && m.text.trim()) {
        const bubble = el('div', 'bubble');
        bubble.textContent = m.text;
        row.append(bubble);
      }
      if (row.childNodes.length) { chat.append(row); last = role; }
    }
    if (!chat.childNodes.length) {
      const empty = el('div', 'empty');
      empty.textContent = 'AI-агент не відповів на це повідомлення.';
      chat.append(empty);
    }
    if (preview.handedToManager) {
      const note = el('div', 'note');
      note.textContent = 'Розмову передано менеджеру';
      chat.append(note);
    }
    pinned = true;
    toBottom();
    requestAnimationFrame(toBottom);
  }

  const theme = (ctx) => { if (ctx && ctx.theme) document.documentElement.dataset.theme = ctx.theme; };
  const app = new App({ name: 'DirectMate chat preview', version: '1.0.0' });
  app.ontoolresult = (result) => render(result && result.structuredContent);
  app.onhostcontextchanged = (ctx) => theme(ctx);
  app.connect().then(() => theme(app.getHostContext())).catch(() => {});
}
</script>
</body>
</html>`;
