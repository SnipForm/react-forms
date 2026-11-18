import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { DEFAULT_API_BASE, initSession, submitSession, validateSession } from './api';
import { InteractionTracker } from './behavior';
import { loadPhoneParser, phoneSettled } from './phone';
import { clientValidateFields, hasPhoneRule } from './rules';
import { SnipFormError } from './types';
import type {
  FieldConfig,
  FieldErrors,
  FieldProps,
  FieldType,
  FieldValue,
  Fields,
  FormProps,
  GateReason,
  HoneypotProps,
  RegisterOptions,
  Session,
  SnipFormHandle,
  SnipFormOptions,
  Status,
  SubmitSuccess,
} from './types';

const BLUR_VALIDATE_DELAY_MS = 250;

/**
 * The whole form, as React state.
 *
 *   const form = useSnipForm({
 *     key: 'FORM_KEY',
 *     fields: {
 *       email: { type: 'email', rules: { required: 'Email is required', email: null } },
 *       plan:  { type: 'select' },
 *     },
 *   });
 *
 *   <SnipForm form={form}>
 *     <input {...form.register('email')} />
 *     <FieldError form={form} name="email" />
 *     <button disabled={!form.isReady}>Send</button>
 *   </SnipForm>
 *
 * Lifecycle: idle -> (first human interaction) initializing -> ready ->
 * submitting -> success | ready (validation errors) | error (recoverable).
 * `fatal` means the form can't run at all (bad key, unpublished, domain).
 *
 * Fields come from `options.fields`, from `registerField()` (what the
 * declarative components call on mount), or both. The server freezes the
 * field set per session - so a field-set change after the session opened
 * marks it stale, and the next submit or validation silently opens a fresh
 * session with the current set. Interaction signals survive the swap.
 */
export const useSnipForm = (options: SnipFormOptions): SnipFormHandle => {
  const apiBase = options.apiBase ?? DEFAULT_API_BASE;
  const clientValidate = options.clientValidate ?? true;

  const [values, setValues] = useState<Record<string, FieldValue>>(() => initialValues(options.fields ?? {}));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [status, setStatus] = useState<Status>('idle');
  const [fatal, setFatal] = useState<string | null>(null);
  const [error, setError] = useState<SnipFormError | null>(null);
  const [success, setSuccess] = useState<SubmitSuccess | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [validatedFields, setValidatedFields] = useState<ReadonlySet<string>>(new Set());
  const [fieldsVersion, setFieldsVersion] = useState(0);

  const formRef = useRef<HTMLFormElement>(null);
  const tracker = useRef(new InteractionTracker()).current;
  const registryRef = useRef<Fields>({ ...(options.fields ?? {}) });
  const staleRef = useRef(false);
  const valuesRef = useRef(values);
  valuesRef.current = values;
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const statusRef = useRef(status);
  statusRef.current = status;
  const initPromise = useRef<Promise<Session | null> | null>(null);
  const blurTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // -----------------------------------------------
  // Field registry - what the declarative components feed
  // -----------------------------------------------

  const registerField = useCallback((name: string, config: FieldConfig = {}): void => {
    const existing = registryRef.current[name];
    if (existing && JSON.stringify(existing) === JSON.stringify(config)) {
      return;
    }
    registryRef.current = { ...registryRef.current, [name]: config };
    if (sessionRef.current || initPromise.current) {
      staleRef.current = true;
    }
    if (config.initial !== undefined) {
      setValues((current) => (name in current ? current : { ...current, [name]: config.initial as FieldValue }));
    }
    setFieldsVersion((version) => version + 1);
  }, []);

  const unregisterField = useCallback((name: string): void => {
    if (!(name in registryRef.current)) {
      return;
    }
    const next = { ...registryRef.current };
    delete next[name];
    registryRef.current = next;
    if (sessionRef.current || initPromise.current) {
      staleRef.current = true;
    }
    setValues((current) => {
      if (!(name in current)) {
        return current;
      }
      const trimmed = { ...current };
      delete trimmed[name];

      return trimmed;
    });
    setErrors((current) => {
      if (!current[name]) {
        return current;
      }
      const trimmed = { ...current };
      delete trimmed[name];

      return trimmed;
    });
    setFieldsVersion((version) => version + 1);
  }, []);

  // -----------------------------------------------
  // Session
  // -----------------------------------------------

  const init = useCallback((): Promise<Session | null> => {
    if (initPromise.current) {
      return initPromise.current;
    }
    setStatus('initializing');
    staleRef.current = false;
    initPromise.current = initSession(apiBase, options.key, registryRef.current)
      .then((opened) => {
        setSession(opened);
        setStatus('ready');

        return opened;
      })
      .catch((cause: unknown) => {
        const failure = cause instanceof SnipFormError ? cause : new SnipFormError(String(cause), 'fatal');
        if (failure.kind === 'fatal') {
          setFatal(failure.message);
          setStatus('fatal');
        } else {
          setError(failure);
          setStatus('error');
        }
        options.onError?.(failure);

        return null;
      })
      .finally(() => {
        initPromise.current = null;
      });

    return initPromise.current;
  }, [apiBase, options.key, options.onError]);

  /**
   * The session to talk to right now. A stale one (the field set changed
   * after it opened) is discarded and replaced - the server freezes fields
   * per session, so a fresh session is the only way to change the set.
   */
  const freshSession = useCallback(async (): Promise<Session | null> => {
    if (staleRef.current && sessionRef.current) {
      sessionRef.current = null;
      setSession(null);
    }
    const live = sessionRef.current ?? (await init());
    // The registry changed while that init was in flight - go once more.
    if (live && staleRef.current) {
      sessionRef.current = null;
      setSession(null);

      return init();
    }

    return live;
  }, [init]);

  const openGate = useCallback(
    (reason: GateReason): void => {
      tracker.openGate(reason);
    },
    [tracker],
  );

  // The gate opening is what starts the session (unless initOn: 'mount').
  useEffect(() => {
    tracker.listen();
    tracker.onGateOpen(() => {
      if (statusRef.current === 'idle' && options.initOn !== 'mount') {
        void init();
      }
    });
    if (options.initOn === 'mount') {
      void init();
    }

    return () => tracker.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Visible in the viewport counts as a human signal too.
  useEffect(() => {
    const element = formRef.current;
    if (!element || typeof IntersectionObserver === 'undefined') {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          openGate('visible');
          observer.disconnect();
        }
      },
      { threshold: 0.1, rootMargin: '50px' },
    );
    observer.observe(element);

    return () => observer.disconnect();
  }, [openGate]);

  // -----------------------------------------------
  // Values
  // -----------------------------------------------

  const setValue = useCallback(
    (name: string, value: FieldValue): void => {
      tracker.touch(name);
      setValues((current) => ({ ...current, [name]: value }));
    },
    [tracker],
  );

  const wireMap = useMemo(() => {
    const map: Record<string, FieldType> = {};
    for (const [name, config] of Object.entries(registryRef.current)) {
      map[name] = config.type ?? 'text';
    }

    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fieldsVersion]);

  const wirePayload = useCallback(
    (live: Session): { map: Record<string, FieldType>; data: Record<string, FieldValue> } => {
      const map = { ...wireMap };
      const data: Record<string, FieldValue> = {};
      for (const name of Object.keys(map)) {
        data[name] = valuesRef.current[name] ?? (map[name] === 'checkbox' || map[name] === 'select-multiple' ? [] : '');
      }
      if (live.honeypot) {
        map[live.honeypot] = 'textarea';
        data[live.honeypot] = '';
      }

      return { map, data };
    },
    [wireMap],
  );

  // -----------------------------------------------
  // Validate (server-true, nothing consumed)
  // -----------------------------------------------

  const markValidated = useCallback((field?: string): void => {
    setValidatedFields((current) => {
      const next = new Set(current);
      if (field) {
        next.add(field);
      } else {
        for (const name of Object.keys(registryRef.current)) {
          next.add(name);
        }
      }

      return next;
    });
  }, []);

  const validate = useCallback(
    async (field?: string): Promise<FieldErrors> => {
      let live = sessionRef.current;
      if (!live) {
        return {};
      }
      if (staleRef.current) {
        live = await freshSession();
        if (!live) {
          return {};
        }
      }
      const { map, data } = wirePayload(live);
      try {
        const found = await validateSession(apiBase, live.token, map, data);
        setErrors((current) => {
          if (!field) {
            return found;
          }
          const next = { ...current };
          if (found[field]) {
            next[field] = found[field];
          } else {
            delete next[field];
          }

          return next;
        });
        markValidated(field);

        return found;
      } catch (cause) {
        // Validation is advisory - never surface its transport failures.
        if (cause instanceof SnipFormError && cause.kind === 'expired') {
          setSession(null);
          setStatus('idle');
          void init();
        }

        return {};
      }
    },
    [apiBase, freshSession, init, markValidated, wirePayload],
  );

  const scheduleBlurValidation = useCallback(
    (name: string): void => {
      if (options.validateOn !== 'blur') {
        return;
      }
      clearTimeout(blurTimers.current[name]);
      blurTimers.current[name] = setTimeout(() => {
        void validate(name);
      }, BLUR_VALIDATE_DELAY_MS);
    },
    [options.validateOn, validate],
  );

  /**
   * Instant, local check of one field's rules on blur - no network. The
   * same rule declarations the server reads, so they can't disagree; rules
   * the browser can't run (active_url, regex, not_regex) are left to the
   * server. Disable with clientValidate: false.
   */
  const clientCheckField = useCallback(
    (name: string): void => {
      const found = clientValidateFields(registryRef.current, valuesRef.current, name);
      setErrors((current) => {
        const next = { ...current };
        if (found[name]) {
          next[name] = found[name];
        } else {
          delete next[name];
        }

        return next;
      });
      markValidated(name);
    },
    [markValidated],
  );

  // -----------------------------------------------
  // Submit
  // -----------------------------------------------

  const submit = useCallback(async (): Promise<void> => {
    if (statusRef.current === 'submitting' || statusRef.current === 'fatal') {
      return;
    }
    openGate('click');

    // Client-side gate: catch what the browser can catch before any network.
    // The server still re-validates everything that gets through.
    if (clientValidate) {
      // `phone` needs libphonenumber-js, loaded on demand: wait for it.
      if (!phoneSettled() && Object.values(registryRef.current).some((field) => hasPhoneRule(field.rules))) {
        await loadPhoneParser();
      }
      const found = clientValidateFields(registryRef.current, valuesRef.current);
      if (Object.keys(found).length > 0) {
        setErrors(found);
        markValidated();
        options.onValidationError?.(found);

        return;
      }
    }

    let live = await freshSession();
    if (!live) {
      return;
    }

    setStatus('submitting');
    setError(null);

    const attempt = async (current: Session, retried: boolean): Promise<void> => {
      const { map, data } = wirePayload(current);
      try {
        const outcome = await submitSession(apiBase, current.token, map, data, tracker.payload());
        if (!outcome.validated) {
          setErrors(outcome.errors);
          setStatus('ready');
          markValidated();
          options.onValidationError?.(outcome.errors);

          return;
        }
        const result: SubmitSuccess = { html: outcome.html, values: { ...valuesRef.current } };
        setErrors({});
        setSuccess(result);
        setSession(null);
        setStatus('success');
        options.onSuccess?.(result);
      } catch (cause) {
        const failure = cause instanceof SnipFormError ? cause : new SnipFormError(String(cause), 'server');

        // Expired / consumed / IP changed: open a fresh session and try once more.
        if (failure.kind === 'expired' && !retried) {
          setSession(null);
          sessionRef.current = null;
          live = await init();
          if (live) {
            return attempt(live, true);
          }
        }

        setError(failure);
        setStatus('error');
        options.onError?.(failure);
      }
    };

    await attempt(live, false);
  }, [apiBase, clientValidate, freshSession, init, markValidated, openGate, options, tracker, wirePayload]);

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>): void => {
      event.preventDefault();
      void submit();
    },
    [submit],
  );

  const reset = useCallback((): void => {
    setValues(initialValues(registryRef.current));
    setErrors({});
    setSuccess(null);
    setError(null);
    setSession(null);
    setValidatedFields(new Set());
    tracker.reset();
    setStatus('idle');
  }, [tracker]);

  // -----------------------------------------------
  // register() - bind an input to a field
  // -----------------------------------------------

  const register = useCallback(
    (name: string, registerOptions: RegisterOptions = {}): FieldProps => {
      const type = wireMap[name] ?? 'text';
      const current = valuesRef.current[name];
      const option = registerOptions.value ?? 'on';

      const onChange = (event: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>): void => {
        const target = event.target;
        if (type === 'checkbox') {
          const selected = new Set(Array.isArray(current) ? current : []);
          if ((target as HTMLInputElement).checked) {
            selected.add(option);
          } else {
            selected.delete(option);
          }
          setValue(name, [...selected]);

          return;
        }
        if (type === 'select-multiple') {
          const picked = Array.from((target as HTMLSelectElement).selectedOptions).map((o) => o.value);
          setValue(name, picked);

          return;
        }
        setValue(name, target.value);
      };

      const bound: FieldProps = {
        name,
        onChange,
        onFocus: () => {
          tracker.focus(name);
          openGate('focus');
          if (clientValidate && !phoneSettled() && hasPhoneRule(registryRef.current[name]?.rules)) {
            void loadPhoneParser();
          }
        },
        onBlur: () => {
          if (clientValidate) {
            if (!phoneSettled() && hasPhoneRule(registryRef.current[name]?.rules)) {
              void loadPhoneParser().then(() => clientCheckField(name));
            } else {
              clientCheckField(name);
            }
          }
          scheduleBlurValidation(name);
        },
        onKeyDown: () => {
          tracker.keystroke();
          openGate('keydown');
        },
        'aria-invalid': errors[name] ? true : undefined,
      };

      if (type === 'checkbox') {
        bound.value = option;
        bound.checked = Array.isArray(current) && current.includes(option);
      } else if (type === 'radio') {
        bound.value = option;
        bound.checked = current === option;
      } else if (type === 'select-multiple') {
        bound.value = Array.isArray(current) ? current : [];
        bound.multiple = true;
      } else {
        bound.value = typeof current === 'string' ? current : '';
      }

      return bound;
    },
    [clientCheckField, clientValidate, errors, openGate, scheduleBlurValidation, setValue, tracker, wireMap],
  );

  // -----------------------------------------------
  // Props bundles
  // -----------------------------------------------

  const formProps: FormProps = useMemo(
    () => ({
      ref: formRef,
      noValidate: true,
      onSubmit: handleSubmit,
      onFocusCapture: () => openGate('focus'),
      onClickCapture: () => openGate('click'),
      onKeyDownCapture: () => openGate('keydown'),
      onTouchStartCapture: () => openGate('touch'),
    }),
    [handleSubmit, openGate],
  );

  const honeypotProps: HoneypotProps | null = useMemo(() => {
    if (!session?.honeypot) {
      return null;
    }

    return {
      name: session.honeypot,
      value: '',
      tabIndex: -1,
      autoComplete: 'off',
      'aria-hidden': true,
      readOnly: true,
      style: { position: 'absolute', left: '-10000px', width: 1, height: 1, opacity: 0, overflow: 'hidden' },
    };
  }, [session?.honeypot]);

  const fieldError = useCallback((name: string): string | undefined => errors[name]?.[0], [errors]);

  const fieldValid = useCallback(
    (name: string): boolean => validatedFields.has(name) && !errors[name],
    [errors, validatedFields],
  );

  return {
    status,
    values,
    errors,
    fatal,
    error,
    success,
    branding: session?.branding ?? null,
    isSubmitting: status === 'submitting',
    isReady: status === 'ready',
    register,
    setValue,
    fieldError,
    fieldValid,
    registerField,
    unregisterField,
    submit,
    handleSubmit,
    validate,
    reset,
    formProps,
    honeypotProps,
  };
};

// -----------------------------------------------
// Helpers
// -----------------------------------------------

const initialValues = (fields: Fields): Record<string, FieldValue> => {
  const values: Record<string, FieldValue> = {};
  for (const [name, config] of Object.entries(fields)) {
    if (config.initial !== undefined) {
      values[name] = config.initial;
    } else {
      values[name] = config.type === 'checkbox' || config.type === 'select-multiple' ? [] : '';
    }
  }

  return values;
};
