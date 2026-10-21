# Events and webhooks

Things that happen in a project (a customer starts a conversation, a changelog entry goes public, a pull request
merges) are published as **domain events** on one bus. You can

- **receive them on your own server** as signed webhooks, each endpoint choosing the events it wants,
- **start a sequence** from one (see [automations](MARKETING.md#automations)), and
- in the code, listen to them in-process with `onDomainEvent` (`server/utils/domainEvents.ts`).

Webhook endpoints are part of the *Event webhooks* plan feature on the hosted edition; self-hosted has no limits.

## The event

Every delivery is a `POST` with a JSON body:

```json
{ "id": "evt_5f0c…", "type": "changelog.entry.published", "createdAt": "2026-10-21T09:30:00.000Z", "projectId": "AbC123", "data": { "entryId": "…" } }
```

`data` carries ids and a few small fields, never whole rows: fetch the rest with the API. Dedupe on `id` (a retry after a
timeout can arrive twice) and ignore old `createdAt`s.

| `type` | `data` |
|---|---|
| `contact.created` | `{ contact: { id, externalId, email } }` |
| `contact.subscription_changed` | `{ contact: { id, externalId, email }, from, to, unsubscribedTopics, topics?: { added, removed } }` |
| `conversation.created` | `{ conversationId, contact: { id, externalId, email }, type }` |
| `conversation.status_changed` | `{ conversationId, from, to, statusCategory, contact: { id } }` |
| `conversation.feedback_linked` | `{ conversationId, postId, linked, created }` (`linked` is false when an operator unlinks it; `created` when the post was filed from the conversation) |
| `feedback.post.created` | `{ postId, number, contact?: { id, externalId } }` (the author, when a person wrote it) |
| `feedback.post.status_changed` | `{ postId, number, from, to }` |
| `feedback.post.voted` | `{ postId, number, voterExternalId }` (only when a vote is added) |
| `board.item.created` | `{ itemId, number }` |
| `board.item.status_changed` | `{ itemId, number, from, to }` |
| `changelog.entry.published` | `{ entryId, number, releaseId, feedbackPostIds, boardItemIds, conversationIds }` |
| `errors.filed_on_board` | `{ itemId, provider, issueId }` |
| `github.commit.referenced` | `{ sha, repo, targetKind, targetId }` |
| `github.pull_request.merged` | `{ number, repo, title, url, targets: [{ kind, id, closes }] }` |
| `email.suppressed` | `{ email, reason: 'bounce' \| 'complaint', detail }` |
| `cms.entry.published` | `{ entry: { id, slug, type, version, publishedAt } }` |
| `cms.entry.unpublished` | `{ entry: { id, slug, type } }` |
| `blog.post.published` | `{ post: { id, slug, title, visibility, publishedAt, url } }` ([BLOG.md](BLOG.md#webhooks)) |
| `blog.post.updated` / `blog.post.unpublished` / `blog.post.deleted` | the same |
| `onboarding.completed` | `{ flow, outcome: 'completed' \| 'skipped', contact: { id, externalId, email } }` |
| `webhook.test` | `{ message }`: only from "Send a test event" |

The machine-readable list is `DOMAIN_EVENTS` in `shared/domainEvents.ts`.

## Endpoints

Developer → Webhook endpoints in the panel, or the API (an operator session or an `ak_` admin key):

```sh
# Add one. The signing secret comes back once, in this response.
curl -X POST "$HELPBITES/v1/admin/projects/$PROJECT/webhooks" \
  -H "Authorization: Bearer $ADMIN_KEY" -H 'content-type: application/json' \
  -d '{ "url": "https://example.com/hooks/helpbites", "events": ["changelog.entry.published", "feedback.*"] }'

curl "$HELPBITES/v1/admin/projects/$PROJECT/webhooks"                      -H "Authorization: Bearer $ADMIN_KEY"
curl -X PATCH "$HELPBITES/v1/admin/projects/$PROJECT/webhooks/$ID"         -H "Authorization: Bearer $ADMIN_KEY" -H 'content-type: application/json' -d '{ "enabled": false }'
curl -X PATCH "$HELPBITES/v1/admin/projects/$PROJECT/webhooks/$ID"         -H "Authorization: Bearer $ADMIN_KEY" -H 'content-type: application/json' -d '{ "rotateSecret": true }'
curl -X POST  "$HELPBITES/v1/admin/projects/$PROJECT/webhooks/$ID/test"    -H "Authorization: Bearer $ADMIN_KEY"
curl "$HELPBITES/v1/admin/projects/$PROJECT/webhooks/deliveries?endpoint=$ID" -H "Authorization: Bearer $ADMIN_KEY"
curl -X DELETE "$HELPBITES/v1/admin/projects/$PROJECT/webhooks/$ID"        -H "Authorization: Bearer $ADMIN_KEY"
```

`events` is a list of filters: `*` (everything, the default), `group.*` (one group: `contact`, `conversation`, `feedback`,
`board`, `changelog`, `errors`, `github`, `email`, `cms`, `blog`, `onboarding`) or an exact type. Up to 10 endpoints per project.

The project's original single event webhook (Settings → Event webhook, [MARKETING.md](MARKETING.md#event-webhook)) keeps
working and keeps receiving the events it always did (`contact.subscription_changed`, `email.suppressed`,
`cms.entry.published`, `cms.entry.unpublished` and the four `blog.post.*`); add an endpoint for anything else.

## Verifying and retrying

Each request carries `x-helpbites-signature: sha256=<hex HMAC-SHA256 of the raw body with the endpoint's secret>` and
`x-helpbites-event: <type>`.

```js
import crypto from 'node:crypto'
const expected = 'sha256=' + crypto.createHmac('sha256', process.env.HELPBITES_WEBHOOK_SECRET).update(rawBody).digest('hex')
const got = Buffer.from(req.headers['x-helpbites-signature'] || '')
if (got.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(expected), got)) return res.status(401).end()
```

```swift
import CryptoKit
// Verify on your own server (Vapor, Hummingbird…): the same HMAC over the raw body.
func isValid(body: Data, header: String, secret: String) -> Bool {
  let mac = HMAC<SHA256>.authenticationCode(for: body, using: SymmetricKey(data: Data(secret.utf8)))
  let expected = "sha256=" + mac.map { String(format: "%02x", $0) }.joined()
  return expected == header
}
```

Anything but a 2xx is retried after 1, 5, 30, 120 and 720 minutes, then given up on. A suspended workspace's events wait.
The latest deliveries and their errors are in the panel and at `/webhooks/deliveries`.
