# Error tracking

HelpBites can provision a separate Sentry-compatible project for each HelpBites
project in either [GlitchTip](https://glitchtip.com) or
[Bugsink](https://www.bugsink.com). New errors become `error` conversations,
operators are notified, and (when LiteLLM is configured) an internal AI note
suggests a cause and fix. Resolving or ignoring either side syncs the other.

Add your trackers once in **Settings → Error tracking**: a name, the URL and API
token (plus the organisation slug for GlitchTip). Add as many servers as you
like, GlitchTip and Bugsink alike; every project in the workspace can use any
of them. Then open Project → Dev (or Errors) → **Connect error tracking**,
pick a server from the list (or add a new one right there) and connect. No env
vars or restart needed. Tokens are stored master-key-only in the workspace's
settings and never sent back to the browser. A project uses one server at a
time, and a server can't be removed while projects report to it.

Where the edition shares one tracker with everyone (the community edition), a
server configured with the `GLITCHTIP_*` / `BUGSINK_*` env vars below also
shows up in the list, read-only. Projects connected before servers existed keep
working with the settings they had.

## GlitchTip

Run Compose with the `glitchtip` profile, then create the first operator once:

```bash
docker compose exec sb-glitchtip ./manage.py createsuperuser
```

Log in to GlitchTip, create an organisation, then create a token at
`/profile/auth-tokens` with `org:read`, `team:write`, `project:admin`, and
`event:write`. Enter the URL, token and organisation slug in Settings → Error
tracking, or set `GLITCHTIP_URL`, `GLITCHTIP_TOKEN` and `GLITCHTIP_ORG`.
`GLITCHTIP_SECRET_KEY` and `GLITCHTIP_DB_PASSWORD` configure the bundled
service itself. In Compose the app reaches it at `http://sb-glitchtip:8000`, so
enter that as the API URL. Attach
your public GlitchTip domain to port 8000 so customer SDKs can send events.

Connecting creates the team, project, DSN, and alert webhook.

## Bugsink

Bugsink 2.6 or newer is needed (its canonical API with issue actions and the
Custom alert kind). Run Compose with the `bugsink` profile, set
`BUGSINK_SECRET_KEY` and `BUGSINK_URL` (the public URL; it becomes Bugsink's
`BASE_URL` and appears in DSNs), then create the first user and a token:

```bash
docker compose exec sb-bugsink bugsink-manage createsuperuser
docker compose exec sb-bugsink bugsink-manage create_auth_token
```

A token from Bugsink's **Tokens** page works too if it has `teams:read`,
`teams:manage`, `projects:read`, `projects:manage`, `issues:read`,
`issues:triage` and `events:read`. Enter the URL and token in Settings → Error
tracking (API URL `http://sb-bugsink:8000` in Compose), or set `BUGSINK_URL` and
`BUGSINK_TOKEN`.

Connecting creates the team and project and stores the DSN. Bugsink's API
can't add alert destinations, so the dialog then shows a webhook URL: in
Bugsink open **Projects**, click the alerts (megaphone) icon next to the
project, click **Add**, set Kind to **Custom** and paste the URL as the
Webhook url. The same URL stays on the Dev and Errors pages. If Bugsink and
HelpBites talk over a private network, set `ALERTS_WEBHOOK_DENY_NON_GLOBAL=false`
on Bugsink.

Bugsink can't search issues by Sentry user id, so a customer's recent errors
don't show in their conversation sidebar. Status and text filters on the Errors
page apply to each page of 250 issues.

## SDKs

Use any Sentry SDK with the DSN shown in Project → Dev. Always set the same
stable identity value used in the HelpBites token's `sub` claim:

```js
Sentry.init({ dsn: 'https://public@errors.example/42' })
Sentry.setUser({ id: user.id })
```

`NUXT_PUBLIC_SENTRY_DSN` enables HelpBites' own browser and server reporting.
GlitchTip is MIT licensed and Bugsink is PolyForm Shield licensed; both run as
separate services next to HelpBites.
