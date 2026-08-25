import { describe, expect, it } from 'vitest';
import { signFor } from './signature';

/**
 * Cross-implementation vectors: the expected values were produced by the
 * SERVER's PHP `_signer()` for these exact inputs, so a drift in either
 * implementation fails here rather than as a 403 in production.
 */
describe('signFor', () => {
  it.each([
    ['demo-key-123', '2026-08-21T12:00:00Z', 3875461403],
    ['3f9c2b', '2026-01-05T08:30:00Z', 4236928582],
    ['7b1e3a9c-4d2f-4e8a-9c1b-2f3e4d5a6b7c', '2026-12-31T23:59:59Z', 713888460],
  ])('matches the PHP signer for %s on %s', (key, iso, expected) => {
    expect(signFor(key, new Date(iso))).toBe(expected);
  });

  it('is unsigned 32-bit', () => {
    const value = signFor('anything', new Date('2026-08-21T00:00:00Z'));

    expect(Number.isInteger(value)).toBe(true);
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThanOrEqual(0xffffffff);
  });

  it('uses the UTC date, not the local one', () => {
    // 23:30 in UTC-8 is the NEXT day in UTC - the day component must follow UTC.
    const lateEvening = new Date('2026-08-21T07:30:00Z'); // 23:30 on the 20th in Los Angeles
    const sameUtcDay = new Date('2026-08-21T20:00:00Z');

    expect(signFor('k', lateEvening)).toBe(signFor('k', sameUtcDay));
    expect(signFor('k', lateEvening)).not.toBe(signFor('k', new Date('2026-08-20T20:00:00Z')));
  });
});
