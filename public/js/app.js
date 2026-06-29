import { api } from './api.js';
import {
  h, esc, toast, modal, confirmDialog, fmtDate, fmtUptime, avatarHtml, PLATFORM_ICON,
} from './ui.js';

const view = document.getElementById('view');
let META = null;

/* ----------------------------------------------------------------- routing */
const routes = {
  dashboard: renderDashboard,
  profile: renderProfile,
  servers: renderServers,
  logs: renderLogs,
  diagnostics: renderDiagnostics,
  settings: renderSettingsPage,
};

function parseHash() {
  const hash = location.hash.replace(/^#\/?/, '');
  const parts = hash.split('/').filter(Boolean);
  if (parts.length === 0) return { name: 'dashboard', params: {} };
  if (parts[0] === 'profiles' && parts[1]) return { name: 'profile', params: { id: parts[1] } };
  if (routes[parts[0]]) return { name: parts[0], params: {} };
  return { name: 'dashboard', params: {} };
}

const TITLES = {
  dashboard: 'Dashboard',
  profile: 'Profil',
  servers: 'Serwery Discord',
  logs: 'Logi / Historia',
  diagnostics: 'Diagnostyka',
  settings: 'Ustawienia',
};

async function router() {
  const { name, params } = parseHash();
  document.getElementById('page-title').textContent = TITLES[name] || 'Discord Notify';
  document.querySelectorAll('.nav a').forEach((a) => {
    a.classList.toggle('active', a.dataset.route === name);
  });
  document.querySelector('.sidebar')?.classList.remove('open');
  view.innerHTML = '<div class="loading"><span class="spin">⏳</span> Ładowanie…</div>';
  try {
    if (!META) META = await api.meta();
    document.getElementById('brand-version').textContent = 'v' + META.app.version;
    await routes[name](params);
  } catch (err) {
    view.innerHTML = `<div class="empty-state"><div class="big">⚠️</div><p>${esc(err.message)}</p></div>`;
  }
}

window.addEventListener('hashchange', router);

/* -------------------------------------------------------------- dashboard */
async function renderDashboard() {
  const [profiles, diag] = await Promise.all([api.profiles(), api.diagnostics().catch(() => null)]);

  const stats = diag
    ? `<div class="stats-grid" style="margin-bottom:24px">
        ${stat('Profile', diag.counts.profiles)}
        ${stat('Serwery', diag.counts.guilds)}
        ${stat('Autoryzowane', diag.counts.authorizedGuilds)}
        ${stat('Bot', diag.bot.online ? '🟢 online' : '🔴 offline')}
       </div>`
    : '';

  const cards = profiles.length
    ? `<div class="cards-grid">${profiles.map(profileCardHtml).join('')}</div>`
    : `<div class="empty-state"><div class="big">📭</div>
        <p>Brak profili. Dodaj pierwszego twórcę, aby zacząć śledzić jego kanały.</p></div>`;

  view.innerHTML = `
    <div class="page-head">
      <div><h2 style="margin:0">Profile twórców</h2><p class="faint" style="margin:4px 0 0">Kliknij kartę, aby otworzyć ustawienia</p></div>
      <button class="btn" id="add-profile">➕ Dodaj profil</button>
    </div>
    ${stats}
    ${cards}`;

  document.getElementById('add-profile').onclick = addProfileDialog;
  view.querySelectorAll('[data-profile-id]').forEach((el) => {
    el.onclick = () => (location.hash = `#/profiles/${el.dataset.profileId}`);
  });
}

function stat(key, value) {
  return `<div class="stat"><div class="value">${esc(value)}</div><div class="key">${esc(key)}</div></div>`;
}

function profileCardHtml(p) {
  const integrations = p.integrations.length
    ? p.integrations
        .map(
          (i) => `<span class="chip ${i.platform}">${PLATFORM_ICON[i.platform] || ''} ${esc(i.label)}
            ${i.is_live ? '<span class="live-dot"></span>' : ''}</span>`
        )
        .join('')
    : '<span class="faint">Brak integracji</span>';

  return `
    <div class="card profile-card" data-profile-id="${p.id}">
      <div class="profile-card-head">
        ${avatarHtml(p.avatar_url, p.name)}
        <div style="min-width:0">
          <div class="profile-card-name">${esc(p.name)}</div>
          <div class="profile-card-meta">${p.enabled ? '🟢 Aktywny' : '⚪ Wyłączony'}</div>
        </div>
      </div>
      <div class="integrations">${integrations}</div>
      <div class="event-line">
        <div>🕒 Ostatnie zdarzenie: ${p.last_event_type ? `${esc(p.last_event_type)} · ${fmtDate(p.last_event_at)}` : '—'}</div>
        ${p.last_error ? `<div class="error-text">⚠️ ${esc(p.last_error)} · ${fmtDate(p.last_error_at)}</div>` : ''}
      </div>
    </div>`;
}

// Small at-a-glance tiles on each profile card: delivered notifications per
// platform (only platforms the profile actually has) + totals.
function statTilesHtml(p) {
  const stats = p.stats || { sentByPlatform: {}, totalSent: 0, detected: 0, failed: 0 };
  const platformTiles = (p.integrations || [])
    .map((i) => {
      const n = stats.sentByPlatform?.[i.platform] || 0;
      return `<div class="mini-tile ${i.platform}">
        <div class="mini-val">${n}</div>
        <div class="mini-key">${PLATFORM_ICON[i.platform] || ''} ${esc(i.label || i.platform)}</div>
      </div>`;
    })
    .join('');
  return `
    <div class="mini-tiles">
      ${platformTiles}
      <div class="mini-tile total">
        <div class="mini-val">${stats.totalSent || 0}</div>
        <div class="mini-key">📨 Łącznie</div>
      </div>
      <div class="mini-tile">
        <div class="mini-val">${stats.detected || 0}</div>
        <div class="mini-key">👁️ Wykryte</div>
      </div>
      ${stats.failed
        ? `<div class="mini-tile fail"><div class="mini-val">${stats.failed}</div><div class="mini-key">⚠️ Błędy</div></div>`
        : ''}
    </div>`;
}

function addProfileDialog() {
  modal({
    title: 'Nowy profil',
    bodyHtml: `
      <label class="field"><span>Nazwa twórcy</span>
        <input type="text" id="np-name" placeholder="np. Mój Ulubiony Streamer" /></label>
      <label class="field"><span>Notatka (opcjonalnie)</span>
        <input type="text" id="np-notes" placeholder="" /></label>`,
    confirmText: 'Utwórz',
    onConfirm: async (el) => {
      const name = el.querySelector('#np-name').value.trim();
      if (!name) { toast('Podaj nazwę', 'warn'); return false; }
      const p = await api.createProfile({ name, notes: el.querySelector('#np-notes').value.trim() });
      toast('Profil utworzony', 'success');
      location.hash = `#/profiles/${p.id}`;
    },
  });
}

/* ---------------------------------------------------------------- profile */
async function renderProfile({ id }) {
  const [profile, guilds] = await Promise.all([api.profile(id), api.guilds()]);

  view.innerHTML = `
    <a class="back-link" href="#/">← Wróć do dashboardu</a>
    <div class="page-head">
      <div class="row">
        ${avatarHtml(profile.avatar_url, profile.name, 'lg')}
        <div>
          <h2 style="margin:0">${esc(profile.name)}</h2>
          ${profile.notes ? `<p class="faint" style="margin:4px 0 0">${esc(profile.notes)}</p>` : ''}
        </div>
      </div>
      <div class="row">
        <div class="row" style="gap:8px"><span class="faint">Aktywny</span>
          <label class="switch"><input type="checkbox" id="prof-enabled" ${profile.enabled ? 'checked' : ''}><span class="slider"></span></label>
        </div>
        <button class="btn btn-danger btn-sm" id="del-profile">🗑️ Usuń</button>
      </div>
    </div>

    <div class="section-title" style="margin-top:0">📊 Statystyki powiadomień</div>
    ${statTilesHtml(profile)}

    <div class="section-title">🔗 Połączone konta</div>
    <div id="accounts" class="stack"></div>

    <div class="section-title">🔔 Powiadomienia per serwer</div>
    <div class="card">
      <label class="field" style="margin:0">
        <span>Wybierz serwer Discord</span>
        <select id="guild-select">
          <option value="">— wybierz serwer —</option>
          ${guilds.map((g) => `<option value="${g.guild_id}">${esc(g.name || g.guild_id)} ${g.authorized ? '' : '(nieautoryzowany)'}</option>`).join('')}
        </select>
      </label>
    </div>
    <div id="settings-area" style="margin-top:16px"></div>`;

  document.getElementById('prof-enabled').onchange = async (e) => {
    await api.updateProfile(id, { enabled: e.target.checked });
    toast('Zapisano', 'success');
  };
  document.getElementById('del-profile').onclick = async () => {
    if (await confirmDialog('Usuń profil', `Na pewno usunąć „${profile.name}”? Tej operacji nie można cofnąć.`)) {
      await api.deleteProfile(id);
      toast('Profil usunięty', 'success');
      location.hash = '#/';
    }
  };

  renderAccounts(profile);

  const guildSelect = document.getElementById('guild-select');
  const lsKey = `dn:lastGuild:${id}`;
  guildSelect.onchange = () => {
    if (guildSelect.value) localStorage.setItem(lsKey, guildSelect.value);
    else localStorage.removeItem(lsKey);
    renderSettings(id, guildSelect.value);
  };

  // Re-select the previously chosen server (survives page refresh), else
  // auto-select when there is exactly one authorized server.
  const remembered = localStorage.getItem(lsKey);
  const authorized = guilds.filter((g) => g.authorized);
  let preselect = null;
  if (remembered && guilds.some((g) => g.guild_id === remembered)) preselect = remembered;
  else if (authorized.length === 1) preselect = authorized[0].guild_id;
  if (preselect) {
    guildSelect.value = preselect;
    renderSettings(id, preselect);
  }
}

function renderAccounts(profile) {
  const container = document.getElementById('accounts');
  const linked = new Set(profile.accounts.map((a) => a.platform));

  const accountRows = profile.accounts
    .map(
      (a) => `
      <div class="card" style="display:flex;align-items:center;gap:12px">
        <a href="${esc(a.input_url || '#')}" target="_blank" rel="noopener" title="Otwórz ${esc(a.platform)}">${avatarHtml(a.avatar_url, a.display_name)}</a>
        <div style="flex:1;min-width:0">
          <a href="${esc(a.input_url || '#')}" target="_blank" rel="noopener" class="account-link" title="Otwórz profil ${esc(a.platform)}">
            <span style="font-weight:600">${PLATFORM_ICON[a.platform]} ${esc(a.display_name || a.identifier)}</span> ↗
          </a>
          <div class="faint" style="word-break:break-all">${esc(a.input_url || a.identifier)}</div>
          ${a.last_error ? `<div class="error-text" style="font-size:12px">⚠️ ${esc(a.last_error)}</div>` : ''}
        </div>
        <button class="btn btn-ghost btn-sm" data-refresh="${a.id}" title="Odśwież avatar/nazwę">🔄</button>
        <button class="btn btn-danger btn-sm" data-del-acc="${a.id}">✕</button>
      </div>`
    )
    .join('');

  const addButtons = META.platforms
    .filter((p) => !linked.has(p.key))
    .map((p) => `<button class="btn btn-ghost btn-sm" data-add-platform="${p.key}">${PLATFORM_ICON[p.key]} + ${esc(p.label)}</button>`)
    .join('');

  container.innerHTML = `
    ${accountRows || '<p class="faint">Brak połączonych kont.</p>'}
    <div class="row">${addButtons || '<span class="faint">Wszystkie platformy połączone.</span>'}</div>`;

  container.querySelectorAll('[data-add-platform]').forEach((btn) => {
    btn.onclick = () => addAccountDialog(profile.id, btn.dataset.addPlatform);
  });
  container.querySelectorAll('[data-del-acc]').forEach((btn) => {
    btn.onclick = async () => {
      if (await confirmDialog('Usuń konto', 'Odłączyć to konto od profilu?')) {
        await api.deleteAccount(btn.dataset.delAcc);
        toast('Konto odłączone', 'success');
        renderProfile({ id: String(profile.id) });
      }
    };
  });
  container.querySelectorAll('[data-refresh]').forEach((btn) => {
    btn.onclick = async () => {
      btn.innerHTML = '<span class="spin">🔄</span>';
      try {
        await api.refreshAccount(btn.dataset.refresh);
        toast('Odświeżono', 'success');
        renderProfile({ id: String(profile.id) });
      } catch (err) {
        toast(err.message, 'error');
        btn.innerHTML = '🔄';
      }
    };
  });
}

function addAccountDialog(profileId, platform) {
  const label = META.platforms.find((p) => p.key === platform)?.label || platform;
  modal({
    title: `Dodaj konto: ${label}`,
    bodyHtml: `
      <label class="field"><span>Link lub nazwa kanału</span>
        <input type="text" id="acc-input" placeholder="${esc(placeholderFor(platform))}" /></label>
      <p class="faint">Avatar i nazwa zostaną pobrane automatycznie, jeśli to możliwe.</p>`,
    confirmText: 'Dodaj',
    onConfirm: async (el) => {
      const input = el.querySelector('#acc-input').value.trim();
      if (!input) { toast('Podaj link/nazwę', 'warn'); return false; }
      el.querySelector('[data-act="confirm"]').textContent = 'Pobieram…';
      await api.addAccount(profileId, { platform, input });
      toast('Konto dodane', 'success');
      renderProfile({ id: String(profileId) });
    },
  });
}

function placeholderFor(platform) {
  return {
    youtube: 'https://youtube.com/@kanal  lub  UCxxxx  lub  @handle',
    tiktok: 'https://tiktok.com/@nazwa  lub  @nazwa',
    twitch: 'https://twitch.tv/nazwa  lub  nazwa',
    kick: 'https://kick.com/nazwa  lub  nazwa',
  }[platform] || '';
}

/* ----------------------------------------------------- notification settings */
async function renderSettings(profileId, guildId) {
  const area = document.getElementById('settings-area');
  if (!guildId) { area.innerHTML = ''; return; }
  area.innerHTML = '<div class="loading"><span class="spin">⏳</span></div>';

  const [data, channels, roles] = await Promise.all([
    api.settings(profileId, guildId),
    api.guildChannels(guildId).catch(() => []),
    api.guildRoles(guildId).catch(() => []),
  ]);

  if (!data.settings.length) {
    area.innerHTML = '<p class="faint">Najpierw dodaj konto platformy do profilu, aby pojawiły się ustawienia powiadomień.</p>';
    return;
  }
  if (data.guild && !data.guild.authorized) {
    area.insertAdjacentHTML?.('beforebegin', '');
  }

  const warn = data.guild && !data.guild.authorized
    ? `<div class="card" style="border-color:var(--yellow);margin-bottom:14px">⚠️ Ten serwer nie jest autoryzowany — powiadomienia nie będą wysyłane, dopóki nie autoryzujesz go w sekcji <a href="#/servers" style="color:var(--accent)">Serwery</a>.</div>`
    : '';

  area.innerHTML = warn + `<div class="event-settings">${data.settings.map((s) => eventRowHtml(s, channels, roles)).join('')}</div>`;

  area.querySelectorAll('.event-row').forEach((row) => wireEventRow(row, channels, roles));
}

function eventRowHtml(s, channels, roles) {
  return `
    <div class="event-row" data-setting-id="${s.id}" data-event-type="${s.event_type}">
      <div class="event-row-head">
        <label class="switch"><input type="checkbox" data-field="enabled" ${s.enabled ? 'checked' : ''}><span class="slider"></span></label>
        <span class="event-row-title">${esc(s.eventLabel || s.event_type)}</span>
        <span class="spacer"></span>
        <button class="expand-toggle" data-toggle>⚙️ ustawienia ▾</button>
      </div>
      <div class="event-row-body">
        <div class="grid-2">
          <label class="field" style="margin:0"><span>Kanał Discord</span>
            <select data-field="channel_id">
              <option value="">— wybierz kanał —</option>
              ${channels.map((c) => `<option value="${c.id}" ${s.channel_id === c.id ? 'selected' : ''}>#${esc(c.name)}</option>`).join('')}
            </select>
          </label>
          <label class="field" style="margin:0"><span>Tryb wysyłki</span>
            <select data-field="mode">
              ${META.modes.map((m) => `<option value="${m.key}" ${s.mode === m.key ? 'selected' : ''}>${esc(m.label)}</option>`).join('')}
            </select>
          </label>
        </div>
        <label class="field" style="margin:0"><span>Ping roli (opcjonalnie)</span>
          <select data-field="role_ping_id">
            <option value="">— brak —</option>
            <option value="everyone" ${s.role_ping_id === 'everyone' ? 'selected' : ''}>@everyone</option>
            <option value="here" ${s.role_ping_id === 'here' ? 'selected' : ''}>@here</option>
            ${roles.map((r) => `<option value="${r.id}" ${s.role_ping_id === r.id ? 'selected' : ''}>@${esc(r.name)}</option>`).join('')}
          </select>
        </label>
        <label class="field" style="margin:0"><span>Szablon wiadomości</span>
          <textarea data-field="template" rows="4">${esc(s.template || '')}</textarea>
        </label>
        <div class="var-chips">
          ${META.templateVariables.map((v) => `<span class="var-chip" data-var="{${v}}">{${v}}</span>`).join('')}
        </div>
        <div class="validation-msg" data-validation></div>
        <div>
          <div class="faint" style="margin-bottom:4px">Podgląd:</div>
          <div class="preview-box" data-preview>—</div>
        </div>
        <div class="row">
          <button class="btn btn-sm" data-save>💾 Zapisz</button>
          <button class="btn btn-ghost btn-sm" data-test>📨 Wyślij test na Discord</button>
        </div>
      </div>
    </div>`;
}

function wireEventRow(row, channels, roles) {
  const sid = row.dataset.settingId;
  const get = (sel) => row.querySelector(sel);
  const enabledCb = get('[data-field="enabled"]');
  const templateEl = get('[data-field="template"]');
  const previewEl = get('[data-preview]');
  const validationEl = get('[data-validation]');

  get('[data-toggle]').onclick = () => row.classList.toggle('open');

  // Toggling enabled saves immediately.
  enabledCb.onchange = async () => {
    try {
      await api.updateSetting(sid, { enabled: enabledCb.checked });
      toast(enabledCb.checked ? 'Powiadomienie włączone' : 'Powiadomienie wyłączone', 'success');
    } catch (err) { toast(err.message, 'error'); enabledCb.checked = !enabledCb.checked; }
  };

  // Insert variable chips at cursor.
  row.querySelectorAll('[data-var]').forEach((chip) => {
    chip.onclick = () => {
      const v = chip.dataset.var;
      const start = templateEl.selectionStart ?? templateEl.value.length;
      templateEl.value = templateEl.value.slice(0, start) + v + templateEl.value.slice(templateEl.selectionEnd ?? start);
      templateEl.focus();
      updatePreview();
    };
  });

  let previewTimer;
  const updatePreview = async () => {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(async () => {
      try {
        const res = await api.previewTemplate(templateEl.value);
        previewEl.textContent = res.preview || '—';
        if (res.valid) {
          validationEl.className = 'validation-msg ok';
          validationEl.textContent = '✓ Szablon poprawny';
        } else {
          validationEl.className = 'validation-msg err';
          validationEl.textContent = '✗ ' + (res.error || 'Błąd szablonu');
        }
      } catch (err) { validationEl.textContent = err.message; }
    }, 300);
  };
  templateEl.oninput = updatePreview;
  updatePreview();

  get('[data-save]').onclick = async () => {
    const body = {
      enabled: enabledCb.checked,
      channel_id: get('[data-field="channel_id"]').value || null,
      mode: get('[data-field="mode"]').value,
      role_ping_id: get('[data-field="role_ping_id"]').value || null,
      template: templateEl.value,
    };
    try {
      await api.updateSetting(sid, body);
      toast('Zapisano ustawienia', 'success');
    } catch (err) {
      toast(err.message, 'error');
      if (err.data?.unknown) {
        validationEl.className = 'validation-msg err';
        validationEl.textContent = '✗ ' + err.message;
      }
    }
  };

  get('[data-test]').onclick = async (e) => {
    const btn = e.currentTarget;
    if (!get('[data-field="channel_id"]').value) { toast('Najpierw wybierz kanał i zapisz', 'warn'); return; }
    btn.disabled = true; btn.textContent = 'Wysyłam…';
    try {
      // Save first so the test uses current settings.
      await api.updateSetting(sid, {
        channel_id: get('[data-field="channel_id"]').value || null,
        mode: get('[data-field="mode"]').value,
        role_ping_id: get('[data-field="role_ping_id"]').value || null,
        template: templateEl.value,
      });
      const res = await api.testSetting(sid);
      if (['sent', 'panel_edited'].includes(res.status)) toast('✅ Test wysłany na Discord', 'success');
      else toast('❌ ' + (res.detail || res.status), 'error', 6000);
    } catch (err) {
      toast(err.message, 'error', 6000);
    } finally {
      btn.disabled = false; btn.textContent = '📨 Wyślij test na Discord';
    }
  };
}

/* ----------------------------------------------------------------- servers */
async function renderServers() {
  const guilds = await api.guilds();
  const rows = guilds.length
    ? guilds
        .map(
          (g) => `
        <div class="card" style="display:flex;align-items:center;gap:14px">
          ${avatarHtml(g.icon_url, g.name)}
          <div style="flex:1;min-width:0">
            <div style="font-weight:600">${esc(g.name || 'Nieznany serwer')}</div>
            <div class="faint">ID: ${esc(g.guild_id)} · ${g.member_count || '?'} członków</div>
          </div>
          <div class="row" style="gap:8px">
            <span class="faint">${g.authorized ? 'Autoryzowany' : 'Zablokowany'}</span>
            <label class="switch"><input type="checkbox" data-guild="${g.guild_id}" ${g.authorized ? 'checked' : ''}><span class="slider"></span></label>
          </div>
        </div>`
        )
        .join('')
    : `<div class="empty-state"><div class="big">🖥️</div>
        <p>Bot nie jest jeszcze na żadnym serwerze.<br>Zaproś bota na serwer, a pojawi się tutaj.</p></div>`;

  view.innerHTML = `
    <div class="page-head"><div><h2 style="margin:0">Serwery Discord</h2>
      <p class="faint" style="margin:4px 0 0">Powiadomienia są wysyłane tylko na <b>autoryzowane</b> serwery.</p></div></div>
    <div class="stack">${rows}</div>`;

  view.querySelectorAll('[data-guild]').forEach((cb) => {
    cb.onchange = async () => {
      try {
        await api.setGuildAuthorized(cb.dataset.guild, cb.checked);
        toast(cb.checked ? '✅ Serwer autoryzowany' : '⛔ Serwer zablokowany', 'success');
      } catch (err) { toast(err.message, 'error'); cb.checked = !cb.checked; }
    };
  });
}

/* -------------------------------------------------------------------- logs */
async function renderLogs() {
  view.innerHTML = `
    <div class="page-head"><h2 style="margin:0">Logi / Historia zdarzeń</h2>
      <div class="row">
        <select id="log-status" style="width:auto">
          <option value="">Wszystkie statusy</option>
          <option value="sent">Wysłane</option>
          <option value="detected">Wykryte</option>
          <option value="skipped_duplicate">Duplikaty</option>
          <option value="panel_edited">Edycja panelu</option>
          <option value="api_error">Błędy API</option>
          <option value="no_permission">Brak uprawnień</option>
          <option value="send_failed">Nieudane wysyłki</option>
        </select>
        <button class="btn btn-ghost btn-sm" id="log-refresh">🔄 Odśwież</button>
      </div>
    </div>
    <div id="log-table"></div>`;

  const load = async () => {
    const status = document.getElementById('log-status').value;
    const tableEl = document.getElementById('log-table');
    tableEl.innerHTML = '<div class="loading"><span class="spin">⏳</span></div>';
    const events = await api.events({ limit: 200, ...(status ? { status } : {}) });
    if (!events.length) { tableEl.innerHTML = '<div class="empty-state"><div class="big">📜</div><p>Brak zdarzeń.</p></div>'; return; }
    tableEl.innerHTML = `
      <div class="table-wrap"><table>
        <thead><tr><th>Czas</th><th>Status</th><th>Platforma</th><th>Zdarzenie</th><th>Tytuł</th><th>Szczegóły</th></tr></thead>
        <tbody>${events.map(logRow).join('')}</tbody>
      </table></div>`;
  };

  document.getElementById('log-refresh').onclick = load;
  document.getElementById('log-status').onchange = load;
  load();
}

function logRow(e) {
  return `<tr>
    <td>${fmtDate(e.created_at)}</td>
    <td><span class="badge ${e.status}">${esc(e.status)}</span></td>
    <td>${e.platform ? `${PLATFORM_ICON[e.platform] || ''} ${esc(e.platform)}` : '—'}</td>
    <td>${esc(e.event_type || '—')}</td>
    <td style="max-width:220px;overflow:hidden;text-overflow:ellipsis">${e.url ? `<a href="${esc(e.url)}" target="_blank" style="color:var(--accent)">${esc(e.title || 'link')}</a>` : esc(e.title || '—')}</td>
    <td style="max-width:280px;white-space:normal" class="faint">${esc(e.detail || '')}</td>
  </tr>`;
}

/* ------------------------------------------------------------- diagnostics */
async function renderDiagnostics() {
  const d = await api.diagnostics();
  const perm = (b) => (b ? '🟢' : '🔴');
  view.innerHTML = `
    <div class="page-head"><h2 style="margin:0">Diagnostyka</h2>
      <button class="btn btn-ghost btn-sm" id="diag-refresh">🔄 Odśwież</button></div>

    <div class="stats-grid" style="margin-bottom:24px">
      ${stat('Status', d.app.status)}
      ${stat('Bot Discord', d.bot.online ? '🟢 online' : '🔴 offline')}
      ${stat('Serwery', d.counts.guilds)}
      ${stat('Autoryzowane', d.counts.authorizedGuilds)}
      ${stat('Profile', d.counts.profiles)}
      ${stat('Konta', d.counts.accounts)}
      ${stat('Uptime', fmtUptime(d.app.uptimeSeconds))}
      ${stat('Wersja', d.app.version)}
    </div>

    <div class="grid-2">
      <div class="card">
        <div class="section-title" style="margin-top:0">ℹ️ Aplikacja</div>
        ${kv('Nazwa', d.app.name)}
        ${kv('Node', d.app.nodeVersion)}
        ${kv('Poziom logów', d.app.logLevel)}
        ${kv('Interwał sprawdzania', d.app.pollIntervalSeconds + 's')}
        ${kv('Start', fmtDate(d.app.startedAt))}
        ${kv('Ostatnie sprawdzenie', fmtDate(d.lastCheck.at) + (d.lastCheck.durationMs ? ` (${d.lastCheck.durationMs}ms)` : ''))}
        ${d.bot.error ? `<div class="error-text">⚠️ Bot: ${esc(d.bot.error)}</div>` : ''}
      </div>
      <div class="card">
        <div class="section-title" style="margin-top:0">⚠️ Ostatnie błędy</div>
        ${d.recentErrors.length
          ? d.recentErrors.map((e) => `<div class="card-row"><span class="faint">${fmtDate(e.created_at)}</span><span class="error-text" style="text-align:right;max-width:60%">${esc(e.detail || e.status)}</span></div>`).join('')
          : '<p class="faint">Brak błędów 🎉</p>'}
      </div>
    </div>`;
  document.getElementById('diag-refresh').onclick = renderDiagnostics;
}

function kv(k, v) {
  return `<div class="card-row"><span class="label">${esc(k)}</span><span>${esc(v)}</span></div>`;
}

/* --------------------------------------------------------------- settings */
const SOURCE_BADGE = {
  panel: '<span class="chip" style="color:var(--green)">panel</span>',
  env: '<span class="chip" style="color:var(--text-dim)">zmienna .env</span>',
  none: '<span class="chip" style="color:var(--text-faint)">brak</span>',
};

async function renderSettingsPage() {
  const { fields } = await api.getConfig();
  const rows = fields
    .map((f) => {
      const status =
        f.type === 'secret'
          ? f.set
            ? `ustawione <code>${esc(f.hint)}</code>`
            : 'nie ustawione'
          : '';
      const input =
        f.type === 'number'
          ? `<input type="text" inputmode="numeric" data-cfg="${f.key}" value="${esc(f.value || '')}" />`
          : f.type === 'secret'
          ? `<input type="password" data-cfg="${f.key}" placeholder="${f.set ? 'zostaw puste, aby nie zmieniać' : 'wklej wartość'}" autocomplete="new-password" />`
          : `<input type="text" data-cfg="${f.key}" value="${esc(f.value || '')}" />`;
      return `
        <label class="field">
          <span>${esc(f.label)} ${SOURCE_BADGE[f.source] || ''}</span>
          ${input}
          <div class="faint" style="margin-top:4px">${esc(f.help || '')}${status ? ` · ${status}` : ''}</div>
        </label>`;
    })
    .join('');

  view.innerHTML = `
    <div class="page-head"><div>
      <h2 style="margin:0">Ustawienia / Klucze API</h2>
      <p class="faint" style="margin:4px 0 0">Wartości z panelu nadpisują zmienne środowiskowe. Sekrety nigdy nie są pokazywane w całości.</p>
    </div></div>
    <div class="card" style="max-width:640px">
      ${rows}
      <div class="row" style="margin-top:6px">
        <button class="btn" id="cfg-save">💾 Zapisz</button>
        <span class="faint">Puste pole sekretu = bez zmian. Zmiany działają od razu (bez restartu).</span>
      </div>
    </div>
    <p class="faint" style="margin-top:16px">ℹ️ TikTok live i nowe filmy (yt-dlp) oraz Kick nie wymagają kluczy. Interwał sprawdzania zmieniasz zmienną <code>POLL_INTERVAL_SECONDS</code> w Portainerze.</p>`;

  document.getElementById('cfg-save').onclick = async (e) => {
    const btn = e.currentTarget;
    const body = {};
    view.querySelectorAll('[data-cfg]').forEach((el) => {
      if (el.value !== '') body[el.dataset.cfg] = el.value.trim();
    });
    if (Object.keys(body).length === 0) { toast('Nic do zapisania', 'warn'); return; }
    btn.disabled = true;
    try {
      await api.saveConfig(body);
      toast('Zapisano ustawienia', 'success');
      renderSettingsPage();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  };
}

/* ------------------------------------------------------------ bot status poll */
async function refreshBotStatus() {
  try {
    const d = await api.diagnostics();
    const pill = document.getElementById('bot-status-pill');
    const txt = document.getElementById('bot-status-text');
    pill.classList.toggle('online', d.bot.online);
    pill.classList.toggle('offline', !d.bot.online);
    txt.textContent = d.bot.online ? 'online' : 'offline';
  } catch { /* ignore */ }
}

/* -------------------------------------------------------------------- init */
document.getElementById('hamburger').onclick = () =>
  document.querySelector('.sidebar').classList.toggle('open');

document.getElementById('refresh-btn').onclick = async (e) => {
  e.currentTarget.disabled = true;
  try {
    await api.runPoll();
    toast('Sprawdzanie uruchomione w tle', 'success');
  } catch (err) { toast(err.message, 'error'); }
  finally { setTimeout(() => (e.currentTarget.disabled = false), 2000); }
};

refreshBotStatus();
setInterval(refreshBotStatus, 20000);
router();
