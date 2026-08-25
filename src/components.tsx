import type { ElementType, FormHTMLAttributes, ReactNode } from 'react';
import type { SnipFormHandle } from './types';

// -----------------------------------------------
// SnipForm - the <form> with everything wired
// -----------------------------------------------

interface SnipFormProps extends Omit<FormHTMLAttributes<HTMLFormElement>, 'onSubmit'> {
  form: SnipFormHandle;
  children: ReactNode;
}

/**
 * A plain <form> with the hook's props applied and the honeypot rendered.
 * Purely optional sugar - spreading `form.formProps` onto your own <form>
 * and rendering `<Honeypot form={form} />` yourself is the same thing.
 */
export const SnipForm = ({ form, children, ...rest }: SnipFormProps) => {
  return (
    <form {...rest} {...form.formProps}>
      {children}
      <Honeypot form={form} />
    </form>
  );
};

// -----------------------------------------------
// Honeypot - the bot trap, present once the session is open
// -----------------------------------------------

export const Honeypot = ({ form }: { form: SnipFormHandle }) => {
  if (!form.honeypotProps) return null;

  return <input type={'text'} {...form.honeypotProps} />;
};

// -----------------------------------------------
// FieldError - first message for a field, or nothing
// -----------------------------------------------

interface FieldErrorProps {
  form: SnipFormHandle;
  name: string;
  as?: ElementType;
  className?: string;
}

export const FieldError = ({ form, name, as: Tag = 'p', className }: FieldErrorProps) => {
  const message = form.fieldError(name);
  if (!message) return null;

  return (
    <Tag className={className} role={'alert'}>
      {message}
    </Tag>
  );
};

// -----------------------------------------------
// Branding - the "Powered by SnipForm" link free plans must show
// -----------------------------------------------

export const Branding = ({ form, className }: { form: SnipFormHandle; className?: string }) => {
  if (!form.branding) return null;

  return (
    <a className={className} href={form.branding.link} target={'_blank'} rel={'noreferrer'}>
      {form.branding.label}
    </a>
  );
};
