# Branded auth emails — operator runbook

Supabase hosted projects store email template HTML in the Dashboard, not in
Postgres — so `supabase db push` does **not** ship email templates.
`supabase config push` syncs subject/path metadata but still doesn't carry
template HTML. Treat the committed files as the source of truth and mirror
them to the Dashboard whenever they change.

**What's committed here (single source of truth):**

| File                                        | Dashboard template            | `config.toml` key              |
| ------------------------------------------- | ----------------------------- | ------------------------------ |
| `supabase/email-templates/confirmation.html` | Confirm signup                | `auth.email.template.confirmation` |
| `supabase/email-templates/magic-link.html`   | Magic Link                    | `auth.email.template.magic_link`   |
| `supabase/email-templates/recovery.html`     | Reset Password                | `auth.email.template.recovery`     |
| `supabase/email-templates/invite.html`       | Invite user                   | `auth.email.template.invite`       |
| `supabase/email-templates/email-change.html` | Change Email Address          | `auth.email.template.email_change` |

## Token reference

Supabase does **naive string replacement** — tokens are literal Go-template
syntax preserved exactly. The templates use:

| Token                  | Where                                                | Notes                                           |
| ---------------------- | ---------------------------------------------------- | ----------------------------------------------- |
| `{{ .ConfirmationURL }}` | Primary CTA button `href`                            | Supabase-built URL; survives redirect settings  |
| `{{ .SiteURL }}`       | Plain-text fallback URL prefix                       | From Dashboard → Auth → URL Configuration       |
| `{{ .TokenHash }}`     | Plain-text fallback URL — `?token_hash=…`           | Used by app's `/auth/confirm` → `verifyOtp`     |
| `{{ .Token }}`         | 6-digit OTP block                                    | Reference code; no in-app UI consumes it yet    |
| `{{ .Email }}`         | Footer address line                                  | Original address on file                        |
| `{{ .NewEmail }}`      | `email-change.html` body + footer                    | `email_change` template only                    |
| `{{ .RedirectTo }}`    | Footer "return to ayceMon" link (conditional)        | Not available in `email_change`                 |

## Local verification (before mirroring)

```bash
supabase start                          # boots Postgres + Inbucket (:54324)
# Trigger an email flow (e.g. signup via the running Next.js dev server).
open http://127.0.0.1:54324             # Inbucket — inspect the rendered email.
supabase stop                           # tear down when done.
```

## Mirror procedure (hosted project)

Do this **once** when you first land Phase 3, and again any time a template
file in `supabase/email-templates/` changes.

1. Open the Supabase Dashboard → **Authentication** → **Email Templates**.
2. For each of the five templates:
   1. Click the template name in the left rail (e.g. "Confirm signup").
   2. **Subject heading** — set to the value from `supabase/config.toml`:
      - Confirm signup: `Confirm your ayceMon account`
      - Magic Link: `Your ayceMon sign-in link`
      - Reset Password: `Reset your ayceMon password`
      - Invite user: `You've been invited to ayceMon`
      - Change Email Address: `Confirm your new ayceMon email`
   3. **Message body** — replace the entire contents with the HTML from the
      matching file in `supabase/email-templates/`. The Dashboard editor has
      "Source" mode; use it (not the visual editor — it will strip classes
      and the inline SVG).
   4. Click **Save**.
3. Verify URL configuration at Dashboard → **Authentication** → **URL
   Configuration**:
   - **Site URL** matches `NEXT_PUBLIC_SUPABASE_URL`'s app origin (e.g.
     `https://aycemon.vercel.app`).
   - **Redirect URLs** allow-list includes the app origin plus any dev
     origins (`http://localhost:3000`).
4. Do a **real signup** against the hosted project with a fresh mailbox —
   the branded template must render (persimmon CTA, logo, wordmark). If
   the stock "Confirm your email · Follow this link…" template appears,
   the mirror didn't take — re-paste into Source mode, not visual mode.

## SMTP upgrade (optional but recommended)

Supabase's built-in sender is rate-limited and marks messages as coming
from `noreply@mail.app.supabase.io`. To send from an ayceMon-owned domain
and lift the rate limit, configure custom SMTP:

1. Choose a provider (Resend, Postmark, AWS SES, Mailgun — any ESMTP host).
2. Dashboard → **Authentication** → **SMTP Settings** → toggle custom SMTP.
3. Fill in host, port (587 for STARTTLS), username, password.
4. **Never commit SMTP credentials** to this repo. The fields live only in
   the Dashboard and the provider's console.
5. Set **Sender email** to `noreply@<your-domain>` and **Sender name** to
   `ayceMon`. Verify SPF / DKIM / DMARC at the provider to avoid spam folder.

## Gotchas

- **Visual editor strips classes.** Always paste into the Dashboard's
  Source mode. The visual editor rewrites `<style>` blocks and breaks the
  dark-mode media query and Outlook `[data-ogsc]` fallback.
- **`supabase config push` does not push template HTML.** It pushes
  subject + path metadata, but the hosted project stores HTML separately.
  There is no supported CLI for mirroring template HTML.
- **`{{ .RedirectTo }}` is not available in `email_change`.** That template
  intentionally omits the "return to ayceMon" footer link.
- **Gmail Android may not render inline SVG.** The text wordmark still
  displays as brand fallback.
- **Outlook Desktop (Word-renderer) strips the dark-mode media query.**
  The `[data-ogsc]` attribute selector handles Outlook 365 / Outlook.com
  dark mode. Outlook Desktop on Windows with Word renderer shows the light
  variant regardless — acceptable.
