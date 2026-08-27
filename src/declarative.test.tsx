import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SnipForm, SubmitButton, SuccessContent } from './components';
import { SnipFormProvider } from './context';
import { Field } from './fields';
import { normalizeValidate } from './validate';

const API = 'https://api.test/v2';

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const initOk = (token = 'tok-1') => jsonResponse({ error_type: false, token, hp: 'company' });

const requestsTo = (fragment: string) =>
  vi.mocked(fetch).mock.calls.filter((call) => String(call[0]).includes(fragment));

const bodyOf = (call: unknown[]) => JSON.parse(String((call[1] as RequestInit).body));

describe('normalizeValidate', () => {
  it('accepts the three Astro shapes', () => {
    expect(normalizeValidate('required')).toEqual({ required: null });
    expect(normalizeValidate(['required', 'integer'])).toEqual({ required: null, integer: null });
    expect(normalizeValidate({ required: 'Say something', 'min_length[2]': null })).toEqual({
      required: 'Say something',
      'min_length[2]': null,
    });
    expect(normalizeValidate(undefined)).toBeUndefined();
  });
});

describe('declarative components', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const Demo = ({ children }: { children?: React.ReactNode }) => (
    <SnipForm formKey={'KEY1'} apiBase={API} data-testid={'form'}>
      <Field name={'email'} type={'email'} aria-label={'email'} validate={{ required: 'Email is required', email: null }} errorClassName={'is-error'} />
      <Field name={'message'} as={'textarea'} aria-label={'message'} validate={'required'} />
      {children}
      <SubmitButton submittingText={'Sending...'}>Send</SubmitButton>
      <SuccessContent />
    </SnipForm>
  );

  it('registers mounted fields and initialises with their types and rules', async () => {
    vi.mocked(fetch).mockResolvedValue(initOk());
    render(<Demo />);

    expect(fetch).not.toHaveBeenCalled();
    fireEvent.focus(screen.getByLabelText('email'));

    await waitFor(() => expect(requestsTo('/init')).toHaveLength(1));
    const body = bodyOf(requestsTo('/init')[0]);
    expect(body.fields).toEqual({ email: 'email', message: 'textarea' });
    expect(body.validation).toEqual({
      email: { required: 'Email is required', email: null },
      message: { required: null },
    });
  });

  it('shows the auto error message and error class after a failed submit, then swaps to success content', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(initOk())
      .mockResolvedValueOnce(jsonResponse({ validated: false, errors: { email: ['Email is required'] } }))
      .mockResolvedValueOnce(jsonResponse({ validated: true, ty: '<p>Thanks jane</p>' }));
    render(<Demo />);

    const email = screen.getByLabelText('email');
    fireEvent.focus(email);
    await waitFor(() => expect(requestsTo('/init')).toHaveLength(1));

    fireEvent.submit(screen.getByTestId('form'));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Email is required'));
    expect(screen.getByLabelText('email').className).toContain('is-error');

    fireEvent.change(email, { target: { value: 'jane@acme.com' } });
    fireEvent.submit(screen.getByTestId('form'));

    await waitFor(() => expect(screen.getByTestId('form').innerHTML).toContain('Thanks jane'));
    // The field components and submit button hide themselves on success.
    expect(screen.queryByLabelText('email')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('re-initialises transparently when a field mounts after the session opened', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(initOk('tok-1'))
      .mockResolvedValueOnce(initOk('tok-2'))
      .mockResolvedValueOnce(jsonResponse({ validated: true, ty: '<p>Done</p>' }));

    const Late = () => {
      const [more, setMore] = useState(false);

      return (
        <Demo>
          {more && <Field name={'phone'} type={'tel'} aria-label={'phone'} />}
          <button type={'button'} onClick={() => setMore(true)}>
            add phone
          </button>
        </Demo>
      );
    };
    render(<Late />);

    fireEvent.focus(screen.getByLabelText('email'));
    await waitFor(() => expect(requestsTo('/init')).toHaveLength(1));

    fireEvent.click(screen.getByText('add phone'));
    await screen.findByLabelText('phone');
    // No eager re-init - staleness resolves lazily.
    expect(requestsTo('/init')).toHaveLength(1);

    fireEvent.submit(screen.getByTestId('form'));
    await waitFor(() => expect(requestsTo('/process')).toHaveLength(1));

    expect(requestsTo('/init')).toHaveLength(2);
    expect(bodyOf(requestsTo('/init')[1]).fields).toEqual({ email: 'email', message: 'textarea', phone: 'tel' });
    expect(String(requestsTo('/process')[0][0])).toContain('/form/tok-2/process');
  });

  it('keeps the session when a `when`-gated field toggles - it was registered all along', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(initOk('tok-1'))
      .mockResolvedValueOnce(jsonResponse({ validated: true, ty: '<p>Done</p>' }));

    const Gated = () => {
      const [show, setShow] = useState(false);

      return (
        <Demo>
          <Field name={'phone'} type={'tel'} aria-label={'phone'} when={show} />
          <button type={'button'} onClick={() => setShow(true)}>
            show phone
          </button>
        </Demo>
      );
    };
    render(<Gated />);

    fireEvent.focus(screen.getByLabelText('email'));
    await waitFor(() => expect(requestsTo('/init')).toHaveLength(1));
    // Hidden, but declared from the start.
    expect(bodyOf(requestsTo('/init')[0]).fields.phone).toBe('tel');
    expect(screen.queryByLabelText('phone')).toBeNull();

    fireEvent.click(screen.getByText('show phone'));
    await screen.findByLabelText('phone');

    fireEvent.submit(screen.getByTestId('form'));
    await waitFor(() => expect(requestsTo('/process')).toHaveLength(1));

    // Same session - no re-init needed.
    expect(requestsTo('/init')).toHaveLength(1);
    expect(String(requestsTo('/process')[0][0])).toContain('/form/tok-1/process');
  });

  it('re-initialises without a field that unmounted after the session opened', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(initOk('tok-1'))
      .mockResolvedValueOnce(initOk('tok-2'))
      .mockResolvedValueOnce(jsonResponse({ validated: true, ty: '<p>Done</p>' }));

    const Shrinking = () => {
      const [gone, setGone] = useState(false);

      return (
        <Demo>
          {!gone && <Field name={'phone'} type={'tel'} aria-label={'phone'} />}
          <button type={'button'} onClick={() => setGone(true)}>
            drop phone
          </button>
        </Demo>
      );
    };
    render(<Shrinking />);

    fireEvent.focus(screen.getByLabelText('email'));
    await waitFor(() => expect(requestsTo('/init')).toHaveLength(1));
    expect(bodyOf(requestsTo('/init')[0]).fields.phone).toBe('tel');

    fireEvent.click(screen.getByText('drop phone'));
    fireEvent.submit(screen.getByTestId('form'));
    await waitFor(() => expect(requestsTo('/process')).toHaveLength(1));

    expect(requestsTo('/init')).toHaveLength(2);
    expect(bodyOf(requestsTo('/init')[1]).fields).toEqual({ email: 'email', message: 'textarea' });
    const processBody = bodyOf(requestsTo('/process')[0]);
    // The dropped field is gone from the payload; only the honeypot remains extra.
    expect(processBody.map).toEqual({ email: 'email', message: 'textarea', company: 'textarea' });
    expect(processBody.data.phone).toBeUndefined();
  });

  it('takes apiBase and validateOn defaults from <SnipFormProvider>', async () => {
    vi.mocked(fetch).mockResolvedValue(initOk());
    render(
      <SnipFormProvider apiBase={API}>
        <SnipForm formKey={'KEY1'} data-testid={'form'}>
          <Field name={'email'} type={'email'} aria-label={'email'} validate={'required'} />
          <SubmitButton>Send</SubmitButton>
        </SnipForm>
      </SnipFormProvider>,
    );

    fireEvent.focus(screen.getByLabelText('email'));
    await waitFor(() => expect(requestsTo('/init')).toHaveLength(1));
    expect(String(requestsTo('/init')[0][0])).toContain(`${API}/form/KEY1/init`);
  });
});
