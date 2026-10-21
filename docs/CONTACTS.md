# Contacts (CRM)

A project's people: your app's users, anyone you import or sync from your own
database, newsletter sign-ups and the people your [lead forms](FORMS.md) bring
in. Panel: **Project → Contacts** (People, Segments, Sources). API: `/v1/contacts`, `/v1/segments`, `/v1/track`, with the
project secret (`sk_…`) from your server, or an operator session / admin key
with `project`.

## One person, one contact

A contact is an `EndUser` row — the same record conversations, feedback and the
email log already point at — so a contact's page shows their support history
and every email they got.

- **Identity is your user id**: `externalId`, the `sub` of the identity tokens
  your app mints. Imports and syncs must map the same id, or the same person
  ends up twice (once from the widget, once from the sync).
- **Email-only contacts** (sign-ups, address-only imports) have no
  `externalId`. The first identity token whose `email` matches adopts the row:
  the sign-up becomes that app user.
- Matching for every write: `externalId` first, then `email` (only a row no
  other id owns). Addresses are stored lowercased.

## Fields

| Field | |
|---|---|
| `email`, `name`, `externalId` | `externalId` is set once and never replaced |
| `language` | The language to write to them in, a tag such as `es` or `pt-BR` (written in one spelling: `pt_br` becomes `pt-BR`). Empty until known. Filled by the identity token's `locale` claim (only into a gap), a lead form (the visitor's browser language), a CSV or sync column mapped to **Language**, the API, or the panel (the **Language** field on the contact's page; `""` clears it). Campaigns, sequences and welcome emails send the matching translation of a template: see [Languages](LANGUAGES.md#a-contacts-language). `{{contact.language}}` is a placeholder |
| `attributes` | Up to 50 keys (`[A-Za-z][A-Za-z0-9_]*`, 40 chars), string / number / boolean. Merged on write; `null` removes a key |
| `tags` | Added on upsert; `PATCH` replaces (`tags`) or edits (`addTags`, `removeTags`) |
| `subscription` | `none` (transactional only) · `pending` (signed up, not confirmed) · `subscribed` · `unsubscribed` |
| `unsubscribedTopics` | Topics they opted out of; every other topic reaches them while subscribed |
| `consent` | `{ source, at, ip, ua, formUrl, confirmedAt }` — the proof of opt-in |
| `sources` | Ids of the database syncs they came from |
| `origin` | How they first got here, set once when the contact is made: `{ type, id, at }`. `type` is `app` (an identity token or email-only access), `lead_form` (`id`: the form), `signup` (the newsletter form), `import` (a CSV), `sync` (`id`: the source), `stripe`, `api`, `panel` (added by hand) or `feedback` (a feedback import). Shown as **Added via** in the people list |
| `leadForms` | Ids of the [lead forms](FORMS.md) they signed up through |

## Consent rule

**Opt-out wins from every side.** Anyone may unsubscribe someone (an API call, a
sync column, the unsubscribe link, Mailgun). Nobody re-subscribes someone who
unsubscribed except the person: through the preferences page (confirmed by
email), a confirmed sign-up, or an API call with `resubscribe: true` that you
only send when they asked again. Imports and syncs only *seed* consent for people who have not
chosen yet (`none`).

```bash
curl -X POST $HELPBITES/v1/contacts -H "Authorization: Bearer $SK" -H 'content-type: application/json' \
  -d '{"externalId":"u_42","email":"ada@example.com","name":"Ada","attributes":{"plan":"pro"},"tags":["beta"]}'
```

Batch: `{ "contacts": [ … up to 1000 ], "fillOnly": true }` returns
`{ results: [{ index, status, id, error? }], created, updated, unchanged, failed }`.
One bad row never stops the others.

Contacts from before `origin` was kept show a best guess (a sync, how their
consent was recorded, an app user id); `bun scripts/backfill-contacts.mjs --apply`
stores that guess once, so the **Added via** filter and segments find them too.

To mirror unsubscribes into your own database, either point the event webhook
at your app (see [MARKETING.md](MARKETING.md#event-webhook)) or poll
`GET /v1/contacts?updatedSince=<last poll>`.

Erasing (`DELETE /v1/contacts/:id`, or `DELETE /v1/end-users/:externalId`)
removes the person, their conversations, feedback, email log rows, sequence
enrollments and changelog subscriptions (including ones made with just their
address, signed out). If they had unsubscribed, the address stays on the suppression
list so a later import can never mail them.

## Segments

`{ match: 'all' | 'any', rules: [{ field, op, value }] }`

- Fields: `email`, `name`, `externalId`, `subscription`, `tags`,
  `unsubscribedTopics`, `sources`, `origin` (how they were added: `is` /
  `is_not` one of the types above), `language`, `leadForms` (`includes` a form id),
  `createdAt`, `lastSeenAt`, `updatedAt`, `attributes.<key>`, and the
  [built-in fields](#built-in-segment-fields) below.
- Ops: `is`, `is_not`, `contains`, `starts_with`, `exists`, `not_exists`, `gt`,
  `lt`, `before`, `after`, `within_days`, `not_within_days` (includes never),
  `includes`, `excludes`.
- An attribute typed as `"3"` matches a stored `3` too.

Values are plain strings, numbers or booleans — operator objects are refused.
A segment can only narrow: campaigns always add *this project, subscribed, has
an email, not opted out of the topic* on the server.

`POST /v1/segments/preview { filter }` counts before you save.

A lead form makes its own segment (**Leads · <form>**), and the project's first
form an **All leads** one. They are ordinary segments marked `auto: true`: edit,
rename or delete them like any other.

The people list filters the same way without a segment:
`GET /v1/contacts?origin=lead_form`, `?leadForm=<form id>`.

### Built-in segment fields

Some questions about a person are answered from HelpBites' other records instead of a column on the contact.
They are ready to pick in the segment builder (web and native) and work like any other field, in any combination:
`{ "field": "hasOpenConversation", "op": "is", "value": "yes" }`. The yes/no ones take `is` with `yes` or `no`
(`true` and `false` are accepted too), and everything a segment can do, a campaign can: *send this only to people
who have not finished onboarding*.

| Field | Meaning | Type |
|---|---|---|
| `stripePlan` | The plan of their Stripe subscription, as the Stripe sync keeps it (the `stripe_plan` attribute). `is`, `contains`, `exists`... | text |
| `language` | Their [language](LANGUAGES.md#a-contacts-language) (`es`, `pt-BR`). `is es` does not match `es-MX`: use `starts_with es` for every Spanish | text |
| `hasOpenConversation` | They have a conversation that is open or waiting for a reply, and not archived | yes / no |
| `votedOnPost` | They voted on at least one feedback post (votes are matched to contacts by the app's user id) | yes / no |
| `hasErrors` | An error was reported for them in your error tracker (see below) | yes / no |
| `finishedOnboarding` | They finished a published [onboarding flow](ONBOARDING.md#who-finished-it) (skipping it does not count). Needs the app to send the identity token with the script, or the `/complete` call | yes / no |

How the yes/no fields work: HelpBites first finds the contacts the question is true for, then hands that list to the
segment, so `no` is "everyone else in the project". Each lookup reads at most 20,000 records; a project with more
fails the query with a clear error instead of matching only some of them.

**`hasErrors` is best effort.** Error trackers do not index events by person, so HelpBites looks at the **newest 50
open (unresolved) issues** of the project's connected GlitchTip or Bugsink, reads the **latest event** of each and takes
its `user.id`, which is your app's user id when your error reports set the user (`Sentry.setUser({ id })`). An error
older than the newest 50 open issues, an issue whose latest event came from someone else, or an app that does not report
users is not seen. The answer is cached for **10 minutes** per project, so a segment can lag behind a fresh error by
that long, and a project with no tracker connected matches nobody. Treat it as "who is probably hitting problems right
now", not as a complete list; for one person's errors the contact's page is exact.

## One person's activity

`GET /v1/contacts/:id/activity` is the contact page's timeline: everything one person has done, in one list, newest
first. It merges conversations they started, feedback posts, comments and votes, emails sent to them, sequences they
are on, Stripe payments and subscriptions, onboarding they finished and when they were added, so a client needs one call
instead of one per kind. The panel's contact page and the native app both show it, with an icon per kind, relative times
and links (a conversation opens in the inbox, a post on the feedback page, an email in the email log).

```bash
curl "$HELPBITES/v1/contacts/CONTACT_ID/activity?limit=20" -H "Authorization: Bearer $SK"
# → { "items": [{ "id": "conversation:abc", "type": "conversation", "at": "2026-10-20T09:14:00.000Z",
#                 "title": "Can't export", "detail": "open", "ref": { "kind": "conversation", "id": "abc" } }, …],
#     "nextBefore": "2026-10-12T16:02:00.000Z" }
# the next page
curl "$HELPBITES/v1/contacts/CONTACT_ID/activity?limit=20&before=2026-10-12T16:02:00.000Z" -H "Authorization: Bearer $SK"
```

`type` is one of `joined`, `conversation`, `feedback_post`, `feedback_comment`, `vote`, `email`, `sequence`,
`payment`, `subscription` and `onboarding`; `types=email,vote` limits the list. `limit` defaults to 50 (200 at most).
`nextBefore` is `null` on the last page, otherwise pass it as `before`. `ref` says what the item leads to
(`conversation`, `feedback_post`, `email_log`, `sequence`, `onboarding_flow` or `stripe`) for building links; the
`title` and `detail` are ready-to-show English text. A kind whose records cannot be read is left out of that page
instead of failing the list.

The [revenue](FEATURES.md) report links each top customer and recent payment to their contact (`contactId`), so a
payment opens the person.

## Putting people on a sequence

From a contact's page (**Add to sequence**), from a segment (**Add everyone to a sequence**), or over the API:
`POST /v1/sequences/:id/enrollments` with `{ contacts: [ids] }` or `{ segment: id }`. Only subscribed people are
enrolled and the answer says who was left out and why. See [MARKETING.md](MARKETING.md#enrolling-by-hand).

## CSV import

Panel only (People → Import): the file is parsed and mapped in the browser,
then sent a thousand rows at a time to `POST /v1/contacts` — the same call the
API offers. Map email / user id / name / language / tags / an opt-in column; other columns
become attributes. "Everyone in this file asked for marketing email" records
consent for rows that do not say otherwise.

## Sources: syncing from your database

Panel: Contacts → Sources (operators only; the API is
`/v1/admin/contact-sources`). One way: HelpBites reads, never writes.

| Kind | Credential | Reads |
|---|---|---|
| Parse Server | master key | a class over REST, `updatedAt > cursor` (ties by `objectId`), only the mapped keys |
| Postgres / Supabase | connection string | a table or view in a `READ ONLY` transaction with a 15 s statement timeout, only the mapped columns |
| Firebase / Firestore | service-account JSON key | a top-level collection with `runQuery`, only the mapped fields |

- **Incremental** with an updated-at column: each run continues after the last
  row it saw. **Full scan** without one: by id, starting over at the end
  (Firestore leaves documents without the order field out of an ordered query,
  so pick a field every document has, or none).
- Credentials are sealed (AES-256-GCM) with `HELPBITES_SECRET` and never
  returned. Syncs run in the background worker (every 15 min to daily, or on
  demand), 500 rows a page, and resume from the cursor after a restart.
- Hosts on a private network (your database next to HelpBites) need
  `ALLOW_PRIVATE_NETWORK=1`; link-local and cloud-metadata addresses are
  always refused. Redirects are not followed.
- **Supabase**: use the connection string from Project settings → Database.
  The pooler (port 6543) works; prepared statements are off. A read-only role
  is best: `create role helpbites_reader login password '…'; grant select on public.users to helpbites_reader;`
- A `true`/`false` column mapped as "Opted in" sets consent per row (and a
  `false` unsubscribes); otherwise the source can assert that everyone in it
  agreed, or leave consent alone.
- Rows deleted upstream are not noticed yet (erase them through the API).
- A sync never writes back. Changes HelpBites owns (unsubscribes, topics) go to
  your app through the event webhook.

## Events

`POST /v1/track { event, contact: { externalId | email, …fields } }` starts every
active sequence waiting for that event, adding the person as a contact if they
are new. Events themselves are not stored; keep state in attributes.
