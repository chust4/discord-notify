// Thin REST client for the panel.
async function request(method, path, body) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`/api${path}`, opts);
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const err = new Error((data && (data.error || data.detail)) || `HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const api = {
  get: (p) => request('GET', p),
  post: (p, b) => request('POST', p, b),
  patch: (p, b) => request('PATCH', p, b),
  del: (p) => request('DELETE', p),

  meta: () => request('GET', '/meta'),
  diagnostics: () => request('GET', '/diagnostics'),
  profiles: () => request('GET', '/profiles'),
  profile: (id) => request('GET', `/profiles/${id}`),
  createProfile: (b) => request('POST', '/profiles', b),
  updateProfile: (id, b) => request('PATCH', `/profiles/${id}`, b),
  deleteProfile: (id) => request('DELETE', `/profiles/${id}`),
  addAccount: (id, b) => request('POST', `/profiles/${id}/accounts`, b),
  refreshAccount: (accId) => request('POST', `/accounts/${accId}/refresh`),
  deleteAccount: (accId) => request('DELETE', `/accounts/${accId}`),
  settings: (id, guildId) =>
    request('GET', `/profiles/${id}/settings${guildId ? `?guild_id=${guildId}` : ''}`),
  updateSetting: (sid, b) => request('PATCH', `/settings/${sid}`, b),
  testSetting: (sid) => request('POST', `/settings/${sid}/test`),
  validateTemplate: (template) => request('POST', '/templates/validate', { template }),
  previewTemplate: (template, context) =>
    request('POST', '/templates/preview', { template, context }),
  guilds: () => request('GET', '/guilds'),
  setGuildAuthorized: (gid, authorized) =>
    request('PATCH', `/guilds/${gid}`, { authorized }),
  guildChannels: (gid) => request('GET', `/guilds/${gid}/channels`),
  guildRoles: (gid) => request('GET', `/guilds/${gid}/roles`),
  events: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return request('GET', `/events${q ? `?${q}` : ''}`);
  },
  runPoll: () => request('POST', '/poll/run'),
};
