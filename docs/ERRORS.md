# Error tracking

HelpBites can provision a separate Sentry-compatible project for each HelpBites
project in either [GlitchTip](https://glitchtip.com) or
[Bugsink](https://www.bugsink.com). The **Errors** page lists a project's issues; click one to
expand its stack trace, event details, breadcrumbs and tags (from the latest event), and resolve
or ignore it in the tracker. Errors don't create inbox conversations (earlier ones stay, and
resolving one still resolves the issue).

**Copy the error.** An open error has a **Copy all** button (web and native) that puts everything
the panel shows on the clipboard as plain text: a summary (title, exception, culprit, state, counts,
dates, tracker link), the full stack trace with its source lines (library frames marked), the event
details, the breadcrumbs, the tags and, when one is saved, the AI analysis. Its dropdown ticks which
of those parts to copy, then **Copy selected** writes just them, always in that order. It is text from
the latest event as the panel loads it (the same limits apply: the last 60 frames, 30 breadcrumbs,
60 tags); the tracker has the rest. There is no API for it: the text is built from
`GET /v1/admin/errors/:id`.

**Alerts.** The **Alerts** button sets rules that email the team (the addresses typed there,
else the project's notify emails): *a new error appears*, *an error totals N events*, or *an
error happens N times within M minutes*, each for all tracker projects or one, with a
cooldown before the same error can alert again. Rules are checked once a minute by polling the
tracker (first page of unresolved issues per tracker project), and immediately when a tracker's
alert webhook calls. The first check of a tracker project only learns what exists, so a new rule
doesn't announce old errors as new. Rate windows count from when polling first saw the issue.
Needs Mailgun for the emails.

**Fix with AI.** An expanded error has **Analyze and suggest a fix** (cause, fix, how to verify,
impact; needs an LLM endpoint, saved for 6 hours) and **Copy prompt for a coding agent** (the
same context, no AI call).

**AI reports.** **Analyze with AI** triages every unresolved error (the first page of each tracker project) and
saves the answer as a *report*; the newest shows on the Errors page with a **Copy report** button, and the
menu next to the button opens **View all reports** (read, copy or delete any; the latest 100 are kept). The same
menu sets **Run automatically**: off, every day, every week or every month, from when you pick it (a run is
booked before the AI is asked, so a failing one is not retried every tick; scheduled runs with nothing open
save nothing, and a suspended workspace's wait). When the project has [GitHub repos](GITHUB.md) connected, the
report also reads the source of the up to 3 most frequent errors (the files in their stack traces, the same
matching rules as *Repo context* below), lists the files it read, and sends them as untrusted data. Needs an LLM
endpoint and counts against the AI budget like any analysis. Scheduled runs happen on workers (`runsWorkers()`).

```bash
# Run one now (saves a report), list them, delete one
curl -X POST -H "Authorization: Bearer ak_…" -H "Content-Type: application/json" \
  https://YOUR_HOST/v1/admin/errors/analyze -d '{ "project": "PROJECT_ID" }'
curl -H "Authorization: Bearer ak_…" "https://YOUR_HOST/v1/admin/errors/reports?project=PROJECT_ID"
# { "reports": [{ "id": "…", "text": "…markdown…", "files": ["owner/repo/src/a.ts"], "count": 12, "source": "scheduled", "at": "2026-10-23T09:00:00.000Z" }] }
curl -X DELETE -H "Authorization: Bearer ak_…" "https://YOUR_HOST/v1/admin/errors/reports/REPORT_ID?project=PROJECT_ID"
# Schedule: frequency is off | daily | weekly | monthly (needs the projects.manage permission)
curl -X PUT -H "Authorization: Bearer ak_…" -H "Content-Type: application/json" \
  https://YOUR_HOST/v1/admin/errors/schedule -d '{ "project": "PROJECT_ID", "frequency": "weekly" }'
# { "frequency": "weekly", "nextAt": "2026-10-30T09:00:00.000Z" }   (GET the same path to read it)
```

This is an operator feature (an admin session or `ak_` key); there is no visitor-facing embed.

**File on board.** An expanded error has **File on board** (when the [project board](FEEDBACK.md) is on). It
makes a board item in the board's first status, titled from the issue, with the culprit, how many times it
happened and a link to the issue in the tracker in its internal description. The item remembers where it came
from (`errorRefs`, shown in its drawer with an *Open in GlitchTip/Bugsink* link), and the error's row on the
Errors page then shows the item instead of the button. Filing is idempotent: pressing it again, or filing from
the API, returns the same item. When the error already has a conversation in the inbox (earlier ones do), it is
linked to the item too, so both sides show each other. It never changes the issue in the tracker. It emits the
`errors.filed_on_board` event ([EVENTS.md](EVENTS.md)).

```sh
# Is it filed? (item is null when not; boardEnabled says whether filing is possible)
curl -H "Authorization: Bearer ak_…" \
  "https://YOUR-SUPPORT-HOST/v1/admin/errors/ISSUE_ID/board?project=PROJECT_ID&link=main"

# File it (link: the tracker project's id from project.errorLinks, default the first)
curl -X POST -H "Authorization: Bearer ak_…" -H "Content-Type: application/json" \
  "https://YOUR-SUPPORT-HOST/v1/admin/errors/ISSUE_ID/board" \
  -d '{ "project": "PROJECT_ID", "link": "main" }'
# { "item": { "id": "…", "number": 14, "title": "TypeError: x is undefined", "errorRefs": [{ "provider": "glitchtip", "issueId": "42", "linkId": "main", "title": "…", "url": "https://…/issues/42" }], … }, "created": true }
```

This is an operator action (an admin session or `ak_` key); there is nothing for a visitor's browser to embed.

**Repo context.** If the project has [GitHub repos](GITHUB.md) connected, the analysis and the
prompt also include the source of the files in the stack trace (up to 3 files, around
the failing line, read from each repo's default branch, so they can differ from
the release that failed). Only the event's in-app frames count, and a frame is
used only if its path matches exactly one file across the project's repos. It is
sent as untrusted data, like the event. No repos, or GitHub not set up: it is
written from the event alone.

Add your trackers once in **Settings → Error tracking**: a name, the URL and API
token (plus the organisation slug for GlitchTip). Add as many servers as you
like, GlitchTip and Bugsink alike; every project in the workspace can use any
of them. Then open Project → Install & API (or Errors) → **Connect error tracking**,
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

Bugsink 2.6 or newer is needed (its canonical API with issue actions). Alerts use
its Slack kind. Run Compose with the `bugsink` profile, set
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

Connecting creates the project and stores the DSN. For Bugsink the dialog lets you pick the team it's created under (default: `BUGSINK_TEAM`, else `HelpBites`, made if missing); Bugsink's API can't add members, so pick a team you belong to to see the project under Team Projects. Bugsink's API
can't add alert destinations, so the dialog then shows a webhook URL: in
Bugsink open **Projects** and the **Other Projects** tab (the API creates the
team and project without adding any user as a member, so they're not under
My Projects), click the alerts (megaphone) icon next to the project, click **Add**, set Kind to **Slack** and paste the URL as the
Webhook url (older Bugsink has no Custom kind; HelpBites reads the Slack payload and still accepts Custom). The webhook is optional: it only makes alert rules run right away instead of within a minute. The same URL stays on the Install & API and Errors pages. If Bugsink and
HelpBites talk over a private network, set `ALERTS_WEBHOOK_DENY_NON_GLOBAL=false`
on Bugsink.

### More than one tracker project

A HelpBites project can report to several tracker projects (a web app and an
API, say). Run **Connect error tracking** again from the Errors or Install & API page and
give a different **Project name**; a name that already exists in the team is
reused. Each one has its own DSN, alert webhook URL and token. The Errors page
shows one pill per tracker project ("All" merges each one's newest page;
pick a pill to page further), and `GET /v1/admin/errors?link=` takes the id from
`project.errorLinks`. Status changes go back to the tracker project
an issue came from.

**Manage** (Errors page) lists each tracker project with its tracker, project name, team, DSN and alert webhook. You can change the name its pill shows or remove it; removing only stops HelpBites reporting there (the tracker project and past conversations stay), and the tracker, name and team are fixed, so to change them remove it and connect again. The alert webhook instructions sit in a collapsible on the same page.

Bugsink can't search issues by Sentry user id, so a customer's recent errors
don't show in their conversation sidebar. Status and text filters on the Errors
page apply to each page of 250 issues.

## SDKs

Use any Sentry SDK with the DSN shown in Project → Install & API. Always set the same
stable identity value used in the HelpBites token's `sub` claim:

```js
Sentry.init({ dsn: 'https://public@errors.example/42' })
Sentry.setUser({ id: user.id })
```

`NUXT_PUBLIC_SENTRY_DSN` enables HelpBites' own browser and server reporting.
GlitchTip is MIT licensed and Bugsink is PolyForm Shield licensed; both run as
separate services next to HelpBites.
