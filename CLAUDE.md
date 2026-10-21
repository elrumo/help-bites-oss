# HelpBites: rules for every new feature

HelpBites is an all-in-one toolkit for indie developers (support inbox, feedback, roadmap, changelog, email, legal,
flags, errors and more), and it keeps growing. Every new feature or feature change walks this checklist **before** it is
called done. `features.json` is the map; update it as part of the same change.

Two repos sit side by side: this one (`help-bites-oss`, AGPL, the product) and `../help-bites-cloud` (private `ee/`
layer: sign-up, plans, billing). Core never imports from `ee/`.

## 1. Which edition?

Decide first, and write it in `features.json` (`editions`, `plan`, `entitlement`).

- **Default: community and cloud both.** Community gets every feature with no limits. Cloud never has a feature that
  community lacks; it adds what running a public service needs (see `docs/EDITIONS.md`).
- **Cloud-only** (sign-up, billing, plans, verification, super-admin, shared sending domain) lives in
  `../help-bites-cloud/ee/`. Core reaches it only through the seams in `server/utils/edition.ts` and
  `app/utils/editionUi.ts`. Need a new hook? Add the extension point in core, implement it in `ee/`.
- **Paid-plan gating in cloud** (Free vs Pro): add the key to `FEATURES` / `GAUGES` / `COUNTERS` in
  `shared/entitlements.ts` with a label, call `assertFeature(workspace, key)` where the feature is used, and set the
  plan in `../help-bites-cloud/ee/config/plans.ts`. Community's `UNLIMITED_PLAN` turns it on automatically.
- If unsure whether something is community, cloud-only or Pro-gated, **ask the user** before building.

## 2. Web and native, always both

- Web panel: a page under `app/pages/` (project sections are listed in `app/utils/projectSections.ts`).
- Native app: a matching screen under `helpbites-native/App/Features/<Area>/` (run `xcodegen generate` after adding
  files; match `Design/` components). The native app covers every page of the panel; a feature is not done until it is
  in both, or the gap is written down in `features.json` `notBuilt` **and** in `docs/FEATURES.md` section 14.
- Logic that both clients need goes in `shared/` (TypeScript) and is ported to Swift by hand. Add a parity test like
  `tests/emailNativeParity.test.ts` for any constants or rules you copy.
- Both clients call the same `/v1/admin/*` API. Never add an endpoint only one of them can use.
- Panel strings go through `$t()` in `i18n/locales/en.json` (en is the fallback and is required; add the other five
  locales when you can).
- Public end-user surfaces (widget, boards, pages) are not part of the native operator app; they get section 3.

## 3. API first, then snippets

Anything an indie dev would want to automate or embed gets all of these:

1. **API.** Routes under `server/routes/v1/**`, one file per route, with `defineRouteMeta({ openAPI: … })` (tags,
   operationId, summary, description, security, parameters, responses; copy a neighbour such as
   `server/routes/v1/feedback/index.get.ts`). Admin routes accept an operator session **or** an `ak_` admin key and
   are workspace-scoped through `requireMember` / `requireProject` (see `CONTRIBUTING.md`). Public routes use the
   project public key or an identity token. Write a feature's rules (limits, errors, idempotency) in its `docs/*.md`.
2. **Docs.** A `docs/<FEATURE>.md` guide; add it to `DOCS` in `shared/docs.ts` if it should publish at `/docs`
   (`tests/docs.test.ts` link-checks it). Put the curl examples and the `Web` and `Swift` snippets in it.
3. **Web snippet.** If end users or the host site see it, ship it as a drop-in `<script>` in `public/*.js` (MIT, with the
   SPDX header, no dependencies; model it on `public/feedback.js` and `public/changelog.js`) and/or a plain HTML form.
   One copy-paste block that works with only `data-project="pk_…"`.
4. **Swift snippet.** A copy-paste SwiftUI view (plain `URLSession` against the public API, no package required) shown in
   the feature's doc next to the web one. No Swift snippets exist yet; the first feature that adds one sets the
   convention, so keep it small and self-contained.
5. **Customisation, without forking.** Everything visual is adjustable:
   - web script: `data-*` attributes plus a JS `init` options object (position, accent, theme, target, labels, which views);
   - the project's own theme (accent colour, logo) read from the API, so the embed wears it by default;
   - styling hooks: CSS variables or documented class names for anything a host page may want to restyle;
   - Swift snippet: colours, fonts and corner radius as parameters or an environment value;
   - the API for people who want to build their own UI. Say so in the doc.
   "Reasonable extent" means colours, type, spacing, which parts show, and copy. Layout is ours.
6. If it truly needs none of these (a purely internal operator tool), say why in the PR or commit message and set
   `embed: null` and a short `api.docs: null` reason in `features.json`.

## 4. features.json, FEATURES.md and the landing page

`features.json` (repo root) is the single source of truth for what the product does. `tests/features.test.ts` fails when
it names a file, route, doc or i18n key that does not exist, or when a project section or native folder has no feature.

Every new feature, removal, rename, edition change, or a change to what a feature can do:

1. Add or edit its entry in `features.json` (fields: `id`, `name`, `category`, `summary`, `editions`, `plan`,
   `entitlement`, `status`, `web`, `native`, `api`, `embed`, `landing`). Keep `notBuilt` honest.
2. Update the prose in `docs/FEATURES.md` (same facts, grouped by where users meet them).
3. **Landing page** (`app/pages/index.vue`): decide whether it earns a place and record the answer in
   `landing.listed`.
   - A new feature that a visitor would choose HelpBites for: add a term/desc to the right group in the `features`
     computed (or a `showcase` entry plus a screenshot in `public/screens/` for a headline feature) with keys under
     `landing.*` in `i18n/locales/en.json`, and set `landing.key`.
   - Small additions to an existing feature: update that feature's `desc` text instead of adding a row.
   - Internal plumbing (a setting, a refactor): `listed: false`.
   - Do not claim anything the code does not do yet; unfinished features stay out of the landing page.
4. If the edition or plan gating changed, update `docs/EDITIONS.md` and the cloud repo's plan config and pricing copy.
5. Add a line under **Unreleased** in `CHANGELOG.md` for anything a self-hoster must know (schema changes, env vars).

## 5. Done means

- `bun test` passes (it includes the features test, the tenancy guard and the edition boundary tests).
- Schema changes are in `scripts/ensure-schema.mjs` (idempotent); search changes in `scripts/ensure-search.mjs`.
- New admin routes pass `bun run smoke:isolation` (one workspace can never reach another's data).
- Both clients were opened and the feature works in each; say so, or say which you could not check.
- Match the surrounding code: comment density, naming, idiom. No new dependency for something a few lines can do.
