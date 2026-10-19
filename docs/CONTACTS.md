# Contacts (CRM)

A project's people: your app's users, anyone you import or sync from your own
database, and newsletter sign-ups. Panel: **Project → Contacts** (People,
Segments, Sources). API: `/v1/contacts`, `/v1/segments`, `/v1/track`, with the
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
| `attributes` | Up to 50 keys (`[A-Za-z][A-Za-z0-9_]*`, 40 chars), string / number / boolean. Merged on write; `null` removes a key |
| `tags` | Added on upsert; `PATCH` replaces (`tags`) or edits (`addTags`, `removeTags`) |
| `subscription` | `none` (transactional only) · `pending` (signed up, not confirmed) · `subscribed` · `unsubscribed` |
| `unsubscribedTopics` | Topics they opted out of; every other topic reaches them while subscribed |
| `consent` | `{ source, at, ip, ua, formUrl, confirmedAt }` — the proof of opt-in |
| `sources` | Ids of the database syncs they came from |

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

To mirror unsubscribes into your own database, either point the event webhook
at your app (see [MARKETING.md](MARKETING.md#event-webhook)) or poll
`GET /v1/contacts?updatedSince=<last poll>`.

Erasing (`DELETE /v1/contacts/:id`, or `DELETE /v1/end-users/:externalId`)
removes the person, their conversations, feedback, email log rows and sequence
enrollments. If they had unsubscribed, the address stays on the suppression
list so a later import can never mail them.

## Segments

`{ match: 'all' | 'any', rules: [{ field, op, value }] }`

- Fields: `email`, `name`, `externalId`, `subscription`, `tags`,
  `unsubscribedTopics`, `sources`, `createdAt`, `lastSeenAt`, `updatedAt`,
  `attributes.<key>`.
- Ops: `is`, `is_not`, `contains`, `starts_with`, `exists`, `not_exists`, `gt`,
  `lt`, `before`, `after`, `within_days`, `not_within_days` (includes never),
  `includes`, `excludes`.
- An attribute typed as `"3"` matches a stored `3` too.

Values are plain strings, numbers or booleans — operator objects are refused.
A segment can only narrow: campaigns always add *this project, subscribed, has
an email, not opted out of the topic* on the server.

`POST /v1/segments/preview { filter }` counts before you save.

## CSV import

Panel only (People → Import): the file is parsed and mapped in the browser,
then sent a thousand rows at a time to `POST /v1/contacts` — the same call the
API offers. Map email / user id / name / tags / an opt-in column; other columns
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
