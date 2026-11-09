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
app itself, so it runs on a self-hosted instance as is. The same address is shown,
ready to copy, under **Settings → API keys** and on the workspace's **Developer & MCP**
page (with the Claude Code command below).

## Connect

There are two ways to sign in. Browser sign-in creates and manages a scoped API
key for the assistant behind the scenes; you do not need to create or paste one.
For clients that only support static headers, you can provide an API key yourself.

### Sign in with your browser (Claude, ChatGPT)

Assistants that run in the cloud can't be given a header, so they sign in with
OAuth instead.

1. In Claude, add a custom connector from **Settings → Connectors → Add custom
   connector**. In ChatGPT, open **Plugins → + → Add custom MCP server**, paste
   the address above, and choose **OAuth** authentication.
2. Your browser opens HelpBites. Sign in if you aren't, check the workspace,
   choose whether the assistant may **read and change** things or may only **read**, choose all projects or only some,
   and press **Approve**.
3. The assistant gets a key named `MCP: Claude` (or whatever it called itself).
   It is listed under **Settings → API keys**. Revoking it there disconnects the
   assistant.

What this needs:

- A public **https** address. Cloud assistants call your server from the
  internet, so `localhost` won't do (use a tunnel while you try it, and set
  `APP_URL` to the tunnel's address).
- `HELPBITES_SECRET` set on the server (it signs the assistant's registration).
- A role that may manage API keys (owners and admins).

The browser connection renews its 30-day access key automatically each time the
assistant uses it, and a connection nobody uses for 90 days ends. Its rotating
refresh token is tied to the API-key record, so revoking that key under
**Settings → API keys** disconnects the assistant. A refresh token that is used a
second time after the first minute is treated as a stolen copy and the whole
connection is revoked; reconnect from the assistant if that happens.

The approval page shows the address you are sent back to, in plain sight. For an
assistant HelpBites doesn't recognise (anything other than Claude, ChatGPT, a
local app or an editor's own address) it says so and selects *Read only* for you.
Only approve a connection you just started. An assistant's registration can only
point at an https address, a loopback address or an app's own scheme, and its name
is shown as plain text.

Changes made by an assistant through MCP tools are marked **via MCP** in a
Planning item's edit history; direct API-key edits are marked **via API**.
Comments written with `comment_on_board_item` display the connected assistant's
name (such as ChatGPT or Claude), while the operator who authorized the
connection remains recorded as the actor.

ChatGPT's custom MCP connections are available on supported Business,
Enterprise and Edu workspaces; availability and controls depend on the
workspace plan and admin settings.

### Paste a key (Claude Code, Cursor, scripts)

Create a key under **Settings → API keys**, optionally limited to some projects or
**read only**, and give it to the client as a header.

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

Each tool is one of the documented `/v1` API routes, called with the assistant's key, and together they cover what the
panel does: if you can do it in the panel, an assistant can, except what is under *Left out on purpose* below. Nothing here is a back door: the role check, the
workspace and a key's project limit apply exactly as they do in the panel and the native app. The tools are grouped by
where you meet them in the panel; ask the server for the live list with `tools/list`.

### Workspace and search

| Tool | What it does |
|---|---|
| `list_projects` | The projects in the workspace, with their ids. Most other tools need one. |
| `get_me` | Who this connection acts as: the operator, their role, the workspaces and the plan. |
| `get_overview` | The overview: unread, open, revenue and errors per project. |
| `search` | Search conversations and knowledge base answers. |

### Team and attention

| Tool | What it does |
|---|---|
| `list_team_members` | Everyone in the workspace with their role; their ids are what `assigneeId` takes. |
| `get_workspace_attention` | What waits on someone: drafts to approve, failed syncs, bounces, error alerts, feedback to triage, and the unread badge. |
| `get_unread_count` | The inbox badge: customer messages waiting on a reply, never cached. |

### Conversations

| Tool | What it does |
|---|---|
| `list_conversations` | The inbox: filter by project, status, unread, assignee, priority, tag or customer. |
| `get_conversation` | One conversation with its customer and project. |
| `get_conversation_messages` | Its messages, internal notes and timeline events. |
| `reply_to_conversation` | Send a reply to the customer, and email them whenever they have an address: asks first. |
| `add_internal_note` | A note only the team sees. |
| `update_conversation` | Status, priority, tags, assignee. |
| `archive_conversation` | Archive or restore. |
| `search_end_users` | Find a customer by name, email or id. |
| `get_conversation_context` | Who the customer is: plan, MRR, past conversations, linked posts. |
| `link_feedback_post` | Link a feedback post to a conversation, or file one for the customer. |
| `draft_conversation_reply` | A draft reply from the project's assistant. Nothing is sent. |
| `save_conversation_faq` | Save an answer from a conversation to the knowledge base. |
| `start_conversation` | Open a conversation with a customer and send the first message (and email it): asks first. |
| `delete_conversation` | Permanently remove a conversation and its messages: asks first. |
| `set_conversation_status` | Close or reopen a conversation, or move it to another status of its type. |
| `mark_conversation_read` | Mark a conversation read or unread for the team. |
| `get_conversation_suggestions` | FAQs and saved replies to answer a conversation with. |
| `run_conversation_action` | Run a host action configured on the conversation's type (it calls your app): asks first. |

### Messages

| Tool | What it does |
|---|---|
| `unsend_message` | Delete a message or note the team sent: asks first. |
| `toggle_message_reaction` | Add or remove a tapback (like, heart, question...) on a message. |

### Saved replies

| Tool | What it does |
|---|---|
| `list_saved_replies` | Reusable replies. |
| `create_saved_reply` | Add one. |
| `update_saved_reply` | Change a reply's title, text or shortcut. |
| `delete_saved_reply` | Remove a saved reply: asks first. |

### Conversation types

| Tool | What it does |
|---|---|
| `list_conversation_types` | A project's ticket types with their statuses, intake fields and host actions. |
| `create_conversation_type` | Add a ticket type with its own statuses, fields and actions. |
| `update_conversation_type` | Edit a type; the statuses, fields and actions lists you send replace the old ones. |
| `delete_conversation_type` | Delete a type no conversation uses: asks first. |

### AI assistants

| Tool | What it does |
|---|---|
| `list_assistants` | The AI support assistants, with their settings (never their provider key). |
| `get_assistant` | One assistant, and what it still needs before it answers customers by itself. |
| `create_assistant` | Add an assistant; it starts as a draft with auto-reply off. |
| `update_assistant` | Edit its instructions, model, routing rules or status; turning it live asks first. |
| `delete_assistant` | Remove an assistant and its knowledge assignments: asks first. |
| `duplicate_assistant` | Copy an assistant as a draft (without its key, rules or confidence bar). |
| `list_assistant_assignments` | The knowledge an assistant is given or kept from. |
| `add_assistant_assignment` | Give an assistant a knowledge model, a path or one FAQ, or keep one out. |
| `remove_assistant_assignment` | Take back one grant or exclusion. |
| `get_assistant_knowledge` | The active FAQs an assistant can read right now. |
| `test_assistant_retrieval` | The knowledge an assistant would be given for a question. Saves nothing. |
| `generate_assistant_answer` | The answer an assistant would write for a question (uses AI credits). Saves nothing. |
| `test_assistant_answer` | What an assistant would do with a customer message: answer, hand over or stay silent, and why. |

### Feedback board

| Tool | What it does |
|---|---|
| `list_feedback` | A project's feedback board. |
| `get_feedback_post` | One post with its comments. |
| `update_feedback_post` | Change status, hide, feature or lock a post. |
| `comment_on_feedback_post` | Comment as the team, or leave an internal note. |
| `get_feedback_config` | The board's statuses, types, platforms, tags and options: the keys the other tools accept. |
| `get_roadmap` | The public roadmap as visitors see it. |
| `create_feedback_post` | File a post on the board as the team. |
| `delete_feedback_post` | Delete a post with its votes and comments: asks first. |
| `merge_feedback_post` | Merge a duplicate into another post, moving its votes: asks first. |
| `list_feedback_comments` | A post's comments, including internal notes and hidden ones. |
| `update_feedback_comment` | Hide, make internal or restore a comment, or rewrite its text. |
| `delete_feedback_comment` | Remove a comment: asks first. |
| `list_feedback_participants` | Who can be @mentioned in a post's thread. |

### Planning

| Tool | What it does |
|---|---|
| `list_board_items` | The work board behind the roadmap: cards and epics (filter with `kind`, `epic`, `release`, a changelog release). |
| `create_board_item` | Add an item. Pass your own `clientId` to make it safe to retry: the same one returns the item already created. |
| `create_board_item_from_feedback` | Plan a feedback post: the AI writes the item, the post is linked. |
| `update_board_item` | Edit or move an item. |
| `delete_board_item` | Remove an item and its links: asks first. |
| `link_board_item` | Link or unlink a feedback post, conversation or related item. |
| `list_board_item_history` | An item's edit history: what changed, who changed it and from where. |
| `suggest_board_item_title` | The AI writes a title from a description. Saves nothing. |
| `upload_board_comment_attachment` | Upload an image, file or MP4/MOV video from a public `url` (HelpBites downloads it; use this for large screenshots and recordings) or as base64, and get its download URL, to attach to a comment or an item. |
| `list_board_item_comments` | Read an item's private comments, threaded replies and attachment URLs. |
| `comment_on_board_item` | Add a private comment or threaded reply, optionally with uploaded files. |
| `list_github_refs` | Commits and merged pull requests that mention an item as #12. |

### Changelog: entries

| Tool | What it does |
|---|---|
| `list_changelog_entries` | Changelog entries, drafts included. |
| `create_changelog_entry` | Write an entry: a draft unless told to publish. |
| `update_changelog_entry` | Edit an entry, or publish a draft. |
| `changelog_linked_conversations` | The conversations a changelog entry answers. |
| `reply_to_changelog_conversations` | Tell all of them it shipped. |
| `create_changelog_entries` | Write up to 50 entries at once, skipping commits already written up. |
| `merge_changelog_entries` | Fold 2 to 10 entries into one and archive the sources: asks first. |
| `suggest_changelog_merges` | The AI proposes which of 2 to 100 entries to merge, and the merged text (possibly none). Saves nothing. |
| `delete_changelog_entry` | Delete an entry: asks first. |
| `link_changelog_entry` | Link or unlink a feedback post, board item or conversation an entry ships. |
| `review_changelog_entry` | Approve (publish) or reject a draft entry: asks first before approving. |

### Changelog: AI drafts and email

| Tool | What it does |
|---|---|
| `generate_changelog_from_commits` | Have the AI draft entries from the project's GitHub commits. |
| `get_changelog_generate_run` | The state of the last AI run: running, done or failed, with counts. |
| `run_changelog_notify` | Run the changelog email job now, or as a dry run: asks first. |
| `get_changelog_subscriber_counts` | How many people the changelog emails, by cadence. |

### Changelog: releases

| Tool | What it does |
|---|---|
| `list_changelog_releases` | A project's releases, drafts included. |
| `create_changelog_release` | Create a release (a version that groups entries), a draft by default. |
| `update_changelog_release` | Edit a release: asks first when publishing. |
| `delete_changelog_release` | Delete a release; its entries stay: asks first. |
| `publish_changelog_release` | Publish a release and its draft entries: asks first. |
| `suggest_changelog_release_copy` | The AI proposes a release's headline and intro. Saves nothing. |

### Changelog: reader comments

| Tool | What it does |
|---|---|
| `list_changelog_comments` | The comments under an entry, including hidden ones. |
| `moderate_changelog_comment` | Hide a reader's comment or show it again. |
| `delete_changelog_comment` | Take a comment down for good: asks first. |

### Errors

| Tool | What it does |
|---|---|
| `list_errors` | Issues from the connected error tracker. |
| `get_error` | One issue with its latest event and stack trace. |
| `file_error_on_board` | Turn an error into a board item. |
| `set_error_status` | Open, resolve or close an issue in the tracker and its inbox conversation. |
| `analyze_error` | AI analysis of one error with a suggested fix, or the context to hand to a coding agent. |
| `analyze_errors` | AI triage of all unresolved errors, saved as a report. |
| `list_error_analyses` | The saved analyses and the latest triage report. |
| `list_error_reports` | Saved triage reports, newest first. |
| `delete_error_report` | Remove one saved report: asks first. |
| `get_error_report_schedule` | How often the AI triage runs on its own. |
| `set_error_report_schedule` | Run the AI triage daily, weekly, monthly or never. |
| `get_error_alerts` | The alert rules, who is mailed and the alerts that fired recently. |
| `set_error_alerts` | Replace the alert rules and recipients (send them all): asks first. |
| `get_filed_error` | The board item an error was filed as, if any. |
| `rename_error_link` | Change the label of a tracker project the project reports to. |
| `remove_error_link` | Stop reporting to a tracker project; nothing is deleted in the tracker: asks first. |
| `list_error_providers` | The supported trackers and whether a server is connected for each. |
| `list_error_servers` | The tracker servers of the workspace (never their tokens). |

### Knowledge base: answers

| Tool | What it does |
|---|---|
| `list_knowledge_models` | The knowledge bases, with their ids. |
| `list_faqs` | Knowledge base answers: filter or search. |
| `get_faq` | One answer. |
| `create_faq` | Add a question and answer. |
| `update_faq` | Edit an answer, its tags, keywords, folder or status (draft, active, disabled, archived, outdated). |
| `delete_faq` | Remove one: asks first. |
| `list_knowledge_documents` | Documents uploaded as knowledge sources. |

### Knowledge base: models

| Tool | What it does |
|---|---|
| `get_knowledge_model` | One knowledge base: name, status, language, project. |
| `create_knowledge_model` | Start an empty knowledge base for a project. |
| `update_knowledge_model` | Rename it, change its status (archive instead of deleting), language or description. |
| `delete_knowledge_model` | Delete it with all its FAQs, folders and documents; reports the impact unless confirmed: asks first. |
| `get_knowledge_model_dashboard` | Counts: FAQs by status, folders, documents, what waits for the search index. |
| `duplicate_knowledge_model` | Copy a model with its folders and FAQs (the copies are drafts). |
| `reindex_knowledge_model` | Rebuild the model's search index in the background. |

### Knowledge base: folders

| Tool | What it does |
|---|---|
| `list_knowledge_nodes` | A model's folder tree, flat and nested. |
| `create_knowledge_node` | Add a folder, at the top or under another. |
| `update_knowledge_node` | Rename, move or reorder a folder. |
| `delete_knowledge_node` | Remove a folder; its children and FAQs move up. Reports the impact unless confirmed: asks first. |

### Knowledge base: FAQs in bulk, documents and imports

| Tool | What it does |
|---|---|
| `bulk_update_faqs` | Set the status of, move, tag or delete up to 500 FAQs at once: asks first. |
| `get_knowledge_document` | One uploaded document with its version history and the number of FAQs made from it. |
| `delete_knowledge_document` | Remove a document; its FAQs stay. Reports the impact unless confirmed: asks first. |
| `reprocess_knowledge_document` | Re-read a document's file and update the FAQs made from it. |
| `get_knowledge_import` | Where a document is in its import: status, errors, stats. |
| `commit_knowledge_import` | Create or update FAQs from reviewed entries for an uploaded document. |

### Contacts and segments

| Tool | What it does |
|---|---|
| `list_contacts` | A project's people: filter by segment, tag, subscription, billing or search. |
| `get_contact` | One person, with their plan, MRR, language and tags. |
| `get_contact_activity` | Everything one person has done in one list: conversations, posts, votes, emails, payments, onboarding. |
| `update_contact` | Name, language, tags, email, user id and attributes. Never marketing consent. |
| `list_segments` | Saved segments. |
| `upsert_contacts` | Create a person or update the one who matches (by user id, then email), one at a time or up to 1000. Never subscribes anyone to marketing. |
| `erase_contact` | Erase a person and everything they left in the project: asks first. |
| `create_segment` | Save a filter over the contacts as a segment. |
| `preview_segment` | Count who a filter or segment matches, with a sample. Saves nothing. |
| `update_segment` | Rename a segment or give it a new filter. |
| `delete_segment` | Delete a segment; the contacts stay: asks first. |

### Sequences and campaigns

| Tool | What it does |
|---|---|
| `list_sequences` | Automated email sequences. |
| `enroll_in_sequence` | Put people (or a whole segment) on an active sequence. |
| `list_automation_recipes` | Ready-made sequences started by an event. |
| `install_automation_recipe` | Add a recipe as a draft sequence. |
| `list_campaigns` | A project's email campaigns with their numbers. |
| `get_campaign` | One campaign: numbers, audience size, what stops it sending. |
| `create_campaign` | A draft: template, segment or topic. Sends nothing. |
| `update_campaign` | Edit a draft, or schedule, send, pause or cancel: sending asks first. |
| `get_sequence` | One sequence with its trigger, steps and counts. |
| `create_sequence` | A draft series of emails. Sends nothing until it is activated. |
| `update_sequence` | Edit a sequence, or activate or pause it: activating asks first. |
| `delete_sequence` | Delete a sequence and everyone's place on it: asks first. |
| `list_sequence_enrollments` | Who is on a sequence, where they are and when the next email is due. |
| `delete_campaign` | Delete a campaign that is not sending: asks first. |
| `send_campaign_test` | Send a campaign to up to five addresses as a test: asks first. |

### Lead forms

| Tool | What it does |
|---|---|
| `list_lead_forms` | A project's waitlist and interest forms, with their sign-up numbers. |
| `get_lead_form` | One form: fields, words, look, settings, translations. |
| `create_lead_form` | Add a form from a preset; it is live at once. |
| `update_lead_form` | Change fields, words, look, settings or close the form. |
| `delete_lead_form` | Delete a form; its leads stay contacts: asks first. |
| `translate_lead_form` | Translate a form into other languages with AI. |
| `list_lead_files` | Files people attached through a form, for one person or one form. |
| `delete_lead_file` | Delete one of those files for good: asks first. |

### Onboarding flows

| Tool | What it does |
|---|---|
| `list_onboarding_flows` | A project's onboarding flows, drafts included, with what is published. |
| `get_onboarding_flow` | One flow: steps, style, options, translations. |
| `create_onboarding_flow` | Start a draft flow, with three starter steps unless you send your own. |
| `update_onboarding_flow` | Edit the working copy (steps, look, options, translations). Apps keep the published version. |
| `delete_onboarding_flow` | Delete a flow: asks first. |
| `publish_onboarding_flow` | Make the working copy the version apps get: asks first. |
| `unpublish_onboarding_flow` | Take a flow offline; apps get a 404. |
| `translate_onboarding_flow` | Translate a flow into other languages with AI. |

### Email templates

| Tool | What it does |
|---|---|
| `list_email_templates` | A project's email templates, or the shared masters. |
| `get_email_template` | One template: subject, design, variables. |
| `send_test_email` | Send a template, with sample values, to up to five addresses: asks first. |
| `list_email_starters` | The built-in designs a new template can start from. |
| `create_email_template` | Add a template: from a design, a starter, a blank page, or by linking a master. |
| `update_email_template` | Edit a template's name, key, design, variables, folder or translations. |
| `delete_email_template` | Delete a template: asks first. |
| `duplicate_email_template` | Copy a template. |
| `detach_email_template` | Turn a linked master into the project's own copy: asks first. |
| `share_email_template` | Open or revoke a view or edit link to one template: asks first. |
| `translate_email_template` | Translate a template into other languages with AI. |
| `list_email_chats` | The AI designer chats people had about a template. |
| `get_email_chat` | The messages of one AI designer chat. |
| `delete_email_chat` | Delete an AI designer chat: asks first. |
| `stop_email_chat_turn` | Stop the AI designer while it is answering. |

### Email folders and components

| Tool | What it does |
|---|---|
| `list_email_folders` | The folders that organise a project's (or the masters') templates. |
| `create_email_folder` | Add a folder. |
| `update_email_folder` | Rename a folder or move it into another. |
| `delete_email_folder` | Delete a folder; what is inside moves up: asks first. |
| `list_email_components` | The library of reusable email blocks. |
| `create_email_component` | Save custom HTML with `{{@key}}` fields as a reusable block. |
| `update_email_component` | Edit a block in the library; emails already using it keep their copy. |
| `delete_email_component` | Remove a block from the library: asks first. |

### Email log, totals, settings and suppressions

| Tool | What it does |
|---|---|
| `list_email_logs` | Everything sent or tried: filter by address, template, status, campaign. |
| `list_email_suppressions` | Addresses a project no longer mails. |
| `get_email_log` | One sent message: status, delivery events and its content when kept. |
| `get_email_stats` | Email totals by status, source and day, and the most-sent templates. |
| `delete_email_logs` | Delete log entries older than a date: asks first. |
| `get_email_settings` | How this server sends email: sender, webhook, retention. No secrets. |
| `add_email_suppressions` | Stop a project mailing these addresses. |
| `remove_email_suppression` | Mail an address again: asks first. |

### Transactional email

| Tool | What it does |
|---|---|
| `send_email` | Send a template, your own HTML, a design or a plain message to up to 50 people for a project: asks first. |
| `render_email` | Preview exactly what a send would deliver. Nothing is sent. |
| `preview_email_template` | Render a template by id with its sample values. |

### Pricing tables

| Tool | What it does |
|---|---|
| `list_pricing_tables` | A project's pricing tables. |
| `get_pricing_table` | One table's plans, features, words, look and A/B test. |
| `create_pricing_table` | Start a draft from a template. |
| `update_pricing_table` | Edit plans, features, prices, words, look or translations. |
| `publish_pricing_table` | Make the table live: asks first. |
| `get_stripe_catalog` | Stripe products, prices and payment links to link plans to. |
| `get_pricing_stats` | Views, clicks, purchases and revenue, and the A/B test result. |
| `suggest_pricing` | AI proposal for plans, features and prices, from the repos and Stripe. |
| `add_pricing_variant` | Copy a table to test against it. |
| `start_pricing_experiment` | Start an A/B test: asks first. |
| `stop_pricing_experiment` | End it, optionally keeping the winner. |
| `preview_pricing_table` | See the table as apps would get it, with optional changes applied. Saves nothing. |
| `translate_pricing_table` | AI translation of the working copy into up to eight languages, saved as translations. |
| `unpublish_pricing_table` | Back to a draft; its public URL and checkout links stop working: asks first. |
| `delete_pricing_table` | Remove a table for good: asks first. |

### Revenue and Stripe

| Tool | What it does |
|---|---|
| `get_revenue_report` | Revenue over every connected source: net, MRR, subscribers, months, plans, top customers, recent payments. |
| `sync_revenue_source` | Read Stripe, App Store, Paddle or Lemon Squeezy again now, optionally from the start. |
| `get_testflight_usage` | TestFlight installs, sessions, crashes and feedback per build, from the App Store source. |
| `get_stripe_connection` | Whether Stripe is connected and how the last sync went (never the key). |
| `get_contact_billing` | One person's Stripe customer, subscriptions and payments. |

### Legal documents

| Tool | What it does |
|---|---|
| `list_legal_documents` | A project's legal documents, drafts included. |
| `get_legal_document` | One document with its sections and rule coverage. |
| `update_legal_document` | Edit sections or the summary: asks first when it is published. |
| `publish_legal_document` | Make it public and record a version: asks first. |
| `unpublish_legal_document` | Back to draft. |
| `create_legal_document` | Start a draft from the wizard answers, with AI, blank, or by importing a text you already have. Nothing is public yet. |
| `delete_legal_document` | Remove a document and all its versions: asks first. |
| `check_legal_document` | Check a document against the rulepacks: coverage, and with AI per-requirement findings. |
| `analyse_legal_text` | Read any pasted legal text (or a document) against the rules for its regions. Saves nothing. |
| `suggest_legal_change_note` | AI note for the next version, from what changed since the last published one. |
| `recompose_legal_document` | Re-run the clause composer on the answers, keeping hand-written and locked sections: asks first when it is published. |
| `rewrite_legal_section` | AI rewrite of one section: a proposal by default, saved only with `apply` (asks first on a published document). |
| `generate_legal_tldr` | AI summary for the top of the public page: asks first when it is published. |
| `translate_legal_document` | A new draft of the document in another language, written by AI for review. |
| `list_legal_versions` | The published versions, newest first. |
| `restore_legal_version` | Put a published version back as the working draft, replacing the current text: asks first. |

### Legal wizard and rules

| Tool | What it does |
|---|---|
| `get_legal_wizard` | The wizard's questions for a document type, plus the answers a project already supplies. |
| `preview_legal_document` | Compose sections from answers and see the coverage, without saving or using AI. |
| `suggest_legal_answers` | Suggest wizard answers from the project's GitHub repos, with the evidence for each. |
| `list_legal_clauses` | The reviewed clause library the composer uses. |
| `list_legal_rulepacks` | The requirement checklists the checks are grounded in. |

### Pages

| Tool | What it does |
|---|---|
| `list_cms_entries` | A project's pages and other entries, drafts included, with status and address. |
| `get_cms_entry` | One entry's working copy: its block tree and style. |
| `create_cms_entry` | A draft page, from a template, a block tree or empty. Nothing goes public. |
| `update_cms_entry` | Edit the name, slug, style or the whole block tree of the working copy. |
| `delete_cms_entry` | Remove an entry for good: asks first. |
| `publish_cms_entry` | Make the working copy the live page: asks first. |
| `unpublish_cms_entry` | Take a page offline; the working copy stays. |
| `list_cms_components` | The built-in and the project's own components, with their fields and templates. |
| `get_cms_component` | One of the project's own components. |
| `create_cms_component` | Add a component: its fields and an optional HTML and CSS template. |
| `update_cms_component` | Edit a component (`fields` is the whole list): asks first when pages use it. |
| `delete_cms_component` | Remove a component: asks first. |
| `list_cms_assets` | The files uploaded for pages, with their addresses and alt text. |
| `upload_cms_asset` | Add an image, SVG, video or PDF to the pages' file library, from a public URL or as base64. |
| `update_cms_asset` | Rename a file or change its alt text. |
| `delete_cms_asset` | Remove a file: asks first. |
| `get_cms_settings` | The Pages settings: the preview address and the messaging brief. |
| `update_cms_settings` | Change the preview address or the messaging brief. |
| `list_cms_templates` | The templates a new page can start from. |
| `list_cms_repos` | The linked GitHub repos the assistants can read. |
| `suggest_cms_wizard_answers` | The AI suggests the page wizard's answers from the linked repos. Saves nothing. |

### Blog

| Tool | What it does |
|---|---|
| `list_blog_posts` | A project's blog posts and standalone blog pages: drafts first, then published, scheduled ones marked. |
| `get_blog_post` | One post with its Markdown, rendered HTML, SEO fields and newsletter state. |
| `create_blog_post` | Write a post or page: a draft unless told to publish (publishing asks first). |
| `update_blog_post` | Edit a post, schedule it, or publish or unpublish it: asks first when it goes public or is live. |
| `delete_blog_post` | Remove a post with its comments and reactions: asks first. |
| `send_blog_newsletter` | Email a published post to the subscribers as a campaign, now, scheduled, or as a draft to test first: asks first. |
| `draft_blog_post_with_ai` | The AI proposes a whole post, a continuation, a rewrite, a passage or the title and meta text, from the linked repos. Saves nothing. |
| `list_blog_comments` | The comments on every post for moderation, newest first. |
| `update_blog_comment` | Hide or show a comment (or edit a team comment you wrote). |
| `delete_blog_comment` | Take a comment down for good: asks first. |
| `comment_on_blog_post` | Answer a post or a comment publicly as the team: confirm the wording first. |

### Brand kit

| Tool | What it does |
|---|---|
| `get_brand_kit` | The kit (tagline, about, colours, fonts, guidelines, page settings) and every file in it. |
| `update_brand_kit` | Edit the kit; colours, fonts and guidelines are replaced as whole lists: asks first when the public page is on. |
| `update_brand_asset` | Rename a brand file, change its kind, background, visibility or order. |
| `delete_brand_asset` | Remove a brand file: asks first. |

### Project settings, flags and webhooks

| Tool | What it does |
|---|---|
| `update_project_settings` | A project's Settings: name, site, sender, access, hidden sections, and the feedback, changelog, blog, legal, newsletter, widget, hub, company and style sections. Only what you send changes; lists inside are replaced whole. Asks first. |
| `update_board_settings` | The Planning board: turn it on, its statuses and labels (replaced whole), the public roadmap's layout and whether linked feedback follows item status. Asks first. |
| `update_project_flags` | Replace a project's feature flags (send them all; one left out is deleted). |
| `list_webhook_endpoints` | A project's webhook endpoints. |

### Project setup and infrastructure

| Tool | What it does |
|---|---|
| `get_project_overview` | One project's numbers, setup checklist, what needs attention and latest activity. |
| `get_project_setup` | What is wired up in a project and what is still to do. |
| `get_project_email_setup` | Whether the project's email can send, and whether campaigns can start. |
| `delete_webhook_endpoint` | Remove an endpoint: asks first. |
| `test_webhook_endpoint` | Send a signed `webhook.test` event to an endpoint. |
| `list_webhook_deliveries` | Recent deliveries with their status and errors. |
| `list_project_domains` | Custom domains with their DNS records and check results. |
| `list_inbound_addresses` | The addresses a project receives mail at. |
| `get_project_repos` | The GitHub repos a project reads. |
| `create_cards_with_ai` | Turn pasted text into feedback posts or board items with AI: asks first. |

### GitHub and the workspace

| Tool | What it does |
|---|---|
| `list_github_connections` | The GitHub accounts connected to the workspace (no tokens). |
| `list_github_connection_repos` | The repos one connection can read, to pick from for a project. |
| `get_workspace` | The workspace's name, status and your role in it. |
| `get_usage` | The plan, its limits and features, and what the workspace has used. |
| `get_storage_usage` | Where the workspace's storage goes, by kind of file and by project. |
| `rename_workspace` | Change the workspace's name. |

Try: *"Which conversations are unread? Draft a reply to the one about the failed
export, and show it to me before sending."* Or: *"Suggest plans for our pricing
table from the repo, and show me before you change anything."*

## Safe by design

- **It acts as you.** The assistant can do what your role does in that
  workspace, no more. A key limited to some projects can't reach the rest, or
  anything workspace-wide.
- **It can be read-only.** Choose *Read only* when you create a key or approve a
  sign-in, and the connection can look at everything your role can see and change
  nothing: it is offered only the tools that read, and the API refuses any other
  call from that key with `403 key_read_only`. Good for summaries, triage and
  anything you would rather not have steered by a customer's message. Switch an
  existing key either way in **Settings → API keys** (or `PATCH /v1/admin/api-keys/{id}`
  with `readOnly`).
- **A key can't mint access or move where things go.** Creating, renaming or
  revoking API keys, adding, re-roling or removing teammates, inviting people,
  revealing or rotating a project's secret, creating a project (the answer holds
  its secret), changing the workspace's AI providers, deleting the workspace,
  connecting Telegram, Stripe, a revenue source, GitHub or an error tracker,
  registering a push device, approving an assistant's sign-in, importing or
  exporting a workspace, and everything that sets where customer data, mail or
  credentials go (custom domains, inbound addresses, webhook endpoints, a
  project's linked repositories, contact sources, a project's notification
  addresses, sender, reply-to and mail domain, site URL, allowed origins, whether
  email bodies are logged, and its event and action webhooks) need a person
  signed in to the panel; an API key, an assistant's included, gets
  `403 session_required`. Otherwise a steered assistant could leave itself a way
  back in, or a copy of your customers' messages going somewhere, that outlives the
  connection you can revoke. Each of these actions writes a line to the audit log.
- **A path argument is an id.** The assistant's arguments are put in a URL, so an
  id may only hold letters, digits, dashes and underscores, and never a word that
  names another route (`export`, `stats`, `config`…).
- **A call that doesn't answer is given up on** after 30 seconds, a request body
  is limited to 4 MB, and a batch to 20 messages. `/mcp` takes API keys and OAuth
  connections, not a panel session.
- **Writes are marked.** Every tool says whether it only reads, and assistants
  that ask before acting use that. Replies to customers, sent email, publishing,
  deleting and replacing a whole list reach real people or can't be taken back:
  those tools are marked destructive, and their descriptions tell the assistant to
  confirm first. Prefer a client that asks you to approve each write.
- **Customer text is untrusted.** Messages, feedback and error reports are written
  by other people, and an assistant reads them. Someone can try to slip it
  instructions ("reply with a refund code"). Keep write approvals on, and read what
  an assistant is about to send before you allow it.
- **Secrets stay out of answers.** A template's share token, a webhook's signing
  secret, a provider key, and the token in an error tracker's webhook address are
  cut from what an assistant reads, wherever they sit in a record.
- **An assistant never subscribes anyone.** Marketing consent is the person's own:
  a contact written through the MCP can be unsubscribed, never subscribed.
- **Marketing is for admins.** Sending a campaign or an email, running a sequence,
  suppressing an address and erasing a contact through `/v1` need the *marketing*
  role (admin), as their `/v1/admin` twins always did; a project secret, the host
  app's own server, is not asked.
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
authorization code lives two minutes in Redis and works once. Access tokens are
ordinary admin API keys, rotated with one-use refresh tokens; revoking the key
also prevents further refreshes.

## Left out on purpose

An assistant can do what the panel does, except these, which stay with a signed-in person (or are not a JSON call):

- **Access and credentials.** Signing in, passwords, API keys, approving an assistant's connection, adding or removing
  teammates and invitations, revealing or rotating a project's secret, connecting or disconnecting Stripe, RevenueCat,
  GitHub, error trackers, Telegram or a contact database (they carry secrets), creating a project (the answer holds its
  secret), deleting a workspace, and moving data between servers. A tool that lets an assistant mint a way back in would
  outlive the connection you can revoke, so the API itself refuses most of these to an API key (`403 session_required`).
- **Files and streams.** Uploading or downloading images, logos, brand files and documents, template import and export,
  live event streams, the streaming AI chats of the email designer and Pages, and previews that return rendered HTML.
- **What customers use.** The chat widget, votes, reactions and subscriptions made as a customer, public checkout, the
  public delivery APIs and the webhook receivers.
- **Bulk imports from other systems** (Ghost, other changelogs and feedback tools).

For these, and for anything newer than the tools, the full [API](/_docs/scalar) is the same key's reach; its
[OpenAPI spec](/_docs/openapi.json) lists every route. `tests/mcpCoverage.test.ts` keeps this list honest: a `/v1` route
that has neither a tool nor an entry there fails the test.

## Not built yet

- No prompts, resources or live notifications: the server offers tools.
- A connection has your role, narrowed by a project limit, read-only and an expiry:
  there is no role of its own (say, one that may reply but not publish) yet.
- Section settings (`feedback`, `changelog`, `blog`, `widget`, `legal`, `marketing`, `style`, `hub`) are objects whose keys
  are described in words: the tool schema cannot check what is inside them, the route does.
