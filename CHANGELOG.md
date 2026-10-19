# Changelog

All notable changes to the community edition. Versions are Docker image tags
(`elrumo/helpbites:<version>`).

## Unreleased

- Inbox conversations can be archived and deleted, on the web and in the native app. Archived threads leave the queue and
  live under a new **Archived** view; they come back when the customer writes again. Deleting removes the conversation
  and all its messages for good. Needs `schema:apply` (the container does it on boot).
- Errors from GlitchTip and Bugsink no longer open inbox conversations or AI notes. The Errors page has cards that
  expand to the stack trace, event details, breadcrumbs and tags, an **Alerts** button for email rules (new error,
  total events, events within a time window), and AI that analyzes an error against the project's GitHub repos or
  copies a prompt for a coding agent. Alert webhooks now just trigger a check of the rules. Needs `schema:apply` (the
  container does it on boot). Conversations opened by earlier errors stay.
- Changelog entries can be drafted by AI from a project's GitHub commits (on demand, or on every push), always as drafts
  waiting for review unless the project turns on publishing without review. Select entries to approve or merge them.
- The public changelog is its own switch (`changelog.enabled`), no longer tied to the feedback board, and has its own embed
  (`/changelog.js`, `/embed/changelog`). Existing projects the board published are switched on by
  `scripts/migrate-changelog-public.mjs`, which the container runs on boot.
- Published as open source (AGPL-3.0). The community image is built and pushed to Docker Hub and GHCR on every tagged
  release, for amd64 and arm64.
- `docker-compose.yml` pulls the published image; `docker-compose.build.yml` builds from source.
- `scripts/install.sh` writes a `.env` with generated secrets. An optional bundled Caddy (`--profile proxy`) serves
  HTTPS.
- Production refuses to start with the `change-me` placeholder `PARSE_MASTER_KEY` or `MEILI_MASTER_KEY`.
- Parse accepts the master key only from the stack's own network (`SB_INTERNAL_SUBNET`, default `10.213.0.0/24`).
  An existing deployment must recreate its Compose network once: `docker compose down && docker compose up -d`.
