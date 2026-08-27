import { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import type { SnipFormConfig, SnipFormHandle } from './types';

// -----------------------------------------------
// Global config - the React analog of the Astro integration
// -----------------------------------------------

const ConfigContext = createContext<SnipFormConfig>({});

export interface SnipFormProviderProps extends SnipFormConfig {
  children: ReactNode;
}

/**
 * App-level defaults for every form below it: apiBase, validateOn, initOn
 * and the callbacks. Optional - forms work without it - and every value can
 * be overridden per form.
 *
 *   <SnipFormProvider validateOn="blur">
 *     <App />
 *   </SnipFormProvider>
 */
export const SnipFormProvider = ({ children, ...config }: SnipFormProviderProps) => {
  const value = useMemo(
    () => config,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      config.apiBase,
      config.validateOn,
      config.clientValidate,
      config.initOn,
      config.onSuccess,
      config.onValidationError,
      config.onError,
    ],
  );

  return <ConfigContext.Provider value={value}>{children}</ConfigContext.Provider>;
};

export const useSnipFormConfig = (): SnipFormConfig => useContext(ConfigContext);

// -----------------------------------------------
// Per-form context - what <SnipForm> provides to its children
// -----------------------------------------------

export const FormContext = createContext<SnipFormHandle | null>(null);

/** The nearest <SnipForm>'s handle. Throws outside of one. */
export const useFormContext = (): SnipFormHandle => {
  const form = useContext(FormContext);
  if (!form) {
    throw new Error('useFormContext must be used inside a <SnipForm>');
  }

  return form;
};

/** `form` prop wins, context fills in - how every component resolves its handle. */
export const useResolvedForm = (form?: SnipFormHandle): SnipFormHandle => {
  const fromContext = useContext(FormContext);
  const resolved = form ?? fromContext;
  if (!resolved) {
    throw new Error('SnipForm components need a `form` prop or a parent <SnipForm>');
  }

  return resolved;
};
