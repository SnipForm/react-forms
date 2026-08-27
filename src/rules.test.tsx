import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SnipForm, SubmitButton } from './components';
import { Field } from './fields';
import { clientValidateFields, isClientRule, parseRules, validateFieldValue } from './rules';

describe('rules engine', () => {
  it('parses rule[param] keys with messages', () => {
    expect(parseRules({ required: 'Say something', 'min[18]': null })).toEqual([
      { name: 'required', param: null, message: 'Say something' },
      { name: 'min', param: '18', message: null },
    ]);
  });

  it('knows which rules the browser can run', () => {
    expect(isClientRule('required')).toBe(true);
    expect(isClientRule('email')).toBe(true);
    expect(isClientRule('active_url')).toBe(false);
    expect(isClientRule('regex')).toBe(false);
    expect(isClientRule('not_regex')).toBe(false);
    // The astro strays the server rejects are not implemented here.
    expect(isClientRule('between')).toBe(false);
    expect(isClientRule('ends_with')).toBe(false);
  });

  it('validates in rule order, first failure wins, custom message preferred', () => {
    const rules = parseRules({ required: 'Need it', email: null });
    expect(validateFieldValue('email', '', rules, {})).toBe('Need it');
    expect(validateFieldValue('email', 'nope', rules, {})).toBe('The email field must be a valid email address.');
    expect(validateFieldValue('email', 'a@b.co', rules, {})).toBeNull();
  });

  it('lets optional empty fields pass every rule except required and accepted', () => {
    expect(validateFieldValue('age', '', parseRules({ integer: null, 'min[18]': null }), {})).toBeNull();
    expect(validateFieldValue('terms', '', parseRules({ accepted: 'Please accept' }), {})).toBe('Please accept');
  });

  it('handles cross-field and parameterised rules', () => {
    const values = { password: 'secret12', confirm: 'secret12', age: '17' };
    expect(validateFieldValue('confirm', 'secret12', parseRules({ 'same[password]': null }), values)).toBeNull();
    expect(validateFieldValue('confirm', 'other', parseRules({ 'same[password]': 'No match' }), values)).toBe('No match');
    expect(validateFieldValue('age', '17', parseRules({ 'min[18]': 'Must be 18+' }), values)).toBe('Must be 18+');
    expect(validateFieldValue('code', 'AB-12', parseRules({ alpha_dash: null }), {})).toBeNull();
  });

  it('validates a whole field set into a server-shaped error bag', () => {
    const fields = {
      email: { rules: { required: 'Email is required' } },
      topics: { type: 'checkbox' as const, rules: { required: null } },
      note: {},
    };
    expect(clientValidateFields(fields, {})).toEqual({
      email: ['Email is required'],
      topics: ['The topics field is required.'],
    });
  });
});

describe('client-side validation in the form', () => {
  const API = 'https://api.test/v2';

  const jsonResponse = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  const initOk = () => jsonResponse({ error_type: false, token: 'tok-1', hp: 'company' });

  const requestsTo = (fragment: string) =>
    vi.mocked(fetch).mock.calls.filter((call) => String(call[0]).includes(fragment));

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('checks a field instantly on blur with no network call', async () => {
    vi.mocked(fetch).mockResolvedValue(initOk());
    render(
      <SnipForm formKey={'KEY1'} apiBase={API} data-testid={'form'}>
        <Field
          name={'email'}
          type={'email'}
          aria-label={'email'}
          validate={{ required: 'Email is required', email: 'Invalid email' }}
          validClassName={'is-valid'}
        />
        <SubmitButton>Send</SubmitButton>
      </SnipForm>,
    );

    const email = screen.getByLabelText('email');
    fireEvent.change(email, { target: { value: 'nope' } });
    fireEvent.blur(email);

    // Instant - and validateOn defaults to 'submit', so no /validate request.
    expect(screen.getByRole('alert').textContent).toBe('Invalid email');
    expect(requestsTo('/validate')).toHaveLength(0);

    fireEvent.change(email, { target: { value: 'jane@acme.com' } });
    fireEvent.blur(email);
    expect(screen.queryByRole('alert')).toBeNull();
    // Client-validated clean -> the valid state lights up.
    expect(screen.getByLabelText('email').className).toContain('is-valid');
  });

  it('skips server-only rules client-side and lets the submit reach the server', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(initOk())
      .mockResolvedValueOnce(jsonResponse({ validated: true, ty: '<p>Done</p>' }));
    render(
      <SnipForm formKey={'KEY1'} apiBase={API} data-testid={'form'}>
        <Field name={'slug'} aria-label={'slug'} validate={{ 'regex[^[a-z]+$]': 'Lowercase only' }} />
        <SubmitButton>Send</SubmitButton>
      </SnipForm>,
    );

    const slug = screen.getByLabelText('slug');
    fireEvent.focus(slug);
    await waitFor(() => expect(requestsTo('/init')).toHaveLength(1));

    fireEvent.change(slug, { target: { value: 'UPPER' } });
    fireEvent.blur(slug);
    // regex can't run in the browser - no error, the server will judge it.
    expect(screen.queryByRole('alert')).toBeNull();

    fireEvent.submit(screen.getByTestId('form'));
    await waitFor(() => expect(requestsTo('/process')).toHaveLength(1));
  });

  it('does nothing client-side when clientValidate is false', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(initOk())
      .mockResolvedValueOnce(jsonResponse({ validated: false, errors: { email: ['Email is required'] } }));
    render(
      <SnipForm formKey={'KEY1'} apiBase={API} clientValidate={false} data-testid={'form'}>
        <Field name={'email'} type={'email'} aria-label={'email'} validate={{ required: 'Email is required' }} />
        <SubmitButton>Send</SubmitButton>
      </SnipForm>,
    );

    const email = screen.getByLabelText('email');
    fireEvent.focus(email);
    await waitFor(() => expect(requestsTo('/init')).toHaveLength(1));

    fireEvent.blur(email);
    expect(screen.queryByRole('alert')).toBeNull();

    // The empty submit goes to the server, which rejects it.
    fireEvent.submit(screen.getByTestId('form'));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Email is required'));
    expect(requestsTo('/process')).toHaveLength(1);
  });
});
