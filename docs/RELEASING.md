# Releasing

For maintainers. A release is a tag: pushing `vX.Y.Z` builds the community image, puts it on Docker Hub and GHCR, creates
the GitHub release and posts the release notes to HelpBites' own public changelog. HelpBites is in public beta, so
versions stay `0.x` and the Beta tag shows next to the number everywhere until `RELEASE_STAGE` in `shared/version.ts` is
set to `null`.

## Cut a release

```bash
bun run release:bump 0.3.0     # package.json, the native app's version, CHANGELOG.md, the Xcode project
git diff                       # CHANGELOG.md now has "## 0.3.0 — <today>" under "## Unreleased": check the bullets
bun test
git commit -am "Release 0.3.0"
git tag v0.3.0 && git push && git push --tags
```

**From your machine instead of CI.** `scripts/release.mjs` runs the same steps itself (bump, test, commit + tag + push,
Docker Hub, GHCR, GitHub release, public changelog). Its release commit says `[skip release]`, which makes `release.yml`
skip the tag so nothing is published twice. It needs `docker login` (and `ghcr.io` for GHCR), `gh auth login` and, for
the changelog, the `HELPBITES_*` variables below.

```bash
bun run release minor --dry-run                              # prints every command, changes nothing
bun run release 0.3.0                                        # everything
bun run release patch --skip ghcr,changelog                  # no GHCR image, no public changelog
bun run release --only dockerhub,ghcr,github,changelog       # resume a release at the current version
bun run release 0.3.0 --only bump,test                       # prepare it, review the diff, publish later
```

Steps: `bump`, `test`, `commit`, `dockerhub`, `ghcr`, `github`, `changelog`; `--draft` leaves the changelog release
unpublished, `--yes` skips the confirmation. It does not sync the Docker Hub description from `README.md` (CI does).

The one number is `version` in `package.json`. Everything else follows it, and `tests/versionParity.test.ts` fails when
the native app (`MARKETING_VERSION` in `helpbites-native/project.yml` and the generated project) or `CHANGELOG.md` drifts.
Write release notes as you go: every self-hoster-visible change gets a bullet under *Unreleased* (that is rule 4.5 of
[CLAUDE.md](../CLAUDE.md)). A bullet is `- **Title** (where): what changed and what to do on upgrade.`; the bold part
becomes the entry's title in the public changelog.

## What the tag does (`.github/workflows/release.yml`)

1. **verify**: the tag must equal `v` + `package.json`'s version, and `CHANGELOG.md` must have a section for it.
2. **image**: builds the community image (no `ee/`) for amd64 and arm64 and pushes it to
   [Docker Hub](https://hub.docker.com/r/elrumo/helpbites) as `X.Y.Z`, `X.Y` and `latest`, and to GHCR. It then checks
   that the image holds no `ee/`, and syncs the Docker Hub description from `README.md`. A tag with a `-` in it
   (`0.3.0-rc.1`) is a pre-release: it gets its own tag and not `latest`.
3. **github-release**: creates the GitHub release from the changelog section, marked as a pre-release and titled "(beta)" while `RELEASE_STAGE` is `'beta'`. Docker tags are unaffected: `latest` still moves.
4. **changelog**: publishes that section to the HelpBites project's public changelog (below).

Every push to `main` also publishes `elrumo/helpbites:edge` (`.github/workflows/edge.yml`).

## One-time setup

**Docker Hub.** Create the public repository `elrumo/helpbites`, then an access token (Account settings → Personal
access tokens, *Read & Write*). In the GitHub repository's *Settings → Secrets and variables → Actions* add
`DOCKERHUB_USERNAME` (`elrumo`) and `DOCKERHUB_TOKEN`. GHCR needs nothing: the workflow's own token pushes there; make the
package public afterwards (*Packages → helpbites → Package settings*).

**The public changelog** (HelpBites on HelpBites). The project *HelpBites* on the HelpBites instance at
[helpbites.app](https://helpbites.app) keeps this repository's changelog, public at
[its changelog page](https://helpbites.app/changelog/pk_68ccfcddaabeee44c8cd907a) (also `/v1/changelog` and an RSS feed).
Make sure the project's public changelog is switched on in its Changelog settings, then in *Settings → API keys* create
an admin key limited to that project, and add three more secrets:

| Secret | Value |
|---|---|
| `HELPBITES_URL` | `https://helpbites.app` |
| `HELPBITES_ADMIN_KEY` | the `ak_…` key |
| `HELPBITES_PROJECT` | the project's id (`GET /v1/admin/projects`) or its public key, `pk_68ccfcddaabeee44c8cd907a` |

Admin keys expire (90 days unless you choose otherwise), so renew the secret when the changelog job starts failing with
`401`. Without the three secrets the job logs that it did nothing and passes, which is what a fork's release does.

The panel, the docs and HelpBites Cloud's landing page show `vX.Y.Z` with a Beta tag, linking to that page (`CHANGELOG_URL` in
`shared/version.ts`; change it if the page ever moves).

## How the changelog is published

`scripts/publish-changelog.mjs` reads `CHANGELOG.md`, finds the section for the version, creates (or reuses) a
*release* of that version on the project, adds each bullet as an entry in it and publishes the release. Run it by hand
to preview or backfill:

```bash
bun run release:changelog -- --dry-run                 # lists what the current version would publish
bun run release:changelog -- --version 0.1.0 --draft   # needs the three HELPBITES_* variables; leaves it unpublished
```

It is safe to run again: entries whose title the release already has are skipped, and `--draft` lets you read it in
the panel before it goes public. To fix wording after publishing, edit the entries in the panel (*Project → Changelog*).
A bullet's tag is guessed (`breaking` for **Breaking**, `fix` for fixes, `removed`, else `new`); change it in the panel
if the guess is off. Entries are Markdown with no raw HTML.

## Going public on GitHub (once)

- Make `elrumo/help-bites-oss` public. There are no secrets in the tree or in the history (checked: `.env` files and
  keys are ignored and never were committed).
- *Settings → General*: description and topics; turn on Issues and Discussions. *Security*: enable private vulnerability
  reporting (`SECURITY.md` points there) and Dependabot alerts (`.github/dependabot.yml` is in place).
- *Branches*: protect `main` and require the `CI` checks. The CLA workflow (`.github/workflows/cla.yml`) asks first-time
  contributors to sign [CLA.md](../CLA.md).
- Add the secrets above, then push the first tag.

## If a release is bad

Fix forward with a patch release; a tag is never moved. To stop new installs getting it, re-run the previous tag's
`image` job (it re-points `latest`). Self-hosters can pin `HELPBITES_VERSION=<previous>` and run `docker compose up -d`;
a rollback does not undo a schema change, so say in the notes when a release changes the schema.
