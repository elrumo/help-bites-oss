# The conversation panel

Open a conversation in the inbox and everything about the customer is beside it: their plan and what they pay, their
earlier conversations, a link to their contact page, and the feedback they asked for. Under the reply box are a
picker for saved replies and FAQs, and a button that drafts a reply with AI. The web panel and the native app do the
same, through the endpoints below. They are admin endpoints (an operator session or an `ak_` admin key), so you can
script all of it too.

Every request carries `Authorization: Bearer ak_…`. Project-scoped keys work for the projects they are limited to.

## What the panel shows

- **Plan and MRR.** When the Stripe sync has found the customer, a compact card shows their plan, their monthly
  recurring revenue in the Stripe account's currency, and the subscription status. No Stripe customer, no card.
  [CONTACTS.md](CONTACTS.md) covers the `stripe_*` attributes the sync writes.
- **Past conversations.** The customer's other conversations, newest first (ten at most). Click one to open it.
- **Open contact.** Opens their contact page (`/projects/<id>/contacts?contact=<contactId>` on the web).
- **Feedback.** The posts linked to this conversation, with whether the customer follows each. File a new post as
  the customer or link one that exists.
- **Save as FAQ.** Right-click (web) or long-press (native) one of your replies to turn it into an FAQ.
- **Saved replies and FAQs** in the reply box, and **Draft with AI**.

## One read: `GET /v1/admin/conversations/:id/context`

```bash
curl -s https://YOUR-SUPPORT-HOST/v1/admin/conversations/CONV_ID/context \
  -H "Authorization: Bearer $HELP_BITES_ADMIN_KEY"
```

```json
{
  "contact": { "id": "k1", "name": "Ada Lovelace", "email": "ada@example.com", "externalId": "user_42", "language": "en", "lastSeenAt": "2026-10-20T08:12:00.000Z" },
  "billing": { "plan": "Pro", "mrr": 29, "currency": "usd", "status": "active", "customerId": "cus_123" },
  "pastConversations": [
    { "id": "c0", "subject": "Export stuck", "status": "done", "statusCategory": "resolved", "lastMessageAt": "2026-09-30T10:00:00.000Z", "lastMessagePreview": "Fixed, thanks!", "createdAt": "2026-09-30T09:00:00.000Z" }
  ],
  "feedbackPosts": [
    { "id": "p12", "number": 12, "title": "Export bookmarks as CSV", "status": "planned", "statusLabel": "Planned", "statusCategory": "planned", "following": true }
  ],
  "faqModels": { "models": [{ "id": "m1", "name": "Help center" }], "defaultModelId": "m1" }
}
```

- `billing` is `null` unless the contact has a Stripe customer. `mrr` is in major currency units (`29`, `19.99`), and
  `currency` comes from the project's connected Stripe account (empty when it was disconnected).
- `pastConversations` leaves out the one you asked about and includes archived ones.
- `feedbackPosts` is in the order they were linked; a post deleted since is skipped. `following` is false when the
  customer has muted the post or has no user id.
- `faqModels` is where "Save as FAQ" can write, best first: the models the conversation's assistant reads, then the
  project's other assistants', then the rest. `defaultModelId` is empty when the workspace has no knowledge model.

## Linking a feedback post: `POST /v1/admin/conversations/:id/feedback-posts`

Link an existing post (an id or `#12`), the customer follows it:

```bash
curl -s -X POST https://YOUR-SUPPORT-HOST/v1/admin/conversations/CONV_ID/feedback-posts \
  -H "Authorization: Bearer $HELP_BITES_ADMIN_KEY" -H "Content-Type: application/json" \
  -d '{ "postId": "#12" }'
```

File a new post written by the customer, and link it:

```bash
curl -s -X POST https://YOUR-SUPPORT-HOST/v1/admin/conversations/CONV_ID/feedback-posts \
  -H "Authorization: Bearer $HELP_BITES_ADMIN_KEY" -H "Content-Type: application/json" \
  -d '{ "create": { "title": "Export bookmarks as CSV", "body": "Asked for in the support chat.", "type": "feature" } }'
```

Unlink: `{ "postId": "#12", "linked": false }`. The answer is `{ feedbackPostIds, post, linked, created, following }`.

The rules:

- **The customer follows what you link** (they are emailed when it changes), unless you send `"follow": false`.
  A post you file is theirs: they are its author, start with their own vote and follow it. It is validated like a post
  they filed themselves (`type` must be one of the board's types), and it does not count as the customer visiting or
  toward their posting rate limit.
- **A contact with no user id (`externalId`) cannot follow or author a post.** Linking still works and answers
  `following: false`. Filing a new post is refused with `409`, because a post needs an author with an id. Link an
  existing post instead.
- **Unlinking does not unfollow.** They may still want to hear about it.
- A conversation links at most 20 posts (`400` past that). Linking something already linked changes nothing.
- Each change leaves a line on the conversation's timeline (internal, the customer never sees it) and publishes the
  `conversation.feedback_linked` event (`{ conversationId, postId, linked, created }`, see [EVENTS.md](EVENTS.md)).
- Customers never see which posts a conversation links: `feedbackPostIds` is left out of everything an end user reads.

## Saved replies: `/v1/admin/saved-replies`

Canned answers a project's team inserts while replying. Reading is open to any member; creating, editing and deleting
need the content role.

```bash
# list
curl -s "https://YOUR-SUPPORT-HOST/v1/admin/saved-replies?project=PROJECT_ID" -H "Authorization: Bearer $HELP_BITES_ADMIN_KEY"

# create
curl -s -X POST https://YOUR-SUPPORT-HOST/v1/admin/saved-replies \
  -H "Authorization: Bearer $HELP_BITES_ADMIN_KEY" -H "Content-Type: application/json" \
  -d '{ "project": "PROJECT_ID", "title": "Refund policy", "shortcut": "refund", "body": "Hi {{firstName}}, you can ask for a refund within 30 days." }'

# edit / delete
curl -s -X PATCH  https://YOUR-SUPPORT-HOST/v1/admin/saved-replies/REPLY_ID -H "Authorization: Bearer $HELP_BITES_ADMIN_KEY" -H "Content-Type: application/json" -d '{ "body": "…" }'
curl -s -X DELETE https://YOUR-SUPPORT-HOST/v1/admin/saved-replies/REPLY_ID -H "Authorization: Bearer $HELP_BITES_ADMIN_KEY"
```

| Field | Rule |
|---|---|
| `title` | Required, up to 120 characters. |
| `body` | Required, up to 8,000 characters (a message's own limit). |
| `shortcut` | Optional, up to 30 characters, unique in the project. Lowercased; letters, digits, `-` and `_` (a leading `/` is ignored). `""` clears it. |
| Per project | At most 200 (`409` past that). |

**Placeholders.** `{{firstName}}` is the first word of the customer's name and `{{name}}` all of it; with no name both
become `there`, so "Hi {{firstName}}," always reads. Spaces inside the braces and letter case do not matter, and
any other `{{…}}` is left as written. The text is stored as typed; the client fills the placeholders when it inserts the
reply (`fillSavedReply` in `shared/savedReplies.ts`, ported to Swift as `SavedReplyFill`).

## Replies and FAQs to answer with: `GET /v1/admin/conversations/:id/suggestions?q=`

```bash
curl -s "https://YOUR-SUPPORT-HOST/v1/admin/conversations/CONV_ID/suggestions?q=refund" -H "Authorization: Bearer $HELP_BITES_ADMIN_KEY"
# { "faqs": [{ "id", "question", "answer" }], "savedReplies": [{ "id", "title", "body", "shortcut" }] }
```

Saved replies match `q` against the shortcut, the title and the text (best match first; with no `q` they are listed by
title, up to 20). FAQs come from the knowledge each of the project's assistants may read, through the same search the
auto-responder uses: Meilisearch when it is set up, a keyword scan otherwise. With no `q` the FAQs answer the
customer's latest message, so the picker opens on likely answers. Only active FAQs are offered.

## Draft a reply with AI: `POST /v1/admin/conversations/:id/draft`

```bash
curl -s -X POST https://YOUR-SUPPORT-HOST/v1/admin/conversations/CONV_ID/draft -H "Authorization: Bearer $HELP_BITES_ADMIN_KEY"
# { "draft": "Hi Ada, …", "model": "gpt-4o-mini", "sources": [{ "faqId": "f1", "question": "How do I export?" }] }
```

The draft is for you to edit: **nothing is stored or sent**. It uses the auto-responder's pipeline: the conversation's
assistant (else the project's first active one, even with auto-reply off), the knowledge it may read, and the public part
of the conversation. Internal notes and timeline events are never shown to the model. `sources` are the FAQs it was
given; with none, check the facts yourself.

| Status | When |
|---|---|
| `409` | The project has no assistant, no AI provider is set up, or the customer has not written anything yet. |
| `402` | The workspace has used this month's AI credits (see [KNOWLEDGE.md](KNOWLEDGE.md) for assistants and your own provider). |
| `502` | The AI provider failed. |

## Save an answer as an FAQ: `POST /v1/admin/conversations/:id/faq`

```bash
curl -s -X POST https://YOUR-SUPPORT-HOST/v1/admin/conversations/CONV_ID/faq \
  -H "Authorization: Bearer $HELP_BITES_ADMIN_KEY" -H "Content-Type: application/json" \
  -d '{ "question": "How do I export my data?", "answer": "Open Settings, then Data, then Export.", "modelId": "MODEL_ID" }'
```

Creates an **active** FAQ with origin `conversation`; its `conversationId` says where it came from. `modelId` is your
pick from `faqModels`; left out it is the first one offered. It counts against the plan's FAQ limit (`402`), and with
no knowledge model in the workspace it answers `409` ("Create one under Knowledge first"). The question is up to 500
characters and the answer up to 20,000. See [KNOWLEDGE.md](KNOWLEDGE.md) for what happens to an FAQ next.

## Events

`conversation.created`, `conversation.status_changed` (a status change by an operator, an action, or a customer
reopening a thread) and `conversation.feedback_linked` are published to your webhook endpoints. See
[EVENTS.md](EVENTS.md).

## Build your own panel

Web, one read and the placeholder fill:

```js
import { fillSavedReply } from './savedReplies' // or copy the few lines from shared/savedReplies.ts

const base = 'https://YOUR-SUPPORT-HOST/v1/admin'
const headers = { authorization: `Bearer ${adminKey}` }

const ctx = await fetch(`${base}/conversations/${id}/context`, { headers }).then(r => r.json())
if (ctx.billing) console.log(`${ctx.billing.plan}: ${ctx.billing.mrr} ${ctx.billing.currency.toUpperCase()} a month`)

const { savedReplies } = await fetch(`${base}/conversations/${id}/suggestions?q=refund`, { headers }).then(r => r.json())
const text = fillSavedReply(savedReplies[0].body, { name: ctx.contact.name })
```

Swift, plain `URLSession`, no package:

```swift
import SwiftUI

struct CustomerPanel: View {
  let base = URL(string: "https://YOUR-SUPPORT-HOST/v1/admin")!
  let adminKey: String
  let conversationId: String
  var accent = Color.accentColor
  var cornerRadius: CGFloat = 8

  struct Context: Decodable {
    struct Billing: Decodable { let plan: String; let mrr: Double; let currency: String; let status: String }
    struct Past: Decodable, Identifiable { let id: String; let subject: String }
    let billing: Billing?
    let pastConversations: [Past]
  }
  @State private var context: Context?

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      if let billing = context?.billing {
        Text("\(billing.plan.isEmpty ? "No plan" : billing.plan) · \(billing.mrr.formatted(.currency(code: billing.currency.uppercased()))) a month")
          .padding(10)
          .overlay(RoundedRectangle(cornerRadius: cornerRadius).stroke(accent.opacity(0.4)))
      }
      ForEach(context?.pastConversations ?? []) { Text($0.subject) }
    }
    .task {
      var request = URLRequest(url: base.appending(path: "conversations/\(conversationId)/context"))
      request.setValue("Bearer \(adminKey)", forHTTPHeaderField: "Authorization")
      if let (data, _) = try? await URLSession.shared.data(for: request) { context = try? JSONDecoder().decode(Context.self, from: data) }
    }
  }
}
```

Keep an admin key on a server you run, not in an app you ship: the key can do everything an operator can.

## Not built yet

- Saved replies cannot be triggered by typing `/shortcut` in the reply box yet: the shortcut is something you search
  for in the picker.
- The AI draft answers the customer's latest message only; it does not take instructions ("make it shorter").
- A contact with no user id cannot follow or file feedback.
