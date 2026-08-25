# @snipform/react

React hooks and components for [SnipForm](https://snipform.io) forms. Server-validated, spam-protected, headless - your markup, your styling, SnipForm's backend.

```bash
npm install @snipform/react
```

## Quick start

```tsx
import { useSnipForm, SnipForm, FieldError } from '@snipform/react';

export function ContactForm() {
  const form = useSnipForm({
    key: 'YOUR_FORM_KEY',
    fields: {
      name:    { type: 'text',     rules: { required: 'Tell us your name' } },
      email:   { type: 'email',    rules: { required: 'Email is required', email: null } },
      message: { type: 'textarea', rules: { required: null, 'max_length[2000]': null } },
    },
  });

  if (form.fatal)   return <p>{form.fatal}</p>;
  if (form.success) return <div dangerouslySetInnerHTML={{ __html: form.success.html }} />;

  return (
    <SnipForm form={form}>
      <input {...form.register('name')} placeholder="Name" />
      <FieldError form={form} name="name" />

      <input {...form.register('email')} placeholder="Email" />
      <FieldError form={form} name="email" />

      <textarea {...form.register('message')} />
      <FieldError form={form} name="message" />

      <button disabled={form.isSubmitting}>Send</button>
    </SnipForm>
  );
}
```

That's a complete, production-grade form: validated by the server with Laravel's rule set, protected by a honeypot and behavioural spam scoring, and rendered entirely by React.

## Why not the script tag?

The HTML library (`sf.iife.js`) works by scanning the DOM for directives and mutating elements - class names, text, `innerHTML`. React owns those elements and overwrites the changes on the next render, so validation state visibly broke. This package never touches the DOM: values, errors, status, and the spam-protection signals all live in React state, and you render whatever you like from them.

## How it works

1. **Idle until a human shows up.** The form sits idle until the visitor focuses, clicks, types, touches, or scrolls it into view. That first interaction opens the session (`initializing` → `ready`). Initialising eagerly on mount is possible (`initOn: 'mount'`) but the spam scorer treats it as bot-like - avoid.
2. **The field set is declared, then frozen.** `fields` is sent at init; the server validates exactly those fields and nothing else. Declare every field the form can ever submit up front, even ones you render conditionally.
3. **Validation is the server's.** The same 34 Laravel rules the dashboard documents, applied by the backend. Nothing is duplicated client-side, so client and server can't disagree.
4. **Submit** posts values, the (empty) honeypot, and behavioural signals. Success returns the form's thank-you HTML with `%field%` variables substituted; validation failure returns per-field messages (all of them, not just the first) and keeps the session open for another try.

## `useSnipForm(options)`

| Option | Type | Default | |
|---|---|---|---|
| `key` | `string` | - | Form key from the dashboard |
| `fields` | `Record<name, { type?, rules?, initial? }>` | - | Every field the form submits |
| `validateOn` | `'submit' \| 'blur'` | `'submit'` | `blur` validates each field server-side as it's left (debounced, nothing consumed) |
| `initOn` | `'interaction' \| 'mount'` | `'interaction'` | When the session opens |
| `apiBase` | `string` | `https://api.snipform.io/v2` | |
| `onSuccess` / `onValidationError` / `onError` | callbacks | | |

**Field types**: `text` `email` `tel` `url` `number` `password` `hidden` `date` `textarea` `select` `select-multiple` `radio` `checkbox`.

**Rules** use the rule name as the key and the message (or `null` for the server default) as the value. Parameters go in square brackets: `{ 'min[18]': 'Must be 18+', 'in[a,b,c]': null }`. Supported: `required email url active_url boolean accepted numeric integer max min in not_in doesnt_start_with doesnt_end_with date after before date_equals same gt gte lt lte regex not_regex alpha alpha_dash alpha_num ip ipv4 ipv6 uuid starts_with min_length max_length`.

### The handle

```ts
form.status          // 'idle' | 'initializing' | 'ready' | 'submitting' | 'success' | 'error' | 'fatal'
form.values          // current values, keyed by field
form.errors          // { field: [message, ...] }
form.fieldError(n)   // first message for a field, or undefined
form.fatal           // unrecoverable init problem (bad key, unpublished form, domain not allowed)
form.error           // recoverable failure from the last submit (network, 403)
form.success         // { html, values } after a successful submit
form.branding        // { label, link } when the plan requires a "powered by" link
form.isReady / form.isSubmitting

form.register(name, { value? })   // props for an input/select/textarea
form.setValue(name, value)        // programmatic updates
form.submit()                     // Promise<void>
form.handleSubmit                 // event handler - what <SnipForm> wires to onSubmit
form.validate(field?)             // server-validate now; returns the error bag
form.reset()                      // back to idle; the next interaction opens a new session

form.formProps        // spread onto your own <form> if you don't use <SnipForm>
form.honeypotProps    // spread onto an <input> - or render <Honeypot form={form} />
```

### Inputs

```tsx
<input {...form.register('email')} />                          // text-likes + textarea + select
<select {...form.register('plan')}>...</select>

<input type="radio" {...form.register('size', { value: 'm' })} />   // one per option
<input type="checkbox" {...form.register('topics', { value: 'news' })} />   // value becomes an array
<input type="checkbox" {...form.register('agree')} />          // single: [] or ['on'] - pair with the `accepted` rule

<select {...form.register('tags')}>...</select>                // type 'select-multiple' -> array value
```

`register()` wires `onFocus` / `onKeyDown` / `onChange` / `onBlur` - keep them attached. They're how the form proves a human filled it in.

### Components

- `<SnipForm form={form}>` - a `<form>` with `formProps` applied and the honeypot rendered. Accepts any form attributes.
- `<Honeypot form={form} />` - the bot trap, if you build your own `<form>`.
- `<FieldError form={form} name="email" as="span" className="..." />` - first error message with `role="alert"`, or nothing.
- `<Branding form={form} />` - the powered-by link when required.

## Validation on blur

```tsx
const form = useSnipForm({ key, fields, validateOn: 'blur' });
```

Each field is validated by the server as the visitor leaves it (debounced 250ms), through a validate-only endpoint that runs the real rules without consuming the session or saving anything. Only the blurred field's messages are applied, so untouched fields don't light up. Submit still validates everything.

## Spam protection, preserved

Everything the HTML library did, without touching the DOM:

- **Honeypot** - the server names a realistic-looking field per form; it's rendered off-screen, non-focusable, empty. A filled honeypot is a 403.
- **Human gate** - no request leaves until the visitor interacts.
- **Behavioural signals** - keystrokes, focus events, fields touched, mouse, scroll, `navigator.webdriver`, plugins, languages - all collected from React's own events and sent with the submit. The scorer penalises their absence heavily, which is why `register()`'s handlers matter.
- **Signed requests**, **session pinning** (600s, single-use, same client IP), and **field-set freezing** are all honoured. A `419` (expired, consumed, or IP changed) triggers one transparent re-init and retry.

Spam is never signalled to the client - a rejected submission still sees success. That's deliberate.

## Developing locally

The server checks the `Referer` against the property's domain. For `localhost` / `127.0.0.1` dev servers, switch on the form's **localhost** toggle in the dashboard. Other hostnames (`0.0.0.0`, `*.local`, LAN IPs) aren't covered - use `localhost`.

## Constraints worth knowing

- **No file uploads.** The form API is JSON-only.
- **Fields can't be added after init.** Declare the superset; render conditionally.
- **Sessions are single-use.** After success, `form.reset()` starts a fresh one on the next interaction.

## Development

```bash
npm install
npm test            # vitest + jsdom + testing-library
npm run typecheck
npm run build       # dist/index.js (ESM) + index.cjs + index.d.ts
```
