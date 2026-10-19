# Email

Design emails once, brand them per project, send them from your server, and
see everything that went out. Templates are block documents (headings, text,
buttons, images, sections, columns, library components, custom HTML) rendered
to table-based, inline-styled HTML that holds up in Gmail, Apple Mail and
Outlook. You can also send your
own HTML, uploaded as a file or in the request, without making a template.

- **Masters**: sidebar → *Email*. A master belongs to no project. Every project that links it gets its design, and edits to the master reach all of them.
- **Project templates**: project → *Email*. These are the project's own templates, plus the masters it links.
- **Send API**: `POST /v1/emails/send` with the project secret. The email is a template (by send key or id), your own HTML, a block document, or a plain-text message in the project's layout.
- **Log**: the *Log* tab of the email page. One entry per recipient for every message HelpBites sends: API sends, test sends, conversation and feedback notifications, operator password resets. Mailgun's delivery webhook keeps each entry's status current.
- **Suppressions**: the *Suppressed* tab. Addresses a project no longer mails: hard bounces and spam reports (added by the webhook), unsubscribes, and addresses added by hand or through the API.

## Masters and projects

A project that links a master stores no design of its own. It keeps:

| Per project | Where it comes from |
|---|---|
| Brand | The project settings. `{{project.name}}`, `{{project.logoUrl}}` (logo URL) and `{{project.url}}` (site URL) fill in automatically. The project accent replaces the master's brand colour on buttons; buttons in any other colour keep it. |
| Values | One value per master variable (`{{footer}}`, `{{supportEmail}}`…). A blank value falls back to the master's default. |
| Send key | The name your server sends it by, e.g. `welcome`. It is unique within the project. |

Variables resolve in this order, last wins: master defaults, project brand,
the project's values, the variables in the send call.

**Detach** turns a link into the project's own editable copy. The project's
accent and values are baked into the copy, so it looks the same, and later
master edits no longer reach it. You can't delete a master while projects
still link it.

## Variables

`{{name}}` placeholders work anywhere in a template: subject, preheader, text,
buttons, links, image URLs, custom HTML and the plain-text version.

- **`{{key}}` or `{{{key}}}`.** In custom HTML (an HTML block, or HTML you send through the API), `{{key}}` fills in **HTML-escaped**, so a name like `<b>Ada</b>` arrives as text, and `{{{key}}}` fills in **raw**, for values that are HTML on purpose (a pre-rendered list, a button row). Everywhere else the renderer escapes or sanitizes the value, so both forms behave the same. Text blocks take the inline subset (bold, italic, links).
- **Reserved**: `{{project.name}}`, `{{project.logoUrl}}`, `{{project.url}}` and `{{project.address}}` (the postal address from the marketing settings) come from the project; `{{recipient.email}}` and `{{recipient.name}}` fill in per message at send time. A call can't set either kind.
- **Unknown placeholders stay as written**, so a missing value shows up in a test instead of vanishing.

## Editor

Three panes: the AI designer, the live preview (click a block to select it,
drag to reorder) and the inspector (block settings, theme, variables).
Changes autosave and sync live to everyone who has the template open. Drag
the panes' edges to resize them, and the line between the AI designer and
Layers to share the left side (arrow keys work on it too; double-click resets);
both sections fold away from their headers.

- **Blocks**: *Add* inserts after the selected block, in the same section or column; with a section selected, inside it. A **section** puts blocks on one surface (a card with rounded corners and a shadow, a coloured or gradient band, a callout, or a plain padded group) and sections nest. Clicking a block inside a section selects it; the inspector moves it up and down within its section, and *In section: select it* climbs to the parent. When the card has rounded corners or something sits outside it, set the card colour to the page colour and draw the card as a section. Headings take their own size, font and letter spacing; buttons their size and shadow; an image sized only by height keeps its shape; links in text keep their colour and weight.
- **Checks**: the top-bar badge lists what will hurt in an inbox, such as a missing subject or preheader, missing alt text, low contrast, placeholder links or images, or tags mail clients strip. For a master it also flags a hardcoded brand.
- **Plain-text version**: under *Email settings*. Sent alongside the HTML; leave it blank and HelpBites generates one from the design (hidden preheaders and HTML comments left out).
- **Send test**: sends the template to you (or up to five addresses) with its sample values, editable, and "[Test]" in front of the subject. A master can borrow a project's brand and sender for the test. Also on every card's menu.
- **Share**: *view* gives anyone with the link a rendered preview; *edit* lets them change the design too, with no sign-in. Links to linked masters are view-only. Turning sharing off revokes the link.
- **Import**: the upload menu on the template list. *Import HTML* turns an HTML file into one custom-HTML block, with its `<title>` as the subject, its hidden preview text as the preheader and its page colour kept. *Import JSON* brings back an export, showing what will be created and updated first.
- **Export**: *Download HTML*, *Copy HTML* (the email as it goes out, brand and sample values filled in), *Export JSON* (the design, placeholders intact) and *Use via API* (copy-ready requests, plus the send key) on every card and in the editor. *Export all as JSON* on the upload menu saves every template of the project, or every master, in one file.

## Components

Custom HTML you save once and reuse: a brand header, a footer, a badge, a
receipt row. The *Components* tab of the email page lists them; *Add* in the
editor inserts them.

- **Fields**: write `{{@name}}` wherever an email gets its own value: `href="{{@link}}"`, `color:{{@tint}}`, `font-size:{{@size}}px`, `{{@title}}`. Each field has a label, a type (text, rich text, link, image, colour, number) and a default, and is **content** (copy, links, images) or **style** (colours, sizes). The dialog guesses the type from where the field sits, and the preview shows the component with its defaults.
- **In an email** the inspector shows the fields, content and style apart. Values belong to that email, so restyling one instance never changes the library or other emails. A value can hold `{{variables}}` (a link with `{{userName}}`, a colour from `{{accentColor}}` that each project linking a master sets for itself), and in a linked master a colour field in the master's brand colour follows the project accent, like buttons do.
- **Copies**: inserting a component copies it into the email, so sending, exporting and the send API never depend on the library. Editing a component changes new insertions; an email that uses an older version shows *Update* on that component. *Detach to HTML* turns an instance into a plain custom-HTML block.
- **Scope**: components saved on the masters page are shared with every project and master. A project's own components only show in its templates; *Use in every project* shares one. Deleting a component leaves the emails that use it as they are.
- **Making one**: *New component* (paste HTML), *Save as component* on a custom-HTML block or a section, or ask the AI designer (*Make reusable* on a selected block).

## AI designer

It edits the document through tools, the same operations as the inspector, so every change shows up in the preview as it happens.

- **How it builds**: for each part of an email it uses, in order, a built-in block (even when a detail differs slightly; it says so), a library component that matches, a new library component when a self-contained part no block can express is likely to come back (it writes the HTML with content and style fields and saves it), and custom HTML only for one-off markup. It never puts a whole email in one HTML block.
- **Converting HTML**: paste an email with something like "Convert this HTML into components", or select an imported custom-HTML block and use *Convert to blocks*. It rebuilds the design from blocks (page and card colours, a card section with its corners and shadow, gradient bands, headings, styled links, buttons, images at their size) and keeps every visible word, link and `{{variable}}`. After each edit the designer is told what the email is missing or has added compared with the source, and fixes it before it answers. It keeps the original's colours even when a check flags them, and tells you instead.
- **Watching it build**: new and converted emails go in top to bottom, part by part, and each part appears in the preview as soon as it's written. With a model that streams tool calls, a part also fills in while it's being written (a draft the preview shows and never saves).

- **High** uses `mimo-v2.6`: fast, good for edits and copy. **Ultra** uses `mimo-v2.6-pro`: strongest, for new designs and big rewrites. The choice is remembered on each device.
- It knows whether it is shaping a master (brand placeholders, no hardcoded names) or one project's template (that project's name, site and accent).
- It sees the checks, can run them itself, and *Fix with AI* hands it the list.
- Each turn is one undo step: *Undo changes* reverts a turn, and *Try again* reruns the last one from the design it started with. Each reply lists its edits; click one to select the block it touched. Follow-up suggestions sit under the newest reply, and long messages fold away under *Show more*.
- A template keeps any number of chats. The newest opens with the editor; *History* (in the section header) switches between them or deletes one, and *New chat* starts another. Deleting a chat leaves the email alone.
- A turn keeps running on the server if the page reloads or goes offline: open the chat again, or come back online, and it picks the turn back up where it is (or shows how it ended). *Stop* stops it on the server too. One turn runs per template at a time.

It needs `LITELLM_API_BASE_URL` (and `LITELLM_API_KEY` if your gateway needs one),
which are the same variables the support assistants use. The gateway must serve
both model names.

## Verification codes

When a project allows email-only users, HelpBites mails a 6-digit code to prove an address (`source: notification`, counted against the plan like other notification mail). Addresses on the suppression list never receive it. The code is a `code` variable, so the log redacts it; with message content logging on (`emailLogContent`) it also appears in the stored body (the code stops working after 10 minutes). At most 5 codes per address and day are sent.

## Sending setup

HelpBites sends through Mailgun. The server needs `MAILGUN_API_KEY`,
`MAILGUN_DOMAIN` and `MAILGUN_FROM_EMAIL` (and `MAILGUN_API_BASE_URL` for the
US region); without them sends answer 503 and notifications are skipped.

Each project can send as itself: project → *Dev* → *Email sending*.

| Setting | API field | Default |
|---|---|---|
| From name | `fromName` (*Reply as*) | The project name |
| From address | `fromEmail` | `MAILGUN_FROM_EMAIL` |
| Sending domain | `mailDomain` | `MAILGUN_DOMAIN` |
| Reply-to | `replyTo` | none |
| Keep a copy of each email | `emailLogContent` | off |

The sending domain must be a domain of the same Mailgun account as
`MAILGUN_API_KEY`, in the region `MAILGUN_API_BASE_URL` points at, and the from
address should be on it (so SPF and DKIM line up). A send may change the from
name and the reply-to; a different from address must stay on the project's
domain.

### Delivery webhooks

Set `MAILGUN_WEBHOOK_SIGNING_KEY` (Mailgun → *Sending* → *Webhooks* → *HTTP
webhook signing key*) and add `https://<your HelpBites>/v1/webhooks/mailgun`
for the events *Delivered*, *Opened*, *Clicked*, *Permanent failure*,
*Temporary failure*, *Spam complaints* and *Unsubscribes*, on every domain your
projects send from. The *Log* tab shows the exact URL.

- Each event moves its log entry on (sent → delivered → opened → clicked) and joins its timeline. A late event never moves an entry backwards.
- A permanent failure, a spam complaint or an unsubscribe also puts the address on the project's suppression list.
- Requests are verified with the signing key, and a replayed token changes nothing. An event for a message HelpBites sent but has not logged yet answers 503, so Mailgun retries it; events for mail HelpBites did not send are ignored.

Opens and clicks need tracking on the Mailgun domain; a send can override it
with `tracking: { opens, clicks }`. Click tracking rewrites links, so leave it
off for messages that carry sign-in or reset links.

## API

Everything is in the OpenAPI docs at `/_docs/scalar`. With the project secret
(`sk_…`, under project → *Dev*) a call acts for its own project. With an
operator session or admin key (`ak_…`) it can act for any project by passing
`project`, and sends are logged as that operator's.

### Send

```bash
curl -X POST https://help.example.com/v1/emails/send \
  -H "Authorization: Bearer $HELPBITES_SECRET" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: welcome-u_42" \
  -d '{"template":"welcome","to":"ada@example.com","variables":{"firstName":"Ada"}}'
```

The email is exactly one of:

| Field | What it is |
|---|---|
| `template` | A send key (`welcome`) or template id of this project. |
| `html` | Your own HTML, a full document or a fragment (a fragment gets a document around it). Needs `subject`, or a `<title>`. |
| `document` | A block document `{ settings, blocks }`, as *Export JSON* writes it. |
| `message` | `{ subject, body, ctaUrl?, ctaLabel? }`: plain text in the project's message layout (the one conversation replies use). |

Your own HTML can also be an uploaded file, with `multipart/form-data`:

```bash
curl -X POST https://help.example.com/v1/emails/send \
  -H "Authorization: Bearer $HELPBITES_SECRET" \
  -F "html=@welcome.html" \
  -F "to=ada@example.com" \
  -F 'variables={"firstName":"Ada"}' \
  -F "attachment=@invoice.pdf"
```

A file field named `html` (or `file`) is the email, `attachment` and `inline`
files are attached, other fields are the same as the JSON keys (`to` may
repeat; `variables`, `headers`, `metadata` take JSON), or send the whole JSON
body as one `payload` field.

Everything else:

| Field | |
|---|---|
| `to` | Up to 50 recipients: `ada@example.com`, `Ada Lovelace <ada@example.com>`, or `{ email, name?, variables? }` for values of their own (they win over the call's `variables`). Each recipient gets their own message. Duplicates are sent once. |
| `variables` | Values for the placeholders. |
| `subject` | Overrides the template's subject. Placeholders fill in. |
| `text` | The plain-text part. Otherwise the template's own, or generated from the HTML. |
| `cc`, `bcc` | Up to 10 each, copied on every message. |
| `from` | A name, `Name <address>`, or `{ name, email }`. The address must be on a domain the project set up itself (its `mailDomain`, or its own sender's domain); a project on the shared default sender can only use that exact address. |
| `replyTo` | One address. |
| `headers` | Extra headers such as `List-Unsubscribe`. Values may use placeholders, filled per recipient: `{"List-Unsubscribe":"<{{unsubscribeUrl}}>"}` with each recipient's own `unsubscribeUrl`. `From`, `To`, `Subject`, `Reply-To` and the like are refused. |
| `tags` | Up to 3, for filtering in Mailgun and in the log. |
| `metadata` | Up to 10 of your own keys (a user id, an order number), values up to 200 characters: stored on the log and echoed back by delivery webhooks. |
| `attachments` | Up to 10 files, 10 MB in all: `[{ filename, content (base64), contentType?, inline? }]`. An inline file is referenced from the HTML as `cid:<filename>`. |
| `sendAt` | Deliver later, up to 72 hours ahead (ISO date or Unix seconds). The log shows it as *scheduled*. |
| `tracking` | `{ opens, clicks }`, overriding the domain's tracking. |
| `testMode` | Mailgun accepts and logs the message but does not deliver it. |
| `ignoreSuppressions` | Send even to suppressed addresses, for mail a person must get after unsubscribing (a password reset). |
| `idempotencyKey` | Or the `Idempotency-Key` header. A retry with the same key within 24 hours returns the first response (with `Idempotent-Replayed: true`) instead of sending again. |

The response is `{ id, sent, failed, suppressed, results }`. `id` is the batch
id every recipient's log entry carries; `results` has `{ to, status, logId,
messageId, error? }` per recipient, where `status` is `sent`, `scheduled`,
`failed` or `suppressed`. Errors: 400 for a bad request (no or bad recipients,
two kinds of content, a bad header, no subject), 404 for an unknown template,
409 while a request with the same idempotency key is still running, 413 for
oversized HTML or attachments, 502 when Mailgun refused every recipient (each
is still logged), 503 when sending is not configured. Sends are limited to 120
requests a minute per project.

### Preview without sending

`POST /v1/emails/render` takes the same body (`to` optional) and returns what
the first recipient would get: `{ subject, html, text, from, replyTo, to, cc,
bcc, headers, kind, template, attachments }`, or the HTML itself with
`?format=html`. Nothing is sent or logged.

### Fetch a template rendered

To hand an email to your own mail provider, fetch it rendered with the project's brand and your variables. Variables are query parameters:

```bash
curl "https://help.example.com/v1/emails/welcome?format=html&firstName=Ada" \
  -H "Authorization: Bearer $HELPBITES_SECRET"
```

- `format=html` returns the HTML document itself, `format=text` the plain-text part. Without it you get `{ id, key, name, subject, html, text, variables }`, where `variables` lists what you can pass and what each falls back to.
- `GET /v1/emails` lists every template the project can use (its own and linked masters), with keys and variables.
- With the project secret, `:key` is the send key or the template id. An operator session or admin key reads any template by id, masters included; a master renders with its sample values.

### Read the log

```bash
curl "https://help.example.com/v1/email-logs?to=ada@example.com" \
  -H "Authorization: Bearer $HELPBITES_SECRET"
```

`GET /v1/email-logs` returns `{ logs, nextBefore }`, newest first, filtered by
`to` (an address, or the start of one), `template` (send key or id), `status`,
`source` (`api`, `admin`, `test`, `notification`, `feedback`, `system`),
`batch` (a send's `id`), `since` and `until`. Pass `before=<nextBefore>` for
the next page. `GET /v1/email-logs/:id` returns one entry with its delivery
timeline, and the message itself when the project keeps content.

### Suppressions

- `GET /v1/email-suppressions` (`q`, `reason`) lists them.
- `POST /v1/email-suppressions` `{ emails, reason?, detail? }` adds addresses, for example when a user unsubscribes in your app. `reason` is `unsubscribe`, `manual`, `bounce` or `complaint`.
- `DELETE /v1/email-suppressions/:email` mails an address again.

### Admin

With an operator session or admin key:

| Route | |
|---|---|
| `GET/POST /v1/admin/emails`, `GET/PATCH/DELETE /v1/admin/emails/:id` | Templates and masters, plus `duplicate`, `detach`, `share`, `chat` and `events` under `:id`. |
| `POST /v1/admin/emails/:id/test` | Send a test: `{ to?, variables?, project? }`. |
| `POST /v1/admin/emails/import` | Up to 100 templates by send key: `{ project?, mode: "create" \| "upsert", dryRun?, templates: [{ key, name?, description?, folder?, document? \| html? (+ subject, preheader, text, settings) \| master? (+ variableValues), variables? }] }`. `create` keeps existing keys; `dryRun` reports and writes nothing. |
| `GET /v1/admin/emails/export` | Every template of `?project=` (or every master) in the import format. |
| `GET/POST/PATCH/DELETE /v1/admin/email-folders…` | Folders. |
| `GET /v1/admin/email-components`, `POST`, `PATCH/DELETE /v1/admin/email-components/:id` | The component library: the shared components, plus a project's own with `?project=`. A component is `{ name, description, html, fields: [{ key, label, type, group, default }], project? }`; `project: null` shares it. |
| `GET /v1/admin/email-logs`, `GET /v1/admin/email-logs/:id` | The log, for one project (`?project=`) or all, same filters as above. |
| `GET /v1/admin/email-logs/stats` | Totals over `days` (default 30): by status, by source, per day, top 50 templates (the log's template filter lists them). |
| `DELETE /v1/admin/email-logs` | Delete entries `before` a date or `olderThanDays`, for one project or all; up to 20,000 per call (`more: true` means call again). |
| `GET/POST /v1/admin/email-suppressions`, `DELETE /v1/admin/email-suppressions/:id` | Suppressions of any project. |
| `GET /v1/admin/email-settings` | Whether sending is configured, the default sender, the webhook URL and the log retention. |
| `PATCH /v1/admin/projects/:id` | A project's sender: `fromName`, `fromEmail`, `mailDomain`, `replyTo`, `emailLogContent`. |

## The log

One entry per recipient: when, to whom, from whom, the subject, the template
(key and name, kept even if the template is renamed or deleted), the status
and its timeline, the error, tags, metadata, attachments by name and size,
header names, who sent it (the project secret, an operator, or HelpBites
itself) and from where, and the values it was rendered with.

Values whose key looks like it unlocks something (`link`, `url`, `token`,
`code`, `password`, `secret`, `reset`, `verify`, `invite`, `unsubscribe`…) are
stored as `[redacted]`; long values are cut at 300 characters. The message
itself is kept only when the project turns on *Keep a copy of each email*,
since it can carry those same links.

Entries older than `EMAIL_LOG_RETENTION_DAYS` (default 180; `0` keeps
everything) are pruned every six hours.

## Campaigns and sequences

Marketing email — broadcasts to subscribers, automated sequences, sign-up and unsubscribe — is in [MARKETING.md](MARKETING.md). It sends through the same pipeline; its log rows have source `campaign` or `sequence`.
