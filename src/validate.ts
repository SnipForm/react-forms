import type { RuleMessages, ValidateProp } from './types';

/**
 * Normalise the three `validate` shapes the declarative components accept
 * (string, string array, message map) into the RuleMessages map the wire
 * format uses. `null` means "use the server's default message".
 */
export const normalizeValidate = (validate?: ValidateProp): RuleMessages | undefined => {
  if (validate === undefined) {
    return undefined;
  }
  if (typeof validate === 'string') {
    return { [validate]: null };
  }
  if (Array.isArray(validate)) {
    const rules: RuleMessages = {};
    for (const rule of validate) {
      rules[rule] = null;
    }

    return rules;
  }

  return validate;
};
