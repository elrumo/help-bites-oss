FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile || bun install
COPY . .
# community (default, AGPL only) or cloud (adds the ee/ layer, see docs/EDITIONS.md).
# Declared after the install so `nuxt prepare` in postinstall never sees it.
ARG HELPBITES_EDITION=community
ARG GIT_SHA=
# A community image must not contain the commercial ee/ code, not even unused.
RUN if [ "$HELPBITES_EDITION" != "cloud" ]; then rm -rf ee; fi
RUN HELPBITES_EDITION=$HELPBITES_EDITION bun run build

FROM oven/bun:1
WORKDIR /app
ARG HELPBITES_EDITION=community
ARG GIT_SHA=
COPY --from=build /app/.output ./.output
COPY --from=build /app/scripts ./scripts
ENV NODE_ENV=production
ENV HELPBITES_EDITION=$HELPBITES_EDITION
ENV GIT_SHA=$GIT_SHA
# One process does everything unless told otherwise (server/utils/appRole.ts);
# the hosted stack splits it into web, worker and embedder containers
# (the hosted stack's compose overlay).
ENV APP_ROLE=all
EXPOSE 3000
# The schema, workspace and search-setup scripts are idempotent; running them
# on every boot keeps a fresh database and search backend in step without a
# separate migration step. ensure-search never fails the boot (Meili is
# optional). With several app containers, let one of them migrate
# (RUN_MIGRATIONS=1, the default) and set RUN_MIGRATIONS=0 on the rest.
CMD ["sh", "-c", "if [ \"${RUN_MIGRATIONS:-1}\" = 1 ]; then bun scripts/ensure-schema.mjs --apply && bun scripts/migrate-workspaces.mjs --apply && bun scripts/ensure-search.mjs; fi && exec bun .output/server/index.mjs"]
