# Inbound email

Give a project an email address (`support@lightbites.app`) and every message sent to it becomes a conversation in
the inbox. Your replies, and the AI assistant's, go back by email, threaded in the customer's mail app, and what
they answer comes back into the same conversation.

Community installs get this with no limits. On HelpBites Cloud it is part of the Pro plan (`inboundEmail`).
Creating addresses needs the `projects.manage` permission. It needs Mailgun, the same account the server already
sends through ([EMAIL.md](EMAIL.md)).

## Two ways to receive mail

| | Forward my mailbox | Use my domain |
|---|---|---|
| Address | A HelpBites alias, `in-…@<INBOUND_DOMAIN>`, that your existing `support@lightbites.app` forwards to. | `support@mail.lightbites.app`, on a domain you point at the mail provider. |
| DNS | None. | MX records for the domain (the panel shows them). |
| Your current mail | Untouched: `lightbites.app` keeps Google Workspace, iCloud or whatever it has. | **All** mail for that domain goes to the provider. Use a subdomain (`mail.lightbites.app`). |
| Replies come from | The project's sender; `Reply-To` is `support@lightbites.app`, so answers come back through your forward. Set up a sending domain for `lightbites.app` ([EMAIL.md](EMAIL.md)) and replies are sent *from* it too. | The address itself, when its domain is the project's sending domain. |

Add one in *Project → Email → Settings → Support email addresses* (web or the native app), or over the API below.
Forwarding: ask your mailbox provider to forward mail for `support@lightbites.app` to the alias. Domain: add
the MX records, then **Check DNS**; the address is *Receiving* when they are found.

## What happens to a message

1. Mailgun posts it to `POST /v1/webhooks/mailgun-inbound` (signed with `MAILGUN_WEBHOOK_SIGNING_KEY`, each
   signature accepted once).
2. The recipient is matched to an address. Mail for an address that is unknown, removed or not verified, or for a
   workspace whose plan lacks `inboundEmail`, is accepted and dropped: nothing is ever bounced back.
3. **Dropped without a conversation:** automatic replies (out-of-office, `Auto-Submitted`, bulk and list mail,
   delivery failures) and mail from one of the project's own addresses, so two auto-responders cannot loop.
   More than 20 messages an hour from one sender, or 300 an hour to one project, are dropped too.
4. The sender becomes a **contact** (an existing contact with that address is reused). The `From` header is not
   proof of who wrote it, so mail never signs anyone in.
5. The mail continues a conversation when it replies to one (`In-Reply-To` / `References`, or the `+c_<id>` in the
   address a reply was sent to), **and** it comes from that conversation's contact. Anything else starts a new
   conversation, titled with the subject. A reply to a closed conversation reopens it.
6. The text is what the sender typed (the quoted earlier message is cut off), up to 8,000 characters. PNG, JPEG,
   GIF and WebP attachments (4 at most, 8 MB each) are kept; other files are listed as "Not shown".
7. The team is notified as for any new conversation, and an assistant with auto-reply on answers, by email.

A conversation that came in by email shows an envelope in the inbox, and the inbox can be filtered to Email.

## Replies

Every reply to an email conversation is mailed (there is no five-minute batching as in chat), with the subject
`Re: …`, the thread's `In-Reply-To` and `References`, and a `Reply-To` of the project's address carrying the
conversation id (`support+c_<id>@lightbites.app`). Replies by the assistant, the operator panel, the native app,
the admin API and MCP all go the same way.

## Set it up on a server

1. Your Mailgun account must receive mail for the domains: add each domain in Mailgun (a sending domain you
   already use works). For forwarding, add a domain for aliases and set `INBOUND_DOMAIN` to it (`inbound.example.com`);
   its MX must point at Mailgun.
2. Create **one** Mailgun Route for the whole account: expression `match_recipient(".*")`, action
   `forward("https://<APP_URL>/v1/webhooks/mailgun-inbound")`. Mailgun signs these posts with the account's webhook
   signing key, the same `MAILGUN_WEBHOOK_SIGNING_KEY` the delivery webhook uses. Check this against your region's
   Mailgun documentation.
3. Optional: `INBOUND_DOMAIN`. Without it the server offers *Use my domain* only.

## API

All calls need an operator session or an `ak_` admin key. Errors: `400` (not an address, a reserved domain, too
many), `402` (the plan has no support email addresses), `403` (the domain is not verified for this workspace),
`409` (taken by another project). Up to 5 addresses per project.

```bash
# Forwarding alias for the address your customers know
curl -X POST https://help.example.com/v1/admin/projects/PROJECT_ID/inbound-addresses \
  -H "Authorization: Bearer $HELPBITES_ADMIN_KEY" -H "Content-Type: application/json" \
  -d '{"kind":"forward","publicAddress":"support@lightbites.app","fromName":"Lightbites Support"}'
# → { "address": { "id": "…", "address": "in-9f2c…@inbound.example.com", "state": "verified", … } }

# An address on your own subdomain, then check its MX records
curl -X POST …/inbound-addresses -H "Authorization: Bearer $HELPBITES_ADMIN_KEY" -H "Content-Type: application/json" \
  -d '{"kind":"domain","address":"support@mail.lightbites.app"}'
curl -X POST …/inbound-addresses/ADDRESS_ID/verify -H "Authorization: Bearer $HELPBITES_ADMIN_KEY"

# List, remove
curl …/inbound-addresses -H "Authorization: Bearer $HELPBITES_ADMIN_KEY"
curl -X DELETE …/inbound-addresses/ADDRESS_ID -H "Authorization: Bearer $HELPBITES_ADMIN_KEY"

# Only the conversations that came in by email
curl "https://help.example.com/v1/admin/conversations?channel=email" -H "Authorization: Bearer $HELPBITES_ADMIN_KEY"
```

Conversations carry `channel` (`email` or `widget`).

## In a web page or an app

There is nothing to embed: the address is the entry point. Put it on a page as a link, or let your own form post
to the public API instead ([SUPPORT.md](SUPPORT.md)):

```html
<a href="mailto:support@lightbites.app">Email support</a>
```

In a SwiftUI app, open the user's mail composer with the same address (no package, no key):

```swift
import SwiftUI

struct EmailSupportButton: View {
    var address = "support@lightbites.app"
    var title = "Email support"
    @Environment(\.openURL) private var openURL

    var body: some View {
        Button(title) { openURL(URL(string: "mailto:\(address)")!) }
    }
}
```

## Limits

- Only Mailgun receives mail. Attachments other than images are not kept.
- A sender's own mail program decides whether a reply carries `In-Reply-To`; a mail that does not and has no
  `+c_<id>` tag starts a new conversation.
- A forwarding rule that rewrites `To` and drops the original (some providers) loses the `+c_<id>` tag; replies
  still thread through `In-Reply-To`.
