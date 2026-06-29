import { TEMPLATE_VARIABLES, TEMPLATE_SAMPLE } from '../constants.js';

const VAR_RE = /\{([a-zA-Z0-9_]+)\}/g;

/**
 * Validate a template string. Returns { valid, unknown, used }.
 * `unknown` lists any {variable} that is not in the allowed set.
 */
export function validateTemplate(template) {
  const used = new Set();
  const unknown = new Set();
  if (typeof template !== 'string') {
    return { valid: false, unknown: [], used: [], error: 'Template must be a string' };
  }
  let match;
  while ((match = VAR_RE.exec(template)) !== null) {
    const name = match[1];
    used.add(name);
    if (!TEMPLATE_VARIABLES.includes(name)) unknown.add(name);
  }
  return {
    valid: unknown.size === 0,
    unknown: [...unknown],
    used: [...used],
    error:
      unknown.size > 0
        ? `Nieznane zmienne: ${[...unknown].map((u) => `{${u}}`).join(', ')}`
        : null,
  };
}

/**
 * Render a template with the supplied context. Missing/unknown variables are
 * replaced with an empty string so a partial context never crashes a send.
 */
export function renderTemplate(template, context = {}) {
  if (typeof template !== 'string') return '';
  return template
    .replace(VAR_RE, (_full, name) => {
      const value = context[name];
      return value === undefined || value === null ? '' : String(value);
    })
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

/**
 * Render a template using the sample context for the live preview feature.
 */
export function previewTemplate(template) {
  return renderTemplate(template, TEMPLATE_SAMPLE);
}
