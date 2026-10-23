# Overview

The page the panel and the native app open on after you sign in. It shows every
project in the workspace at once:

- **A card per project**: its unread and open conversations, its revenue for
  the period, and a bug count when it has open error reports. A card opens the
  project's own overview.
- **At a glance**: unread and open conversations across the workspace, net
  revenue against the period before, and MRR. Agents see open error reports
  instead of the revenue tiles.
- **Needs attention**: one list for every project, above the cards (below).
- **Unread messages**: the latest conversations waiting on a reply, newest
  first. Each one opens in the inbox.
- **Revenue by project**: net revenue by month across the workspace, then each
  project's net revenue and MRR with its share of the total.

The panel reloads it as messages arrive. The inbox's unread badge and the count
beside Overview in the sidebar are kept live on every page, not only here. On the web it is `/overview` (`G` then
`O`). In the native app it is the first tab on iPhone, and the top of the
sidebar on iPad and Mac (`⌘0`).

## The numbers

| Number | What counts |
|---|---|
| Unread | Conversations with unread customer messages, outside the archive. The same as the inbox's Unread view. |
| Open | Conversations in an open or pending status, archived ones included, as on a project's overview. |
| Errors | Open conversations of type `error`. |
| Revenue | What the project's revenue sources kept in the period (`net`): payments that succeeded, less refunds ([Revenue](REVENUE.md)). |
| MRR | Subscriptions that are active or past due, at their list price a month. |

Revenue comes from every revenue source a project has connected, Stripe,
RevenueCat and the others (**Project → Revenue**). **Each project counts in its own
currency**, the one its Revenue tab totals in, so a project's number here matches
that tab. Payments in that project's other currencies are left out, as they are on
the tab. When
projects charge in different currencies, totals are given per currency, and the
panel leads with the currency that has the most revenue.

The period is `30d`, `90d`, `12m` or `all`. The change is measured against the
same length of time just before it, and has no value for all time or when the
period before had no revenue.

Revenue is for admins and owners. For agents, `revenue` is `null` and the rest
is the same.

## API

`GET /v1/admin/overview?range=30d` returns what the page shows, for scripts and
your own dashboards. It accepts an operator session or an admin key. A key
limited to some projects sees only those.

```bash
curl https://YOUR-SUPPORT-HOST/v1/admin/overview?range=90d \
  -H "Authorization: Bearer ak_…"
```

```json
{
  "totals": { "unreadMessages": 5, "unread": 3, "open": 12, "errors": 1 },
  "projects": [{ "id": "proj_123", "name": "Acme", "open": 9, "unread": 2, "errors": 1 }],
  "unread": [{ "conversationId": "conv_123", "projectId": "proj_123", "name": "Maya Chen", "email": "maya@example.com", "subject": "", "preview": "The export button does nothing", "unread": 2, "at": "2026-10-21T09:12:00.000Z" }],
  "revenue": {
    "range": "90d",
    "connected": 1,
    "totals": [{ "currency": "usd", "net": 4210, "previousNet": 3760, "change": 0.12, "mrr": 3980, "subscribers": 211, "months": [{ "month": "2026-10", "net": 2950 }] }],
    "projects": [{ "projectId": "proj_123", "currency": "usd", "net": 4210, "previousNet": 3760, "change": 0.12, "mrr": 3980, "subscribers": 211, "payments": 236 }]
  }
}
```

- Amounts are in the currency's major unit (`19.99`), not Stripe's smallest one.
- `change` is a fraction: `0.12` is 12% up, `-0.3` is 30% down.
- `projects` lists every project in name order. `revenue.projects` lists only
  those that have synced, the most revenue first.
- `revenue.months` is the last 12 calendar months (UTC), oldest first, whatever
  the period.
- `unread` holds up to 8 conversations. The unread totals stop at 1,000
  conversations, as the inbox's do.
- It is read-only and safe to poll. It reads what has already synced and never
  calls Stripe.

## Needs attention

One list of what waits on someone, across the workspace (and, for one project,
on its own overview). It covers:

| Kind | What it counts | Opens |
|---|---|---|
| `drafts` | Changelog drafts waiting for approval (every draft is reviewed before it publishes, including the ones AI writes from your commits) | Changelog |
| `sync` | A contact source or a Stripe connection whose last sync failed. One row each, with the error under it | Contacts → Sources, Revenue |
| `bounces` | Emails that bounced, drew a complaint, failed or were suppressed in the last 7 days | Email → Log |
| `alerts` | Error alerts that fired in the last 24 hours | Errors |
| `paused` | Campaigns and sequences paused by the reputation guard (hosted edition), with the reason | The email log |
| `errors` | Open error reports | Errors |
| `documents` | Knowledge documents that would not process | Knowledge |
| `triage` | Feedback posts still in an open status | Feedback |

A project's own overview adds `unread`, its conversations waiting on a reply
(the workspace list leaves those to the inbox badge). Rows are grouped per
project and kind, newest first, and a project with nothing to say adds nothing.

`GET /v1/admin/attention` returns the workspace list. It accepts an operator
session or an admin key; a key limited to some projects sees only those. It is
cached for 15 seconds per workspace, so polling it is cheap (`?fresh=1` skips the cache). The panel reads it
every minute and when the tab comes back.

```bash
curl https://YOUR-SUPPORT-HOST/v1/admin/attention \
  -H "Authorization: Bearer ak_…"
```

```json
{
  "unreadMessages": 5,
  "total": 4,
  "items": [
    { "key": "drafts:proj_123", "kind": "drafts", "projectId": "proj_123", "count": 2, "value": "CSV export", "detail": "", "section": "changelog", "at": "2026-10-21T09:12:00.000Z" },
    { "key": "sync:stripe:proj_123", "kind": "sync", "projectId": "proj_123", "count": 1, "value": "Stripe", "detail": "Stripe answered 401: Invalid API Key", "section": "revenue", "at": "2026-10-21T08:00:00.000Z" }
  ]
}
```

- `total` is the sum of the `count`s: the number beside Overview in the sidebar.
- `value` names what a row is about (the failing integration, the newest draft's
  title); `detail` is the error behind it. `section` is the page that deals with
  it, as a path under the project (`email?view=log`).
- `unreadMessages` here can be up to 15 seconds old. For the live inbox badge call
  `GET /v1/admin/unread`, which is never cached and returns `{ "unreadMessages": 5 }`.
  It counts unread customer messages outside the archive, and stops at 1,000
  conversations, as the inbox does. The panel recounts whenever a message
  arrives on the event stream (`GET /v1/admin/events`).

## Setup checklist

A project's overview ends its page with a checklist of what is wired up. It is
judged from what HelpBites has seen, never from a box someone ticked:

| Row | Done when |
|---|---|
| Chat widget on your site | The widget has loaded on a page of your site (allowing an origin is not enough) |
| Users identified | Your backend signed an identity token HelpBites accepted. Where email-only sign-in is on, a missing token is not a failure |
| Someone is told about new chats | A notify address is set and this server can send mail, or a team member's phone gets push notifications |
| Email sender | Mail can go out: the server has a Mailgun key and the project (or the server) has a from address and domain |
| AI assistant ready | An assistant is active, has auto-reply on, an AI provider and knowledge to read. Not live is flagged, not just left undone |
| Stripe | Connected and the last sync did not fail |
| GitHub | At least one repository is linked |
| Error tracking | A tracker is connected |

Each row has a `state` (`done`, `todo`, `attention`), and the optional ones
(assistant, Stripe, GitHub, errors, and identity where email-only sign-in is on)
say so. A section a project hides from its sidebar takes its row with it, and a
member who cannot use Stripe is not shown that row.

`GET /v1/admin/projects/:id/setup` returns it; the project overview carries the
same `setup` object next to `stats`, `attention` and `activity`.

```json
{
  "done": 2, "total": 3,
  "items": [
    { "key": "widget", "state": "done", "reason": "seen", "value": "2026-10-21T08:00:00.000Z", "section": "dev", "optional": false },
    { "key": "identity", "state": "todo", "reason": "missing", "value": "", "section": "dev", "optional": false },
    { "key": "sender", "state": "done", "reason": "ready", "value": "hello@mail.acme.app", "section": "email?view=settings", "optional": false }
  ]
}
```

`reason` is a code (the full list is `SETUP_REASONS` in `shared/setup.ts`) and
`value` is what it is about, so a client words it in its own language. The
project overview no longer returns `health`; the checklist replaces it.

## Hiding what a project does not use

The sidebar groups a project's sections as Support (Conversations, Knowledge
base, Assistants, Ticket types), Product (Feedback, Planning, Changelog,
Onboarding), Grow (Contacts, Forms, Email, Revenue), Site (Pages, Blog, Legal,
Brand) and Build (Errors, Flags, Install & API), with Overview above them and
Settings below. **Project → Settings → Sidebar** takes out the ones the project
does not use, in the sidebar and the ⌘K list, in the web panel and the native
app. Nothing is deleted: the pages and the API keep working, and a hidden section
stays in the sidebar while you are on it. Overview and Settings cannot be hidden.

Through the API it is `hiddenSections` on the project:
`PATCH /v1/admin/projects/:id` with `{ "hiddenSections": ["revenue", "pages"] }`.
Unknown names, `overview` and `settings` are refused with a 400.

There is no embed: the overview, the checklist and this list are for your team,
not your users.
