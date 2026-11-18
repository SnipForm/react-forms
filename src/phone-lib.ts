/**
 * The one libphonenumber-js function the `phone` rule needs, in its own
 * module so the lazy `import()` in phone.ts pulls in only that.
 *
 * "max" metadata: number types (`phone[mobile]`) need it, and "min" lets
 * through numbers with a digit too many (+27 82 123 45678).
 */
export { parsePhoneNumberFromString } from 'libphonenumber-js/max';
