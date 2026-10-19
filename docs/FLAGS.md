# Feature flags

Turn parts of your app on and off from the HelpBites panel, without a deploy.
HelpBites doesn't know what a flag gates. The keys are yours (`ai_chat`,
`new_checkout`), and your app decides what each one does.

## A flag

| Field | Meaning |
|---|---|
| `key` | Your identifier: lowercase letters, digits, `.`, `-`, `_`, up to 64 characters. |
| `state` | `off` is off for everyone, admins included. `on` is on for everyone. `admins` is on for your admins plus the `allow` list. |
| `fallback` | What your app should assume when it can't reach HelpBites. The default is `off`. |
| `targets` | Free-form tags such as `frontend`, `backend` or `ios`. A client asks for its own target, and untagged flags go to every client. |
| `allow` | User ids (your `sub`) or emails that count as admins for this flag, e.g. beta testers. |
| `description` | A note for operators. |

**Who is an admin?** Your app decides. A server checks its own admin role. A
browser that sends an identity token is an admin when the token carries
`role: "admin"`. Anyone on the flag's `allow` list counts too, matched by `sub`
or by `email`.

Manage flags under **Project → Flags**. You can also replace the whole list with
`PATCH /v1/admin/projects/:id { flags: [...] }` and an admin key.

## Reading flags: `GET /v1/flags`

Add `?target=frontend` to get only that client's flags.

### From your server (recommended)

Send the project secret. This returns every flag raw, `allow` list included,
for you to evaluate against your own users:

```js
const { flags } = await fetch('https://YOUR-SUPPORT-HOST/v1/flags?target=backend', {
  headers: { authorization: `Bearer ${process.env.HELP_BITES_SECRET}` }
}).then(r => r.json())
// { ai_chat: { state: 'admins', fallback: 'off', targets: ['backend'], allow: ['user_123'], description: '…' } }

function isOn(state, flag, user) {
  if (state === 'on') return true
  if (state !== 'admins') return false
  return user?.isAdmin || flag.allow.includes(user?.id) || flag.allow.includes(user?.email?.toLowerCase())
}
```

Never send the secret from a browser.

### From a browser

Send the identity token, which gives you `enabled` for that user. Or send
`?pk=<public key>` for an anonymous visitor, for whom `admins` flags are off.
Both forms evaluate the flag for you and never return the `allow` list:

```js
const { flags } = await fetch('https://YOUR-SUPPORT-HOST/v1/flags?target=frontend', {
  headers: { authorization: `Bearer ${identityToken}` }
}).then(r => r.json())
// { ai_chat: { state: 'admins', enabled: true, fallback: false, targets: ['frontend'] } }
```

Identity-token requests count toward the project's request budget, which is
600 per minute shared by every user. For busy apps, read flags on your server
and pass the result down to the browser.

## Caching and outages

Flags change when an operator clicks, not per request, so don't fetch on every
request:

1. Cache the answer for about 30 seconds.
2. If a refresh fails, keep serving the last good answer for a short grace
   period (a couple of minutes), so a single blip doesn't flip features.
3. After that, use each flag's `fallback`, which the same response gave you.
4. If you have never reached HelpBites, use your own defaults.
5. Treat a flag you don't know as off.

Changes reach an app that caches like this within about 30 seconds.
