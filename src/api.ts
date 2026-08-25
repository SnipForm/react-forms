import { signFor } from './signature';
import { SnipFormError } from './types';
import type { FieldErrors, FieldType, FieldValue, Fields, InteractionSignals, RuleMessages, Session } from './types';

export const DEFAULT_API_BASE = 'https://api.snipform.io/v2';

export const LIB_VERSION = '0.1.0';

// -----------------------------------------------
// Init - opens a wrap session for this form
// -----------------------------------------------

export const initSession = async (apiBase: string, key: string, fields: Fields): Promise<Session> => {
  const validation: Record<string, RuleMessages> = {};
  const types: Record<string, FieldType> = {};
  for (const [name, config] of Object.entries(fields)) {
    types[name] = config.type ?? 'text';
    validation[name] = config.rules ?? {};
  }

  const response = await request(`${apiBase}/form/${encodeURIComponent(key)}/init`, {
    headers: { 'X-SNIP-FORM': String(signFor(key)) },
    body: {
      validation,
      fields: types,
      key,
      source: typeof location !== 'undefined' ? location.href : '',
      successContent: null,
    },
  });

  const data = await readJson(response);
  if (!response.ok || data.error_type) {
    throw new SnipFormError(String(data.message ?? `Init failed (${response.status})`), 'fatal', response.status);
  }
  if (!data.token) {
    throw new SnipFormError('Init returned no session token', 'fatal', response.status);
  }

  return {
    token: String(data.token),
    honeypot: data.hp ? String(data.hp) : null,
    branding: data.branding ? { label: String(data.branding), link: String(data.branding_link ?? '') } : null,
    thankYou: data.ty ? String(data.ty) : null,
  };
};

// -----------------------------------------------
// Submit - the real thing; consumes the session on success
// -----------------------------------------------

export type SubmitOutcome =
  | { validated: true; html: string }
  | { validated: false; errors: FieldErrors };

export const submitSession = async (
  apiBase: string,
  token: string,
  map: Record<string, FieldType>,
  data: Record<string, FieldValue>,
  signals: InteractionSignals,
): Promise<SubmitOutcome> => {
  const response = await request(`${apiBase}/form/${encodeURIComponent(token)}/process`, {
    headers: { 'X-SNIP-SESSION': String(signFor(token)) },
    body: { map, data, _sig: signals },
  });

  const body = await readJson(response);
  throwForStatus(response, body);

  if (body.validated === false) {
    return { validated: false, errors: normaliseErrors(body.errors) };
  }

  return { validated: true, html: String(body.ty ?? '') };
};

// -----------------------------------------------
// Validate - same rules, nothing consumed, nothing saved
// -----------------------------------------------

export const validateSession = async (
  apiBase: string,
  token: string,
  map: Record<string, FieldType>,
  data: Record<string, FieldValue>,
): Promise<FieldErrors> => {
  const response = await request(`${apiBase}/form/${encodeURIComponent(token)}/validate`, {
    headers: { 'X-SNIP-SESSION': String(signFor(token)) },
    body: { map, data },
  });

  const body = await readJson(response);
  throwForStatus(response, body);

  return body.validated === false ? normaliseErrors(body.errors) : {};
};

// -----------------------------------------------
// Internals
// -----------------------------------------------

const request = async (url: string, init: { headers: Record<string, string>; body: unknown }): Promise<Response> => {
  try {
    return await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-SNIP-LIB': LIB_VERSION,
        ...init.headers,
      },
      body: JSON.stringify(init.body),
    });
  } catch (cause) {
    throw new SnipFormError(`Network error: ${(cause as Error)?.message ?? 'request failed'}`, 'network');
  }
};

const readJson = async (response: Response): Promise<Record<string, any>> => {
  try {
    return (await response.json()) ?? {};
  } catch {
    return {};
  }
};

/** 419 = session expired / consumed / IP changed -> caller re-inits. 403 = signature or honeypot. */
const throwForStatus = (response: Response, body: Record<string, any>): void => {
  if (response.ok) {
    return;
  }
  const message = String(body.message ?? `Request failed (${response.status})`);
  if (response.status === 419) {
    throw new SnipFormError(message, 'expired', 419);
  }
  if (response.status === 403) {
    throw new SnipFormError(message, 'unauthorized', 403);
  }
  throw new SnipFormError(message, 'server', response.status);
};

/** Laravel's MessageBag shape is {field: [msg, ...]} - keep every message, never just the first. */
const normaliseErrors = (raw: unknown): FieldErrors => {
  const errors: FieldErrors = {};
  if (!raw || typeof raw !== 'object') {
    return errors;
  }
  for (const [field, messages] of Object.entries(raw as Record<string, unknown>)) {
    errors[field] = Array.isArray(messages) ? messages.map(String) : [String(messages)];
  }

  return errors;
};
