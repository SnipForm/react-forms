/**
 * Request signature - byte-exact port of the server's `_signer()`.
 *
 * input = UTC year + key + UTC day-of-month (no leading zero)
 * h = ((h << 5) - h + charCode) as a 32-bit signed int, returned unsigned.
 *
 * Uses the UTC getters directly - the old tracker derived UTC through
 * `toLocaleString`, which straddled midnight badly. The server also accepts
 * yesterday's signature so a form opened before UTC midnight and submitted
 * after still passes.
 */
export const signFor = (key: string, now: Date = new Date()): number => {
  const input = `${now.getUTCFullYear()}${key}${now.getUTCDate()}`;

  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) - hash + input.charCodeAt(i)) | 0;
  }

  return hash >>> 0;
};
