# helpbites

Run it inside any git repo to turn that repo's changes into entries on a HelpBites project's changelog. It reads the git changes, has a local model CLI (`mimo`, `claude` or `codex`, in that order) write the entries, shows you a preview, and posts them. It never pushes.

## Install

```bash
cd cli && bun link
```

That puts `helpbites` in `~/.bun/bin`. Run it once; it picks up edits to this folder.

## Set up a repo

Needs an admin API key (panel: sidebar → API keys). Keep it in the environment, e.g. the repo's `.env` (Bun loads it):

```
HELPBITES_ADMIN_KEY=ak_…
```

The rest can be flags, env vars, or a `.helpbites.json` at the repo root (no secrets in it):

```json
{
  "project": "Acme",
  "url": "https://help.example.com",
  "product": "Acme, a site for sharing icons with an editor and a public API",
  "voice": "first person, as the person who builds it. Never \"we\"",
  "internal": ["app/pages/admin", "app/components/admin"]
}
```

`project` is an id, public key, slug or name. `product`, `voice` and `internal` (paths whose changes are never user-facing) shape the prompt.

## Use

```bash
helpbites changelog                 # uncommitted work → preview → commit + published entries
helpbites changelog --since 2w      # commits of the last 2 weeks → draft entries
helpbites changelog --since 3m --publish
helpbites changelog --since v1.4    # commits since a tag or ref
helpbites changelog --dry-run       # run the model, show everything, change nothing
```

`--since` takes `7d`, `2w`, `3m`, a date (`2026-09-01`) or a git ref. Other options: `--draft`, `--publish`, `--yes`, `--message`, `--model`, `--max-diff-bytes`, `--timeout`, `--chunk`, `--url`, `--key`, `--project`; see `helpbites changelog --help`.

The default run asks the model for a conventional-commit message and the user-facing entries, shows both, then does `git add -A`, `git commit`, and posts the entries stamped with the new commit's SHA and date. A change with nothing user-facing just gets the commit. Entries from `--since` are back-dated to the commits they describe.

## No duplicates

- Every entry stores the full SHAs of the commits it describes (`commitShas`). Before spending a model call, `--since` drops every commit an entry already cites.
- `POST /v1/admin/changelog/entries/batch` is the second guard: the server skips any entry whose commit is already cited, so re-sending a batch never writes a commit up twice.
- Entries whose title matches an existing one are left out, which covers rewritten history (rebases change SHAs).

Known limit: a commit the model judges internal gets no entry, so no SHA is recorded, and `--since` asks the model about it again on the next run. Costs a call, never a duplicate.

## When something fails

Before any model call or commit, the CLI checks the server is reachable, the key works, and the project exists. If the commit lands but the post fails (exit code 2), run the command it prints, `helpbites changelog --since HEAD~1 --publish`: the commit is not in the changelog yet, so it is written up, once.

## Good to know

- **What goes to the model:** the diff, the commit list and the text of new files, sent through the local `mimo`/`claude`/`codex` CLI, so to whichever provider that CLI uses. Lockfiles, minified files, `.env*`, `*.pem`, `*.key` and `*.p12` are left out of diffs, and new files that look like secrets are never read.
- **`git add -A`** stages everything not gitignored. The preview lists the files; secret-looking ones are flagged in red, and `--yes` refuses to commit them.
- **Entries are Markdown**, no raw HTML (the RSS feed embeds the body as is).
- **Only the admin API:** entries show up in `GET /v1/changelog` and the RSS feed once published and the project's board has the changelog on.
