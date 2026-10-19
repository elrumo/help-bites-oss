# GitHub

A workspace connects its GitHub accounts and organisations once; each project
then picks the repos it uses. AI error notes and legal documents can read those
repos (the legal wizard's *Suggest from my repos* reads the file list and dependency manifests; see [LEGAL.md](LEGAL.md)). HelpBites only ever reads them: the app asks for read-only access.

**In the panel**

1. Settings → **GitHub** → *Connect GitHub*. Install the app on your account or
   organisation and choose which repos it may see (all, or only some).
2. Project → Settings → **GitHub repos**: pick the repos this project uses (up
   to 10, from any connected account).

**What reads them.** AI error notes ([ERRORS.md](ERRORS.md)): when an error
arrives, HelpBites lists each repo's files at its default branch, matches the
stack-trace paths by path suffix (a path must match exactly one file), and reads
up to 3 of them (100 KB max each; the prompt gets about 80 lines around the
failing line). The text goes to the AI as untrusted data. Nothing is stored,
and failures (no repos, GitHub not set up, a repo that is gone) skip silently.

**Changelog from commits.** *Changelog → From commits* reads the repos' commit messages (newest
300 per repo, default branch) and has the AI draft changelog entries; see [FEEDBACK.md](FEEDBACK.md).
To draft entries automatically on every push, turn the app's webhook on (below). Only the push's
commit messages are used, and they go to the AI as untrusted data.

Changing which repos the app can see happens on GitHub (the app's installation
settings); the lists here are read live. *Disconnect* only forgets the link in
HelpBites; uninstall the app on GitHub to revoke access there too. A connection
can't be disconnected while a project uses its repos.

## Registering the GitHub App (server owner, once)

GitHub → Settings → Developer settings → GitHub Apps → *New GitHub App*.

| Field | Value |
| --- | --- |
| Homepage URL | your `APP_URL` |
| Callback URL | `<APP_URL>/v1/github/callback` |
| Setup URL | `<APP_URL>/v1/github/callback` |
| Request user authorization (OAuth) during installation | on |
| Webhook | off, or on for changelog drafting on push: *Webhook URL* `<APP_URL>/v1/webhooks/github`, a *Secret* you invent, and subscribe to the **Push** event |
| Repository permissions | Contents: read-only (Metadata: read-only is added for you) |
| Where can this app be installed | *Any account* if your users connect their own, else *Only on this account* |

Then generate a client secret and a private key (`.pem`), and set:

```
GITHUB_APP_ID=…            # the App ID
GITHUB_APP_SLUG=…          # the name in github.com/apps/<slug>
GITHUB_APP_CLIENT_ID=…
GITHUB_APP_CLIENT_SECRET=…
GITHUB_APP_PRIVATE_KEY=…   # the .pem; literal \n is accepted
HELPBITES_SECRET=…         # already needed for contacts; signs the install link
GITHUB_APP_WEBHOOK_SECRET=…  # optional: the webhook's Secret; without it pushes are refused (503)
```

A project is found from a push by the repo ids saved when its repos were picked. Projects whose
repos were picked before this existed need their repos saved once more (Project → Settings →
GitHub repos).

Until all of these are set, the GitHub tab says it isn't set up.

## How it is kept safe

- No GitHub credential is stored. Only the installation id and account name are
  saved in the workspace; short-lived installation tokens are minted from the
  app's key when needed.
- GitHub returns the browser with an installation id, which anyone could
  forge in a URL. The OAuth code that comes with it is exchanged and the
  installation must be on that person's own list, so a workspace can't attach
  an account it doesn't control. The link back is signed, single-purpose and
  expires after 15 minutes.
- The webhook is accepted only with a valid `x-hub-signature-256` (HMAC-SHA256 of the raw body with
  `GITHUB_APP_WEBHOOK_SECRET`), and each delivery id is acted on once.
- A repo is saved only if GitHub lists it for that installation, with GitHub's
  own name for it.
