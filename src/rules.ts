import { checkPhone, phoneParser } from './phone';
import type { FieldErrors, FieldValue, Fields, RuleMessages } from './types';

/**
 * Client-side implementations of SnipForm validation rules, ported from
 * @snipform/astro-forms and restricted to the server's rule whitelist -
 * client and server stay aligned because both read the same rule
 * declarations, and nothing is checked client-side the server would reject.
 *
 * The server remains the authority: it re-validates everything on submit,
 * and rules that cannot run in the browser (`active_url` needs a DNS
 * lookup; `regex` / `not_regex` are applied with PHP regex semantics) are
 * skipped here and enforced there. `phone` runs here once libphonenumber-js
 * has loaded (see phone.ts); until then it is left to the server.
 */

/** A parsed `rule[param]` key from a RuleMessages map */
export interface ParsedRule {
  name: string;
  param: string | null;
  message: string | null;
}

const RULE_KEY_PATTERN = /^([a-z0-9_]+)(?:\[(.+?)\])?$/;

/** Parses RuleMessages entries ({ 'min[18]': 'msg' }) into ParsedRules. */
export const parseRules = (rules: RuleMessages): ParsedRule[] => {
  const parsed: ParsedRule[] = [];
  for (const [key, message] of Object.entries(rules)) {
    const match = RULE_KEY_PATTERN.exec(key);
    if (match) {
      parsed.push({ name: match[1], param: match[2] ?? null, message });
    }
  }

  return parsed;
};

/** Rules that cannot be checked in the browser and are deferred to the server. */
export const SERVER_ONLY_RULES = new Set(['active_url', 'regex', 'not_regex']);

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INTEGER = /^-?\d+$/;
const NUMERIC = /^-?(\d+\.?\d*|\.\d+)$/;
const ALPHA = /^[a-zA-Z]+$/;
const ALPHA_NUM = /^[a-zA-Z0-9]+$/;
const ALPHA_DASH = /^[a-zA-Z0-9_-]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const IPV6 =
  /^((([0-9a-f]{1,4}:){7}[0-9a-f]{1,4})|(([0-9a-f]{1,4}:)*[0-9a-f]{1,4})?::(([0-9a-f]{1,4}:)*[0-9a-f]{1,4})?)$/i;
const DATE = /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}(:\d{2})?)?$/;

const isEmpty = (value: FieldValue): boolean =>
  Array.isArray(value) ? value.length === 0 : value.trim() === '';

const parseDate = (value: string): number | null => {
  if (!DATE.test(value.trim())) return null;
  const time = Date.parse(value.trim().replace(' ', 'T'));

  return Number.isNaN(time) ? null : time;
};

/** Resolves an `after[ref]`-style reference: keyword, date literal, or another field. */
const resolveDateRef = (ref: string, values: Record<string, FieldValue>): number | null => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  switch (ref) {
    case 'today':
      return today.getTime();
    case 'tomorrow':
      return today.getTime() + 86_400_000;
    case 'yesterday':
      return today.getTime() - 86_400_000;
  }
  const literal = parseDate(ref);
  if (literal !== null) return literal;
  const other = values[ref];

  return typeof other === 'string' ? parseDate(other) : null;
};

const asString = (value: FieldValue | undefined): string => (typeof value === 'string' ? value : '');

/**
 * Comparative rules (`gt`, `gte`, `lt`, `lte`) compare numerically when both
 * values are numeric, otherwise by character length (matching server behavior).
 */
const comparable = (value: string, other: string): [number, number] => {
  if (NUMERIC.test(value.trim()) && NUMERIC.test(other.trim())) {
    return [Number.parseFloat(value), Number.parseFloat(other)];
  }

  return [value.length, other.length];
};

const compareDates = (
  value: string,
  ref: string,
  values: Record<string, FieldValue>,
  cmp: (a: number, b: number) => boolean,
): boolean => {
  const valueTime = parseDate(value);
  const refTime = resolveDateRef(ref, values);

  return valueTime !== null && refTime !== null && cmp(valueTime, refTime);
};

const compareFields = (
  value: string,
  other: FieldValue | undefined,
  cmp: (a: number, b: number) => boolean,
): boolean => {
  const [a, b] = comparable(value, asString(other));

  return cmp(a, b);
};

const inList = (param: string): string[] => param.split(',').map((entry) => entry.trim());

type RuleCheck = (value: string, param: string, values: Record<string, FieldValue>, field: string) => boolean;

/**
 * Each check returns true when the value passes. Empty values are handled
 * before dispatch. Exactly the server's whitelist minus SERVER_ONLY_RULES -
 * nothing more, so a rule that passes client-side always reaches a server
 * that recognises it.
 */
const CHECKS: Record<string, RuleCheck> = {
  email: (v) => EMAIL.test(v.trim()),
  url: (v) => {
    try {
      const url = new URL(v.trim());

      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  },
  boolean: (v) => ['true', 'false', '1', '0'].includes(v.trim().toLowerCase()),
  accepted: (v) => ['yes', 'on', '1', 'true'].includes(v.trim().toLowerCase()),
  numeric: (v) => NUMERIC.test(v.trim()),
  integer: (v) => INTEGER.test(v.trim()),
  alpha: (v) => ALPHA.test(v),
  alpha_num: (v) => ALPHA_NUM.test(v),
  alpha_dash: (v) => ALPHA_DASH.test(v),
  uuid: (v) => UUID.test(v.trim()),
  ip: (v) => IPV4.test(v.trim()) || IPV6.test(v.trim()),
  ipv4: (v) => IPV4.test(v.trim()),
  ipv6: (v) => IPV6.test(v.trim()),
  date: (v) => parseDate(v) !== null,
  phone: (v, p, values, field) => {
    const parse = phoneParser();

    return parse ? checkPhone(parse, v, p || null, field, values) : true;
  },

  max: (v, p) => NUMERIC.test(v.trim()) && Number.parseFloat(v) <= Number.parseFloat(p),
  min: (v, p) => NUMERIC.test(v.trim()) && Number.parseFloat(v) >= Number.parseFloat(p),

  min_length: (v, p) => v.length >= Number.parseInt(p, 10),
  max_length: (v, p) => v.length <= Number.parseInt(p, 10),
  starts_with: (v, p) => inList(p).some((s) => v.startsWith(s)),
  doesnt_start_with: (v, p) => !inList(p).some((s) => v.startsWith(s)),
  doesnt_end_with: (v, p) => !inList(p).some((s) => v.endsWith(s)),
  in: (v, p) => inList(p).includes(v),
  not_in: (v, p) => !inList(p).includes(v),

  after: (v, p, values) => compareDates(v, p, values, (a, b) => a > b),
  before: (v, p, values) => compareDates(v, p, values, (a, b) => a < b),
  date_equals: (v, p, values) => compareDates(v, p, values, (a, b) => a === b),

  same: (v, p, values) => v === asString(values[p]),
  gt: (v, p, values) => compareFields(v, values[p], (a, b) => a > b),
  gte: (v, p, values) => compareFields(v, values[p], (a, b) => a >= b),
  lt: (v, p, values) => compareFields(v, values[p], (a, b) => a < b),
  lte: (v, p, values) => compareFields(v, values[p], (a, b) => a <= b),
};

/** Humanizes a field name for auto-generated messages ("first_name" -> "first name"). */
const label = (field: string): string => field.replace(/[_-]+/g, ' ');

const MESSAGES: Record<string, (field: string, param: string) => string> = {
  required: (f) => `The ${f} field is required.`,
  email: (f) => `The ${f} field must be a valid email address.`,
  url: (f) => `The ${f} field must be a valid URL.`,
  boolean: (f) => `The ${f} field must be true or false.`,
  accepted: (f) => `The ${f} field must be accepted.`,
  numeric: (f) => `The ${f} field must be a number.`,
  integer: (f) => `The ${f} field must be an integer.`,
  alpha: (f) => `The ${f} field may only contain letters.`,
  alpha_num: (f) => `The ${f} field may only contain letters and numbers.`,
  alpha_dash: (f) => `The ${f} field may only contain letters, numbers, dashes, and underscores.`,
  uuid: (f) => `The ${f} field must be a valid UUID.`,
  ip: (f) => `The ${f} field must be a valid IP address.`,
  ipv4: (f) => `The ${f} field must be a valid IPv4 address.`,
  ipv6: (f) => `The ${f} field must be a valid IPv6 address.`,
  date: (f) => `The ${f} field must be a valid date.`,
  phone: (f) => `The ${f} field must be a valid phone number.`,
  max: (f, p) => `The ${f} field must not be greater than ${p}.`,
  min: (f, p) => `The ${f} field must be at least ${p}.`,
  min_length: (f, p) => `The ${f} field must be at least ${p} characters.`,
  max_length: (f, p) => `The ${f} field must not be greater than ${p} characters.`,
  starts_with: (f, p) => `The ${f} field must start with one of: ${p}.`,
  doesnt_start_with: (f, p) => `The ${f} field must not start with one of: ${p}.`,
  doesnt_end_with: (f, p) => `The ${f} field must not end with one of: ${p}.`,
  in: (f) => `The selected ${f} is invalid.`,
  not_in: (f) => `The selected ${f} is invalid.`,
  after: (f, p) => `The ${f} field must be a date after ${p}.`,
  before: (f, p) => `The ${f} field must be a date before ${p}.`,
  date_equals: (f, p) => `The ${f} field must be a date equal to ${p}.`,
  same: (f, p) => `The ${f} field must match ${label(p)}.`,
  gt: (f, p) => `The ${f} field must be greater than ${label(p)}.`,
  gte: (f, p) => `The ${f} field must be greater than or equal to ${label(p)}.`,
  lt: (f, p) => `The ${f} field must be less than ${label(p)}.`,
  lte: (f, p) => `The ${f} field must be less than or equal to ${label(p)}.`,
};

const defaultMessage = (rule: ParsedRule, field: string): string => {
  const template = MESSAGES[rule.name];

  return template ? template(label(field), rule.param ?? '') : `The ${label(field)} field is invalid.`;
};

/** True if the rule can run in the browser. */
export const isClientRule = (name: string): boolean =>
  name === 'required' || (name in CHECKS && !SERVER_ONLY_RULES.has(name));

/**
 * Validates one field against its rules.
 *
 * Mirrors server semantics: rules are evaluated in order and the first
 * failure is returned. Rules other than `required` and `accepted` pass on
 * empty values (empty + optional = valid). Rules the client cannot check
 * are skipped - the server enforces them on submit.
 *
 * @returns the error message for the first failing rule, or null if valid
 */
export const validateFieldValue = (
  field: string,
  value: FieldValue,
  rules: ParsedRule[],
  values: Record<string, FieldValue>,
): string | null => {
  for (const rule of rules) {
    if (rule.name === 'required') {
      if (isEmpty(value)) return rule.message ?? defaultMessage(rule, field);
      continue;
    }
    if (!isClientRule(rule.name)) continue;
    if (rule.name !== 'accepted' && isEmpty(value)) continue;

    const check = CHECKS[rule.name];
    const items = Array.isArray(value) ? value : [value];
    const passes =
      rule.name === 'accepted'
        ? check(asString(Array.isArray(value) ? value[0] : value), '', values, field)
        : items.every((item) => check(item, rule.param ?? '', values, field));

    if (!passes) return rule.message ?? defaultMessage(rule, field);
  }

  return null;
};

/**
 * Runs the client rules over a field set - all fields, or just one.
 * Returns an error bag shaped like the server's ({ field: [message] }).
 */
export const clientValidateFields = (
  fields: Fields,
  values: Record<string, FieldValue>,
  only?: string,
): FieldErrors => {
  const errors: FieldErrors = {};
  for (const [name, config] of Object.entries(fields)) {
    if (only && name !== only) continue;
    if (!config.rules) continue;
    const value = values[name] ?? (config.type === 'checkbox' || config.type === 'select-multiple' ? [] : '');
    const message = validateFieldValue(name, value, parseRules(config.rules), values);
    if (message) {
      errors[name] = [message];
    }
  }

  return errors;
};

/** True if any of the field's rules is `phone` / `phone[...]`. */
export const hasPhoneRule = (rules?: RuleMessages): boolean =>
  rules !== undefined && Object.keys(rules).some((key) => /^phone(\[|$)/.test(key));
