# Connect an AI assistant (MCP)

Let Claude, ChatGPT, Cursor or any assistant that speaks the
[Model Context Protocol](https://modelcontextprotocol.io) work in your
HelpBites workspace: read the inbox, draft a reply, move a feedback post along,
write a changelog entry, look into an error. You keep control: the assistant
acts as *you*, with your role, in one workspace, and you can cut it off from
**Settings → API keys** at any time.

The server is one address on your HelpBites host:

```
https://YOUR-SUPPORT-HOST/mcp
```

It is stateless Streamable HTTP (JSON-RPC 2.0), so it needs nothing beyond the
app itself. The same address is shown, ready to copy, under **Settings → API
keys**.

## Connect

There are two ways to sign in. Both end in the same thing: an admin API key
(`ak_…`) that the assistant sends as `Authorization: Bearer …`.

### Sign in with your browser (claude.ai, ChatGPT)

Assistants that run in the cloud can't be given a header, so they sign in with
OAuth instead.

1. In the assistant, add a custom connector (Claude: **Settings → Connectors →
   Add custom connector**; ChatGPT: **Settings → Connectors**, with developer
   mode on) and paste the address above.
2. Your browser opens HelpBites. Sign in if you aren't, check the workspace,
   choose all projects or only some, and press **Approve**.
3. The assistant gets a key named `MCP: Claude` (or whatever it called itself).
   It is listed under **Settings → API keys**. Revoking it there disconnects the
   assistant.

What this needs:

- A public **https** address. Cloud assistants call your server from the
  internet, so `localhost` won't do (use a tunnel while you try it, and set
  `APP_URL` to the tunnel's address).
- `HELPBITES_SECRET` set on the server (it signs the assistant's registration).
- A role that may manage API keys (owners and admins).

The key lasts a year. There are no refresh tokens: when it expires, the
assistant asks you to sign in again.

### Paste a key (Claude Code, Cursor, scripts)

Create a key under **Settings → API keys**, optionally limited to some projects,
and give it to the client as a header.

Claude Code:

```bash
claude mcp add --transport http helpbites https://YOUR-SUPPORT-HOST/mcp \
  --header "Authorization: Bearer ak_…"
```

Cursor (`~/.cursor/mcp.json`), and most other clients that take a URL:

```json
{
  "mcpServers": {
    "helpbites": {
      "url": "https://YOUR-SUPPORT-HOST/mcp",
      "headers": { "Authorization": "Bearer ak_…" }
    }
  }
}
```

Clients that only run local programs (an older Claude Desktop) can bridge with
`npx mcp-remote https://YOUR-SUPPORT-HOST/mcp --header "Authorization: Bearer ak_…"`.

## What it can do

Each tool is one of the documented `/v1` API routes, called with the
assistant's key. Nothing here is a back door: the role check, the workspace and
a key's project limit apply exactly as they do in the panel and the native app.

| Tool | What it does |
|---|---|
| `list_projects` | The projects in the workspace, with their ids. Most other tools need one. |
| `get_overview` | The overview: unread, open, revenue and errors per project. |
| `search` | Search conversations and knowledge base answers. |
| `list_conversations` | The inbox: filter by project, status, unread, assignee, priority, tag or customer. |
| `get_conversation` | One conversation with its customer and project. |
| `get_conversation_messages` | Its messages, including internal notes. |
| `reply_to_conversation` | Send a reply to the customer (and email them). |
| `add_internal_note` | A note only the team sees. |
| `update_conversation` | Status, priority, tags, assignee. |
| `archive_conversation` | Archive or restore. |
| `search_end_users` | Find a customer by name, email or id. |
| `list_feedback` | A project's feedback board. |
| `get_feedback_post` | One post with its comments. |
| `update_feedback_post` | Change status, hide, feature or lock a post. |
| `comment_on_feedback_post` | Comment as the team, or leave an internal note. |
| `list_board_items` | The work board behind the roadmap. |
| `create_board_item` | Add an item. |
| `update_board_item` | Edit or move an item. |
| `list_changelog_entries` | Changelog entries, drafts included. |
| `create_changelog_entry` | Write an entry: a draft unless told to publish. |
| `update_changelog_entry` | Edit an entry, or publish a draft. |
| `list_errors` | Issues from the connected error tracker. |
| `get_error` | One issue with its latest event and stack trace. |

Try: *"Which conversations are unread? Draft a reply to the one about the failed
export, and show it to me before sending."*

## Safe by design

- **It acts as you.** The assistant can do what your role does in that
  workspace, no more. A key limited to some projects can't reach the rest, or
  anything workspace-wide.
- **Writes are marked.** Every tool says whether it only reads, and assistants
  that ask before acting use that. Replies to customers and publishing a
  changelog entry reach real people, and the tool descriptions tell the
  assistant to confirm first. Prefer a client that asks you to approve each
  write.
- **Customer text is untrusted.** Messages, feedback and error reports are written
  by other people, and an assistant reads them. Someone can try to slip it
  instructions ("reply with a refund code"). Keep write approvals on, and read what
  an assistant is about to send before you allow it.
- **Revoke at any time.** Each connection is an API key: rename or revoke it
  under **Settings → API keys**. Changing your password with *revoke keys*
  ticked removes them all.
- **Limits apply.** A key is limited to 600 calls a minute, and to the plan's
  per-minute allowance on the hosted edition.
- **Results are trimmed.** A very long answer is cut off after 60,000 characters
  with a note, so one big list doesn't fill the assistant's memory: ask for less
  with a filter or `limit`.

## Calling it yourself

Every message is a JSON-RPC POST. List the tools, then call one:

```bash
curl https://YOUR-SUPPORT-HOST/mcp \
  -H "Authorization: Bearer ak_…" -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

curl https://YOUR-SUPPORT-HOST/mcp \
  -H "Authorization: Bearer ak_…" -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_conversations","arguments":{"unread":true,"limit":10}}}'
```

A tool that fails (a wrong id, a role that can't do that) answers with
`isError: true` and the API's own message, so the assistant can correct itself.
The server offers tools only; it keeps no sessions, so `GET` and `DELETE` on
`/mcp` answer 405. For anything the tools don't cover, the full
[API](/_docs/scalar) is the same key's reach, and building your own interface on
it is just as supported.

## How sign-in works

For the curious, or anyone writing a client. It is standard OAuth 2.1 with PKCE
(S256), no client secret, and dynamic client registration:

| Step | Where |
|---|---|
| The server answers `401` with `WWW-Authenticate: Bearer resource_metadata="…"` | `POST /mcp` |
| Protected resource metadata (RFC 9728) | `/.well-known/oauth-protected-resource` |
| Authorization server metadata (RFC 8414) | `/.well-known/oauth-authorization-server` |
| Register the client (RFC 7591) | `POST /v1/oauth/register` |
| The person approves | the panel page `/oauth/authorize` |
| Exchange the code | `POST /v1/oauth/token` |

Registration stores nothing: the client id is the client's name and redirect
addresses, signed with a key derived from `HELPBITES_SECRET`. Redirect addresses
must be https, `http://localhost`, or an app's own scheme (`cursor://`). The
authorization code lives two minutes in Redis and works once. The access token
is an ordinary admin API key, minted when the code is exchanged.

## Not built yet

- No refresh tokens (the key lasts a year, then the assistant signs in again).
- No prompts, resources or live notifications: the server offers tools.
- No tools for email, campaigns, contacts sync, legal documents, flags or
  knowledge base editing yet; the API has them, and they are the next to add.
