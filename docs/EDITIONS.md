# Editions

HelpBites is built in two editions. This repository is the community edition; the hosted edition adds a small commercial layer that lives in a separate, private repository and is not distributed.

| | Community | Cloud |
|---|---|---|
| Who runs it | You, on your own server | The HelpBites team, as a hosted service |
| Build | `docker compose up` (the default) | `HELPBITES_EDITION=cloud` |
| Code | Core (AGPL-3.0), this repository | Core plus a private commercial layer (`ee/`) |
| Accounts | The first visitor creates the operator; teammates come from the panel | Anyone signs up and gets their own workspace |
| Limits | None: every workspace is on the unlimited plan | Free and Pro plans, billed through Stripe |
| Branding | None | "Powered by HelpBites" on the Free plan |

Everything a team uses day to day is in the core and therefore in both: the inbox, the widget, knowledge and AI
assistants, email, campaigns, the feedback board, the roadmap, the changelog and the blog. The cloud edition adds what
running a public service needs. It does not unlock features that community lacks.

## Licensing

| Path | License | Why |
|---|---|---|
| Everything not listed below | [AGPL-3.0-only](../LICENSE) | The product |
| `public/widget.js`, `public/feedback.js` | [MIT](../licenses/MIT.txt) | Your site embeds them |
| `cli/` | [MIT](../licenses/MIT.txt) | It runs in your repository |
| `ee/` (private repository, not in this one) | HelpBites Commercial License | The hosted service's business code |

**What the AGPL asks of anyone running a modified copy for others**: offer those users the source of the version they
run.
- The panel's **Source code** link and `GET /source` do that.
- Set `SOURCE_CODE_URL` to your fork. With `GIT_SHA` set at build time, a GitHub URL points at the exact commit.
- `GET /v1/meta` reports the edition, the commit and the source URL.

**What the licenses allow and don't**
- Anyone may self-host the community edition, change it, and even offer it to others as a service, provided they publish
  their changes under the AGPL.
- Nobody else may use the HelpBites name or logo for their service ([TRADEMARKS.md](../TRADEMARKS.md)).
- The commercial layer is not published and may not be run without an agreement. It covers the sign-up, billing and plans code, so another
  host has to write their own.
- That is the trade-off: the AGPL can't stop a competitor hosting the core. It makes them rebrand, publish their changes
  and build their own commercial layer.

**Contributions** need a one-time [CLA](../CLA.md), which lets the maintainer offer the code under more than one license.
A bot asks on the first pull request (`.github/workflows/cla.yml`).

> The license texts (`LICENSE`, `CLA.md`, `TRADEMARKS.md`) were drafted with AI assistance and need a
> lawyer's review before anyone relies on them.

## What the commercial layer adds

Open sign-up with abuse checks, plans and Stripe billing, sending from a shared domain, verified custom domains and a
staff console. It is a [Nuxt layer](https://nuxt.com/docs/getting-started/layers) called `ee/`.

## How the two builds differ

- **Inclusion**: `nuxt.config.ts` extends `./ee` only when `HELPBITES_EDITION=cloud`. A cloud build without `ee/`
  fails at config time. A community checkout simply has no `ee/` directory.
- **Community image**: the `Dockerfile` also deletes `ee/` if it is present, so a community image never holds
  commercial code.
- **Checks**: `scripts/check-edition-build.mjs community|cloud` checks the build output both ways.

```bash
docker build .                                           # community
```

At boot, a cloud build whose `ee/` layer did not register refuses to start (`server/plugins/editionCheck.ts`), rather
than quietly running as an open community install.

## Extension points

Core never imports `ee/`. Wherever the editions behave differently, core asks an extension point and `ee/` registers its
answer at boot.

**Server**: `registerEdition()` in `server/utils/edition.ts`. Community defaults in brackets.

| Hook | What it decides |
|---|---|
| `policy.signup` | `setup` (the first visitor creates the operator) or `open` (anyone signs up) [`setup`] |
| `policy.teammatePasswords` | Whether an admin can create a teammate with a password, or only invite [yes] |
| `policy.removeAccountWithLastMembership` | Whether removing someone from their last workspace deletes their account [yes] |
| `policy.trackerEnvFallback` | Whether the server's own GlitchTip/Bugsink env backs every workspace [yes] |
| `policy.requireVerifiedEmail` | Whether inviting, counted email and API keys wait for the owner's confirmed address [no] |
| `policy.reputationGuard` | Whether high bounce or complaint rates pause a workspace's bulk mail [no] |
| `canCreateWorkspace(agent)` | Who may create another workspace [anyone] |
| `planFor(workspace)` | The plan a workspace is on [none: every workspace is unlimited, and nothing loads the workspace to ask] |
| `aiCredits(call)` | What a call to the server's AI gateway costs [0] |
| `brandUrl` | Where "Powered by HelpBites" links |
| `rewriteSender(sender, project)` | Who mail appears to come from [the project's own settings] |
| `onWorkspaceDeleting(workspace)` | Cleanup before a workspace's data goes (the cloud edition cancels its subscription) |
| `meExtras(identity, member)` | More for `/v1/admin/me` under `extras` (confirmation, billing state, super-admin) |

**Client**: `app/utils/editionUi.ts`:
- `registerSettingsTab` for a tab in Settings;
- `registerBanner` for a strip above every panel page;
- `setUpgradeAction` for what the plan-limit dialog's Upgrade button does (no action: no button);
- `registerSidebarItem` for a link in the sidebar.

## Plans and limits

`shared/entitlements.ts` defines three kinds of entitlement:
- **Gauges**: projects, teammates, API keys, knowledge models, assistants, FAQs, contacts and storage. They are counted
  from the data when something is created.
- **Counters**: conversations, emails and AI credits per month, and emails per day. They are counted in Redis by
  `server/utils/usage.ts`.
- **Features**: campaigns, sequences, database sync, event webhooks, custom sending domain, removing the branding, your
  own AI provider, the Ultra designer, and more workspaces. Sending a blog post as a newsletter is a campaign, so it follows
  `campaigns`; the blog itself, its comments, reactions and RSS feed are on every plan.

The community edition puts every workspace on `UNLIMITED_PLAN`, so none of this is visible there. The Plan & usage tab
hides itself, and nothing answers 402.

In the cloud edition a workspace's plan comes from, in order:
1. a comp plan given by staff, until its end date;
2. an active or trialing subscription;
3. a past-due one, for 7 days;
4. otherwise Free.

**The 402 contract**: a limit answers `402 { statusMessage, data }`.
- `data` is `{ code: 'plan_limit', metric, limit, used, plan }`, or `{ code: 'plan_feature', feature, plan }`.
- The panel shows it in a dialog with the Upgrade action.
- Workers pause paid work instead of failing.
- Data is never deleted on a downgrade: only new things past the limit are refused.

## Checks that keep the seam clean

- `tests/editionBoundary.test.ts`: no core file imports `ee/` or calls an `ee/`-only helper, and `ee/` helpers never
  shadow a core auto-import. The last two checks only have something to look at when `ee/` is present, which is the case
  in the private cloud repository's CI.
- `tests/tenancy.guard.test.ts`: every admin route is scoped to a workspace.
