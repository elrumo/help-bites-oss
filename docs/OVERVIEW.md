# Overview

The page the panel and the native app open on after you sign in. It shows every
project in the workspace at once:

- **A card per project**: its unread and open conversations, its revenue for
  the period, and a bug count when it has open error reports. A card opens the
  project's own overview.
- **At a glance**: unread and open conversations across the workspace, net
  revenue against the period before, and MRR. Agents see open error reports
  instead of the revenue tiles.
- **Unread messages**: the latest conversations waiting on a reply, newest
  first. Each one opens in the inbox.
- **Revenue by project**: net revenue by month across the workspace, then each
  project's net revenue and MRR with its share of the total.

The panel reloads it as messages arrive. On the web it is `/overview` (`G` then
`O`). In the native app it is the first tab on iPhone, and the top of the
sidebar on iPad and Mac (`⌘0`).

## The numbers

| Number | What counts |
|---|---|
| Unread | Conversations with unread customer messages, outside the archive. The same as the inbox's Unread view. |
| Open | Conversations in an open or pending status, archived ones included, as on a project's overview. |
| Errors | Open conversations of type `error`. |
| Revenue | What Stripe kept from charges in the period (`net`): succeeded charges, less refunds. |
| MRR | Subscriptions that are active or past due, at their list price a month. |

Revenue comes from the last Stripe sync of each project
(**Project → Revenue**). **Each project counts in its own currency**, the one
its Revenue tab totals in, so a project's number here matches that tab. Charges
in that project's other currencies are left out, as they are on the tab. When
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

There is no embed: the overview is for your team, not your users.
