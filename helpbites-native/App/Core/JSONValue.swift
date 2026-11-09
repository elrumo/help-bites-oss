import Foundation

/// Any JSON value: request bodies built field by field, and values the app only passes along.
/// Compiled into the app and the share extension (the offline outbox stores item fields as these).
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

extension JSONValue {
  var string: String? { if case .string(let value) = self { value } else { nil } }
  var array: [JSONValue]? { if case .array(let value) = self { value } else { nil } }
  var object: [String: JSONValue]? { if case .object(let value) = self { value } else { nil } }

  /// The value read as a Codable type (a list of attachments, a whole item); nil when it does not fit.
  func decoded<Value: Decodable>(_ type: Value.Type) -> Value? {
    (try? JSONEncoder().encode(self)).flatMap { try? JSONDecoder().decode(type, from: $0) }
  }
}
