// Tiny holder so other modules can reach the live Discord client without
// creating an import cycle with bot/client.js.

let client = null;
let status = { online: false, ready: false, error: null, since: null };

export function setClient(c) {
  client = c;
}

export function getClient() {
  return client;
}

export function isReady() {
  return Boolean(client && client.isReady && client.isReady());
}

export function setStatus(patch) {
  status = { ...status, ...patch };
}

export function getStatus() {
  return { ...status, ready: isReady() };
}
