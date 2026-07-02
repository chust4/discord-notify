// Small DOM + UX helpers shared by all views.

export function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function toast(message, type = 'info', timeout = 3500) {
  const el = h(`<div class="toast ${type}">${esc(message)}</div>`);
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity .3s';
    setTimeout(() => el.remove(), 300);
  }, timeout);
}

export function modal({ title, bodyHtml, confirmText = 'Zapisz', onConfirm, confirmClass = 'btn' }) {
  const root = document.getElementById('modal-root');
  const backdrop = h(`
    <div class="modal-backdrop">
      <div class="modal">
        <h3>${esc(title)}</h3>
        <div class="modal-body">${bodyHtml}</div>
        <div class="modal-actions">
          <button class="btn btn-ghost" data-act="cancel">Anuluj</button>
          <button class="${confirmClass}" data-act="confirm">${esc(confirmText)}</button>
        </div>
      </div>
    </div>`);
  root.appendChild(backdrop);

  const close = () => backdrop.remove();
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });
  backdrop.querySelector('[data-act="cancel"]').onclick = close;
  backdrop.querySelector('[data-act="confirm"]').onclick = async () => {
    const btn = backdrop.querySelector('[data-act="confirm"]');
    btn.disabled = true;
    try {
      const ok = await onConfirm(backdrop);
      if (ok !== false) close();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  };
  return { close, el: backdrop };
}

export function confirmDialog(title, message, confirmText = 'Usuń') {
  return new Promise((resolve) => {
    const m = modal({
      title,
      bodyHtml: `<p class="muted">${esc(message)}</p>`,
      confirmText,
      confirmClass: 'btn btn-danger',
      onConfirm: () => {
        resolve(true);
        return true;
      },
    });
    m.el.querySelector('[data-act="cancel"]').addEventListener('click', () => resolve(false));
    m.el.addEventListener('click', (e) => {
      if (e.target === m.el) resolve(false);
    });
  });
}

export function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' });
}

export function fmtUptime(seconds) {
  if (!seconds) return '0s';
  const d = Math.floor(seconds / 86400);
  const hh = Math.floor((seconds % 86400) / 3600);
  const mm = Math.floor((seconds % 3600) / 60);
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (hh) parts.push(`${hh}h`);
  parts.push(`${mm}m`);
  return parts.join(' ');
}

export const PLATFORM_ICON = {
  youtube: '▶️',
  tiktok: '🎵',
  twitch: '🎮',
  kick: '🥊',
  instagram: '📸',
};

export function avatarHtml(url, name, cls = '') {
  if (url) {
    return `<img class="avatar ${cls}" src="${esc(url)}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'avatar ${cls}',textContent:'${esc(
      (name || '?')[0].toUpperCase()
    )}'}))" />`;
  }
  const letter = (name || '?').trim()[0]?.toUpperCase() || '?';
  return `<div class="avatar ${cls}">${esc(letter)}</div>`;
}

/**
 * Avatar routed through the server-side proxy/cache (`/api/avatar/<kind>/<id>`)
 * so expired/hotlink-blocked social CDN URLs still render. Falls back to a
 * letter placeholder when there is no avatar or the proxy 404s.
 */
export function avatarProxyHtml(kind, id, hasAvatar, name, cls = '') {
  if (!hasAvatar) return avatarHtml(null, name, cls);
  return avatarHtml(`/api/avatar/${kind}/${id}`, name, cls);
}
