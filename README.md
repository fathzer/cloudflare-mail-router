# Cloudflare Mail Router

**Tired of the limits of your registrar's email redirections? Want your domain's aliases in a file you can read, diff and review, instead of a web form you click through?**

Cloudflare Mail Router turns the redirections of your domain into **one JSON table, versioned in Git**. Every change is
validated (no typo in an address, no loop, no alias to nowhere) and deployed to Cloudflare by a GitHub Action when you
push. Mails are routed by a tiny Cloudflare Worker: no server to run, no mail software to maintain.
It is meant for personal and small-scale domains, and should fit in Cloudflare's free plan
(check the current limits of Email Routing, Workers and KV for your volume).

- **One table for everything**: all your addresses in a single file, with a history of who changed what and when.
- **Aliases of aliases**: `jobs@` can point to `contact@`, which points to your real mailbox.
- **Several destinations** per address.
- **Strict by default**: a mail sent to an address that is not in the table is rejected, not silently swallowed.
- **Safe to edit**: a table with a loop, a malformed address, a duplicate or a destination that Cloudflare did not verify
  is never deployed. The worker validates the table again before using it.
- **Pending destinations**: your cousin did not click the verification link yet? List her address as *pending*: the
  deployment goes on, and mails start flowing the minute she validates it, without any new deployment.
- **Prepare a domain before moving it**: add the redirections of a domain you are about to move to Cloudflare, so the
  mail interruption is as short as possible.

What this project does **not** do: it only forwards mails. It does not host mailboxes and it does not send mails, so
answering *from* one of your addresses must be set up with your mail provider ("send as" in Gmail, for instance).
The forwarding itself is done by Cloudflare Email Routing, which is designed to keep forwarded mails passing the
receivers' SPF, DKIM and DMARC checks (it rewrites the envelope sender and leaves the DKIM signatures intact). This is
likely to work, but not guaranteed: how a receiving provider treats forwarded mails is out of this project's control.

> This is an independent project: it is not affiliated with Cloudflare in any way. See the [disclaimer](#disclaimer).

## How it works

Three pieces, in simple terms:

1. **A redirection table.** A JSON file in *your own* (private) repository that says which address goes where.
2. **A Cloudflare Worker.** A small program that runs on Cloudflare. It is attached to the *catch-all* rule of Email
   Routing, so it receives every mail sent to your domain. It reads the table, follows the aliases, and forwards the mail
   to the final destinations, or rejects it if the address is unknown.
3. **GitHub Actions** (provided here) that do all the deployments for you, each time you push to your repository:
   - `validate` checks the table;
   - `deploy-table` checks with Cloudflare that the destination addresses are verified, then stores the table in
     Cloudflare (in a KV key named `mail.redirections`), where the worker reads it;
   - `deploy-worker` deploys (and updates) the worker itself.

   So you never deploy anything by hand: you change the table, you push, and the actions do the rest.

```
 You                                                      A sender
  │ edit and push redirections.json                         │ sends a mail to contact@example.com
  ▼                                                         ▼
 Your private repository                              Cloudflare Email Routing (catch-all rule)
  │ GitHub Actions: validate, then                          │
  │ deploy the table and the worker                         ▼
  ▼                                                      The Worker  (deployed by deploy-worker)
 Cloudflare KV  ◄─────────────── reads the table ─────────  │ forwards to the final addresses,
 (key mail.redirections,                                    ▼ or rejects an unknown address
  written by deploy-table)                               me@gmail.com …
```

The table lives in your repository, not in this one: this repository only contains the code and the actions.

## Requirements

- **A domain name that you own**, and the ability to change its name servers at your registrar.
- **A free Cloudflare account**, as far as we know the free plan is enough for personal use (check the current limits of
  Email Routing, Workers and KV against your volume).
- ⚠️ **You must accept that Cloudflare manages your whole domain**: Email Routing only works on a domain whose DNS is
  hosted by Cloudflare. You'll have to change the name servers of the domain to Cloudflare's, and from then on *all* its DNS
  records (website, mail, verification records...) will be managed in Cloudflare.
- **Final mailboxes that already exist** (Gmail or any other provider), whose owners can click a verification link
  sent by Cloudflare (unless you list them as *pending*, see below).
- **A GitHub account**, and a (private) repository for your table. The deployments run in GitHub Actions: check
  GitHub's current limits for your plan.

## Quick start

If your domain already uses Cloudflare's DNS, skip the steps marked *(moving only)*.

⚠️ If you move a domain to Cloudflare, know this first: **mails can't be routed by Cloudflare before the switch of the name
servers**, because Email Routing can only be enabled once the domain is *Active* in Cloudflare. So there is a window
between the switch (step 4) and the activation of Email Routing (step 5) where mails may not be delivered: do not count
on your previous provider to keep forwarding them. In our experience with OVH, the mails stopped arriving as soon as
the name servers were switched, although the MX records still pointed to OVH. The steps below are ordered so that
everything is ready before the switch, and this window lasts only a few minutes.

### 1. A few days before: prepare the move *(moving only)*

1. If DNSSEC is enabled at your registrar, disable it: it must be off when the name servers change (you can enable it
   again in Cloudflare afterwards).
2. Lower the TTL of the MX records at your current DNS provider (to 300 seconds, for instance).
3. Add your domain to Cloudflare (*Connect a domain*, free plan). It stays *pending* until the name servers are switched,
   and nothing changes for your domain until then.
4. Check the DNS records Cloudflare imported, and add the missing ones by hand (except the NS records): its automatic
   scan often misses some.
5. Delete the imported **MX records** and **SPF record** (the TXT record starting with `v=spf1`): Cloudflare refuses to
   enable Email Routing while they exist, and they are of no use after the switch.

### 2. Prepare Cloudflare

1. Create a **KV namespace** (Storage & Databases > KV) and note its **id** (32 hexadecimal characters, not its name).
2. Create an **API token** with these permissions: *Workers Scripts: Edit*, *Workers KV Storage: Edit* and
   *Email Routing Addresses: Read*. Note your **account id** too.
3. Add every final destination address (for instance your Gmail address) in Email Routing's *Destination addresses*,
   and have each owner click the verification link they receive. If Cloudflare does not let you do it before the domain
   is active, or if an owner can't validate yet, list the address as *pending* in the table (see
   [Pending destinations](#pending-destinations)): the deployment goes on, and mails flow to it as soon as it is verified.

### 3. Create your private repository and deploy

The worker and the table do not depend on the DNS of your domain.

> ⚠️ **Push your table, and check that the deployment succeeded, *before* switching the name servers (step 4).** Once
> the name servers are switched, the clock is ticking: there must be nothing left to do but steps 4 and 5.

Your repository contains your table, `redirections.json`:

```json
{
  "redirections": {
    "contact@example.com": "me@gmail.com",
    "support@example.com": ["contact@example.com", "colleague@gmail.com"],
    "sales@example.com": "new-colleague@gmail.com"
  },
  "pending": ["new-colleague@gmail.com"]
}
```

and this workflow, `.github/workflows/redirections.yml`:

```yaml
name: Redirections

on:
  pull_request:
  push:
    branches: [main]
  workflow_dispatch:   # to deploy again by hand

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: fathzer/cloudflare-mail-router/validate@v1

  deploy-worker:
    needs: validate
    if: github.event_name != 'pull_request' && github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    concurrency: { group: deploy-worker, cancel-in-progress: false }
    steps:
      - uses: fathzer/cloudflare-mail-router/deploy-worker@v1
        with:
          api-token: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          account-id: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          kv-namespace-id: ${{ vars.KV_NAMESPACE_ID }}

  deploy-table:
    needs: deploy-worker
    if: github.event_name != 'pull_request' && github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    concurrency: { group: deploy-table, cancel-in-progress: false }
    steps:
      - uses: actions/checkout@v7
      - uses: fathzer/cloudflare-mail-router/deploy-table@v1
        with:
          api-token: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          account-id: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          kv-namespace-id: ${{ vars.KV_NAMESPACE_ID }}
```

In the repository settings, add the secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` and the variable
`KV_NAMESPACE_ID`. Pushing to `main` validates the table, deploys the worker, then deploys the table (after the worker,
so the worker always knows how to read it). On a pull request, only the validation runs.

> **Security:** these actions receive your Cloudflare token. In your workflow, use a fixed tag or, better, a full commit
> SHA (`uses: fathzer/cloudflare-mail-router/deploy-table@<sha>`), and review what you upgrade to.

### 4. Switch the name servers *(moving only)*

⚠️ **Choose a quiet moment: from now on, mails may not be delivered until step 5 is done.**

At your registrar, replace the name servers of the domain with the two given by Cloudflare. Then watch the domain's
overview page in Cloudflare (*Check nameservers* asks Cloudflare to check right away) until the domain is **Active**:
it often takes a few minutes, but can (theorically) take up to a day.

### 5. Send the mails to the worker

As soon as the domain is active in Cloudflare, without waiting:

1. If the domain already had MX records and SPF record in Cloudflare (if you skipped step 1), delete them: Cloudflare
   refuses to enable Email Routing while they exist.
2. In Email > Email Routing, **enable Email Routing**, and accept the records Cloudflare adds (its own MX and SPF
   records). From then on, mails reach Cloudflare.
3. In Email > Email Routing > Routing rules, edit the **Catch-all** rule, choose *Send to a Worker* and select
   `mail-redirections`. Remove the per-address rules you do not need.
4. If some destinations could not be verified before, add and verify them now.

Then send a mail to an address of your table from an external address, and another to an unknown address (it must be
rejected).

*(moving only)* Remove the redirections at your previous provider after a couple of days, and enable DNSSEC again, in
Cloudflare this time.

## The table

`redirections` maps an address that receives mails to a destination, or to an array of destinations.
All the addresses are lowercase.

- A destination that is itself a key of `redirections` is an **alias**: it is followed recursively.
- Any other destination is **final**: it must be an external address, verified in Cloudflare (see *Pending
  destinations* for the exception).
- An address that is not a key is rejected (`Unknown recipient`).

### Pending destinations

If the owner of a final destination cannot validate it yet, list it in `pending`. The deployment does not require it
to be verified, and the worker tries to forward to it anyway: while it is not verified, it is skipped (and the mail is
rejected if it was the only destination); as soon as it is verified, mails flow, without anything to deploy.
Once the address is verified, the next deployment fails until you remove it from `pending`, which keeps the list clean.

### What is checked

Before anything is deployed (and again by the worker before it uses the table):

- addresses are well formed and lowercase;
- a source address appears only once, and a destination only once per source;
- there is no loop (`a → b → a`);
- an alias never points to an address of your domains that is not in the table;
- `pending` only contains final destinations that are really used.

At deployment time, every final destination that is not pending must also be a verified destination address in
Cloudflare.

## Actions reference

All the actions are used as `fathzer/cloudflare-mail-router/<action>@<version>`.

| Action | Inputs | What it does |
|---|---|---|
| `validate` | `table` (default `redirections.json`) | Validates the table. |
| `deploy-table` | `api-token`, `account-id`, `kv-namespace-id` (required), `table` | Validates the table, checks the destinations in Cloudflare, copies the table into the KV key `mail.redirections`. |
| `deploy-worker` | `api-token`, `account-id`, `kv-namespace-id` (required), `worker-name` (default `mail-redirections`) | Deploys the worker, bound to the KV namespace. |

`kv-namespace-id` must be the id of the namespace, not its name.
The first deployment of the worker creates it: if your token is not allowed to do that, deploy it once by hand with
`wrangler`, or give the token a wider permission for that first run.

## Behaviour of the worker

- Unknown recipient: the mail is rejected.
- Table missing or invalid, or every forward fails: the worker raises an error, nothing is forwarded to a wrong place.
- Some forwards fail but at least one works: the failure is logged, and the mail is not retried (that would duplicate it).
- Only pending destinations are available: the mail is rejected (`Recipient address is not active yet`).

## Development

```
npm test           # unit tests (Node.js 20 or later)
npm run validate   # validates examples/redirections.json
```

The code has no dependency. [src/redirections.js](src/redirections.js) (validation and resolution) is shared by the
command line scripts and the worker ([worker/index.js](worker/index.js)).

## Disclaimer

This project has **no commercial or technical link with Cloudflare**, and is not endorsed by it. "Cloudflare" and the
names of its products are trademarks of their owner. The project only uses Cloudflare's public services and APIs, which
can change, or be limited or priced differently, at any time.

We do **not provide any support about Cloudflare**: your account, DNS, Email Routing configuration, billing, etc. are
between you and Cloudflare, please refer to their documentation. Issues about this project's code and documentation are
welcome. The software is provided "as is", without warranty (see the [license](LICENSE)): mind your mail, test your
setup before you rely on it.

## License

[MIT](LICENSE)
