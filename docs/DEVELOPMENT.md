# Development

How to run HelpBites from source, find your way around, change it safely and get a change merged. HelpBites is in
public beta and moves quickly: `main` is always releasable, and [CHANGELOG.md](../CHANGELOG.md) is the history.
Read [CONTRIBUTING.md](../CONTRIBUTING.md) (licenses, the CLA, the rules of the road) before your first pull request.

## What you need

- [Bun](https://bun.sh) 1.x. It is the package manager, the script runner, the test runner and the production runtime.
- Docker with the Compose plugin, for MongoDB, Parse, Redis, Meilisearch and the bucket.
- Optional: Xcode 16 and [XcodeGen](https://github.com/yonaskolb/XcodeGen) for the native app.

## Run it

```bash
git clone https://github.com/elrumo/help-bites-oss.git && cd help-bites-oss
cp .env.example .env                       # the defaults already target the dev stack below
docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile dev \
  up -d sb-mongo sb-parse sb-redis sb-meili sb-rustfs
bun install
bun run schema:apply                       # Parse classes, permissions, indexes (idempotent)
bun run search:setup                       # Meilisearch indexes and settings (idempotent)
bun run dev                                # http://localhost:3100
```

The first visit asks you to create the operator account. The dev overlay publishes the services on localhost: Parse
`:1337` (dashboard `:4040`, login `admin`/`admin`), Redis `:6379`, Meilisearch `:7700`, RustFS `:9000`/`:9001`. It is only
for development, never for production.

Useful extras:

```bash
bun run seed:knowledge                     # a demo knowledge model (against the running app)
bun scripts/dev-token.mjs <projectId> <userId> "Demo user" demo@example.com   # an identity token, no host code
bun run reindex                            # rebuild the search index
bun run add-agent                          # another operator, from the CLI
```

`/demo` serves the panel against canned data with no backend (`app/utils/demoApi.ts`): the quickest way to check a UI
change. The API reference is at `/_docs/scalar`; your own AI, email and GitHub setups are in [Setting things up](SETUP.md).

To run the real image instead, from your checkout: `docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build`.

## Checks

| | What | When |
|---|---|---|
| `bun test` | Unit tests, the features map, the tenancy guard, the edition boundary, the native parity tests. No services needed apart from an optional Redis (`REDIS_TEST_URL`) for the usage counters | Before every push |
| `bun run smoke` | End to end against the running stack | After changing a flow |
| `bun run smoke:isolation` | One workspace can never reach another's data | Whenever you touch an admin route |
| `bun run build` | The production build | Before a release; CI does it on every PR |
| `bun scripts/check-edition-build.mjs community` | The build holds no `ee/` code | CI does it |

CI (`.github/workflows/ci.yml`) runs the tests and the build on every pull request.

## The layout

```
app/                      the Nuxt panel and the public pages (landing, docs, embeds)
  pages/                  routes; project sections are listed in app/utils/projectSections.ts
  components/             UI; app/components/settings holds the settings tabs
  utils/demoApi.ts        canned data behind /demo
server/
  routes/v1/**            the API, one file per route, each with defineRouteMeta({ openAPI })
  utils/                  the logic: tenancy, auth, conversations, email, AI gateway, MCP tools
  plugins/                boot-time checks and schedulers
shared/                   TypeScript that the server and the panel share; ported by hand to Swift
public/*.js               the drop-in scripts host sites include (MIT): widget.js, feedback.js, changelog.js …
cli/                      `helpbites changelog` (MIT)
helpbites-native/         the SwiftUI iPhone, iPad and Mac app
scripts/                  schema, search, migrations, seeding, smoke tests
docs/                     these guides; shared/docs.ts picks which ones publish at /docs
i18n/locales/             en (required, the fallback), ca, es, ja, ko, zh
features.json             the machine-readable map of what the product does
ee/                       the hosted service's commercial layer. Not in this repository
```

Three things worth knowing early:

- **Parse is the database layer.** Data lives in MongoDB behind Parse Server; `scripts/ensure-schema.mjs` declares every
  class, permission and index and is safe to run any time. A schema change is a change to that file and a line in the
  changelog.
- **Everything is workspace-scoped.** A *workspace* owns *projects*. Admin routes go through `requireMember` /
  `requireProject` and the `scoped.*` getters in `server/utils/tenancy.ts`; `tests/tenancy.guard.test.ts` fails the build
  on a route that does not.
- **Two editions, one codebase.** Community is everything here, unlimited. Cloud adds sign-up, plans and billing from a
  private layer through the seams in `server/utils/edition.ts` and `app/utils/editionUi.ts`. Core never imports from
  `ee/` ([Editions](EDITIONS.md)).

## Adding a feature

[CLAUDE.md](../CLAUDE.md) is the checklist, and it applies to people as much as to coding assistants. In short, a
feature is done when it has:

1. **An edition decision** (community and cloud by default), written into `features.json`.
2. **Web and native**: a page under `app/pages/` and a screen under `helpbites-native/App/Features/<Area>/`, or the gap
   written down in `features.json` (`notBuilt`) and [FEATURES.md](FEATURES.md) §14. Anything both need goes in `shared/`,
   with a parity test where Swift copies constants (see `tests/emailNativeParity.test.ts`).
3. **An API**: routes under `server/routes/v1/**` with OpenAPI metadata, accepting an operator session or an `ak_` key, and
   an MCP tool in `server/utils/mcp/tools.ts` plus a row in [MCP.md](MCP.md) (`tests/mcpCoverage.test.ts` checks).
4. **A guide** in `docs/` (add it to `shared/docs.ts` to publish it), with curl examples, and for anything end users see a
   drop-in `<script>` in `public/` and a Swift snippet.
5. **Strings** through `$t()` in `i18n/locales/en.json` (add the other five when you can).
6. **Its entry in `features.json`**, `docs/FEATURES.md`, a line under *Unreleased* in `CHANGELOG.md`, and a decision on the
   landing page (`landing.listed`).

`tests/features.test.ts` fails when `features.json` names a file, route, doc or key that does not exist.

## The native app

`helpbites-native/` is one SwiftUI target for iPhone, iPad and Mac (iOS 18, macOS 15), generated by XcodeGen.

```bash
cd helpbites-native
xcodegen generate                          # after adding or removing files
open HelpBitesNative.xcodeproj
```

Set `APP_BASE_URL` in `Config/Debug.xcconfig` to your server (the simulator default is `http://localhost:3100`; a device
needs an HTTPS tunnel or your LAN address) and your team in `project.yml`, then run the `HelpBitesNative` scheme. The share
extension needs the App Group `group.com.helpbites.operator` on both targets. The app's version is `MARKETING_VERSION` in
`project.yml`, kept equal to `package.json` by a test. More in [helpbites-native/README.md](../helpbites-native/README.md).

## Conventions

- Match the surrounding code: comment density, naming, idiom. No new dependency for something a few lines can do.
- Comments say why, not what. Tests sit in `tests/` and are named for what they protect.
- Public scripts (`public/*.js`) have no dependencies and start with the SPDX header; they must work from one tag with
  only `data-project="pk_…"`.
- Errors are `createError({ statusCode, statusMessage })` with a message a person can act on.
- Pull requests are small and say what and why. The template asks for `bun test`, workspace scoping and the CLA.

## Releasing

Maintainers: [RELEASING.md](RELEASING.md) covers the version, the tag, Docker Hub and the public changelog.
