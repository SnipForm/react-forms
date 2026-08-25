import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FieldError, SnipForm } from './components';
import { useSnipForm } from './useSnipForm';
import type { SnipFormOptions } from './types';

const API = 'https://api.test/v2';

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const initOk = () => jsonResponse({ error_type: false, token: 'tok-1', hp: 'phone', branding: 'SnipForm.io', branding_link: 'https://snipform.io' });

const requestsTo = (fragment: string) =>
  vi.mocked(fetch).mock.calls.filter((call) => String(call[0]).includes(fragment));

const bodyOf = (call: unknown[]) => JSON.parse(String((call[1] as RequestInit).body));

const Demo = (props: Partial<SnipFormOptions>) => {
  const form = useSnipForm({
    key: 'KEY1',
    apiBase: API,
    fields: {
      email: { type: 'email', rules: { required: 'Email is required', email: null } },
      topics: { type: 'checkbox' },
    },
    ...props,
  });

  if (form.fatal) return <p data-testid={'fatal'}>{form.fatal}</p>;
  if (form.success) return <div data-testid={'success'} dangerouslySetInnerHTML={{ __html: form.success.html }} />;

  return (
    <SnipForm form={form} data-testid={'form'}>
      <input aria-label={'email'} {...form.register('email')} />
      <FieldError form={form} name={'email'} />
      <label>
        <input type={'checkbox'} {...form.register('topics', { value: 'news' })} /> news
      </label>
      <label>
        <input type={'checkbox'} {...form.register('topics', { value: 'offers' })} /> offers
      </label>
      <span data-testid={'status'}>{form.status}</span>
      <button type={'submit'}>Send</button>
    </SnipForm>
  );
};

describe('useSnipForm', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('stays idle until a human interacts, then initialises with the declared field set', async () => {
    vi.mocked(fetch).mockResolvedValue(initOk());
    render(<Demo />);

    expect(screen.getByTestId('status').textContent).toBe('idle');
    expect(fetch).not.toHaveBeenCalled();

    fireEvent.focus(screen.getByLabelText('email'));

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready'));
    const [initCall] = requestsTo('/init');
    expect(bodyOf(initCall).fields).toEqual({ email: 'email', topics: 'checkbox' });
    expect(bodyOf(initCall).validation.email).toEqual({ required: 'Email is required', email: null });

    // The honeypot appears once the server has named it.
    const trap = screen.getByTestId('form').querySelector('input[name="phone"]') as HTMLInputElement;
    expect(trap).not.toBeNull();
    expect(trap.tabIndex).toBe(-1);
  });

  it('renders server validation errors per field and keeps the session', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(initOk())
      .mockResolvedValueOnce(jsonResponse({ validated: false, errors: { email: ['Email is required'] } }));
    render(<Demo />);

    fireEvent.focus(screen.getByLabelText('email'));
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready'));

    fireEvent.submit(screen.getByTestId('form'));

    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Email is required'));
    expect(screen.getByTestId('status').textContent).toBe('ready');
    expect(screen.getByLabelText('email').getAttribute('aria-invalid')).toBe('true');
  });

  it('submits values, checkbox arrays, the empty honeypot and behavioural signals', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(initOk())
      .mockResolvedValueOnce(jsonResponse({ validated: true, ty: '<p>Thanks jane@acme.com</p>' }));
    render(<Demo />);

    const email = screen.getByLabelText('email');
    fireEvent.focus(email);
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready'));

    fireEvent.keyDown(email, { key: 'j' });
    fireEvent.change(email, { target: { value: 'jane@acme.com' } });
    fireEvent.click(screen.getByLabelText('news'));
    fireEvent.click(screen.getByLabelText('offers'));
    fireEvent.click(screen.getByLabelText('news'));
    fireEvent.submit(screen.getByTestId('form'));

    await waitFor(() => expect(screen.getByTestId('success').innerHTML).toContain('Thanks jane@acme.com'));

    const [submitCall] = requestsTo('/process');
    const body = bodyOf(submitCall);
    expect(body.map).toEqual({ email: 'email', topics: 'checkbox', phone: 'textarea' });
    expect(body.data).toEqual({ email: 'jane@acme.com', topics: ['offers'], phone: '' });
    expect(body._sig.gt).toBe('focus');
    expect(body._sig.k).toBeGreaterThanOrEqual(1);
    expect(body._sig.f).toBeGreaterThanOrEqual(1);
    expect(body._sig.t).toBeGreaterThanOrEqual(2);
  });

  it('re-initialises and retries once when the session has expired', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(initOk())
      .mockResolvedValueOnce(jsonResponse({ message: 'Session has expired, please refresh' }, 419))
      .mockResolvedValueOnce(jsonResponse({ error_type: false, token: 'tok-2', hp: 'phone' }))
      .mockResolvedValueOnce(jsonResponse({ validated: true, ty: '<p>Done</p>' }));
    render(<Demo />);

    fireEvent.focus(screen.getByLabelText('email'));
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready'));
    fireEvent.submit(screen.getByTestId('form'));

    await waitFor(() => expect(screen.getByTestId('success')).toBeTruthy());
    expect(requestsTo('/init')).toHaveLength(2);
    const [first, second] = requestsTo('/process');
    expect(String(first[0])).toContain('/form/tok-1/process');
    expect(String(second[0])).toContain('/form/tok-2/process');
  });

  it('surfaces a fatal init error instead of the form', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ error_type: 1, message: '[Key error] SnipForm not found.' }));
    render(<Demo />);

    fireEvent.focus(screen.getByLabelText('email'));

    await waitFor(() => expect(screen.getByTestId('fatal').textContent).toContain('SnipForm not found'));
  });

  it('validates a field on blur against the validate endpoint when asked to', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(fetch)
      .mockResolvedValueOnce(initOk())
      .mockResolvedValueOnce(jsonResponse({ validated: false, errors: { email: ['Must be an email'], topics: ['Pick one'] } }));
    render(<Demo validateOn={'blur'} />);

    const email = screen.getByLabelText('email');
    fireEvent.focus(email);
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready'));
    fireEvent.change(email, { target: { value: 'nope' } });
    fireEvent.blur(email);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Must be an email'));
    expect(requestsTo('/validate')).toHaveLength(1);
    // Only the blurred field's errors land - the untouched checkbox stays clean.
    expect(screen.queryAllByRole('alert')).toHaveLength(1);
    vi.useRealTimers();
  });
});
