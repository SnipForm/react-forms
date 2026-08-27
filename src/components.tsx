import type { ButtonHTMLAttributes, ElementType, FormHTMLAttributes, HTMLAttributes, ReactNode } from 'react';
import { FormContext, useResolvedForm, useSnipFormConfig } from './context';
import { useSnipForm } from './useSnipForm';
import type { Fields, SnipFormConfig, SnipFormHandle } from './types';

// -----------------------------------------------
// SnipForm - the <form> with everything wired
// -----------------------------------------------

type FormAttributes = Omit<FormHTMLAttributes<HTMLFormElement>, 'onSubmit' | 'onError' | 'children'>;

type SnipFormChildren = ReactNode | ((form: SnipFormHandle) => ReactNode);

interface BoundSnipFormProps extends FormAttributes {
  /** A handle from useSnipForm - the headless path. */
  form: SnipFormHandle;
  formKey?: never;
  children: SnipFormChildren;
}

interface ManagedSnipFormProps extends FormAttributes, SnipFormConfig {
  /**
   * The form key from the SnipForm dashboard. (Astro's prop is `key`, but
   * `key` is reserved in React.) The form is created internally and provided
   * to children via context - no hook call needed.
   */
  formKey: string;
  form?: never;
  /** Optional upfront field declarations - declarative children register themselves. */
  fields?: Fields;
  children: SnipFormChildren;
}

export type SnipFormProps = BoundSnipFormProps | ManagedSnipFormProps;

/**
 * The form container. Two ways in:
 *
 *   <SnipForm formKey="contact-form">...</SnipForm>     // self-contained
 *   <SnipForm form={form}>...</SnipForm>                // bring your own hook
 *
 * Either way it renders a <form> with the hook's props applied, the honeypot
 * rendered, and the handle provided to every child component via context.
 * `children` may be a render function receiving the handle.
 */
export const SnipForm = (props: SnipFormProps) => {
  if (props.form) {
    const { form, children, ...rest } = props;

    return (
      <BoundForm form={form} {...rest}>
        {children}
      </BoundForm>
    );
  }

  const {
    formKey,
    fields,
    validateOn,
    clientValidate,
    initOn,
    apiBase,
    onSuccess,
    onValidationError,
    onError,
    children,
    ...rest
  } = props as ManagedSnipFormProps;

  return (
    <ManagedForm
      formKey={formKey}
      fields={fields}
      validateOn={validateOn}
      clientValidate={clientValidate}
      initOn={initOn}
      apiBase={apiBase}
      onSuccess={onSuccess}
      onValidationError={onValidationError}
      onError={onError}
      formAttributes={rest}
    >
      {children}
    </ManagedForm>
  );
};

const BoundForm = ({ form, children, ...rest }: BoundSnipFormProps) => {
  return (
    <FormContext.Provider value={form}>
      <form {...rest} {...form.formProps}>
        {typeof children === 'function' ? children(form) : children}
        <Honeypot form={form} />
      </form>
    </FormContext.Provider>
  );
};

interface ManagedFormProps extends SnipFormConfig {
  formKey: string;
  fields?: Fields;
  formAttributes: FormAttributes;
  children: SnipFormChildren;
}

const ManagedForm = ({ formKey, fields, formAttributes, children, ...config }: ManagedFormProps) => {
  const defaults = useSnipFormConfig();
  const form = useSnipForm({
    key: formKey,
    fields,
    validateOn: config.validateOn ?? defaults.validateOn,
    clientValidate: config.clientValidate ?? defaults.clientValidate,
    initOn: config.initOn ?? defaults.initOn,
    apiBase: config.apiBase ?? defaults.apiBase,
    onSuccess: config.onSuccess ?? defaults.onSuccess,
    onValidationError: config.onValidationError ?? defaults.onValidationError,
    onError: config.onError ?? defaults.onError,
  });

  return (
    <BoundForm form={form} {...formAttributes}>
      {children}
    </BoundForm>
  );
};

// -----------------------------------------------
// Honeypot - the bot trap, present once the session is open
// -----------------------------------------------

export const Honeypot = ({ form }: { form?: SnipFormHandle }) => {
  const resolved = useResolvedForm(form);
  if (!resolved.honeypotProps) return null;

  return <input type={'text'} {...resolved.honeypotProps} />;
};

// -----------------------------------------------
// ErrorMessage / FieldError - first message for a field, or nothing
// -----------------------------------------------

interface ErrorMessageProps extends HTMLAttributes<HTMLElement> {
  form?: SnipFormHandle;
  /** The field to watch. `field` is accepted as an alias for Astro parity. */
  name?: string;
  field?: string;
  as?: ElementType;
  children?: ReactNode;
}

/**
 * Shows the field's first validation error (or custom children when there is
 * one). Hidden while the field is clean - the Astro <ErrorMessage> behaviour.
 */
export const ErrorMessage = ({ form, name, field, as: Tag = 'span', children, ...rest }: ErrorMessageProps) => {
  const resolved = useResolvedForm(form);
  const target = name ?? field;
  if (!target) return null;
  const message = resolved.fieldError(target);
  if (!message || resolved.success) return null;

  return (
    <Tag role={'alert'} {...rest}>
      {children ?? message}
    </Tag>
  );
};

/** The original error component - same thing as <ErrorMessage> with a <p> default. */
export const FieldError = ({
  form,
  name,
  as = 'p',
  className,
}: {
  form?: SnipFormHandle;
  name: string;
  as?: ElementType;
  className?: string;
}) => {
  return <ErrorMessage form={form} name={name} as={as} className={className} />;
};

// -----------------------------------------------
// ValidMessage - content shown once a field validated clean
// -----------------------------------------------

interface ValidMessageProps extends HTMLAttributes<HTMLElement> {
  form?: SnipFormHandle;
  name?: string;
  field?: string;
  as?: ElementType;
  children?: ReactNode;
}

/**
 * Shown once the field has been server-validated with no errors. Validation
 * happens on blur (validateOn: 'blur') or on submit - until then the field is
 * neither valid nor invalid and nothing renders.
 */
export const ValidMessage = ({ form, name, field, as: Tag = 'span', children, ...rest }: ValidMessageProps) => {
  const resolved = useResolvedForm(form);
  const target = name ?? field;
  if (!target) return null;
  if (!resolved.fieldValid(target) || resolved.success) return null;

  return <Tag {...rest}>{children}</Tag>;
};

// -----------------------------------------------
// SubmitButton - submit with submission-state styling
// -----------------------------------------------

interface SubmitButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'form'> {
  form?: SnipFormHandle;
  /** Replace the label while submitting - Astro's onSubmitText. */
  submittingText?: string;
  /** Class added while submitting - Astro's onSubmitClass. */
  submittingClassName?: string;
  children: ReactNode;
}

export const SubmitButton = ({
  form,
  submittingText,
  submittingClassName,
  className,
  disabled,
  children,
  ...rest
}: SubmitButtonProps) => {
  const resolved = useResolvedForm(form);
  if (resolved.success) return null;
  const submitting = resolved.isSubmitting;
  const classes = [className, submitting ? submittingClassName : undefined].filter(Boolean).join(' ') || undefined;

  return (
    <button type={'submit'} {...rest} className={classes} disabled={disabled || submitting}>
      {submitting && submittingText ? submittingText : children}
    </button>
  );
};

// -----------------------------------------------
// SuccessContent - what replaces the form after a successful submit
// -----------------------------------------------

interface SuccessContentProps extends HTMLAttributes<HTMLElement> {
  form?: SnipFormHandle;
  as?: ElementType;
  /** Render the dashboard's thank-you HTML (with %field% substituted) instead of children. */
  useServerHtml?: boolean;
  children?: ReactNode;
}

/**
 * Renders only after a successful submit. With no children (or with
 * `useServerHtml`) it renders the form's thank-you HTML from the dashboard.
 * The library's field components hide themselves on success, so the swap
 * looks like the Astro one.
 */
export const SuccessContent = ({ form, as: Tag = 'div', useServerHtml, children, ...rest }: SuccessContentProps) => {
  const resolved = useResolvedForm(form);
  if (!resolved.success) return null;
  if (useServerHtml || children === undefined) {
    return <Tag {...rest} dangerouslySetInnerHTML={{ __html: resolved.success.html }} />;
  }

  return <Tag {...rest}>{children}</Tag>;
};

// -----------------------------------------------
// Branding - the "Powered by SnipForm" link free plans must show
// -----------------------------------------------

export const Branding = ({ form, className }: { form?: SnipFormHandle; className?: string }) => {
  const resolved = useResolvedForm(form);
  if (!resolved.branding) return null;

  return (
    <a className={className} href={resolved.branding.link} target={'_blank'} rel={'noreferrer'}>
      {resolved.branding.label}
    </a>
  );
};
