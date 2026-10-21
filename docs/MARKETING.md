# Marketing email

Newsletters and announcements to a project's subscribers: broadcast
**campaigns**, automated **sequences**, a hosted **sign-up** form with double
opt-in, **topics** with a preferences page, and an **event webhook** that tells
your app about unsubscribes. Panel: **Project → Campaigns** (Campaigns,
Sequences, Settings). Built on the email stack ([EMAIL.md](EMAIL.md)) and on
contacts ([CONTACTS.md](CONTACTS.md)).

## Setup

| Variable | |
|---|---|
| `HELPBITES_SECRET` | Required. Signs unsubscribe and confirm links, seals source credentials. 32+ random characters (`openssl rand -base64 48`). Never rotate it casually: old unsubscribe links must keep working (CAN-SPAM: 30 days at least). |
| `APP_URL` | Required. The public origin unsubscribe and preference links point at. |
| `MAILGUN_*` | As for all email. Optionally a separate sending domain for marketing (Settings → Sender), which must belong to the same Mailgun account. Without a mailer a campaign cannot be scheduled nor a sequence activated; a due sequence step waits an hour and tries again. |

In **Settings**: the **postal address** (required in every campaign; it is the
address of the project's company profile, Project settings → Company, which legal
documents use too, and `{{project.address}}` in a template), the
**topics**, double opt-in, the thank-you URL, the marketing sender, and the
event webhook.

The worker that sends campaigns, runs sequences and syncs sources is a Nitro
plugin ticking every 15 seconds; it stays off until `HELPBITES_SECRET` is set.

## Compliance checklist

- Every campaign and sequence email must contain `{{unsubscribeUrl}}` and
  `{{project.address}}`; scheduling or activating is refused otherwise. The
  **Editorial digest** starter has both in its footer.
- Each message carries `List-Unsubscribe: <…/v1/unsubscribe/<token>>` and
  `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (RFC 8058, what Gmail and
  Yahoo require for bulk senders). Check once with a test send that Mailgun's
  DKIM signature covers both headers.
- Turn **off** Mailgun's own unsubscribe tracking for the domain: it adds a
  second unsubscribe link and keeps a domain-wide list that would block
  password resets too. HelpBites' unsubscribe is per contact and per topic;
  if Mailgun's still fires on campaign mail, it unsubscribes the contact rather
  than suppressing the address.
- Unsubscribing never stops account or security email: it changes the
  contact's `subscription`, not the suppression list. Bounces and spam
  complaints still suppress the address for everything.
- Opening a link never changes anything (mail scanners open links): the
  unsubscribe link and the confirm link open a page with one button.

## Campaigns

1. Design the template under Email.
2. Create a campaign: template, optional subject (placeholders work), audience
   (a segment, a topic, or every subscriber), test mode.
3. **Send test**, then **Schedule** or **Send now**.

- The audience is always: this project, `subscribed`, has an email, not opted
  out of the topic. A segment narrows it.
- The design is frozen when sending starts; editing the template later changes
  nothing that is going out.
- Placeholders: `{{firstName}}`, `{{contact.name}}`, `{{contact.email}}`,
  `{{contact.language}}`, `{{contact.externalId}}`, `{{contact.<attribute>}}` (or the attribute's own
  name), `{{unsubscribeUrl}}`, `{{preferencesUrl}}`, `{{project.*}}`, and the
  template's own variables (their defaults apply). Anything left unfilled goes
  out blank, never as `{{…}}`.
- **Languages**: each recipient gets the translation of the template closest to their
  contact's `language` (`es-MX` gets `es`), and the template's own language when it has
  none or they have none. Translating a template is all it takes; see
  [Languages](LANGUAGES.md#a-contacts-language). The campaign's own subject is in the
  template's language, so a translation that carries a subject of its own replaces it for
  those recipients. Every translation needs the unsubscribe link and the postal address
  too, or the campaign does not go. Sequence steps and a lead form's welcome email work
  the same way, since all of them send through the same composer.
- Sending: 100 contacts at a time through the send pipeline (suppressions,
  log, tracking), about a thousand per worker tick. Every recipient's log row
  has batch id `cm_<campaignId>`: the recipient list is
  `GET /v1/email-logs?batch=cm_<id>`. One message per address, even when two
  contacts share one.
- **Resumable**: before each chunk the log is asked who already got one, so a
  crash or deploy mid-send sends nobody twice. A message Mailgun accepted
  whose log row was never written (a crash in that instant) could still go
  twice.
- **Mailgun down or throttling** (429/5xx): the campaign stops, keeps its
  place, and tries again five minutes later.
- **No mailer at all** (no Mailgun key or sending domain): scheduling or
  sending is refused with a 503 that says what to set, and a campaign already
  sending pauses with that reason in `lastError`. Resume it once mail is set up.
- **Pause / resume / cancel** while sending; numbers update live and for days
  after (opens and clicks arrive through the Mailgun webhook). Each log row
  counts once at its furthest status, so *opened* includes those who clicked.

API: `POST /v1/campaigns`, `PATCH /v1/campaigns/:id { status: 'scheduled', scheduledAt }`
(or `'sending'` to send now, `'paused'`, `'canceled'`, `'draft'`),
`POST /v1/campaigns/:id/test { to }`.

## Sequences

A linear series: each email waits `delayMinutes` after the one before (the
first, after enrollment). Started by:

- **someone subscribing** (optionally to one topic), including a confirmed
  sign-up;
- **an event** from your app: `POST /v1/track { event: 'trial_started', contact: { externalId } }`;
- **by hand**: from a contact's page (**Add to sequence**), from a segment (**Add everyone to a sequence**, in the
  segment list or on the people list while a segment is selected), or over the API
  (below).

Only subscribed contacts are enrolled, once per sequence. Anyone who
unsubscribes, or opts out of the sequence's topic, leaves at their next step.
Pausing a sequence holds everyone where they are. Each step's log batch id is
`sq_<enrollment>_<step>`, so a step is never sent twice.

### Enrolling by hand

The sequence has to be `active`. Pass `contacts` (up to 100 contact ids) or `segment` (a segment id):

```bash
# One person, or a handful
curl -X POST $HELPBITES/v1/sequences/$SEQ/enrollments -H "Authorization: Bearer $SK" -H 'content-type: application/json' \
  -d '{ "contacts": ["CONTACT_ID"] }'

# Everyone in a segment (up to 5,000 per call)
curl -X POST $HELPBITES/v1/sequences/$SEQ/enrollments -H "Authorization: Bearer $SK" -H 'content-type: application/json' \
  -d '{ "segment": "SEGMENT_ID" }'
# → { "enrolled": 412, "skipped": { "notSubscribed": 31, "optedOut": 0, "alreadyEnrolled": 9, "notFound": 0 }, "truncated": false }
```

`skipped` says why people were left out: `notSubscribed` (they never agreed to marketing email, or
unsubscribed), `optedOut` (a sequence with a topic skips segment members who opted out of it),
`alreadyEnrolled` (on it now or before), `notFound` (ids that are not this project's contacts).
A segment bigger than the call's 5,000 answers `truncated: true`; call again for the next batch
(the people already on the sequence are skipped, so it carries on where it stopped). `contacts` and
`segment` together, or neither, is a `400`. Segments that use the
[built-in fields](CONTACTS.md#built-in-segment-fields) work too, e.g. everyone who *finished onboarding*.

## Sign-up form and double opt-in

For a waitlist or an interest form with fields of your own, a welcome email and
a sequence per form, use [lead forms](FORMS.md); this section is the
project-wide newsletter sign-up.

- Hosted page: `/s/<publicKey>`, to link to or iframe.
- Or a plain form on your site (Settings shows the snippet):

```html
<form action="https://help.example.com/v1/subscribe" method="post">
  <input type="hidden" name="pk" value="pk_…">
  <input type="email" name="email" required>
  <input type="text" name="website" tabindex="-1" autocomplete="off" style="position:absolute;left:-10000px">
  <button type="submit">Subscribe</button>
</form>
```

- JSON works too: `POST /v1/subscribe { pk, email, name?, topics? }` → `202 { ok, pending }`.
- `website` is a honeypot. The project's allowed origins apply to browser
  forms. Sign-ups are limited per IP and per project, and mails to one
  address (confirmations and preference links together) to three a day (no
  subscription bombing). The answer is the same whether or not the address
  was known.
- Anyone can type an address into a form, so it never changes what an
  existing subscriber gets: a different topic choice emails them their
  preferences link instead. Someone who unsubscribed is always sent the
  confirmation email, double opt-in or not.
- With double opt-in (the default) the person is `pending` until they press
  the button behind the link in the confirmation email (valid for seven days);
  that click, with when and from where, is their recorded consent. Give the
  project a template with send key `confirm-subscription` (it gets
  `{{confirmUrl}}`) to replace the built-in confirmation message.

## Preferences page

`/u/<token>` — every campaign links to it. Topic checkboxes, "unsubscribe from
all", and "subscribe again" for someone who left. Plain HTML, no sign-in: the
signed token names the project, the contact and the campaign's topic. The link
never expires, so unsubscribing always works, instantly; since emails get
forwarded, "subscribe again" sends the confirmation email (valid seven days)
rather than subscribing on the spot.

## Automations

A sequence can wait for any [event](EVENTS.md) HelpBites publishes, not only for your app's `POST /v1/track`: set its trigger
to `{ "type": "event", "event": "onboarding.completed" }` and everyone the event is about starts it. The event has to say
who: `data.contact.id` (the events that concern a person carry it). One friendlier name exists for one case,
`conversation.resolved` (a conversation moved to a resolved or closed status).

**Recipes** are ready-made sequences. Campaigns → Sequences → Recipes (or the API) adds one to your project as a *draft*
with its emails written; read it, change it, activate it.

| Recipe | Starts when | Emails |
|---|---|---|
| `welcome-subscribers` | someone subscribes | welcome, tips after 3 days, check-in after 10 |
| `after-onboarding` | `onboarding.completed` | tips after a day, feedback nudge after a week |
| `thank-for-feedback` | `feedback.post.created` | a thank-you after 10 minutes |
| `check-in-after-support` | `conversation.resolved` | "did we solve it?" after 3 days |

```sh
curl "$HELPBITES/v1/automations/recipes" -H "Authorization: Bearer $ADMIN_KEY"
curl -X POST "$HELPBITES/v1/automations/recipes/after-onboarding/install" \
  -H "Authorization: Bearer $ADMIN_KEY" -H 'content-type: application/json' -d '{ "project": "'$PROJECT'" }'
# → { "sequence": { "id": "…", "status": "draft", … } }; activate with PATCH /v1/sequences/<id> { "status": "active" }
```

Sequences are marketing mail, so only contacts who are **subscribed** are emailed: someone who posts feedback but never
agreed to email is skipped. Activation refuses emails without an unsubscribe link and your postal address (the recipes
include both).

## Event webhook

Settings → Event webhook: a URL and a signing secret. HelpBites posts:

| `type` | `data` |
|---|---|
| `contact.subscription_changed` | `{ contact: { id, externalId, email }, from, to, unsubscribedTopics, topics?: { added, removed } }` |
| `email.suppressed` | `{ email, reason: 'bounce' \| 'complaint', detail }` |
| `cms.entry.published` | `{ entry: { id, slug, type, version, publishedAt } }`: rebuild a static site ([PAGES.md](PAGES.md)) |
| `cms.entry.unpublished` | `{ entry: { id, slug, type } }` |
| `blog.post.published` | `{ post: { id, slug, title, visibility, publishedAt, url } }`: a post went public, now or at its scheduled time ([BLOG.md](BLOG.md#webhooks)) |
| `blog.post.updated` | the same: a public post changed |
| `blog.post.unpublished` | the same: a public post stopped being public |
| `blog.post.deleted` | the same: a public post was deleted |

Body: `{ id, type, createdAt, projectId, data }`. Header
`x-helpbites-signature: sha256=<hex HMAC-SHA256 of the raw body with your secret>`
— the same as the action webhook. Dedupe on `id` (a retry after a timeout can
arrive twice) and ignore old `createdAt`s. Anything but a 2xx is retried after
1, 5, 30, 120 and 720 minutes, then given up on (the deliveries are rows in
`WebhookDelivery`).

```js
const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
const got = Buffer.from(req.headers['x-helpbites-signature'] || '')
if (got.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(expected), got)) return res.status(401).end()
```
