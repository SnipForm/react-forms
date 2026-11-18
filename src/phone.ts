/**
 * The `phone` rule, client side.
 *
 * The server validates `phone` with propaganistas/laravel-phone (Google's
 * libphonenumber data). This mirrors that rule's parameters and decisions
 * with libphonenumber-js, so a number the browser accepts is one the server
 * accepts. `src/test/phone-cases.json` holds the server's answers and
 * the tests check this file gives the same ones.
 *
 * Parameters, comma separated, in any case (HTML lowercases attribute names):
 * - `za`, `gb`, ...       country codes the number must belong to; local
 *                         numbers ("082 123 4567") are read as these countries
 * - `international`       also allow any valid number written with "+"
 * - `mobile`, `!mobile`   allow / block a number type (any libphonenumber type)
 * - `lenient`             only check the length, not the number ranges
 * - a field name          read the country from that field
 * Without a country, numbers must be written internationally ("+27 ...").
 * A field named `<field>_country` is picked up as the country automatically.
 *
 * The metadata is ~50 KB gzipped, so it loads on demand: `loadPhoneParser()`
 * the first time a field with a phone rule gets focus. Until it has loaded,
 * `checkPhone` cannot run and the rule is left to the server.
 */

import type { CountryCode, PhoneNumber } from 'libphonenumber-js';

type ParseFn = (text: string, defaultCountry?: CountryCode) => PhoneNumber | undefined;

/** libphonenumber's number types, as laravel-phone accepts them (case-insensitive). */
const TYPES = new Set([
  'FIXED_LINE',
  'MOBILE',
  'FIXED_LINE_OR_MOBILE',
  'TOLL_FREE',
  'PREMIUM_RATE',
  'SHARED_COST',
  'VOIP',
  'PERSONAL_NUMBER',
  'PAGER',
  'UAN',
  'UNKNOWN',
  'EMERGENCY',
  'VOICEMAIL',
  'SHORT_CODE',
  'STANDARD_RATE',
]);

const isType = (name: string) => TYPES.has(name.toUpperCase());

let parser: ParseFn | null = null;
let loading: Promise<ParseFn | null> | null = null;
let settled = false;

/** Loads libphonenumber-js once. Resolves to null if it fails to load (the server still checks). */
export function loadPhoneParser(): Promise<ParseFn | null> {
  loading ??= import('./phone-lib')
    .then((lib) => (parser = lib.parsePhoneNumberFromString))
    .catch(() => null)
    .finally(() => (settled = true));
  return loading;
}

/** True once loading has finished, whether or not it worked. */
export function phoneSettled(): boolean {
  return settled;
}

/** The loaded parser, or null before `loadPhoneParser()` has finished. */
export function phoneParser(): ParseFn | null {
  return parser;
}

/** True when a `phone` rule can be checked right now. */
export function phoneReady(): boolean {
  return parser !== null;
}

/** For tests: use this parser instead of loading one. */
export function setPhoneParser(parse: ParseFn | null): void {
  parser = parse;
  loading = parse ? Promise.resolve(parse) : null;
  settled = parse !== null;
}

interface PhoneOptions {
  countries: string[];
  countryField: string | null;
  allowed: string[];
  blocked: string[];
  international: boolean;
  lenient: boolean;
}

/** Reads `phone[...]` parameters in the order laravel-phone does. */
function parseParams(param: string | null, values: Record<string, unknown>): PhoneOptions {
  const options: PhoneOptions = {
    countries: [],
    countryField: null,
    allowed: [],
    blocked: [],
    international: false,
    lenient: false,
  };
  for (const raw of (param ?? '').split(',')) {
    const p = raw.trim();
    if (!p) continue;
    if (p.startsWith('!') && isType(p.slice(1))) options.blocked.push(p.slice(1).toUpperCase());
    else if (p.toLowerCase() === 'lenient') options.lenient = true;
    else if (p.toLowerCase() === 'international') options.international = true;
    else if (isType(p)) options.allowed.push(p.toUpperCase());
    else if (p in values) options.countryField = p;
    else options.countries.push(p.toUpperCase());
  }
  return options;
}

const KEYPAD: Record<string, string> = {};
for (const [digit, letters] of Object.entries({
  2: 'ABC',
  3: 'DEF',
  4: 'GHI',
  5: 'JKL',
  6: 'MNO',
  7: 'PQRS',
  8: 'TUV',
  9: 'WXYZ',
})) {
  for (const letter of letters) KEYPAD[letter] = digit;
}
const EXTENSION = /\s*(?:;\s*ext=|ext\.?|extension|#|x)\s*\d+\s*$/i;

/**
 * Letters the way the server's libphonenumber reads them: three or more are
 * keypad digits ("+1 800 FLOWERS"), fewer are dropped. A "tel:" prefix and a
 * trailing extension are set aside first, as the server does.
 */
function readLetters(value: string): string {
  const core = value.replace(/^\s*tel:/i, '').replace(EXTENSION, '');
  const letters = core.match(/[a-z]/gi)?.length ?? 0;
  if (letters === 0) return value;
  return letters >= 3
    ? core.replace(/[a-z]/gi, (letter) => KEYPAD[letter.toUpperCase()] ?? '')
    : core.replace(/[a-z]/gi, '');
}

function ofType(number: PhoneNumber, types: string[]): boolean {
  const all =
    types.includes('FIXED_LINE') || types.includes('MOBILE')
      ? [...types, 'FIXED_LINE_OR_MOBILE']
      : types;
  const type = number.getType();
  return type !== undefined && all.includes(type);
}

/**
 * Checks one value against a `phone` rule.
 *
 * @param field  the field's name, for the `<field>_country` lookup
 * @param values all form values, for country fields
 */
export function checkPhone(
  parse: ParseFn,
  value: string,
  param: string | null,
  field: string,
  values: Record<string, unknown>,
): boolean {
  const options = parseParams(param, values);
  value = readLetters(value);
  const fromField = values[options.countryField ?? `${field}_country`];
  const countries = [
    typeof fromField === 'string' ? fromField.toUpperCase() : '',
    ...options.countries,
  ].filter(Boolean);

  // Which country is it? Written with "+": the number says. Otherwise the
  // first allowed country it's valid for (possible, when lenient).
  let number: PhoneNumber | undefined;
  let country: string | undefined;
  try {
    number = parse(value);
    country = number?.country;
    if (!number) {
      for (const candidate of countries) {
        const local = parse(value, candidate as CountryCode);
        if (!local) continue;
        if (options.lenient ? local.isPossible() : local.isValid() && local.country === candidate) {
          number = local;
          country = options.lenient ? candidate : local.country;
          break;
        }
      }
    }
  } catch {
    return false;
  }
  if (!number) return false;

  if (!options.international && countries.length > 0 && (!country || !countries.includes(country)))
    return false;
  if (options.allowed.length > 0 && !ofType(number, options.allowed)) return false;
  if (options.blocked.length > 0 && ofType(number, options.blocked)) return false;

  return options.lenient ? number.isPossible() : number.isValid();
}
