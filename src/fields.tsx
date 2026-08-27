import { useEffect } from 'react';
import type { AllHTMLAttributes, ReactNode } from 'react';
import { ErrorMessage } from './components';
import { useResolvedForm } from './context';
import { normalizeValidate } from './validate';
import type { FieldConfig, FieldType, FieldValue, SnipFormHandle, ValidateProp } from './types';

// -----------------------------------------------
// Shared plumbing
// -----------------------------------------------

interface DeclaredFieldProps extends Omit<AllHTMLAttributes<HTMLElement>, 'name' | 'as' | 'form'> {
  form?: SnipFormHandle;
  /** Field name - the input's name attribute and the error/valid binding. */
  name: string;
  /** Validation rules: "required", ['required', 'email'] or { required: 'Message', email: null }. */
  validate?: ValidateProp;
  /** Initial value. */
  initial?: FieldValue;
  /**
   * Render gate for conditional fields. The field stays registered (so the
   * session never goes stale), only the element hides:
   *
   *   <Field name="phone" when={wantsCall} />
   *
   * Plain `{cond && <Field/>}` also works - the field set change just
   * re-opens the session transparently on the next submit.
   */
  when?: boolean;
  /** Class added while the field has a validation error. */
  errorClassName?: string;
  /** Class added once the field validated clean (blur or submit). */
  validClassName?: string;
}

/** The FieldType the server should treat this element as. */
const deriveType = (element: 'input' | 'textarea' | 'select', type?: string, multiple?: boolean): FieldType => {
  if (element === 'textarea') {
    return 'textarea';
  }
  if (element === 'select') {
    return multiple ? 'select-multiple' : 'select';
  }
  switch (type) {
    case 'email':
    case 'tel':
    case 'url':
    case 'number':
    case 'password':
    case 'hidden':
    case 'date':
    case 'radio':
    case 'checkbox':
      return type;
    default:
      return 'text';
  }
};

/** Register the field's config with the form for as long as the component is mounted. */
const useFieldRegistration = (form: SnipFormHandle, name: string, config: FieldConfig): void => {
  const serialized = JSON.stringify(config);
  const { registerField, unregisterField } = form;

  useEffect(() => {
    registerField(name, JSON.parse(serialized) as FieldConfig);

    return () => unregisterField(name);
  }, [name, registerField, serialized, unregisterField]);
};

const stateClasses = (
  form: SnipFormHandle,
  name: string,
  base?: string,
  errorClassName?: string,
  validClassName?: string,
): string | undefined => {
  const parts = [base];
  if (form.fieldError(name)) {
    parts.push(errorClassName);
  } else if (form.fieldValid(name)) {
    parts.push(validClassName);
  }

  return parts.filter(Boolean).join(' ') || undefined;
};

// -----------------------------------------------
// Input / Textarea / Select - standalone declared elements
// -----------------------------------------------

/**
 * A declared <input>: names its field, carries its rules, wires the spam
 * signals, and styles itself by validation state. No built-in error message -
 * pair it with <ErrorMessage> or use <Field> for the compound version.
 */
export const Input = ({
  form,
  name,
  validate,
  initial,
  when = true,
  errorClassName,
  validClassName,
  className,
  ...rest
}: DeclaredFieldProps) => {
  const resolved = useResolvedForm(form);
  const type = deriveType('input', rest.type);
  useFieldRegistration(resolved, name, { type, rules: normalizeValidate(validate), initial });
  if (!when || resolved.success) return null;

  const option = type === 'radio' || type === 'checkbox' ? { value: rest.value as string | undefined } : undefined;

  return (
    <input
      {...rest}
      className={stateClasses(resolved, name, className, errorClassName, validClassName)}
      {...resolved.register(name, option)}
    />
  );
};

/** <Input> for a <textarea>. */
export const Textarea = ({
  form,
  name,
  validate,
  initial,
  when = true,
  errorClassName,
  validClassName,
  className,
  children,
  ...rest
}: DeclaredFieldProps) => {
  const resolved = useResolvedForm(form);
  useFieldRegistration(resolved, name, { type: 'textarea', rules: normalizeValidate(validate), initial });
  if (!when || resolved.success) return null;

  return (
    <textarea
      {...rest}
      className={stateClasses(resolved, name, className, errorClassName, validClassName)}
      {...resolved.register(name)}
    />
  );
};

/** <Input> for a <select> - children are the options. `multiple` submits an array. */
export const Select = ({
  form,
  name,
  validate,
  initial,
  when = true,
  errorClassName,
  validClassName,
  className,
  children,
  ...rest
}: DeclaredFieldProps) => {
  const resolved = useResolvedForm(form);
  const type = deriveType('select', undefined, rest.multiple);
  useFieldRegistration(resolved, name, { type, rules: normalizeValidate(validate), initial });
  if (!when || resolved.success) return null;

  return (
    <select
      {...rest}
      className={stateClasses(resolved, name, className, errorClassName, validClassName)}
      {...resolved.register(name)}
    >
      {children}
    </select>
  );
};

// -----------------------------------------------
// Field - the compound: element + auto error message
// -----------------------------------------------

interface FieldProps extends DeclaredFieldProps {
  /** Element type: 'input' (default), 'textarea', 'select'. */
  as?: 'input' | 'textarea' | 'select';
  /** Class for the auto-rendered error message. */
  errorMessageClassName?: string;
  /** Suppress the built-in error element (use a standalone <ErrorMessage>). */
  hideError?: boolean;
  children?: ReactNode;
}

/**
 * The Astro <Field>, in React: an input/textarea/select with validation plus
 * an auto-hidden error message right after it.
 *
 *   <Field name="email" type="email" validate={{ required: 'Enter email', email: 'Invalid' }} />
 *   <Field name="role" as="select" validate="required">
 *     <option value="">Select...</option>
 *   </Field>
 */
export const Field = ({ as = 'input', errorMessageClassName, hideError = false, ...props }: FieldProps) => {
  const Element = as === 'textarea' ? Textarea : as === 'select' ? Select : Input;

  return (
    <>
      <Element {...props} />
      {!hideError && props.when !== false && (
        <ErrorMessage form={props.form} name={props.name} className={errorMessageClassName} />
      )}
    </>
  );
};
