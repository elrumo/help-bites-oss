# Revenue

A project's **Revenue** tab shows what an app earns, next to its conversations:
net revenue and MRR for a period, the last twelve months, plans, top customers and
recent payments. It reads from every place you sell through. Connect as many
sources as you have and the numbers add up; each one can be disconnected without
touching the others.

| Source | How it gets the data | Brings | Link to a contact |
|---|---|---|---|
| [Stripe](#stripe) | HelpBites reads it with a restricted key, hourly | Charges, subscriptions, MRR | Stripe customer id, then email |
| [RevenueCat](#revenuecat) | RevenueCat sends events to HelpBites | Purchases, renewals, refunds, subscriptions, MRR | The app's user id (the contact's external id), then email |
| [App Store](#app-store) | HelpBites reads Apple's sales reports, hourly | Daily proceeds per product | None |
| [Paddle](#paddle) | HelpBites reads it with an API key, hourly | Transactions, refunds, subscriptions, MRR | Email |
| [Lemon Squeezy](#lemon-squeezy) | HelpBites reads it with an API key, hourly | Orders, invoices, subscriptions, MRR | Email |
| [Custom API](#custom-api) | You send it | Whatever you send | Email, or the app's user id |

Google Play has no source of its own yet: RevenueCat reports Google Play purchases
(and the App Store's), and anything else can be sent to the custom API.

HelpBites only reads from these services. The one write it ever makes is a pricing
table's Stripe Checkout session, and only with a Stripe key you gave that right
([Pricing tables](PRICING.md)).

## What the numbers mean

The period is `30d`, `90d`, `12m` or `all`.

| Number | What counts |
|---|---|
| Net revenue | Payments that succeeded in the period, less what was refunded. |
| MRR | Subscriptions that are active or past due, at their list price a month. A trial or a lapsed subscription is not recurring revenue yet. |
| Subscribers | Active, past due and trialing subscriptions, and how many started or ended in the period. |
| Paying customers | People who paid in the period. A payment that names nobody (an App Store sale) is not a customer. |

**Currency.** Totals are in the currency with the most revenue; payments in any
other currency are listed under the totals and left out of them. RevenueCat reports
a USD price whatever the customer paid in, so its amounts are always USD.

**Gross, net and proceeds differ by source.** Stripe, Paddle and Lemon Squeezy count
what the customer was charged (tax included, as a Stripe charge is), less refunds.
RevenueCat counts its USD price before the store's commission and tax. The App Store
counts Apple's proceeds, which are after both. Mixing sources therefore mixes these;
the **By source** list on the tab shows each source's share so you can read them
apart.

**Where a payment goes.** A source's money is kept under that source. Disconnecting
one forgets its credentials and the payments and subscriptions it brought; the others
are kept. Contacts keep any `stripe_*` attributes a Stripe sync wrote.

## Stripe

Connect it with a restricted key (Stripe → Developers → API keys → Create restricted
key) that can read Charges, Customers, Subscriptions and Products. HelpBites copies
the account's charges and subscriptions hourly (**Sync** runs it now; **Sync
everything again** reads the whole history again, to pick up refunds on old
charges). A summary of each customer is written on their contact as `stripe_*`
attributes, which the People filters, segments and campaigns can use, and a person's
page looks them up in Stripe live. Those attributes, filters and the live lookup are
Stripe's only.

## RevenueCat

RevenueCat posts its events to HelpBites as they happen. Choose **RevenueCat** under
Revenue → Add a source; HelpBites shows two values to paste into RevenueCat
(Project settings → Integrations → Webhooks):

- **Webhook URL**: `https://YOUR-SUPPORT-HOST/v1/webhooks/revenuecat/<project id>`
- **Authorization header value**: a secret HelpBites made. A request without it is
  answered 401. `Bearer ` in front of it is accepted. Only people who manage the
  project see it; disconnecting and connecting again makes a new one.

Choose production events, save, and use RevenueCat's **Send test event**: it shows
under the source as the last event.

What the events do:

| Event | Effect |
|---|---|
| `INITIAL_PURCHASE`, `RENEWAL`, `NON_RENEWING_PURCHASE` | A payment (its USD `price`), and for subscriptions an active subscription priced a month from the period's length. A free trial is a trialing subscription with no payment until it converts. |
| `CANCELLATION` | Renewal is off; the subscription runs to the end of the period. A refund (`cancel_reason` `CUSTOMER_SUPPORT`, negative price) refunds the payment it names. |
| `UNCANCELLATION`, `SUBSCRIPTION_EXTENDED`, `PRODUCT_CHANGE` | Renewal back on, the period moved, the plan renamed. |
| `BILLING_ISSUE` | Past due; it still counts towards MRR until it expires. |
| `EXPIRATION` | Ended, in the month it ran out. |
| `REFUND_REVERSED` | Takes the refund back. |

Limits: RevenueCat cannot replay the past, so **history starts when the webhook
does**. For earlier months send payments to the [custom API](#custom-api). Sandbox
purchases and event types that carry no revenue (`TEST`, `TRANSFER`, …) are
acknowledged and ignored. An event that arrives after a newer one for the same
subscription is ignored for its state. A subscription that HelpBites first sees on a
renewal counts in the MRR by month from that renewal on. An introductory price counts as
the price until the next renewal brings the real one. Plans are named by RevenueCat's
product id.

People are matched to contacts by the App User ID (the contact's external id, which
is the user id your app signs in with), else by the `$email` subscriber attribute.
Set RevenueCat's `$email` attribute from your app to link anonymous purchases.

## App Store

Reads the Sales and Trends reports from App Store Connect. Create an API key (Users
and Access → Integrations → App Store Connect API) that can read Sales and Reports,
and enter its **Issuer ID**, **Key ID**, your **Vendor number** (Payments and
Financial Reports) and the **private key** (the `.p8` file's text, pasted whole;
Apple lets you download it once).

HelpBites reads one daily report at a time, up to the last 365 days (the most Apple
keeps), then each hour the newest days, again three days back because Apple revises
recent days. A day's report is published the next day. Amounts are **your proceeds**
(after Apple's commission and tax), one payment per product and currency per day;
refunds are their own negative lines and subtract.

Limits: Apple's reports name no customers, so there are no top customers, no contact
links, no subscribers and no MRR from this source. Use RevenueCat as well if you
need those. A day Apple later removes keeps its old row.

## Paddle

Create a server-side API key (Paddle → Developer tools → Authentication) that can
read transactions, subscriptions, customers and adjustments. A key made in the
sandbox connects the sandbox. HelpBites reads paid and completed transactions
(`grand_total`, tax included), refunds from approved adjustments, and subscriptions
with their plan and price.

Limits: refunds on transactions older than 35 days are picked up by **Sync everything
again**. Credits and chargebacks are not counted as refunds.

## Lemon Squeezy

Create an API key (Lemon Squeezy → Settings → API). HelpBites reads orders (which
cover every payment, a subscription's first included), subscription invoices after the
first, and subscriptions, with the plan and price taken from the variant. Test-mode
orders and free ones are left out.

Limits: tiered and usage-based prices count 0 towards MRR; there is no date filter
on Lemon Squeezy's lists, so each run reads the newest pages back to 35 days.

## Custom API

For anything with no connector: Google Play's earnings report, Gumroad, PayPal, a bank
transfer, invoices you send by hand, or revenue from before RevenueCat's webhook.
Send payments and subscriptions to one route with an admin API key
(Settings → API keys; a key limited to the project is enough). The source connects
itself on first use.

```bash
curl -X POST https://YOUR-SUPPORT-HOST/v1/admin/revenue/payments \
  -H "Authorization: Bearer ak_…" \
  -H "Content-Type: application/json" \
  -d '{
    "project": "PROJECT_ID",
    "payments": [
      { "id": "invoice-1042", "amount": 19.99, "currency": "usd", "paidAt": "2026-03-01T10:00:00Z",
        "email": "ada@example.com", "description": "Pro, yearly" }
    ],
    "subscriptions": [
      { "id": "member-7", "plan": "Pro", "amount": 4.99, "currency": "usd", "interval": "month",
        "status": "active", "email": "ada@example.com", "startedAt": "2026-01-05T00:00:00Z" }
    ]
  }'
```

```js
// Node, on your server: never put an admin key in a browser or an app.
await fetch('https://YOUR-SUPPORT-HOST/v1/admin/revenue/payments', {
  method: 'POST',
  headers: { authorization: `Bearer ${process.env.HELPBITES_ADMIN_KEY}`, 'content-type': 'application/json' },
  body: JSON.stringify({ project: PROJECT_ID, payments: [{ id: sale.id, amount: sale.total, currency: 'usd', paidAt: sale.date, email: sale.email }] })
})
```

There is no browser or Swift snippet for this one on purpose: it takes an admin key,
which must stay on a server. Rules:

- Up to 500 payments and 500 subscriptions per request. `id` is yours; sending it
  again **updates** that row, so a script can run twice.
- Amounts are decimals in the currency's units (`19.99`, or `500` yen), never cents.
  `currency` is a three-letter code.
- A payment: `id`, `amount`, `currency`, and optionally `paidAt` (ISO 8601 or epoch
  seconds; now by default), `email`, `customerId`, `description`, `receiptUrl`,
  `refunded` (the part given back, same units) and `status` (`succeeded` counts; any
  other is kept but adds nothing).
- A subscription: `id`, `plan`, `amount` (per period), `currency`, `interval`
  (`day`, `week`, `month` or `year`), `status` (`active`, `trialing`, `past_due`,
  `paused`, `canceled`, …), and optionally `intervalCount`, `email`, `customerId`,
  `startedAt`, `canceledAt` and `endedAt`. Only `active` and `past_due` count towards
  MRR. A canceled one with no `endedAt` ended when it was canceled, else now.
- A bad row answers 400 and names it (`payments[3].amount: must be a number`);
  nothing is saved from that request.
- A person is linked to a contact by `email`, or by `customerId` equal to the
  contact's external id.

## Linking people

A customer opens their contact from Top customers and Recent payments, and a
person's page lists their payments and subscriptions from **every** source, found by
their Stripe customer id, the app's user id or their email.

## The API

All of these take an operator session or an admin key and are scoped to the
workspace like the rest of `/v1/admin`; the OpenAPI reference at `/_docs/scalar` has
the schemas.

| Route | What it does |
|---|---|
| `GET /v1/admin/revenue/sources?project=` | The connected sources and how each last ran; RevenueCat's webhook URL and (for people who manage the project) secret. |
| `POST /v1/admin/revenue/connect` | `{ project, source, credentials }`. `apiKey` for Stripe, Paddle and Lemon Squeezy; `issuerId`, `keyId`, `vendorNumber`, `privateKey` for Apple; nothing for RevenueCat and custom. A source HelpBites reads is tried first (502 when the service refuses the credentials). |
| `POST /v1/admin/revenue/sync` | `{ project, source, reset? }`: a run now, for Stripe, Apple, Paddle and Lemon Squeezy. |
| `DELETE /v1/admin/revenue?project=&source=` | Disconnects one source and forgets what it brought. |
| `GET /v1/admin/revenue/report?project=&range=` | The report the tab shows, over every source, with `sources` saying what each brought in the period. `null` until something has been paid. |
| `POST /v1/admin/revenue/payments` | The [custom API](#custom-api). |
| `POST /v1/webhooks/revenuecat/<project id>` | Where RevenueCat posts; authenticated by its Authorization header. |

`GET /v1/admin/overview` and the workspace Overview add up each project's sources, each
project in its own main currency ([Overview](OVERVIEW.md)). The older `/v1/admin/stripe`
routes still work for Stripe alone.

## Native app

Revenue has the same screens in the iPhone, iPad and Mac app: connect a source, the
setup sheet for RevenueCat and the custom API, a status line per source, sync and
disconnect, and the report with its by-source list.
