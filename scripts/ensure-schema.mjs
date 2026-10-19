// Creates every help-bites class with typed fields, master-only CLPs and
// the Mongo indexes the inbox relies on. Parse creates neither on its own:
// `allowClientClassCreation` is off, and Parse never adds indexes for you.
//
// Index keys are spelled the way Mongo stores them (`_p_project` for a
// pointer, `_created_at` for createdAt): Parse hands them to Mongo verbatim.
// That needs `disableIndexFieldValidation` on the Parse database options,
// which docker-compose.yml sets.
//
//   bun scripts/ensure-schema.mjs           # dry run, exits 2 when work is pending
//   bun scripts/ensure-schema.mjs --apply   # create / update
//
// Idempotent. Existing classes keep their data, gain missing fields, and have
// CLPs and indexes re-asserted. The container entrypoint runs it on every boot.

import { assertEnv, parseFetch } from './parseRest.mjs'

const MASTER_ONLY = {}

const CLP_MASTER_ONLY = {
  find: MASTER_ONLY, get: MASTER_ONLY, count: MASTER_ONLY,
  create: MASTER_ONLY, update: MASTER_ONLY, delete: MASTER_ONLY,
  addField: MASTER_ONLY, protectedFields: { '*': [] }
}

const SCHEMAS = {
  // A tenant (server/utils/tenancy.ts). Everything an operator works on
  // belongs to one: a community install usually has just one, the hosted
  // edition one per sign-up.
  Workspace: {
    fields: {
      name: { type: 'String' },
      // active | suspended | deleting | deleted (a tombstone: server/utils/workspaceData.ts)
      status: { type: 'String' },
      deletedAt: { type: 'Date' },
      // The latest data export { at, key, by }.
      lastExport: { type: 'Object' },
      owner: { type: 'Pointer', targetClass: '_User' },
      // Settings that used to be install-wide (error tracker credentials).
      settings: { type: 'Object' },
      // The workspace's own AI provider { endpoint, model, ultraModel, apiKey (sealed) }.
      ai: { type: 'Object' },
      // The cloud edition's plan: a plan given by hand (until compUntil), else the subscription in billing.
      plan: { type: 'String' },
      compPlan: { type: 'String' },
      compUntil: { type: 'Date' },
      billing: { type: 'Object' },
      suspendedReason: { type: 'String' },
      // Bulk mail paused by the reputation guard { at, reason, bounceRate, complaintRate, sends, bounces, complaints },
      // and once staff lift it, resumedAt and resumedBy (server/utils/emailReputation.ts).
      sendingPaused: { type: 'Object' }
    },
    indexes: {
      owner_1: { _p_owner: 1 },
      status_1: { status: 1 },
      // Stripe events name the customer; the cloud edition finds the workspace by it.
      billing_customer: { 'billing.customerId': 1 }
    }
  },
  // A domain a workspace has registered with Mailgun to send from (the cloud
  // edition's custom sending domains). One workspace per domain. `dnsRecords`
  // are the records to add, as the panel shows them: [{ purpose, type, host, value, priority, valid }].
  WorkspaceDomain: {
    fields: {
      workspace: { type: 'Pointer', targetClass: 'Workspace' },
      domain: { type: 'String' },
      // pending | verified | failed
      state: { type: 'String' },
      dnsRecords: { type: 'Array' },
      verifiedAt: { type: 'Date' },
      lastCheckedAt: { type: 'Date' }
    },
    indexes: {
      domain_1: { domain: 1 },
      workspace_1: { _p_workspace: 1 },
      state_1: { state: 1 }
    }
  },
  // Plan counters copied out of Redis (server/utils/usage.ts), one row per
  // workspace, period (2026-10, 2026-10-07 or all) and metric.
  WorkspaceUsage: {
    fields: {
      workspace: { type: 'Pointer', targetClass: 'Workspace' },
      period: { type: 'String' },
      metric: { type: 'String' },
      value: { type: 'Number' }
    },
    indexes: {
      workspace_period: { _p_workspace: 1, period: 1, metric: 1 }
    }
  },
  // What was done to a workspace that matters later (server/utils/audit.ts).
  AuditLog: {
    fields: {
      action: { type: 'String' },
      actor: { type: 'Pointer', targetClass: '_User' },
      actorEmail: { type: 'String' },
      workspace: { type: 'Pointer', targetClass: 'Workspace' },
      target: { type: 'String' },
      data: { type: 'Object' },
      ip: { type: 'String' }
    },
    indexes: {
      workspace_created: { _p_workspace: 1, _created_at: -1 },
      action_created: { action: 1, _created_at: -1 }
    }
  },
  // The background job outbox (server/utils/jobs.ts).
  Job: {
    fields: {
      kind: { type: 'String' },
      workspace: { type: 'Pointer', targetClass: 'Workspace' },
      payload: { type: 'Object' },
      // pending | running | done | dead
      status: { type: 'String' },
      attempts: { type: 'Number' },
      runAt: { type: 'Date' },
      lockedUntil: { type: 'Date' },
      startedAt: { type: 'Date' },
      finishedAt: { type: 'Date' },
      lastError: { type: 'String' },
      dedupeKey: { type: 'String' }
    },
    indexes: {
      status_runAt: { status: 1, runAt: 1 },
      status_locked: { status: 1, lockedUntil: 1 },
      dedupe_status: { dedupeKey: 1, status: 1 },
      status_finished: { status: 1, finishedAt: 1 }
    }
  },
  // Who is in a workspace, and as what (shared/roles.ts). Unique per
  // (workspace, user) by convention: writers hold a Redis lock.
  WorkspaceMember: {
    fields: {
      workspace: { type: 'Pointer', targetClass: 'Workspace' },
      user: { type: 'Pointer', targetClass: '_User' },
      // owner | admin | agent
      role: { type: 'String' }
    },
    indexes: {
      workspace_user: { _p_workspace: 1, _p_user: 1 },
      user_1: { _p_user: 1 }
    }
  },
  // An emailed link into a workspace. Only the token's hash is stored.
  WorkspaceInvite: {
    fields: {
      workspace: { type: 'Pointer', targetClass: 'Workspace' },
      email: { type: 'String' },
      role: { type: 'String' },
      tokenHash: { type: 'String' },
      expiresAt: { type: 'Date' },
      invitedBy: { type: 'Pointer', targetClass: '_User' },
      acceptedAt: { type: 'Date' }
    },
    indexes: {
      tokenHash_1: { tokenHash: 1 },
      workspace_email: { _p_workspace: 1, email: 1 }
    }
  },
  Project: {
    fields: {
      workspace: { type: 'Pointer', targetClass: 'Workspace' },
      name: { type: 'String' },
      slug: { type: 'String' },
      publicKey: { type: 'String' },
      secret: { type: 'String' },
      allowedOrigins: { type: 'Array' },
      siteUrl: { type: 'String' },
      inboxPath: { type: 'String' },
      fromName: { type: 'String' },
      notifyEmails: { type: 'Array' },
      theme: { type: 'Object' },
      allowAttachments: { type: 'Boolean' },
      // Let a person use chat and feedback with only an email address (server/utils/endUserSessions.ts).
      allowAnonymousUsers: { type: 'Boolean' },
      chatNotice: { type: 'String' },
      brandLogoUrl: { type: 'String' },
      assistantLogoUrl: { type: 'String' },
      actionWebhookUrl: { type: 'String' },
      actionWebhookSecret: { type: 'String' },
      feedback: { type: 'Object' },
      // Last allocated feedback post number (atomic increment).
      feedbackPostSeq: { type: 'Number' },
      // The project board (statuses, labels, roadmap options) and its `#N` counter.
      board: { type: 'Object' },
      boardItemSeq: { type: 'Number' },
      // Changelog options (`autoDraft`) and its entries' `#N` counter.
      changelog: { type: 'Object' },
      changelogSeq: { type: 'Number' },
      flags: { type: 'Array' },
      errors: { type: 'Object' },
      // This project's own error tracker URLs and API tokens (see server/utils/errorTracking.ts).
      errorTrackers: { type: 'Object' },
      // Email sending: this project's own sender (blank = the MAILGUN_* defaults).
      fromEmail: { type: 'String' },
      replyTo: { type: 'String' },
      mailDomain: { type: 'String' },
      // Keep a copy of each message's HTML and text on its EmailLog row.
      emailLogContent: { type: 'Boolean' },
      // Newsletter settings (shared/marketing.ts) and the signed event webhook.
      marketing: { type: 'Object' },
      eventWebhookUrl: { type: 'String' },
      eventWebhookSecret: { type: 'String' }
    },
    indexes: {
      publicKey_1: { publicKey: 1 },
      slug_1: { slug: 1 },
      secret_1: { secret: 1 },
      workspace_name: { _p_workspace: 1, name: 1 }
    }
  },
  AdminApiKey: {
    fields: {
      agent: { type: 'Pointer', targetClass: '_User' },
      // The one workspace this key may act in.
      workspace: { type: 'Pointer', targetClass: 'Workspace' },
      name: { type: 'String' },
      hash: { type: 'String' },
      prefix: { type: 'String' },
      // The only projects it may act in; absent = every project and the workspace itself.
      projectIds: { type: 'Array' }
    },
    indexes: { hash_1: { hash: 1 }, workspace_1: { _p_workspace: 1 } }
  },
  // A session of an email-only user: `eu_…` bearer tokens, only the hash is stored.
  EndUserSession: {
    fields: {
      project: { type: 'Pointer', targetClass: 'Project' },
      endUser: { type: 'Pointer', targetClass: 'EndUser' },
      hash: { type: 'String' },
      prefix: { type: 'String' },
      lastUsedAt: { type: 'Date' },
      ip: { type: 'String' },
      ua: { type: 'String' }
    },
    indexes: { hash_1: { hash: 1 }, endUser_1: { _p_endUser: 1 }, project_1: { _p_project: 1 } }
  },
  EndUser: {
    fields: {
      project: { type: 'Pointer', targetClass: 'Project' },
      externalId: { type: 'String' },
      name: { type: 'String' },
      email: { type: 'String' },
      // From the identity token: what feedback boards show and mention by.
      username: { type: 'String' },
      avatarUrl: { type: 'String' },
      // false = opted out of feedback email (status changes, comments, mentions).
      feedbackEmails: { type: 'Boolean' },
      lastSeenAt: { type: 'Date' },
      // The CRM (shared/contacts.ts). An EndUser is a contact: an app user, an
      // imported or synced person, or a newsletter sign-up (no externalId).
      attributes: { type: 'Object' },
      tags: { type: 'Array' },
      // Marketing consent: none | pending | subscribed | unsubscribed.
      subscription: { type: 'String' },
      unsubscribedTopics: { type: 'Array' },
      // { source, at, ip, ua, formUrl, confirmedAt }: the proof of opt-in.
      consent: { type: 'Object' },
      // ContactSource ids this person was synced from.
      sources: { type: 'Array' },
      // Email-only users (server/utils/endUserSessions.ts): `anonymous` rows have
      // an `anon_…` externalId; the address stays in `pendingEmail` until the
      // person proves it with a code, then moves to `email`.
      anonymous: { type: 'Boolean' },
      pendingEmail: { type: 'String' },
      emailVerifiedAt: { type: 'Date' },
      anonWrites: { type: 'Number' },
      verifyCodeHash: { type: 'String' },
      verifyExpiresAt: { type: 'Date' },
      verifyAttempts: { type: 'Number' }
    },
    indexes: {
      project_externalId: { _p_project: 1, externalId: 1 },
      // Lowercased by every writer, so lookups by address are exact.
      project_email: { _p_project: 1, email: 1 },
      project_created: { _p_project: 1, _created_at: -1, _id: -1 },
      project_subscription_id: { _p_project: 1, subscription: 1, _id: 1 },
      project_tags: { _p_project: 1, tags: 1 }
    }
  },
  // The developer's own database, synced into contacts on a schedule
  // (server/utils/contactSources.ts). The credential is sealed with
  // HELPBITES_SECRET; the cursor says where the last run stopped.
  ContactSource: {
    fields: {
      project: { type: 'Pointer', targetClass: 'Project' },
      kind: { type: 'String' },
      name: { type: 'String' },
      config: { type: 'Object' },
      secretSealed: { type: 'String' },
      enabled: { type: 'Boolean' },
      status: { type: 'String' },
      cursor: { type: 'Object' },
      stats: { type: 'Object' },
      lastRunAt: { type: 'Date' },
      nextRunAt: { type: 'Date' },
      lastError: { type: 'String' }
    },
    indexes: {
      project_created: { _p_project: 1, _created_at: -1 },
      enabled_next: { enabled: 1, nextRunAt: 1 }
    }
  },
  // A broadcast: one template to an audience, sent by the worker in chunks
  // (server/utils/campaigns.ts). `snapshot` freezes the design when sending
  // starts; `cursor` is the last contact id sent to. Recipients are EmailLog
  // rows with batchId cm_<id>.
  Campaign: {
    fields: {
      project: { type: 'Pointer', targetClass: 'Project' },
      name: { type: 'String' },
      status: { type: 'String' },
      template: { type: 'String' },
      templateName: { type: 'String' },
      subject: { type: 'String' },
      audience: { type: 'Object' },
      testMode: { type: 'Boolean' },
      snapshot: { type: 'Object' },
      cursor: { type: 'Object' },
      stats: { type: 'Object' },
      scheduledAt: { type: 'Date' },
      startedAt: { type: 'Date' },
      finishedAt: { type: 'Date' },
      nextAt: { type: 'Date' },
      lastError: { type: 'String' }
    },
    indexes: {
      project_created: { _p_project: 1, _created_at: -1 },
      status_scheduled: { status: 1, scheduledAt: 1 }
    }
  },
  // The event webhook's outbox (server/utils/webhooks.ts): one row per event,
  // retried with backoff until delivered or given up on.
  WebhookDelivery: {
    fields: {
      project: { type: 'Pointer', targetClass: 'Project' },
      type: { type: 'String' },
      payload: { type: 'Object' },
      status: { type: 'String' },
      attempts: { type: 'Number' },
      nextAt: { type: 'Date' },
      deliveredAt: { type: 'Date' },
      lastError: { type: 'String' }
    },
    indexes: {
      status_next: { status: 1, nextAt: 1 },
      project_created: { _p_project: 1, _created_at: -1 }
    }
  },
  // An automated series of emails (server/utils/sequences.ts) and who is on it.
  Sequence: {
    fields: {
      project: { type: 'Pointer', targetClass: 'Project' },
      name: { type: 'String' },
      status: { type: 'String' },
      // { type: subscribed | event | manual, topic?, event? }
      trigger: { type: 'Object' },
      // [{ id, delayMinutes, template, subject? }]
      steps: { type: 'Array' },
      enrolledCount: { type: 'Number' },
      completedCount: { type: 'Number' },
      exitedCount: { type: 'Number' },
      activeCount: { type: 'Number' }
    },
    indexes: {
      project_created: { _p_project: 1, _created_at: -1 },
      project_status_trigger: { _p_project: 1, status: 1, 'trigger.type': 1 }
    }
  },
  SequenceEnrollment: {
    fields: {
      project: { type: 'Pointer', targetClass: 'Project' },
      sequence: { type: 'Pointer', targetClass: 'Sequence' },
      contact: { type: 'Pointer', targetClass: 'EndUser' },
      // The index of the next step to send.
      step: { type: 'Number' },
      status: { type: 'String' },
      nextAt: { type: 'Date' },
      lastSentAt: { type: 'Date' },
      lastError: { type: 'String' }
    },
    indexes: {
      status_next: { status: 1, nextAt: 1 },
      // Each project's due steps, read separately so one project can't take a whole tick.
      project_status_next: { _p_project: 1, status: 1, nextAt: 1 },
      sequence_contact: { _p_sequence: 1, _p_contact: 1 },
      contact_1: { _p_contact: 1 }
    }
  },
  // A saved filter over a project's contacts (shared/segments.ts).
  ContactSegment: {
    fields: {
      project: { type: 'Pointer', targetClass: 'Project' },
      name: { type: 'String' },
      filter: { type: 'Object' }
    },
    indexes: { project_created: { _p_project: 1, _created_at: -1 } }
  },
  Conversation: {
    fields: {
      project: { type: 'Pointer', targetClass: 'Project' },
      endUser: { type: 'Pointer', targetClass: 'EndUser' },
      assistantId: { type: 'String' },
      subject: { type: 'String' },
      type: { type: 'String' },
      status: { type: 'String' },
      statusCategory: { type: 'String' },
      doneAt: { type: 'Date' },
      closedAt: { type: 'Date' },
      reopenedAt: { type: 'Date' },
      context: { type: 'Object' },
      subjectRef: { type: 'Object' },
      fields: { type: 'Object' },
      priority: { type: 'String' },
      assignee: { type: 'Pointer', targetClass: '_User' },
      assignedAt: { type: 'Date' },
      tags: { type: 'Array' },
      idempotencyKey: { type: 'String' },
      lastMessageAt: { type: 'Date' },
      lastMessagePreview: { type: 'String' },
      lastMessageFrom: { type: 'String' },
      unreadByAgent: { type: 'Number' },
      unreadByUser: { type: 'Number' },
      userReadAt: { type: 'Date' },
      agentReadAt: { type: 'Date' }
    },
    indexes: {
      project_status_last: { _p_project: 1, status: 1, lastMessageAt: -1 },
      // The workspace inbox: every project's conversations, newest first, and its unread badge.
      project_last: { _p_project: 1, lastMessageAt: -1 },
      project_unread: { _p_project: 1, unreadByAgent: 1 },
      project_type_status_last: { _p_project: 1, type: 1, status: 1, lastMessageAt: -1 },
      project_idempotency: { _p_project: 1, idempotencyKey: 1 },
      assignee_status: { _p_assignee: 1, status: 1 },
      endUser_last: { _p_endUser: 1, lastMessageAt: -1 }
    }
  },
  ConversationType: {
    fields: {
      project: { type: 'Pointer', targetClass: 'Project' },
      key: { type: 'String' }, name: { type: 'String' }, description: { type: 'String' }, icon: { type: 'String' },
      statuses: { type: 'Array' }, fields: { type: 'Array' }, actions: { type: 'Array' },
      assignable: { type: 'Boolean' }, userCanReopen: { type: 'Boolean' }, defaultPriority: { type: 'String' }
    },
    indexes: { project_key: { _p_project: 1, key: 1 } }
  },
  // --- Knowledge: models, the path tree, FAQs and their source documents. ---
  // Ordered before Message so Message.supportAgent's target exists on a fresh
  // apply, and each pointer's target class is created before its referrer.
  KnowledgeModel: {
    fields: {
      workspace: { type: 'Pointer', targetClass: 'Workspace' },
      project: { type: 'Pointer', targetClass: 'Project' },
      name: { type: 'String' },
      slug: { type: 'String' },
      description: { type: 'String' },
      status: { type: 'String' },
      icon: { type: 'String' },
      defaultLanguage: { type: 'String' },
      metadata: { type: 'Object' },
      createdBy: { type: 'Pointer', targetClass: '_User' }
    },
    indexes: {
      project_1: { _p_project: 1 },
      workspace_project: { _p_workspace: 1, _p_project: 1 },
      slug_1: { slug: 1 },
      status_1: { status: 1 }
    }
  },
  KnowledgeNode: {
    fields: {
      knowledgeModel: { type: 'Pointer', targetClass: 'KnowledgeModel' },
      parent: { type: 'Pointer', targetClass: 'KnowledgeNode' },
      name: { type: 'String' },
      slug: { type: 'String' },
      description: { type: 'String' },
      order: { type: 'Number' },
      depth: { type: 'Number' },
      pathCache: { type: 'String' }
    },
    indexes: {
      model_parent_order: { _p_knowledgeModel: 1, _p_parent: 1, order: 1 },
      model_path: { _p_knowledgeModel: 1, pathCache: 1 }
    }
  },
  KnowledgeDocument: {
    fields: {
      knowledgeModel: { type: 'Pointer', targetClass: 'KnowledgeModel' },
      node: { type: 'Pointer', targetClass: 'KnowledgeNode' },
      filename: { type: 'String' },
      originalFilename: { type: 'String' },
      mimeType: { type: 'String' },
      size: { type: 'Number' },
      storageKey: { type: 'String' },
      status: { type: 'String' },
      checksum: { type: 'String' },
      lineageId: { type: 'String' },
      version: { type: 'Number' },
      isCurrent: { type: 'Boolean' },
      uploadedBy: { type: 'Pointer', targetClass: '_User' },
      processedAt: { type: 'Date' },
      processingError: { type: 'String' },
      importStats: { type: 'Object' },
      metadata: { type: 'Object' }
    },
    indexes: {
      model_current: { _p_knowledgeModel: 1, isCurrent: 1 },
      lineage_version: { lineageId: 1, version: -1 },
      checksum_1: { checksum: 1 }
    }
  },
  Faq: {
    fields: {
      knowledgeModel: { type: 'Pointer', targetClass: 'KnowledgeModel' },
      node: { type: 'Pointer', targetClass: 'KnowledgeNode' },
      question: { type: 'String' },
      answer: { type: 'String' },
      language: { type: 'String' },
      status: { type: 'String' },
      tags: { type: 'Array' },
      aliases: { type: 'Array' },
      keywords: { type: 'Array' },
      origin: { type: 'String' },
      sourceDocument: { type: 'Pointer', targetClass: 'KnowledgeDocument' },
      sourceSection: { type: 'String' },
      sourceVersion: { type: 'Number' },
      importKey: { type: 'String' },
      normalizedQuestion: { type: 'String' },
      detached: { type: 'Boolean' },
      needsReindex: { type: 'Boolean' },
      indexedAt: { type: 'Date' },
      metadata: { type: 'Object' },
      createdBy: { type: 'Pointer', targetClass: '_User' },
      lastProcessedAt: { type: 'Date' }
    },
    indexes: {
      model_status: { _p_knowledgeModel: 1, status: 1 },
      model_importKey: { _p_knowledgeModel: 1, importKey: 1 },
      model_normalized: { _p_knowledgeModel: 1, normalizedQuestion: 1 },
      node_1: { _p_node: 1 }
    }
  },
  SupportAgent: {
    fields: {
      workspace: { type: 'Pointer', targetClass: 'Workspace' },
      project: { type: 'Pointer', targetClass: 'Project' },
      name: { type: 'String' },
      slug: { type: 'String' },
      description: { type: 'String' },
      status: { type: 'String' },
      systemPrompt: { type: 'String' },
      model: { type: 'String' },
      endpoint: { type: 'String' },
      apiKey: { type: 'String' },
      temperature: { type: 'Number' },
      autoReply: { type: 'Boolean' },
      fallbackBehavior: { type: 'String' },
      minConfidence: { type: 'Number' },
      rules: { type: 'Array' },
      defaultAction: { type: 'String' },
      createdBy: { type: 'Pointer', targetClass: '_User' }
    },
    indexes: {
      slug_1: { slug: 1 },
      project_1: { _p_project: 1 },
      workspace_project: { _p_workspace: 1, _p_project: 1 }
    }
  },
  AgentKnowledgeAssignment: {
    fields: {
      supportAgent: { type: 'Pointer', targetClass: 'SupportAgent' },
      knowledgeModel: { type: 'Pointer', targetClass: 'KnowledgeModel' },
      node: { type: 'Pointer', targetClass: 'KnowledgeNode' },
      faq: { type: 'Pointer', targetClass: 'Faq' },
      scope: { type: 'String' },
      exclude: { type: 'Boolean' }
    },
    indexes: {
      agent_1: { _p_supportAgent: 1 }
    }
  },
  Message: {
    fields: {
      project: { type: 'Pointer', targetClass: 'Project' },
      conversation: { type: 'Pointer', targetClass: 'Conversation' },
      sender: { type: 'String' },
      senderName: { type: 'String' },
      agent: { type: 'Pointer', targetClass: '_User' },
      supportAgent: { type: 'Pointer', targetClass: 'SupportAgent' },
      body: { type: 'String' },
      attachments: { type: 'Array' },
      reactions: { type: 'Array' },
      context: { type: 'Object' },
      replyToId: { type: 'String' },
      clientId: { type: 'String' },
      visibility: { type: 'String' },
      kind: { type: 'String' },
      event: { type: 'Object' }
    },
    indexes: {
      conversation_createdAt: { _p_conversation: 1, _created_at: 1 },
      conversation_clientId: { _p_conversation: 1, clientId: 1 }
    }
  },
  // --- Feedback boards: public posts, one vote row per voter, comments. ---
  // Authors and voters are the host's own user ids (`EndUser.externalId`), so
  // imported history keeps its votes without an EndUser row per voter.
  FeedbackPost: {
    fields: {
      project: { type: 'Pointer', targetClass: 'Project' },
      externalId: { type: 'String' },
      number: { type: 'Number' },
      title: { type: 'String' },
      body: { type: 'String' },
      type: { type: 'String' },
      platform: { type: 'String' },
      tags: { type: 'Array' },
      status: { type: 'String' },
      voteCount: { type: 'Number' },
      commentCount: { type: 'Number' },
      authorExternalId: { type: 'String' },
      authorName: { type: 'String' },
      authorIsTeam: { type: 'Boolean' },
      endUser: { type: 'Pointer', targetClass: 'EndUser' },
      agent: { type: 'Pointer', targetClass: '_User' },
      hidden: { type: 'Boolean' },
      featured: { type: 'Boolean' },
      locked: { type: 'Boolean' },
      showOnChangelog: { type: 'Boolean' },
      changelogTitle: { type: 'String' },
      changelogBody: { type: 'String' },
      shippedIn: { type: 'String' },
      icon: { type: 'String' },
      metadata: { type: 'Object' },
      adminNote: { type: 'String' },
      pinnedCommentId: { type: 'String' },
      duplicateOf: { type: 'Pointer', targetClass: 'FeedbackPost' },
      // `#N` numbers the body mentions — what backlinks are found by.
      refs: { type: 'Array' },
      // "<reaction key>:<actor id>" strings, toggled with $addToSet / $pull.
      reactions: { type: 'Array' },
      editedAt: { type: 'Date' },
      postedAt: { type: 'Date' },
      completedAt: { type: 'Date' },
      statusChangedAt: { type: 'Date' },
      lastActivityAt: { type: 'Date' }
    },
    indexes: {
      project_postedAt: { _p_project: 1, postedAt: -1 },
      project_votes: { _p_project: 1, voteCount: -1 },
      project_status: { _p_project: 1, status: 1 },
      project_externalId: { _p_project: 1, externalId: 1 },
      project_author: { _p_project: 1, authorExternalId: 1 },
      project_number: { _p_project: 1, number: 1 },
      project_tags: { _p_project: 1, tags: 1 },
      project_refs: { _p_project: 1, refs: 1 }
    }
  },
  FeedbackVote: {
    fields: {
      project: { type: 'Pointer', targetClass: 'Project' },
      post: { type: 'Pointer', targetClass: 'FeedbackPost' },
      voterId: { type: 'String' }
    },
    indexes: {
      post_voter: { _p_post: 1, voterId: 1 },
      project_voter: { _p_project: 1, voterId: 1 }
    }
  },
  FeedbackComment: {
    fields: {
      project: { type: 'Pointer', targetClass: 'Project' },
      post: { type: 'Pointer', targetClass: 'FeedbackPost' },
      externalId: { type: 'String' },
      body: { type: 'String' },
      // One level of threading: parentId is a top-level comment, replyToId the one answered.
      parentId: { type: 'String' },
      replyToId: { type: 'String' },
      // public (unset) | internal (team-only note) | hidden (moderated)
      visibility: { type: 'String' },
      refs: { type: 'Array' },
      reactions: { type: 'Array' },
      authorExternalId: { type: 'String' },
      authorName: { type: 'String' },
      authorIsTeam: { type: 'Boolean' },
      endUser: { type: 'Pointer', targetClass: 'EndUser' },
      agent: { type: 'Pointer', targetClass: '_User' },
      editedAt: { type: 'Date' },
      postedAt: { type: 'Date' }
    },
    indexes: {
      post_postedAt: { _p_post: 1, postedAt: 1 },
      post_externalId: { _p_post: 1, externalId: 1 },
      project_author: { _p_project: 1, authorExternalId: 1 },
      project_refs: { _p_project: 1, refs: 1 }
    }
  },
  // Who follows a post: authors, commenters and mentioned users join on their
  // own; status and comment emails go to the unmuted ones.
  FeedbackSubscription: {
    fields: {
      project: { type: 'Pointer', targetClass: 'Project' },
      post: { type: 'Pointer', targetClass: 'FeedbackPost' },
      subscriberId: { type: 'String' },
      muted: { type: 'Boolean' },
      lastReadAt: { type: 'Date' }
    },
    indexes: {
      post_subscriber: { _p_post: 1, subscriberId: 1 },
      project_subscriber: { _p_project: 1, subscriberId: 1 }
    }
  },
  // --- Project board: Linear-style items on a kanban. Public items in a
  // planned/active/done status make the roadmap. Links to posts and
  // conversations are id arrays changed with $addToSet / $pull; ids that no
  // longer resolve are skipped on read. ---
  BoardItem: {
    fields: {
      project: { type: 'Pointer', targetClass: 'Project' },
      number: { type: 'Number' },
      title: { type: 'String' },
      // Internal Markdown; never public.
      description: { type: 'String' },
      // The only text the roadmap shows; never falls back to `description`.
      publicDescription: { type: 'String' },
      status: { type: 'String' },
      rank: { type: 'Number' },
      // '' | low | normal | high | urgent
      priority: { type: 'String' },
      assignee: { type: 'Pointer', targetClass: '_User' },
      labels: { type: 'Array' },
      targetDate: { type: 'Date' },
      public: { type: 'Boolean' },
      feedbackPostIds: { type: 'Array' },
      conversationIds: { type: 'Array' },
      completedAt: { type: 'Date' }
    },
    indexes: {
      project_status_rank: { _p_project: 1, status: 1, rank: 1 },
      project_number: { _p_project: 1, number: 1 },
      project_posts: { _p_project: 1, feedbackPostIds: 1 },
      project_conversations: { _p_project: 1, conversationIds: 1 }
    }
  },
  // --- Changelog: what shipped, written for the public. An entry is linked to
  // the feedback posts, board items and conversations (tickets and error
  // issues) it answers, as id arrays like BoardItem; ids that no longer
  // resolve are skipped on read. Nothing public until an entry is published
  // and its release (if any) is too. ---
  ChangelogRelease: {
    fields: {
      project: { type: 'Pointer', targetClass: 'Project' },
      // Free text: "2.4", "2026.10"…
      version: { type: 'String' },
      title: { type: 'String' },
      summary: { type: 'String' },
      // draft | published
      status: { type: 'String' },
      publishedAt: { type: 'Date' }
    },
    indexes: {
      project_publishedAt: { _p_project: 1, publishedAt: -1 }
    }
  },
  ChangelogEntry: {
    fields: {
      project: { type: 'Pointer', targetClass: 'Project' },
      number: { type: 'Number' },
      title: { type: 'String' },
      // The entry's URL key: stable, unique within the project (checked on write, Parse can't index
      // that), claimed for good even once the entry is archived.
      slug: { type: 'String' },
      summary: { type: 'String' },
      // What was written: Markdown (the default) or HTML. `bodyHtml` is it rendered and sanitised
      // once, on write; `excerpt` a plain-text lead-in.
      body: { type: 'String' },
      bodyFormat: { type: 'String' },
      bodyHtml: { type: 'String' },
      excerpt: { type: 'String' },
      // new | improved | fix | removed | breaking
      tag: { type: 'String' },
      // The part of the product it touches (limited to `Project.changelog.areas` when that lists any).
      area: { type: 'String' },
      release: { type: 'Pointer', targetClass: 'ChangelogRelease' },
      // draft | published | archived
      status: { type: 'String' },
      publishedAt: { type: 'Date' },
      pinned: { type: 'Boolean' },
      iconGlyph: { type: 'String' },
      accentColor: { type: 'String' },
      imageUrl: { type: 'String' },
      // [{ label, url }] shown to readers (not the sources the entry was made from).
      links: { type: 'Array' },
      feedbackPostIds: { type: 'Array' },
      boardItemIds: { type: 'Array' },
      conversationIds: { type: 'Array' },
      // Full SHAs of the git commits the entry describes (the `helpbites` CLI).
      commitShas: { type: 'Array' },
      // The caller's own id for the entry (an import's key).
      externalId: { type: 'String' },
      // Review of a draft: pending | approved | rejected, and who/when/why.
      reviewStatus: { type: 'String' },
      reviewedBy: { type: 'String' },
      reviewedAt: { type: 'Date' },
      reviewNotes: { type: 'String' },
      authorName: { type: 'String' },
      // admin | internal (written with the project secret)
      source: { type: 'String' },
      commentCount: { type: 'Number' },
      // Subscribers' mail: stamped when an entry is published (never from an import), cleared
      // by stamping `notifiedAt` once the sweep has told them. Not `publishedAt`: that can be backdated.
      notifyPendingSince: { type: 'Date' },
      notifiedAt: { type: 'Date' }
    },
    indexes: {
      project_notify: { _p_project: 1, status: 1, notifyPendingSince: 1 },
      project_slug: { _p_project: 1, slug: 1 },
      project_externalId: { _p_project: 1, externalId: 1 },
      project_status_publishedAt: { _p_project: 1, status: 1, publishedAt: -1 },
      project_release: { _p_project: 1, _p_release: 1 },
      project_number: { _p_project: 1, number: 1 },
      project_posts: { _p_project: 1, feedbackPostIds: 1 },
      project_board_items: { _p_project: 1, boardItemIds: 1 },
      project_conversations: { _p_project: 1, conversationIds: 1 },
      project_commits: { _p_project: 1, commitShas: 1 }
    }
  },
  // Readers' comments on a published entry. Authored by the host's own user id (the identity
  // token's `sub`), like feedback; `bodyHtml` is the Markdown rendered with the strict comment
  // allowlist, once, on write. `postedAt` is the date shown (an import keeps the original).
  ChangelogComment: {
    fields: {
      project: { type: 'Pointer', targetClass: 'Project' },
      entry: { type: 'Pointer', targetClass: 'ChangelogEntry' },
      body: { type: 'String' },
      bodyHtml: { type: 'String' },
      // visible | hidden | deleted
      status: { type: 'String' },
      postedAt: { type: 'Date' },
      editedAt: { type: 'Date' },
      endUser: { type: 'Pointer', targetClass: 'EndUser' },
      authorExternalId: { type: 'String' },
      authorName: { type: 'String' },
      authorAvatar: { type: 'String' },
      authorIsStaff: { type: 'Boolean' },
      externalId: { type: 'String' }
    },
    indexes: {
      entry_status_posted: { _p_entry: 1, status: 1, postedAt: 1 },
      author_recent: { _p_project: 1, authorExternalId: 1, postedAt: -1 },
      project_externalId: { _p_project: 1, externalId: 1 }
    }
  },
  // Who is emailed about the changelog. One row per address; an unsubscribed row stays as the suppression record.
  ChangelogSubscription: {
    fields: {
      project: { type: 'Pointer', targetClass: 'Project' },
      email: { type: 'String' },
      // The host's id for the person, when they subscribed signed in.
      userId: { type: 'String' },
      displayName: { type: 'String' },
      // instant | weekly
      frequency: { type: 'String' },
      // What an anonymous subscriber asked for; applied by the confirm click.
      pendingFrequency: { type: 'String' },
      // pending | active | unsubscribed
      status: { type: 'String' },
      // user | anonymous
      source: { type: 'String' },
      confirmedAt: { type: 'Date' },
      unsubscribedAt: { type: 'Date' },
      confirmSentAt: { type: 'Date' },
      // The id it had in the system it was imported from (`parse:<id>`): links sent from there still work.
      externalId: { type: 'String' }
    },
    indexes: {
      project_email: { _p_project: 1, email: 1 },
      project_status_frequency: { _p_project: 1, status: 1, frequency: 1 },
      project_user: { _p_project: 1, userId: 1 },
      project_externalId: { _p_project: 1, externalId: 1 },
      project_confirm: { _p_project: 1, confirmSentAt: -1 }
    }
  },
  // The ledger of sends: what stops a tick (or a second instance) mailing the same week twice.
  ChangelogNotifyRun: {
    fields: {
      project: { type: 'Pointer', targetClass: 'Project' },
      // instant | weekly
      kind: { type: 'String' },
      // sending | sent | abandoned
      status: { type: 'String' },
      entryIds: { type: 'Array' },
      windowStart: { type: 'Date' },
      windowEnd: { type: 'Date' },
      startedAt: { type: 'Date' },
      finishedAt: { type: 'Date' },
      recipientCount: { type: 'Number' },
      imported: { type: 'Boolean' }
    },
    indexes: {
      project_kind_status: { _p_project: 1, kind: 1, status: 1 },
      project_window: { _p_project: 1, kind: 1, windowEnd: -1 }
    }
  },
  // --- Email templates. No project = a master; `master` set = a project's
  // link to one (no document of its own, only its variable values). ---
  EmailFolder: {
    fields: {
      workspace: { type: 'Pointer', targetClass: 'Workspace' },
      project: { type: 'Pointer', targetClass: 'Project' },
      parent: { type: 'Pointer', targetClass: 'EmailFolder' },
      name: { type: 'String' }
    },
    indexes: { project_1: { _p_project: 1 }, workspace_project: { _p_workspace: 1, _p_project: 1 } }
  },
  // The component library: custom HTML with `{{@key}}` fields, reused across
  // emails. No project = shared by every project and master in its workspace. Templates keep
  // their own copy of what they insert, so nothing points back here.
  EmailComponent: {
    fields: {
      workspace: { type: 'Pointer', targetClass: 'Workspace' },
      project: { type: 'Pointer', targetClass: 'Project' },
      name: { type: 'String' },
      description: { type: 'String' },
      html: { type: 'String' },
      // [{ key, label, type, group, default }]
      fields: { type: 'Array' }
    },
    indexes: { project_1: { _p_project: 1 }, workspace_project: { _p_workspace: 1, _p_project: 1 } }
  },
  EmailTemplate: {
    fields: {
      workspace: { type: 'Pointer', targetClass: 'Workspace' },
      project: { type: 'Pointer', targetClass: 'Project' },
      master: { type: 'Pointer', targetClass: 'EmailTemplate' },
      folder: { type: 'Pointer', targetClass: 'EmailFolder' },
      key: { type: 'String' },
      name: { type: 'String' },
      description: { type: 'String' },
      document: { type: 'Object' },
      variables: { type: 'Array' },
      // [{ key, value }]: variable keys may contain dots, which Parse refuses as object keys.
      values: { type: 'Array' },
      shareToken: { type: 'String' },
      shareMode: { type: 'String' },
      // A share link without one (shared before links expired) counts as expired.
      shareExpiresAt: { type: 'Date' },
      // { at, ip } of the last save made through an edit link.
      lastSharedEdit: { type: 'Object' },
      lastActorId: { type: 'String' }
    },
    indexes: {
      project_key: { _p_project: 1, key: 1 },
      master_1: { _p_master: 1 },
      shareToken_1: { shareToken: 1 },
      workspace_project: { _p_workspace: 1, _p_project: 1 }
    }
  },
  // The AI designer's conversation per template (UI message parts, as sent).
  EmailChatMessage: {
    fields: {
      template: { type: 'Pointer', targetClass: 'EmailTemplate' },
      // Which of the template's chats; none on rows from before there were several.
      chatId: { type: 'String' },
      clientId: { type: 'String' },
      role: { type: 'String' },
      // JSON text: tool inputs can carry keys Parse refuses in nested objects.
      content: { type: 'String' },
      tier: { type: 'String' },
      agent: { type: 'Pointer', targetClass: '_User' }
    },
    indexes: { template_created: { _p_template: 1, _created_at: 1 }, template_chat_created: { _p_template: 1, chatId: 1, _created_at: 1 } }
  },
  // One row per message sent (or skipped): the send API, test sends and the
  // app's own notifications. Delivery webhooks move `status` on and append to
  // `events`. No project and no workspace = HelpBites' own mail (password
  // resets, invitations).
  EmailLog: {
    fields: {
      // Set on mail a workspace sends without a project (master template tests).
      workspace: { type: 'Pointer', targetClass: 'Workspace' },
      project: { type: 'Pointer', targetClass: 'Project' },
      template: { type: 'Pointer', targetClass: 'EmailTemplate' },
      // Snapshots: the template may be renamed or deleted later.
      templateKey: { type: 'String' },
      templateName: { type: 'String' },
      // Shared by every recipient of one API call.
      batchId: { type: 'String' },
      source: { type: 'String' },
      kind: { type: 'String' },
      // Lowercased, so lookups by address are exact.
      to: { type: 'String' },
      toName: { type: 'String' },
      cc: { type: 'Array' },
      bcc: { type: 'Array' },
      from: { type: 'String' },
      replyTo: { type: 'String' },
      subject: { type: 'String' },
      status: { type: 'String' },
      error: { type: 'String' },
      // Mailgun's id for the message: what delivery webhooks name it by.
      messageId: { type: 'String' },
      tags: { type: 'Array' },
      metadata: { type: 'Object' },
      // [{ key, value }], sensitive values redacted.
      variables: { type: 'Array' },
      attachments: { type: 'Array' },
      headerNames: { type: 'Array' },
      events: { type: 'Array' },
      lastEventAt: { type: 'Date' },
      scheduledAt: { type: 'Date' },
      testMode: { type: 'Boolean' },
      idempotencyKey: { type: 'String' },
      actorType: { type: 'String' },
      actorId: { type: 'String' },
      actorName: { type: 'String' },
      ip: { type: 'String' },
      userAgent: { type: 'String' },
      durationMs: { type: 'Number' },
      // The message itself, only when the project keeps content (Project.emailLogContent).
      hasContent: { type: 'Boolean' },
      html: { type: 'String' },
      text: { type: 'String' }
    },
    indexes: {
      project_created: { _p_project: 1, _created_at: -1 },
      project_status_created: { _p_project: 1, status: 1, _created_at: -1 },
      project_to_created: { _p_project: 1, to: 1, _created_at: -1 },
      project_key_created: { _p_project: 1, templateKey: 1, _created_at: -1 },
      template_created: { _p_template: 1, _created_at: -1 },
      messageId_1: { messageId: 1 },
      batch_to: { batchId: 1, to: 1 },
      created_1: { _created_at: -1 },
      workspace_created: { _p_workspace: 1, _created_at: -1 }
    }
  },
  // Addresses a project no longer mails: hard bounces and spam complaints
  // (from the delivery webhook), unsubscribes, or added by hand or by API.
  EmailSuppression: {
    fields: {
      project: { type: 'Pointer', targetClass: 'Project' },
      email: { type: 'String' },
      reason: { type: 'String' },
      detail: { type: 'String' },
      source: { type: 'String' }
    },
    indexes: {
      project_email: { _p_project: 1, email: 1 },
      project_created: { _p_project: 1, _created_at: -1 }
    }
  },
  Device: {
    fields: {
      agent: { type: 'Pointer', targetClass: '_User' },
      token: { type: 'String' },
      platform: { type: 'String' },
      env: { type: 'String' }
    },
    indexes: {
      token_1: { token: 1 },
      agent_1: { _p_agent: 1 }
    }
  }
}

// Agents are plain _User rows; nobody but the app may create or read them.
const USER_CLP = { ...CLP_MASTER_ONLY }

const RESERVED = new Set(['objectId', 'createdAt', 'updatedAt', 'ACL'])

function missingFields(existing, wanted) {
  const out = {}
  for (const [name, def] of Object.entries(wanted)) {
    if (RESERVED.has(name)) continue
    if (!existing?.[name]) out[name] = def
  }
  return out
}

// Indexes to add, and stale ones (same name, different keys) to drop first.
// Parse refuses to update an index in place, so a change is a delete + add.
function indexChanges(existing, wanted) {
  const add = {}
  const drop = {}
  for (const [name, def] of Object.entries(wanted)) {
    const current = existing?.[name]
    if (!current) {
      add[name] = def
    } else if (JSON.stringify(stable(current)) !== JSON.stringify(stable(def))) {
      drop[name] = { __op: 'Delete' }
      add[name] = def
    }
  }
  return { add, drop }
}

// Parse returns the CLP keys in its own order; compare structurally.
function stable(value) {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]))
  }
  return value
}

function clpDiffers(existing, wanted) {
  return JSON.stringify(stable(existing || {})) !== JSON.stringify(stable(wanted))
}

async function ensureClass(className, definition, apply) {
  const wantedClp = className === '_User' ? USER_CLP : CLP_MASTER_ONLY
  const current = await parseFetch(`/schemas/${className}`)
  const exists = current.ok || current.body?.className === className

  if (!exists) {
    console.log(`+ ${className}: create (${Object.keys(definition.fields).length} fields, ${Object.keys(definition.indexes || {}).length} indexes)`)
    if (!apply) return true
    const res = await parseFetch('/schemas', {
      method: 'POST',
      body: JSON.stringify({ className, fields: definition.fields, classLevelPermissions: wantedClp, indexes: definition.indexes })
    })
    if (!res.ok) throw new Error(`create ${className} failed: ${res.body?.error || res.status}`)
    return true
  }

  const fields = missingFields(current.body.fields, definition.fields)
  const { add: indexes, drop } = indexChanges(current.body.indexes, definition.indexes || {})
  const clp = clpDiffers(current.body.classLevelPermissions, wantedClp)
  const pending = Object.keys(fields).length || Object.keys(indexes).length || clp
  if (!pending) {
    console.log(`= ${className}: up to date`)
    return false
  }

  console.log(`~ ${className}: ${Object.keys(fields).length} field(s), ${Object.keys(indexes).length} index(es)${Object.keys(drop).length ? ` (${Object.keys(drop).length} replaced)` : ''}${clp ? ', CLP' : ''}`)
  if (!apply) return true
  if (Object.keys(drop).length) {
    const dropped = await parseFetch(`/schemas/${className}`, { method: 'PUT', body: JSON.stringify({ className, indexes: drop }) })
    if (!dropped.ok) throw new Error(`drop indexes on ${className} failed: ${dropped.body?.error || dropped.status}`)
  }
  const res = await parseFetch(`/schemas/${className}`, {
    method: 'PUT',
    body: JSON.stringify({ className, fields, indexes, classLevelPermissions: wantedClp })
  })
  if (!res.ok) throw new Error(`update ${className} failed: ${res.body?.error || res.status}`)
  return true
}

async function main() {
  assertEnv()
  const apply = process.argv.includes('--apply')
  let pending = false
  for (const [className, definition] of Object.entries(SCHEMAS)) {
    pending = (await ensureClass(className, definition, apply)) || pending
  }
  // emailVerifiedAt: when they confirmed their address (editions that ask for it, server/utils/tenancy.ts).
  pending = (await ensureClass('_User', { fields: { name: { type: 'String' }, defaultWorkspace: { type: 'Pointer', targetClass: 'Workspace' }, emailVerifiedAt: { type: 'Date' } }, indexes: {} }, apply)) || pending

  if (!apply && pending) {
    console.log('\nPending changes. Re-run with --apply.')
    process.exit(2)
  }
  console.log(apply ? '\nSchema applied.' : '\nSchema up to date.')
}

main().catch((error) => {
  console.error(error.message || error)
  process.exit(1)
})
