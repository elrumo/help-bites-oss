# Usage and storage

Settings → **Usage** shows where a workspace's storage goes, on every edition. On a plan with limits (the hosted
edition's Free and Pro) the tab is called **Plan & usage** and also shows what has been used against each limit, what is
left, and which features the plan includes. The native app has the same screen under Settings.

## Storage

Every uploaded file is counted: attachments in conversations, files on feedback posts and planning cards, logos and
the brand kit, CMS files, lead form uploads, images in emails, blog posts and onboarding flows, and knowledge
documents. The tab adds them up two ways:

- **By type**, largest first:

  | `type` | What it holds |
  |---|---|
  | `conversations` | Files your customers sent in the widget or by email. |
  | `feedback` | Files end users attached to feedback posts. |
  | `team` | Files your team attached to replies, posts and cards. |
  | `branding` | Project logos and the brand kit. |
  | `cms` | CMS files. |
  | `forms` | Lead form uploads. |
  | `emails` | Images in email templates. |
  | `blog` | Images in blog posts. |
  | `onboarding` | Images in onboarding flows. |
  | `knowledge` | Knowledge documents. |
  | `other` | Anything else. |

- **By project**, with each project's three biggest types. A knowledge model made for one project counts there;
  shared knowledge models, email templates shared across the workspace and files brought in by an
  [import](TRANSFER.md) belong to the whole workspace, listed last.

The breakdown is read from the bucket, so it can differ a little from what the plan counts: an upload still in flight,
or a file whose delete never gave its bytes back. The plan's limit is checked against its own count (`used`).

Workspace exports are not counted.

## Limits (hosted edition)

Each limit shows `used / limit`, a bar that turns amber at 80% and red when it is reached, and what is left. A **soft**
limit (Pro's conversations) is counted but never refuses anything; past it the row says by how much. Monthly counts
start over on the 1st and daily ones at midnight, UTC. See [EDITIONS.md](EDITIONS.md) for how plans are defined.

## API

Both need an operator session or an `ak_` admin key that is not limited to some projects.

```bash
# The plan, its limits (null: none) and features, and what has been used.
curl https://helpbites.example.com/v1/admin/usage -H "Authorization: Bearer ak_…"

# Where the storage goes.
curl https://helpbites.example.com/v1/admin/usage/storage -H "Authorization: Bearer ak_…"
```

```json
{
  "used": 48211968,
  "limit": 262144000,
  "bytes": 48100352,
  "files": 412,
  "types": [
    { "type": "conversations", "bytes": 40894464, "files": 377 },
    { "type": "branding", "bytes": 5242880, "files": 21 },
    { "type": "knowledge", "bytes": 1963008, "files": 14 }
  ],
  "projects": [
    { "id": "Pk3x9QaZ2m", "name": "My app", "bytes": 46137344, "files": 398, "types": { "conversations": 40894464, "branding": 5242880 } },
    { "id": null, "name": "", "bytes": 1963008, "files": 14, "types": { "knowledge": 1963008 } }
  ]
}
```

`limit` is `null` on a plan without one (always, self-hosted). The storage route lists every stored file, so it takes a
moment on a big workspace; call it when you need it, not on every page load. The MCP tools are `get_usage` and
`get_storage_usage` ([MCP.md](MCP.md)).

There is no embed: this is the operator's own view of their workspace.
