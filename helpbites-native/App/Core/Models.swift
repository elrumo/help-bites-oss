import Foundation

struct Agent: Codable, Identifiable, Equatable, Sendable { let id, username, email, name: String }

struct EndUser: Codable, Identifiable, Equatable, Sendable {
  let id, externalId, name, email: String
  let lastSeenAt, createdAt: String?
}

struct ProjectTheme: Codable, Equatable, Sendable { var accent: String?; var dark: Bool? }
/// A project's error tracker (GlitchTip or Bugsink). `dsn` is empty until it is connected.
struct ProjectErrors: Codable, Equatable, Sendable {
  let connected: Bool
  let provider, providerName, dsn, url, alertWebhookUrl: String?
}
struct Project: Codable, Identifiable, Equatable, Sendable {
  let id, publicKey, name, slug, siteUrl, inboxPath, fromName: String
  let allowedOrigins, notifyEmails: [String]
  let theme: ProjectTheme
  let allowAttachments: Bool
  let actionWebhookUrl: String?
  let hasActionWebhookSecret: Bool?
  let createdAt: String?
  /// The custom icon shown wherever the project appears; empty means its initial.
  let iconUrl: String?
  let errors: ProjectErrors?
  /// The project board's settings; nil from a server without boards.
  let board: BoardConfig?
}

struct Attachment: Codable, Equatable, Identifiable, Sendable {
  let url, mime: String
  let size: Int
  var id: String { url }
}

/// One tapback on a message. `actor` is stable per reactor ('user' or 'agent:<id>').
struct MessageReaction: Codable, Equatable, Sendable {
  let emoji, actor, side, actorName, at: String
}

struct ConversationContext: Codable, Equatable, Sendable { let type, id, label: String; let url, thumbnailUrl: String? }
typealias SubjectRef = ConversationContext

struct Conversation: Codable, Identifiable, Equatable, Sendable {
  let id, projectId, endUserId, subject, status: String
  let type, statusCategory, priority, assigneeId: String?
  let tags: [String]?
  let fields: [String: JSONValue]?
  let subjectRef: SubjectRef?
  let doneAt: String?
  let context: ConversationContext?
  let lastMessageAt: String?
  let lastMessagePreview, lastMessageFrom: String
  var unreadByAgent, unreadByUser: Int
  var userReadAt, agentReadAt: String?
  /// Set while the team has archived it; archived threads leave the inbox queue.
  let archivedAt: String?
  let createdAt: String
}

struct Message: Codable, Identifiable, Equatable, Sendable {
  let id, conversationId, sender, senderName, body: String
  let attachments: [Attachment]
  let reactions: [MessageReaction]?
  let context: ConversationContext?
  let replyToId, clientId, createdAt: String
  let visibility, kind: String?
  let event: [String: JSONValue]?
  /// The assistant that wrote it; empty for people.
  let supportAgentId: String?
}

struct ConversationDetail: Codable, Sendable { let conversation: Conversation; let endUser: EndUser; let project: Project }
struct InboxCounts: Codable, Sendable { let status, type, assignee: [String: Int] }
struct InboxResponse: Codable, Sendable { let conversations: [Conversation]; let endUsers: [String: EndUser]; let hasMore: Bool; let totalUnread: Int; let counts: InboxCounts?; let unreadByProject: [String: Int]?; let archivedCount: Int? }
struct MessagePage: Codable, Sendable { let messages: [Message]; let hasMore: Bool }
struct LoginResponse: Codable, Sendable { let sessionToken: String; let agent: Agent }
struct MeResponse: Codable, Sendable { let agent: Agent }
struct SetupStatus: Codable, Sendable { let needsSetup: Bool }

struct SupportEvent: Codable, Sendable {
  let type: String
  let conversationId: String
  let messageId: String?
  let message: Message?
  let conversation: Conversation
}

struct ConversationStatus: Codable, Equatable, Sendable, Identifiable {
  let key, label, category: String
  let isDefault, isTerminal: Bool?
  let reopenTo: String?
  var id: String { key }
}

struct ConversationField: Codable, Equatable, Sendable, Identifiable {
  let key, label, type: String
  let required, `private`: Bool?
  let options: [String]?
  let editableBy: String?
  var id: String { key }
}

struct ConversationAction: Codable, Equatable, Sendable, Identifiable {
  let key, label: String
  let confirm: String?
  let destructive, requiresNote: Bool?
  let statusAfter: String?
  var id: String { key }
}

struct ConversationType: Codable, Equatable, Sendable, Identifiable {
  let id: String?
  let key, name, description, icon: String
  let statuses: [ConversationStatus]
  let fields: [ConversationField]
  let actions: [ConversationAction]
  let assignable, userCanReopen: Bool
  let defaultPriority: String
}

struct SupportAgent: Codable, Equatable, Sendable, Identifiable {
  var id, projectId, name, description, status, systemPrompt, model, endpoint, fallbackBehavior: String
  var temperature: Double
  var autoReply, hasApiKey: Bool
}

struct KnowledgeModel: Codable, Equatable, Sendable, Identifiable {
  var id, projectId, name, slug, description, status, icon, defaultLanguage: String
}

struct KnowledgeNode: Codable, Equatable, Sendable, Identifiable {
  let id, modelId, parentId, name, pathCache: String
}

struct Faq: Codable, Equatable, Sendable, Identifiable {
  let id, modelId, nodeId, question, answer, status, language, origin, pathCache: String
}

enum JSONValue: Codable, Equatable, Sendable {
  case string(String), number(Double), bool(Bool), object([String: JSONValue]), array([JSONValue]), null
  init(from decoder: Decoder) throws {
    let c = try decoder.singleValueContainer()
    if c.decodeNil() { self = .null }
    else if let value = try? c.decode(Bool.self) { self = .bool(value) }
    else if let value = try? c.decode(Double.self) { self = .number(value) }
    else if let value = try? c.decode(String.self) { self = .string(value) }
    else if let value = try? c.decode([String: JSONValue].self) { self = .object(value) }
    else { self = .array(try c.decode([JSONValue].self)) }
  }
  func encode(to encoder: Encoder) throws {
    var c = encoder.singleValueContainer()
    switch self { case .string(let v): try c.encode(v); case .number(let v): try c.encode(v); case .bool(let v): try c.encode(v); case .object(let v): try c.encode(v); case .array(let v): try c.encode(v); case .null: try c.encodeNil() }
  }
  var display: String { switch self { case .string(let v): v; case .number(let v): String(v); case .bool(let v): String(v); case .null: "—"; case .array, .object: "…" } }
}
