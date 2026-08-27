# @snipform/react-forms

React components and hooks for [SnipForm](https://snipform.io) — directive-driven form backend for static sites. Server-validated, spam-protected, headless: your markup, your styling, SnipForm's backend.

```bash
npm install @snipform/react-forms
```

## Quick start

```tsx
import { SnipForm, Field, SubmitButton, SuccessContent } from '@snipform/react-forms';

export function ContactForm() {
  return (
    <SnipForm formKey="YOUR_FORM_KEY">
      <Field name="name" placeholder="Your name" validate={{ required: 'Tell us your name' }} />
      <Field name="email" type="email" placeholder="your@email.com" validate={{ required: 'Email is required', email: null }} />
      <Field name="message" as="textarea" validate={{ required: null, 'max_length[2000]': null }} />

      <SubmitButton submittingText="Sending...">Send</SubmitButton>
      <SuccessContent />
    </SnipForm>
  );
}
```

That's a complete, production-grade form: validated by the server with Laravel's rule set, protected by a honeypot and behavioural spam scoring, and rendered entirely by React. On success the fields hide themselves and `<SuccessContent>` shows your dashboard's thank-you message.

> Coming from `@snipform/astro-forms`? Same components, same props, one rename: Astro's `key` prop is `formKey` here (`key` is reserved in React), and `class`-flavoured props are `className`-flavoured (`errorClass` → `errorClassName`).

## Global setup (optional)

App-wide defaults for every form — the React analog of the Astro integration:

```tsx
import { SnipFormProvider } from '@snipform/react-forms';

<SnipFormProvider validateOn="blur">
  <App />
</SnipFormProvider>
```

Accepts `apiBase`, `validateOn`, `initOn`, `onSuccess`, `onValidationError`, `onError`. Every value can be overridden per form.

## Components

### `<SnipForm>`

The form container: renders a `<form>` wired with submit handling, the human gate, and the honeypot, and provides the form to every child component via context.

| Prop | Type | Description |
| --- | --- | --- |
| `formKey` | `string` | Your form's key from the SnipForm dashboard |
| `fields` | `Fields` | Optional upfront field declarations (children register themselves) |
| `validateOn` | `'submit' \| 'blur'` | `blur` validates each field server-side as it's left |
| `initOn` | `'interaction' \| 'mount'` | When the session opens (default: first human interaction — keep it) |
| `apiBase` | `string` | Override the API base |
| `onSuccess` / `onValidationError` / `onError` | callbacks | |

Also accepts any `<form>` attributes. `children` may be a render function receiving the form handle:

```tsx
<SnipForm formKey="contact-form">
  {(form) => form.fatal ? <p>{form.fatal}</p> : <>...fields...</>}
</SnipForm>
```

(Headless path: `<SnipForm form={form}>` with a handle from `useSnipForm` — see below.)

### `<Field>`

Compound component: an input/textarea/select with validation plus an auto-hidden error message right after it.

| Prop | Type | Description |
| --- | --- | --- |
| `name` | `string` (required) | Field name (input name attr and error binding) |
| `validate` | `ValidateProp` | Validation rules (see [Validation](#validation)) |
| `as` | `'input' \| 'textarea' \| 'select'` | Element type (default: `'input'`) |
| `initial` | `string \| string[]` | Initial value |
| `when` | `boolean` | Conditional rendering that keeps the field declared (see [Conditional fields](#conditional-fields)) |
| `errorClassName` | `string` | Class added to the element while it has an error |
| `validClassName` | `string` | Class added once it validated clean |
| `errorMessageClassName` | `string` | Class for the auto-rendered error message |
| `hideError` | `boolean` | Suppress the built-in error element (use `<ErrorMessage>`) |

Plus all standard HTML attributes for the element.

```tsx
<Field
  name="email"
  type="email"
  validate={{ required: 'Enter your email', email: 'Invalid email' }}
  errorClassName="border-red-500"
  validClassName="border-green-500"
/>

<Field name="role" as="select" validate="required">
  <option value="">Select...</option>
  <option value="dev">Developer</option>
</Field>
```

### `<Input>` / `<Textarea>` / `<Select>`

Standalone versions of `<Field>` — same props, no built-in error message. Pair with `<ErrorMessage>`.

```tsx
<Input name="email" type="email" validate={{ required: 'Required', email: 'Invalid' }} />
<Textarea name="message" validate="required" />
<Select name="country" validate="required">...</Select>
```

Radio groups and checkboxes: one element per option, sharing a name. Checkbox values become arrays.

```tsx
<Input type="radio" name="size" value="s" /> <Input type="radio" name="size" value="m" />
<Input type="checkbox" name="topics" value="news" /> <Input type="checkbox" name="topics" value="offers" />
<Input type="checkbox" name="agree" validate="accepted" />   {/* single checkbox */}
```

### `<ErrorMessage>`

The field's first validation error. Hidden while the field is clean.

```tsx
<ErrorMessage name="email" className="text-red-500 text-sm" />
```

Props: `name` (or `field`, Astro-style), `as` (default `'span'`), `children` (custom content instead of the message), any HTML attributes. Rendered with `role="alert"`.

### `<ValidMessage>`

Content shown once a field has been server-validated with no errors — most useful with `validateOn: 'blur'`.

```tsx
<ValidMessage name="email" className="text-green-500 text-sm">Looks good!</ValidMessage>
```

### `<SubmitButton>`

```tsx
<SubmitButton submittingText="Sending..." submittingClassName="opacity-50 cursor-wait">
  Send Message
</SubmitButton>
```

Disabled and restyled while submitting. Any `<button>` attributes pass through.

### `<SuccessContent>`

Renders after a successful submit — the library's field components hide themselves at the same time, so the form swaps for the thank-you.

```tsx
<SuccessContent />                          {/* the dashboard's thank-you HTML, %field% substituted */}
<SuccessContent><p>Thanks!</p></SuccessContent>   {/* your own content */}
```

### `<Honeypot>` / `<Branding>`

Rendered automatically by `<SnipForm>` / when required. Exported for custom `<form>` markup.

## Validation

The `validate` prop accepts the same three shapes as the Astro package:

```tsx
<Input name="name" validate="required" />
<Input name="age" validate={['required', 'integer']} />
<Input name="email" validate={{ required: 'Email is required', email: 'Invalid email format' }} />
<Input name="age" validate={{ required: 'Required', 'between[18,99]': 'Must be 18-99' }} />
```

`null` as a message means "use the server's default". Validation always runs on the server — the same 34 Laravel rules the dashboard documents. Nothing is duplicated client-side, so client and server can't disagree.

**Rules:** `required` `email` `url` `active_url` `boolean` `accepted` `numeric` `integer` `alpha` `alpha_num` `alpha_dash` `date` `ip` `ipv4` `ipv6` `uuid` `regex` `not_regex` and parameterised `max[n]` `min[n]` `min_length[n]` `max_length[n]` `starts_with[s]` `doesnt_start_with[s]` `doesnt_end_with[s]` `in[a,b,c]` `not_in[a,b,c]` `after[date]` `before[date]` `date_equals[date]` `same[field]` `gt[field]` `gte[field]` `lt[field]` `lte[field]`.

### Validation on blur

```tsx
<SnipForm formKey="..." validateOn="blur">
```

Each field is validated by the server as the visitor leaves it (debounced 250ms), through a validate-only endpoint that consumes nothing. Only the blurred field's messages land, so untouched fields don't light up. Submit still validates everything.

## Conditional fields

The server freezes a session's field set at init (an anti-spam boundary). Two ways to render a field conditionally, both fine:

```tsx
{/* Preferred: declared from the start, only the DOM toggles - no extra request */}
<Field name="phone" when={wantsCall} />

{/* Also works: the field-set change marks the session stale, and the next
    submit or validation transparently opens a fresh one. Costs one extra
    init round-trip; interaction signals are preserved. */}
{wantsCall && <Field name="phone" />}
```

## How it works

1. **Idle until a human shows up.** The form sits idle until the visitor focuses, clicks, types, touches, or scrolls it into view. That first interaction opens the session. (`initOn: 'mount'` initialises eagerly but is scored as bot-like — avoid.)
2. **Fields declare themselves.** Each `<Field>` registers its name, type, and rules on mount; the session opens with exactly that set. Changes after init are handled by the stale-session swap above.
3. **Validation is the server's.** Nothing is duplicated client-side.
4. **Submit** posts values, the (empty) honeypot, and behavioural signals. Success returns the thank-you HTML; validation failure returns per-field messages (all of them) and keeps the session open.

### Spam protection, preserved

- **Honeypot** — server-named, rendered off-screen, non-focusable. Filled = 403.
- **Human gate** — no request leaves until the visitor interacts.
- **Behavioural signals** — keystrokes, focus, touched fields, mouse, scroll, `navigator.webdriver` — collected from React's own events, sent with the submit.
- **Signed requests**, **session pinning** (600s, single-use, same IP), **field-set freezing**. A `419` triggers one transparent re-init and retry.

Spam is never signalled to the client — a rejected submission still sees success. Deliberate.

## Headless: `useSnipForm(options)`

Everything above is sugar over one hook. Use it directly for full control:

```tsx
import { useSnipForm, SnipForm, FieldError } from '@snipform/react-forms';

const form = useSnipForm({
  key: 'YOUR_FORM_KEY',
  fields: {
    email: { type: 'email', rules: { required: 'Email is required', email: null } },
  },
});

if (form.fatal)   return <p>{form.fatal}</p>;
if (form.success) return <div dangerouslySetInnerHTML={{ __html: form.success.html }} />;

return (
  <SnipForm form={form}>
    <input {...form.register('email')} />
    <FieldError form={form} name="email" />
    <button disabled={form.isSubmitting}>Send</button>
  </SnipForm>
);
```

Options: `key`, `fields` (optional — components can register instead), `validateOn`, `initOn`, `apiBase`, callbacks. **Field types**: `text` `email` `tel` `url` `number` `password` `hidden` `date` `textarea` `select` `select-multiple` `radio` `checkbox`.

### The handle

```ts
form.status          // 'idle' | 'initializing' | 'ready' | 'submitting' | 'success' | 'error' | 'fatal'
form.values          // current values, keyed by field
form.errors          // { field: [message, ...] }
form.fieldError(n)   // first message for a field, or undefined
form.fieldValid(n)   // true once server-validated clean
form.fatal           // unrecoverable init problem (bad key, unpublished form, domain not allowed)
form.error           // recoverable failure from the last submit (network, 403)
form.success         // { html, values } after a successful submit
form.branding        // { label, link } when the plan requires a "powered by" link
form.isReady / form.isSubmitting

form.register(name, { value? })   // props for an input/select/textarea
form.setValue(name, value)        // programmatic updates
form.registerField(name, config)  // add a field to the set (what <Field> calls on mount)
form.unregisterField(name)        // remove one - both handle session staleness transparently
form.submit()                     // Promise<void>
form.handleSubmit                 // event handler - what <SnipForm> wires to onSubmit
form.validate(field?)             // server-validate now; returns the error bag
form.reset()                      // back to idle; the next interaction opens a new session

form.formProps        // spread onto your own <form> if you don't use <SnipForm>
form.honeypotProps    // spread onto an <input> - or render <Honeypot form={form} />
```

`register()` wires `onFocus` / `onKeyDown` / `onChange` / `onBlur` — keep them attached. They're how the form proves a human filled it in.

Inside a `<SnipForm>`, child components reach the handle with `useFormContext()`.

## Developing locally

The server checks the `Referer` against the property's domain. For `localhost` / `127.0.0.1` dev servers, switch on the form's **localhost** toggle in the dashboard. Other hostnames (`0.0.0.0`, `*.local`, LAN IPs) aren't covered — use `localhost`.

## Constraints worth knowing

- **No file uploads.** The form API is JSON-only.
- **Sessions are single-use.** After success, `form.reset()` starts a fresh one on the next interaction.
- **Field-set changes cost a re-init.** Prefer `when` for conditional fields.

## Why not the script tag?

The HTML library (`sf.iife.js`) works by scanning the DOM for directives and mutating elements — class names, text, `innerHTML`. React owns those elements and overwrites the changes on the next render, so validation state visibly broke. This package never touches the DOM: values, errors, status, and the spam-protection signals all live in React state, and you render whatever you like from them.

## Development

```bash
npm install
npm test            # vitest + jsdom + testing-library
npm run typecheck
npm run build       # dist/index.js (ESM) + index.cjs + index.d.ts
```
