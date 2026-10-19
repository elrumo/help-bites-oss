# GitHub

A workspace connects its GitHub accounts and organisations once; each project
then picks the repos it uses. AI error notes and legal documents can read those
repos (the legal wizard's *Suggest from my repos* reads the file list and dependency manifests; see [LEGAL.md](LEGAL.md)). HelpBites only ever reads them: the app asks for read-only access.

**In the panel**

1. Settings → **GitHub** → *Connect GitHub*. Install the app on your account or
   organisation and choose which repos it may see (all, or only some).
2. Project → Settings → **GitHub repos**: pick the repos this project uses (up
   to 10, from any connected account).

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
| Webhook | off |
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
```

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
- A repo is saved only if GitHub lists it for that installation, with GitHub's
  own name for it.
