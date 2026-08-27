import type { ChangeEvent, FocusEvent, FormEvent, KeyboardEvent, MouseEvent, RefObject, TouchEvent } from 'react';

// -----------------------------------------------
// Field configuration
// -----------------------------------------------

/** Input type as the server understands it - drives how a value is read and cast. */
export type FieldType =
  | 'text'
  | 'email'
  | 'tel'
  | 'url'
  | 'number'
  | 'password'
  | 'hidden'
  | 'date'
  | 'textarea'
  | 'select'
  | 'select-multiple'
  | 'radio'
  | 'checkbox';

/**
 * Validation rules keyed by rule name, valued by the error message (or null
 * for the server default). Parameterised rules use the `rule[param]` form,
 * exactly as the HTML library's `sf-validate:min[18]` attribute did.
 *
 *   { required: 'Email is required', email: null, 'max_length[120]': null }
 */
export type RuleMessages = Record<string, string | null>;

/**
 * What the `validate` prop on declarative components accepts - the same three
 * shapes as @snipform/astro-forms:
 *
 *   validate="required"
 *   validate={['required', 'integer']}
 *   validate={{ required: 'Name is required', 'min_length[2]': null }}
 */
export type ValidateProp = string | string[] | RuleMessages;

export type FieldValue = string | string[];

export interface FieldConfig {
  type?: FieldType;
  rules?: RuleMessages;
  initial?: FieldValue;
}

export type Fields = Record<string, FieldConfig>;

// -----------------------------------------------
// Hook options + results
// -----------------------------------------------

export type Status = 'idle' | 'initializing' | 'ready' | 'submitting' | 'success' | 'error' | 'fatal';

export type FieldErrors = Record<string, string[]>;

export interface SubmitSuccess {
  /** Thank-you HTML from the form settings, with %field% variables already substituted by the server. */
  html: string;
  values: Record<string, FieldValue>;
}

export type ErrorKind = 'fatal' | 'expired' | 'unauthorized' | 'network' | 'server';

/** Shared form configuration - accepted by the hook, by `<SnipForm formKey>`, and app-wide by `<SnipFormProvider>`. */
export interface SnipFormConfig {
  /** `submit` (default): errors arrive on submit. `blur`: each field is validated server-side as it's left. */
  validateOn?: 'submit' | 'blur';
  /**
   * Client-side validation (default: true): rules are also checked in the
   * browser - instantly on blur and before submit - from the same
   * declarations the server reads. Rules the browser can't run
   * (active_url, regex, not_regex) are left to the server, which always
   * re-validates on submit. Set false for server-only validation.
   */
  clientValidate?: boolean;
  /** `interaction` (default): initialise on the first human touch. `mount`: initialise immediately (scored as bot-like; avoid). */
  initOn?: 'interaction' | 'mount';
  /** Override the API base. Defaults to https://api.snipform.io/v2 */
  apiBase?: string;
  onSuccess?: (result: SubmitSuccess) => void;
  onValidationError?: (errors: FieldErrors) => void;
  onError?: (error: SnipFormError) => void;
}

export interface SnipFormOptions extends SnipFormConfig {
  /** The form key from the SnipForm dashboard. */
  key: string;
  /**
   * Fields declared up front. Optional - declarative components register
   * their own fields on mount. A change to the field set after the session
   * has opened marks the session stale; it is transparently re-initialised
   * on the next submit or validation.
   */
  fields?: Fields;
}

export interface Branding {
  label: string;
  link: string;
}

export interface Session {
  token: string;
  honeypot: string | null;
  branding: Branding | null;
  thankYou: string | null;
}

// -----------------------------------------------
// Register + form props
// -----------------------------------------------

export interface RegisterOptions {
  /** For checkbox groups and radios: the option this input represents. */
  value?: string;
}

export interface FieldProps {
  name: string;
  value?: string | string[];
  checked?: boolean;
  multiple?: boolean;
  onChange: (event: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => void;
  onBlur: (event: FocusEvent<HTMLElement>) => void;
  onFocus: (event: FocusEvent<HTMLElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  'aria-invalid': boolean | undefined;
}

export interface FormProps {
  ref: RefObject<HTMLFormElement>;
  noValidate: true;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onFocusCapture: (event: FocusEvent<HTMLFormElement>) => void;
  onClickCapture: (event: MouseEvent<HTMLFormElement>) => void;
  onKeyDownCapture: (event: KeyboardEvent<HTMLFormElement>) => void;
  onTouchStartCapture: (event: TouchEvent<HTMLFormElement>) => void;
}

export interface HoneypotProps {
  name: string;
  value: '';
  tabIndex: -1;
  autoComplete: 'off';
  'aria-hidden': true;
  readOnly: true;
  style: Record<string, string | number>;
}

export interface SnipFormHandle {
  status: Status;
  values: Record<string, FieldValue>;
  errors: FieldErrors;
  /** Non-recoverable problem - bad key, unpublished form, disallowed domain. Shown instead of the form. */
  fatal: string | null;
  /** Recoverable error from the last submit (network, 403). */
  error: SnipFormError | null;
  success: SubmitSuccess | null;
  branding: Branding | null;
  isSubmitting: boolean;
  isReady: boolean;

  register: (name: string, options?: RegisterOptions) => FieldProps;
  setValue: (name: string, value: FieldValue) => void;
  fieldError: (name: string) => string | undefined;
  /** True once the field has been server-validated (blur or submit) and has no errors. */
  fieldValid: (name: string) => boolean;
  /**
   * Add a field to the form's set. Called by the declarative components on
   * mount; safe at any time - a change after the session opened makes the
   * session stale and it is re-initialised transparently.
   */
  registerField: (name: string, config?: FieldConfig) => void;
  /** Remove a field from the set (and its value/errors). Same staleness rules as registerField. */
  unregisterField: (name: string) => void;
  submit: () => Promise<void>;
  handleSubmit: (event: FormEvent<HTMLFormElement>) => void;
  validate: (field?: string) => Promise<FieldErrors>;
  reset: () => void;

  formProps: FormProps;
  honeypotProps: HoneypotProps | null;
}

// -----------------------------------------------
// Wire shapes
// -----------------------------------------------

export interface InteractionSignals {
  dur: number;
  gt: string;
  k: number;
  f: number;
  m: 0 | 1;
  s: 0 | 1;
  t: number;
  w: 0 | 1;
  p: number;
  l: number;
}

export type GateReason = 'visible' | 'focus' | 'click' | 'keydown' | 'touch' | 'none';

export class SnipFormError extends Error {
  constructor(
    message: string,
    public readonly kind: ErrorKind,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'SnipFormError';
  }
}
