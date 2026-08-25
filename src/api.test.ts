import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initSession, LIB_VERSION, submitSession, validateSession } from './api';
import { signFor } from './signature';
import { SnipFormError } from './types';

const API = 'https://api.test/v2';

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const lastCall = () => {
  const call = vi.mocked(fetch).mock.calls.at(-1)!;

  return { url: String(call[0]), init: call[1] as RequestInit, body: JSON.parse(String(call[1]?.body)) };
};

describe('api', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('initSession', () => {
    it('posts field types + rules with the signed form header and maps the session', async () => {
      vi.mocked(fetch).mockResolvedValue(
        jsonResponse({ error_type: false, token: 'tok-1', hp: 'phone', branding: 'SnipForm.io', branding_link: 'https://snipform.io', ty: '<p>Thanks</p>' }),
      );

      const session = await initSession(API, 'KEY1', {
        email: { type: 'email', rules: { required: 'Email is required', email: null } },
        plan: { type: 'select' },
      });

      const { url, init, body } = lastCall();
      expect(url).toBe(`${API}/form/KEY1/init`);
      expect((init.headers as Record<string, string>)['X-SNIP-FORM']).toBe(String(signFor('KEY1')));
      expect((init.headers as Record<string, string>)['X-SNIP-LIB']).toBe(LIB_VERSION);
      expect(body.fields).toEqual({ email: 'email', plan: 'select' });
      expect(body.validation).toEqual({ email: { required: 'Email is required', email: null }, plan: {} });
      expect(body.key).toBe('KEY1');

      expect(session).toEqual({
        token: 'tok-1',
        honeypot: 'phone',
        branding: { label: 'SnipForm.io', link: 'https://snipform.io' },
        thankYou: '<p>Thanks</p>',
      });
    });

    it('treats error_type on a 200 as fatal', async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ error_type: 2, message: '[Lib Error] Signature failed' }));

      await expect(initSession(API, 'KEY1', {})).rejects.toMatchObject({ kind: 'fatal', message: '[Lib Error] Signature failed' });
    });

    it('wraps transport failures as network errors', async () => {
      vi.mocked(fetch).mockRejectedValue(new TypeError('Failed to fetch'));

      await expect(initSession(API, 'KEY1', {})).rejects.toMatchObject({ kind: 'network' });
    });
  });

  describe('submitSession', () => {
    const signals = { dur: 1200, gt: 'focus', k: 12, f: 2, m: 1 as const, s: 0 as const, t: 2, w: 0 as const, p: 3, l: 2 };

    it('posts map, data and signals under the signed session header', async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ validated: true, ty: '<p>Thanks Jane</p>' }));

      const outcome = await submitSession(API, 'tok-1', { email: 'email', phone: 'textarea' }, { email: 'j@a.c', phone: '' }, signals);

      const { url, init, body } = lastCall();
      expect(url).toBe(`${API}/form/tok-1/process`);
      expect((init.headers as Record<string, string>)['X-SNIP-SESSION']).toBe(String(signFor('tok-1')));
      expect(body).toEqual({ map: { email: 'email', phone: 'textarea' }, data: { email: 'j@a.c', phone: '' }, _sig: signals });
      expect(outcome).toEqual({ validated: true, html: '<p>Thanks Jane</p>' });
    });

    it('keeps every validation message per field, not just the first', async () => {
      vi.mocked(fetch).mockResolvedValue(
        jsonResponse({ validated: false, errors: { email: ['Email is required', 'Must be an email'] } }),
      );

      const outcome = await submitSession(API, 'tok-1', {}, {}, signals);

      expect(outcome).toEqual({ validated: false, errors: { email: ['Email is required', 'Must be an email'] } });
    });

    it('maps 419 to expired, 403 to unauthorized, others to server', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ message: 'Session has expired' }, 419));
      await expect(submitSession(API, 'tok-1', {}, {}, signals)).rejects.toMatchObject({ kind: 'expired', status: 419 });

      vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ message: 'Data invalidated' }, 403));
      await expect(submitSession(API, 'tok-1', {}, {}, signals)).rejects.toMatchObject({ kind: 'unauthorized', status: 403 });

      vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({}, 500));
      await expect(submitSession(API, 'tok-1', {}, {}, signals)).rejects.toBeInstanceOf(SnipFormError);
    });
  });

  describe('validateSession', () => {
    it('returns an empty bag when valid and the errors when not', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ validated: true, errors: null }));
      expect(await validateSession(API, 'tok-1', { email: 'email' }, { email: 'j@a.c' })).toEqual({});

      vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ validated: false, errors: { email: ['Must be an email'] } }));
      expect(await validateSession(API, 'tok-1', { email: 'email' }, { email: 'nope' })).toEqual({ email: ['Must be an email'] });

      expect(lastCall().url).toBe(`${API}/form/tok-1/validate`);
    });
  });
});
