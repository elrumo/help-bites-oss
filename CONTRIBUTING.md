# Contributing to HelpBites

Thanks for helping. A few things to know before you open a pull request.

## Licensing and the CLA

| Path | License |
|---|---|
| Everything not listed below | [AGPL-3.0-only](LICENSE) |
| `public/widget.js`, `public/feedback.js`, `cli/` | [MIT](licenses/MIT.txt) |

Every contributor signs the [Contributor License Agreement](CLA.md) once. A bot asks you to on your first pull
request. You keep your copyright; the CLA lets the maintainer offer HelpBites under more than one license.

## Getting set up

The full guide is [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md); the short version:

```bash
cp .env.example .env
docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile dev up -d sb-mongo sb-parse sb-redis sb-meili sb-rustfs
bun install
bun run schema:apply && bun run search:setup
bun run dev                      # community edition on http://localhost:3100
```

## Checks

- `bun test`: unit tests, no services needed. Run them before every push.
- `bun run smoke`: end to end, against a running stack.
- `bun run smoke:isolation`: proves one workspace can never see another's data. Run it whenever you touch an admin
  route.

## Rules of the road

- **Core never imports from `ee/`.** `ee/` is the hosted service's private commercial layer and you never need it to contribute. If cloud code needs a hook, add an extension point to
  `server/utils/edition.ts` or `app/utils/editionUi.ts`. `tests/editionBoundary.test.ts` enforces this.
- **Every admin route is scoped to a workspace.** Use these helpers:
  - `requireMember` / `requireProject` from `server/utils/tenancy.ts`;
  - the `scoped.*` getters, never a bare `get(id)`.
  `tests/tenancy.guard.test.ts` enforces this.
- **Match the surrounding code.** Keep the same comment density, naming and idioms.
