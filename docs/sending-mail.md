# Sending mails from your addresses

Cloudflare free plan does not allow sending emails. It only allows you to **receive** and **forward** mails to addresses registered as `destination addresses`throught the `Email Routing service`. It does not
send any: to write or answer *from* `contact@example.com`, you need something else.

This page describes the common options. They are not part of this project, and their providers' features, limits and
prices change: check their current documentation.

## Option 1: answer from Gmail ("Send mail as")

The simplest option to write and answer from your own address, from your Gmail mailbox, for free. Other mail providers
often have an equivalent feature.

### 1. Create an app password

Gmail needs a password to send through its own SMTP server on behalf of your address. Your usual Google password is
refused: you need an **app password**.

1. Enable 2-Step Verification on your Google account (app passwords are not available without it).
2. Go to <https://myaccount.google.com/apppasswords>, give the password a name (for instance *Send as contact*) and copy
   the 16 characters it shows, **without the spaces**.

Create a new app password for this use, rather than reusing an old one (another client may in fact use OAuth, and
Google sometimes revokes old app passwords).

### 2. Add your address in Gmail

In Gmail, Settings > See all settings > Accounts and Import > *Send mail as* > *Add another email address*:

1. **Name**: your name, as recipients will see it. **Email address**: `contact@example.com`. Keep *Treat as an alias*
   checked, then *Next step*.
2. **SMTP server**: `smtp.gmail.com`, **port** 587 with TLS (465 with SSL also works).
   **Username**: your **full** Gmail address (`me@gmail.com`). **Password**: the app password.
3. Gmail sends a verification mail to `contact@example.com`. Thanks to the router, it lands in your Gmail mailbox:
   click the link, or paste the code.

`contact@example.com` is now available in the *From* field of a new message.

If clicking *Send* does nothing (no error, the window stays open), **reload the Gmail page**: the web interface may still
use the list of senders it had before you added the address.

### 3. Allow Google to send for your domain (SPF)

Receivers check that the servers sending mails for your domain are allowed to do so, using the SPF record of the domain:
a TXT record at the root of the domain that starts with `v=spf1`. When you enabled Email Routing, Cloudflare created
one, like:

```
v=spf1 include:_spf.mx.cloudflare.net ~all
```

Add Google's servers to it, **in the same record**:

```
v=spf1 include:_spf.mx.cloudflare.net include:_spf.google.com ~all
```

- Keep Cloudflare's `include`, and keep a **single** `v=spf1` record: two SPF records make SPF fail.
- The final `all` tells what to do with any other server: `~all` (soft fail: suspicious, often accepted but flagged) or
  `-all` (fail: not allowed). `-all` is stricter, use it only once you are sure of all the services that send mails for
  your domain. Never use `+all`.
- SPF allows at most 10 DNS lookups (each `include` counts, including the ones nested inside it). Cloudflare and Google
  are far from it, but keep it in mind if you add other sending services.
- Edit the record in the **DNS records** page of the domain. The Email Routing settings page may keep showing the value
  it created (without Google's `include`), without any warning: what is actually published is what the DNS records page
  shows (`dig +short TXT example.com` to check).
- ⚠️ If you disable and enable Email Routing again, or let it fix its DNS records, it may write its own value back and
  silently remove Google's `include`. Check the SPF record after any such operation.

Recipients may see your mails as sent "via gmail.com": without a mail service that signs the mails with a key of your
domain (DKIM), this is expected.

### 4. Test

Send a mail from your address to a mailbox of **another** provider than Gmail, open its source, and check the
`Authentication-Results` header: SPF should pass. If you publish (or plan to publish) a DMARC policy for your domain,
check that DMARC passes too before making it strict (`p=reject` or `p=quarantine`): mails sent this way may not be
aligned with your domain, and a strict policy would make receivers reject them.

## Option 2: a transactional mail service (for applications)

To send mails to anyone from a script, an application or a contact form, with SPF, DKIM and DMARC aligned on your
domain, use a mail sending service (Resend, Brevo, SMTP2GO, Mailgun, Amazon SES...). Many of them have a free tier, with
a daily or monthly limit. They give you a few DNS records (DKIM keys, SPF `include`) to add in Cloudflare, and an API or
SMTP credentials.

Remember to add their `include` to your existing SPF record, not to create a second one.

## Option 3: Cloudflare's own sending features

Cloudflare also offers ways to send mails from Workers. At the time of writing, sending to any recipient is not part of
the free plan. Check Cloudflare's documentation for the current features, limits and prices.
