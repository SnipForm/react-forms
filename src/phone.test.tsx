import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { parsePhoneNumberFromString } from 'libphonenumber-js/max';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SnipForm, SubmitButton } from './components';
import { Field } from './fields';
import { checkPhone, phoneSettled } from './phone';
import { hasPhoneRule } from './rules';
import cases from './test/phone-cases.json';

/**
 * The `phone` rule. phone-cases.json holds SnipForm's server answers
 * (propaganistas/laravel-phone) - the browser check must give the same ones.
 */
describe('checkPhone matches SnipForm\'s server', () => {
  it.each(cases.cases.map((c) => [c.param ?? '(none)', c.value, c.valid, c] as const))(
    'phone[%s] %s -> %s',
    (_param, value, valid, c) => {
      const values = ('values' in c ? c.values : undefined) ?? {};
      expect(checkPhone(parsePhoneNumberFromString, value, c.param, 'phone', values)).toBe(valid);
    },
  );
});

describe('hasPhoneRule', () => {
  it('spots phone and phone[...] keys only', () => {
    expect(hasPhoneRule({ phone: null })).toBe(true);
    expect(hasPhoneRule({ required: null, 'phone[za]': 'x' })).toBe(true);
    expect(hasPhoneRule({ phone_number: null } as never)).toBe(false);
    expect(hasPhoneRule(undefined)).toBe(false);
  });
});

describe('phone in forms', () => {
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

  it('loads the phone data on demand and checks the number on blur', async () => {
    expect(phoneSettled()).toBe(false);
    vi.mocked(fetch).mockResolvedValue(initOk());
    render(
      <SnipForm formKey={'KEY1'} apiBase={API}>
        <Field name={'phone'} type={'tel'} aria-label={'phone'} validate={{ 'phone[za]': 'Enter a South African number' }} />
        <SubmitButton>Send</SubmitButton>
      </SnipForm>,
    );

    const phone = screen.getByLabelText('phone');
    fireEvent.focus(phone);
    fireEvent.change(phone, { target: { value: '+44 20 7946 0958' } });
    fireEvent.blur(phone);

    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Enter a South African number'));
    expect(phoneSettled()).toBe(true);

    fireEvent.change(phone, { target: { value: '082 123 4567' } });
    fireEvent.blur(phone);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('blocks a bad number at submit without calling the server', async () => {
    vi.mocked(fetch).mockResolvedValue(initOk());
    render(
      <SnipForm formKey={'KEY1'} apiBase={API} data-testid={'form'}>
        <Field name={'phone'} type={'tel'} aria-label={'phone'} validate={{ phone: 'Add your country code' }} />
        <SubmitButton>Send</SubmitButton>
      </SnipForm>,
    );

    fireEvent.change(screen.getByLabelText('phone'), { target: { value: '0821234567' } });
    fireEvent.submit(screen.getByTestId('form'));

    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Add your country code'));
    expect(requestsTo('/process')).toHaveLength(0);
  });
});
