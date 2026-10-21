# Lead forms

Collect people before you launch, or whenever you want to hear from them: a
waitlist, a "notify me when it is ready" box, an early-access request or a short
interest form. Put it on your site with one script tag, as a plain HTML form, on
a hosted page, in a SwiftUI app, or post to the API from your own UI.

Everyone who signs up becomes a [contact](CONTACTS.md) of the project: you see
them under **Contacts → People** with **Added via: Lead form**, each form gets a
segment of its own, and you can send them a welcome email, start them on a
[sequence](MARKETING.md#sequences) and email them later with a campaign.

Panel: **Project → Forms**, in the web panel or the native app.

## A form

A project has up to 50 forms. Each has a **key** (the name your site asks for it
by, such as `waitlist`), a name, and can be switched off: a form that is not
taking sign-ups answers `404`, and the script draws nothing.

### Fields

Up to 12, in order. There is always exactly one email field; everything else is
up to you, from a single email box to a longer form.

| Type | Saved as | Notes |
|---|---|---|
| `email` | the contact's email | Always there, always required. |
| `name` | the contact's name | At most one. |
| `text`, `textarea` | an attribute | Up to 200 and 500 characters. |
| `number` | an attribute (a number) | |
| `url` | an attribute | An http(s) address. |
| `phone` | an attribute | Digits, spaces, `+ ( ) . / -`. |
| `select` | an attribute | One of up to 20 options. |
| `checkbox` | an attribute (`true` / `false`) | Make it required for "I agree to…". |
| `file` | a private file of the contact | Up to 3 per form. See [Files](#files). |

Every field but `email` and `name` has a `key`: the [contact attribute](CONTACTS.md#fields)
its answer is saved in (letters, digits and `_`, starting with a letter). Two
forms that ask the same thing should use the same key. A form never overwrites
an answer a contact already has (anyone can type someone else's address into a
form), so the first answer stays; change it in the panel or with the contacts API.

### Words and look

`content`: the `title`, `description`, `buttonLabel`, the `successTitle` and
`successMessage` shown afterwards, the `confirmMessage` shown instead while
someone still has to confirm their address, and an optional `footnote` (a privacy
line). `style`: `accent`, `background` and `text` colours (empty: the project's
accent; no background, so the form sits on your page; text that follows your
page's light or dark), `radius`, `font` (`system`, `rounded`, `serif`, `mono`) and `layout`:
`stacked`, or `inline` for the inputs and the button on one row.

### Files

A `file` field takes one file: `accept` says which kind (`images`: PNG, JPEG,
GIF or WebP; `documents`: PDF, Word, Excel, PowerPoint, OpenDocument, RTF, text,
CSV or Markdown; `any`: either, or a ZIP archive) and `maxMB` how large (1 to 20,
10 by default). Files are checked by what they really are, not by their name, so
a renamed program is refused.

Files are kept privately for your team: they are not attributes and have no
public link. You see them on the contact (**Files sent**) and on the form, and
download them with your session or an admin key. Their bytes count towards the
workspace's storage; when it is full the form answers `402` to anyone who sends
a file. Erasing a contact deletes their files; deleting a form keeps them with
the contact. File fields need the server's S3 storage (`S3_ENDPOINT`,
`S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET`); without it a form cannot have one.

### Languages

A form is written in one language (`locale`, `en` by default) and can carry a
translation per language (up to 20): its words, and each field's label,
placeholder and options. Write them in the panel's language bar, or have the AI
fill them in (it keeps what you already translated unless you overwrite). A word
a translation leaves out shows in the form's own language.

Visitors get the language they ask for when the form has it, else the form's
own: the script sends your page's `<html lang>` (or `data-locale`), the hosted
page and the read API take `?locale=` and the browser's `Accept-Language`, and
the Swift snippet sends the device's language. That language follows them:
errors, the hosted page, the confirmation page and email, and the welcome email
(when its template has a translation for it). A choice keeps its original
options as the values it saves, whatever language it was shown in.

The words HelpBites writes itself (errors, "(optional)", the confirmation page
and the built-in confirmation email) come in English, Spanish, Catalan, French,
German, Italian, Portuguese, Japanese, Korean and Chinese; other languages get
English.

## What happens when someone signs up

1. **They become a contact**, matched by email like every other write
   ([one person, one contact](CONTACTS.md#one-person-one-contact)). Someone new
   remembers how they got here: `origin: { type: 'lead_form', id: <form id> }`,
   shown as **Added via** in the people list. People who were already contacts
   keep their origin. The first language of their browser fills the contact's
   `language` when it is empty, so the welcome email can come in it.
2. **They join the form's segment.** The form's id is added to the contact's
   `leadForms`. Creating a form makes a segment **Leads · <form name>**
   (`leadForms includes <id>`), and the project's first form also makes
   **All leads** (`leadForms is set`). They are ordinary segments, marked *Auto*:
   rename, edit or delete them; deleting a form keeps its segment and its leads.
3. **They get the form's tags.**
4. **They confirm their address** when the form asks for it (`doubleOptIn`, on by
   default): they are `pending` until they press the button behind the link in
   the confirmation email, valid for seven days. The email is the template you
   pick (it must have a `{{confirmUrl}}` button), else the project's
   `confirm-subscription` template, else HelpBites' own. That click, with when
   and from where, is their recorded consent.
5. **Once they are on the list** (subscribed: confirmed, or right away without
   double opt-in), the **welcome email** goes out (any of the project's
   templates; it is sent once per form and person, with their answers as
   placeholders such as `{{firstName}}` or `{{company}}`, and `{{unsubscribeUrl}}`;
   in the person's language when the template has a
   [translation](LANGUAGES.md#a-contacts-language) of it)
   and they start the form's **sequence**. A draft or paused sequence holds them at
   the first step until you activate it.
6. The **redirect URL** is where a plain HTML form, the hosted page and the
   confirmation link send people afterwards; without one they see the form's
   thank-you words on a HelpBites page.

The consent rules are the newsletter sign-up's
([MARKETING.md](MARKETING.md#sign-up-form-and-double-opt-in)): a subscriber stays
as they are, and someone who unsubscribed only comes back through the
confirmation email, double opt-in or not. After the answers check out, the
answer is the same whether or not the address was already known.

Welcome emails count as marketing: they carry `List-Unsubscribe`, show in the
email log with source **Lead form** and batch id `lf_<form>_<contact>`, and count
towards your plan's email. Confirmation emails are sent by HelpBites itself.

## Plug and play: web

One script tag. It draws the form where you put it:

```html
<script src="https://YOUR-SUPPORT-HOST/forms.js" data-project="pk_…" data-form="waitlist" defer></script>
```

Without `data-form` it draws the project's first form, so `data-project` alone
works. It is MIT-licensed, has no dependencies, and draws the form from JSON in a
shadow root (your CSS and its CSS never collide). It posts the answers itself and
shows the thank-you words; a form with double opt-in shows its `confirmMessage`.
A form with a file field sends its answers as `multipart/form-data`, checks each
file's size before sending and shows how large a file may be.

### Options

Set them as `data-*` attributes or in `init`:

| Option | Meaning |
|---|---|
| `form` | The form's key. Default: the project's first form. |
| `target` | A selector. Draws the form in that element instead of after the script tag. |
| `theme` | `light`, `dark` or `system` (the visitor's setting). Defaults to a `dark` or `light` class on your `<html>`, then the colour behind the form, so it reads on your page whatever the visitor's setting. A form with a background colour of its own picks its text from that. |
| `accent`, `radius`, `font`, `layout` | Override the form's look. |
| `show` | The parts to show besides the inputs: `title,description,footnote` (default), any of them plus `logo`, or `none`. |
| `locale` | The language to show it in, when the form has a translation for it. Default: your `<html lang>`, then the visitor's browser. |
| `host` | Where HelpBites is, when you serve `forms.js` from your own site. |

```html
<div id="waitlist"></div>
<script>
  window.HelpBitesForms = window.HelpBitesForms || []
  HelpBitesForms.push(['init', {
    labels: { title: 'Get early access', button: 'Count me in', successTitle: 'You are in!' },
    values: { plan: 'pro', referrer: document.referrer },   // answers you add yourself, by key
    onSuccess: ({ form, pending }) => analytics.track('waitlist_joined', { form, pending }),
    onError: (message) => {}
  }])
</script>
<script src="https://YOUR-SUPPORT-HOST/forms.js" data-project="pk_…" data-form="waitlist" data-target="#waitlist" data-layout="inline" defer></script>
```

`labels` takes `title`, `description`, `button`, `successTitle`,
`successMessage`, `confirmMessage` and `footnote`. `values` fills in answers for
fields the visitor does not see; only keys the form has are saved. More forms on
one page: another script tag, or `HelpBitesForms.push(['render', { form: 'beta', target: '#beta' }])`.
Every outcome is also a `helpbites:form` event on `window`, with `detail.type`
set to `submit`, `success` (and `detail.pending`) or `error`.

### Restyle it

Set these variables on `.help-bites-form`:

```css
.help-bites-form {
  --hb-form-accent: #0ea5e9;
  --hb-form-on-accent: #fff;      /* text on the button */
  --hb-form-bg: transparent;      /* a colour makes it a card */
  --hb-form-text: #0f172a;
  --hb-form-muted: #64748b;
  --hb-form-border: #e2e8f0;
  --hb-form-input-bg: #fff;
  --hb-form-radius: 10px;
  --hb-form-font: "Inter", sans-serif;
  --hb-form-gap: 10px;
  --hb-form-max-width: 440px;
}
.help-bites-form::part(button) { text-transform: uppercase; letter-spacing: .04em; }
```

Parts you can style: `form`, `title`, `description`, `logo`, `fields`, `field`,
`label`, `input`, `hint`, `button`, `footnote`, `success` and `error`. The layout
is HelpBites'.

## A plain HTML form

No script at all: the form posts to HelpBites and the browser comes back to your
redirect URL (or the form's thank-you page). Each field's answer goes under its
key; the panel's **HTML** tab writes this for your form:

```html
<form action="https://YOUR-SUPPORT-HOST/v1/forms/pk_…/waitlist" method="post">
  <input type="email" name="email" placeholder="you@example.com" required>
  <input type="text" name="name" placeholder="Your name">
  <!-- Leave this empty: bots fill it in. -->
  <input type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-10000px">
  <button type="submit">Join the waitlist</button>
</form>
```

A wrong answer comes back as the hosted page with the problem and what was typed.
A form with a file field needs `enctype="multipart/form-data"` and an
`<input type="file" name="<key>">`; the HTML tab writes both. Add
`<input type="hidden" name="locale" value="es">` for errors and emails in that
language.

## A hosted page

`https://YOUR-SUPPORT-HOST/f/<public key>/<form key>`: link to it from a tweet, a
QR code or an app, or frame it:

```html
<iframe src="https://YOUR-SUPPORT-HOST/f/pk_…/waitlist" title="Join the waitlist" style="width:100%;max-width:480px;height:520px;border:0"></iframe>
```

It is plain HTML with no JavaScript, in the form's words and accent. Add
`?locale=es` for a language of the form's (else the browser's is used).

## Plug and play: Swift

Paste this file into your app. It needs no package: plain `URLSession` against
the public API.

```swift
// HelpBitesLeadForm.swift. MIT. A HelpBites lead form in SwiftUI. iOS 17, macOS 14.
import SwiftUI
import UniformTypeIdentifiers

struct HelpBitesLeadFormData: Decodable, Equatable {
  struct Field: Decodable, Identifiable, Equatable {
    let id, key, type, label, placeholder: String
    let required: Bool
    /// The values a choice sends; `optionLabels` say what they show in this language.
    let options: [String]
    let optionLabels: [String]?
    /// `file` fields: images, documents or any, and the largest file in MB.
    let accept: String?
    let maxMB: Int?
  }
  struct Content: Decodable, Equatable { let title, description, buttonLabel, successTitle, successMessage, confirmMessage, footnote: String }
  struct Style: Decodable, Equatable { let accent: String; let radius: Double }
  let key: String
  /// The language of these words.
  let locale: String?
  let fields: [Field]
  let content: Content
  let style: Style
  let doubleOptIn: Bool
}

struct HelpBitesLeadForm: View {
  let host: URL
  let projectKey: String
  /// The form's key; empty draws the project's first form.
  var form = ""
  /// The language to show it in, when the form has a translation for it.
  var locale = Locale.preferredLanguages.first ?? ""
  var accent: Color?
  var cornerRadius: CGFloat?
  var design: Font.Design = .default
  /// Answers you add yourself (a plan, a referrer), by key.
  var values: [String: String] = [:]
  /// `true` when they still have to confirm their email.
  var onSuccess: (Bool) -> Void = { _ in }

  @State private var data: HelpBitesLeadFormData?
  @State private var text: [String: String] = [:]
  @State private var ticked: [String: Bool] = [:]
  @State private var files: [String: (name: String, data: Data)] = [:]
  /// The file field being picked.
  @State private var picking: String?
  @State private var sending = false
  @State private var error = ""
  @State private var pending: Bool?

  var body: some View {
    Group {
      if let data, let pending { done(data, pending) }
      else if let data { fields(data) }
      else { ProgressView().frame(maxWidth: .infinity) }
    }
    .fontDesign(design)
    .task { await load() }
  }

  private var url: URL {
    let url = host.appending(path: form.isEmpty ? "v1/forms/\(projectKey)" : "v1/forms/\(projectKey)/\(form)")
    return locale.isEmpty ? url : url.appending(queryItems: [URLQueryItem(name: "locale", value: locale)])
  }
  #if os(iOS)
  private static let keyboards: [String: UIKeyboardType] = ["email": .emailAddress, "number": .decimalPad, "url": .URL, "phone": .phonePad]
  #endif

  private func fields(_ data: HelpBitesLeadFormData) -> some View {
    let tint = accent ?? Color(helpBitesHex: data.style.accent) ?? .accentColor
    let radius = cornerRadius ?? data.style.radius
    return VStack(alignment: .leading, spacing: 12) {
      if !data.content.title.isEmpty { Text(data.content.title).font(.title2.weight(.semibold)) }
      if !data.content.description.isEmpty { Text(data.content.description).foregroundStyle(.secondary) }
      ForEach(data.fields) { field in
        switch field.type {
        case "checkbox": Toggle(field.label, isOn: binding(ticked, field.key, false)).tint(tint)
        case "select":
          Picker(field.label, selection: binding(text, field.key, "")) {
            Text("—").tag("")
            ForEach(Array(field.options.enumerated()), id: \.offset) { i, option in Text(field.optionLabels?[i] ?? option).tag(option) }
          }
        case "file":
          Button { picking = field.key } label: {
            Label(files[field.key]?.name ?? field.label, systemImage: files[field.key] == nil ? "paperclip" : "checkmark.circle")
              .lineLimit(1).frame(maxWidth: .infinity, minHeight: 46, alignment: .leading).padding(.horizontal, 12)
              .background(.quaternary.opacity(0.5), in: .rect(cornerRadius: radius * 0.75))
          }
          .buttonStyle(.plain)
        default:
          TextField(field.placeholder.isEmpty ? field.label : field.placeholder, text: binding(text, field.key, ""), axis: field.type == "textarea" ? .vertical : .horizontal)
            .lineLimit(field.type == "textarea" ? 3 ... 6 : 1 ... 1)
            .padding(12)
            .background(.quaternary.opacity(0.5), in: .rect(cornerRadius: radius * 0.75))
            .autocorrectionDisabled(field.type != "textarea" && field.type != "text")
            #if os(iOS)
            .keyboardType(Self.keyboards[field.type] ?? .default)
            .textInputAutocapitalization(["email", "url"].contains(field.type) ? .never : .sentences)
            #endif
            .accessibilityLabel(field.label)
        }
      }
      if !error.isEmpty { Text(error).font(.footnote).foregroundStyle(.red) }
      Button { Task { await send(data) } } label: {
        Text(data.content.buttonLabel).fontWeight(.semibold).frame(maxWidth: .infinity, minHeight: 46)
          .background(tint, in: .rect(cornerRadius: radius * 0.75)).foregroundStyle(.white)
      }
      .buttonStyle(.plain)
      .disabled(sending || data.fields.contains { $0.required && missing($0) })
      if !data.content.footnote.isEmpty { Text(data.content.footnote).font(.footnote).foregroundStyle(.secondary) }
    }
    .fileImporter(isPresented: Binding(get: { picking != nil }, set: { if !$0 { picking = nil } }), allowedContentTypes: types(data.fields.first { $0.key == picking })) { result in
      if let key = picking, let file = try? result.get() { pick(file, key, data) }
    }
  }

  private func done(_ data: HelpBitesLeadFormData, _ pending: Bool) -> some View {
    VStack(alignment: .leading, spacing: 6) {
      Label(data.content.successTitle, systemImage: "checkmark.circle.fill").font(.headline)
      Text(pending ? data.content.confirmMessage : data.content.successMessage).foregroundStyle(.secondary)
    }
  }

  private func missing(_ field: HelpBitesLeadFormData.Field) -> Bool {
    switch field.type {
    case "checkbox": ticked[field.key] != true
    case "file": files[field.key] == nil
    default: (text[field.key] ?? "").isEmpty
    }
  }

  private func binding<T>(_ store: [String: T], _ key: String, _ empty: T) -> Binding<T> {
    Binding(get: { store[key] ?? empty }, set: { value in
      if let value = value as? String { text[key] = value } else if let value = value as? Bool { ticked[key] = value }
    })
  }

  /// What the picker offers; the server checks what each file really is.
  private func types(_ field: HelpBitesLeadFormData.Field?) -> [UTType] {
    switch field?.accept {
    case "images": [.image]
    case "documents": [.pdf, .text, .rtf, .spreadsheet, .presentation] + ["doc", "docx", "odt", "md"].compactMap { UTType(filenameExtension: $0) }
    default: [.item]
    }
  }

  private func pick(_ url: URL, _ key: String, _ data: HelpBitesLeadFormData) {
    let scoped = url.startAccessingSecurityScopedResource()
    defer { if scoped { url.stopAccessingSecurityScopedResource() } }
    guard let bytes = try? Data(contentsOf: url) else { return }
    let limit = data.fields.first { $0.key == key }?.maxMB ?? 10
    if bytes.count > limit * 1024 * 1024 { error = "That file is larger than \(limit) MB."; return }
    files[key] = (url.lastPathComponent, bytes)
    error = ""
  }

  private func load() async {
    struct Envelope: Decodable { let form: HelpBitesLeadFormData }
    guard let answer = try? await URLSession.shared.data(from: url), (answer.1 as? HTTPURLResponse)?.statusCode == 200 else { return }
    data = try? JSONDecoder().decode(Envelope.self, from: answer.0).form
  }

  private func send(_ data: HelpBitesLeadFormData) async {
    sending = true
    defer { sending = false }
    var answers: [String: Any] = values
    for (key, value) in text { answers[key] = value.trimmingCharacters(in: .whitespacesAndNewlines) }
    for (key, value) in ticked { answers[key] = value }
    // Errors and emails come in the language the form was shown in.
    if let locale = data.locale { answers["locale"] = locale }
    var request = URLRequest(url: host.appending(path: "v1/forms/\(projectKey)/\(data.key)"))
    request.httpMethod = "POST"
    if files.isEmpty {
      request.setValue("application/json", forHTTPHeaderField: "Content-Type")
      request.httpBody = try? JSONSerialization.data(withJSONObject: answers)
    } else {
      // With a file it is multipart: each answer a text part, each file a part named by its field's key.
      let boundary = "hb-\(UUID().uuidString)"
      var body = Data()
      func part(_ name: String, _ filename: String?, _ bytes: Data) {
        body.append(Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(name)\"\(filename.map { "; filename=\"\($0)\"" } ?? "")\r\n\r\n".utf8))
        body.append(bytes)
        body.append(Data("\r\n".utf8))
      }
      for (key, value) in answers { part(key, nil, Data(((value as? Bool).map { $0 ? "true" : "" } ?? "\(value)").utf8)) }
      for (key, file) in files { part(key, file.name.replacingOccurrences(of: "\"", with: ""), file.data) }
      body.append(Data("--\(boundary)--\r\n".utf8))
      request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
      request.httpBody = body
    }
    guard let answer = try? await URLSession.shared.data(for: request) else { error = "Could not reach the server."; return }
    let json = (try? JSONSerialization.jsonObject(with: answer.0)) as? [String: Any] ?? [:]
    if (200 ..< 300).contains((answer.1 as? HTTPURLResponse)?.statusCode ?? 0) {
      let waiting = json["pending"] as? Bool ?? false
      pending = waiting
      onSuccess(waiting)
    } else {
      error = json["message"] as? String ?? "Something went wrong. Please try again."
    }
  }
}

private extension Color {
  init?(helpBitesHex hex: String) {
    guard hex.count == 7, hex.hasPrefix("#"), let v = Int(hex.dropFirst(), radix: 16) else { return nil }
    self.init(red: Double(v >> 16 & 255) / 255, green: Double(v >> 8 & 255) / 255, blue: Double(v & 255) / 255)
  }
}
```

Then, anywhere in your app:

```swift
HelpBitesLeadForm(host: URL(string: "https://YOUR-SUPPORT-HOST")!, projectKey: "pk_…", form: "waitlist")
  .padding()
```

**Customise it** with `accent`, `cornerRadius` and `design` (`.rounded`,
`.serif`…), set `locale` for another language than the device's, pass `values`
for answers you know already (an app version, a plan), and use `onSuccess` to
move on. File fields open the system file picker and send the form as multipart. It is your file, so change anything: the layout,
the error words, how a field looks. The button text and the thank-you words come
from the form, so you change them in the panel without a release.

## Your own UI

Read the form, then post the answers. Both are public, open to any origin, and
need only the project's public key:

```bash
curl -s 'https://YOUR-SUPPORT-HOST/v1/forms/PROJECT_PUBLIC_KEY/waitlist?locale=es'
```

```json
{
  "form": {
    "key": "waitlist", "name": "Launch waitlist", "doubleOptIn": true,
    "locale": "es", "locales": ["en", "es"],
    "project": { "name": "Acme", "logoUrl": "https://cdn.acme.test/icon.png" },
    "fields": [
      { "id": "fd_1", "key": "email", "type": "email", "label": "Correo", "placeholder": "tu@ejemplo.com", "required": true, "options": [], "optionLabels": [], "accept": "", "maxMB": 0 },
      { "id": "fd_2", "key": "role", "type": "select", "label": "Tu rol", "placeholder": "", "required": false, "options": ["Founder", "Developer"], "optionLabels": ["Fundador", "Desarrollador"], "accept": "", "maxMB": 0 },
      { "id": "fd_3", "key": "cv", "type": "file", "label": "Currículum", "placeholder": "", "required": false, "options": [], "optionLabels": [], "accept": "documents", "maxMB": 5 }
    ],
    "content": { "title": "Join the waitlist", "description": "…", "buttonLabel": "Join the waitlist", "successTitle": "You are on the list", "successMessage": "…", "confirmMessage": "…", "footnote": "" },
    "style": { "accent": "#0ea5e9", "background": "", "text": "", "radius": 12, "font": "system", "layout": "stacked" }
  }
}
```

```bash
curl -s https://YOUR-SUPPORT-HOST/v1/forms/PROJECT_PUBLIC_KEY/waitlist \
  -H 'content-type: application/json' \
  -d '{"email":"ada@example.com","role":"Founder","locale":"es"}'
# 202 {"ok":true,"pending":true}

# With a file field: multipart, the file under its field's key
curl -s https://YOUR-SUPPORT-HOST/v1/forms/PROJECT_PUBLIC_KEY/waitlist \
  -F email=ada@example.com -F role=Founder -F locale=es -F cv=@cv.pdf
```

Send a choice's value from `options` (what `optionLabels` shows in that
language is understood too). `locale` (or `Accept-Language`) sets the language of
errors and emails.

- `GET /v1/forms/{pk}` (no key) is the project's first active form.
- `404`: an unknown project or form, or one that is switched off.
- `400`: an answer or a file is missing or invalid; `data.errors` lists each one
  (`message` joins them), in the visitor's language.
- `411` / `413`: a multipart body without a `Content-Length`, or one larger than
  the form's file fields allow (their `maxMB` added up, plus 1 MB).
- `pending: true` means "check your inbox": the form asks people to confirm.
- `403`: a browser on a site that is not in the project's **allowed origins**
  (when it has any). Server-to-server calls send no `Origin` and are fine.
- `402`: the workspace is at its plan's contact limit (or, for a submission with
  a file, its storage limit); nobody can sign up until there is room again.
- `429`: too many sign-ups from one address (10 in ten minutes) or for the
  project (300 an hour). Multipart posts are also limited to 20 in ten minutes per
  address, counted before the files are read. Confirmation emails to one address are limited to three a
  day, together with the newsletter's.
- A filled-in `website` field is treated as a bot: the answer is the same, and
  nothing is saved.
- Reads are limited to 1,200 a minute per IP address, carry an `ETag` and may be
  cached for a minute.

## Managing forms over the API

Use an admin API key (**API keys**) or an operator session. Every route is
scoped to your workspace; a key limited to some projects only reaches those.

```bash
HOST=https://YOUR-SUPPORT-HOST
KEY=ak_...

# A waitlist that asks people to confirm, then welcomes them and starts a sequence
curl -s $HOST/v1/admin/lead-forms -H "authorization: Bearer $KEY" -H 'content-type: application/json' -d '{
  "project": "PROJECT_ID", "name": "Launch waitlist", "preset": "waitlist",
  "settings": { "doubleOptIn": true, "welcomeTemplate": "waitlist-welcome", "sequence": "SEQUENCE_ID", "tags": ["waitlist"] }
}'

# Ask one more thing, and put the button on the same row
curl -s -X PATCH $HOST/v1/admin/lead-forms/FORM_ID -H "authorization: Bearer $KEY" -H 'content-type: application/json' -d '{
  "fields": [
    { "type": "email", "placeholder": "you@example.com" },
    { "type": "select", "key": "platform", "label": "Your phone", "options": ["iPhone", "Android"], "required": true }
  ],
  "style": { "layout": "inline" }
}'

# Everyone who came through it, newest first (contacts API; the project secret works too)
curl -s "$HOST/v1/contacts?project=PROJECT_ID&leadForm=FORM_ID" -H "authorization: Bearer $KEY"

# Spanish and French, translated by AI, then a Spanish word of your own
curl -s $HOST/v1/admin/lead-forms/FORM_ID/translate -H "authorization: Bearer $KEY" -H 'content-type: application/json' -d '{ "locales": ["es", "fr"] }'
curl -s -X PATCH $HOST/v1/admin/lead-forms/FORM_ID -H "authorization: Bearer $KEY" -H 'content-type: application/json' -d '{
  "translations": { "es": { "content": { "title": "Únete a la lista" }, "fields": {} } }
}'

# The files sent through it, and one of them
curl -s "$HOST/v1/admin/lead-files?project=PROJECT_ID&form=FORM_ID" -H "authorization: Bearer $KEY"
curl -s -OJ $HOST/v1/admin/lead-files/FILE_ID/download -H "authorization: Bearer $KEY"
```

| Route | What it does |
|---|---|
| `GET /v1/admin/lead-forms?project=` | Every form, with `stats` (`leads`, and `confirmed`: how many are subscribed), `path` and `pagePath`. |
| `POST /v1/admin/lead-forms` | Create one, live at once. `preset`: `email` (default), `waitlist` or `detailed`; `key` must be unused (`409`). Makes its segment. |
| `GET /v1/admin/lead-forms/{id}` | One form. |
| `PATCH /v1/admin/lead-forms/{id}` | Change `name`, `key`, `active`, `fields` (the full list), `content`, `style`, `settings` (merged), `locale` or `translations` (by language; `null` removes one). Templates and the sequence must exist; the confirmation template must use `{{confirmUrl}}`. |
| `POST /v1/admin/lead-forms/{id}/translate` | AI-translate its words into `locales` (up to 8 at once); `overwrite: true` replaces words already translated. `501` without an AI provider. |
| `DELETE /v1/admin/lead-forms/{id}` | Delete it. Its leads, their files and its segment stay. |
| `GET /v1/admin/lead-files?project=&contact=` or `&form=` | Files sent through file fields, newest first (`before`, `limit` up to 200). |
| `GET /v1/admin/lead-files/{id}/download` | The file, as an attachment. |
| `DELETE /v1/admin/lead-files/{id}` | Delete a file for good. |
| `GET /v1/forms/{pk}/{key}`, `POST` the same | Public: read the form, sign up. |

Invalid values answer `400` with every problem listed. The full schema is in the
OpenAPI docs at `/_docs/scalar`.

## Leads in your contacts

- `GET /v1/contacts?leadForm=<id>` lists a form's leads; `?origin=lead_form`
  everyone a lead form brought in first.
- Every contact has `origin` (`{ type, id, at }`: `app`, `lead_form`, `signup`,
  `import`, `sync`, `stripe`, `api`, `panel` or `feedback`) and `leadForms`.
  Segments can use both: **Added via** is `lead_form` and **Lead form** includes
  a form. See [CONTACTS.md](CONTACTS.md#fields).
- To mirror leads into your own database, use the event webhook
  (`contact.subscription_changed` fires when a lead confirms) or poll
  `GET /v1/contacts?updatedSince=` ([MARKETING.md](MARKETING.md#event-webhook)).
