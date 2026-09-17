import Foundation

struct ChatMessage: Decodable, Identifiable, Equatable, Sendable {
    let id: String
    let role: String
    let text: String
    let status: String
    let order: Double
    let createdAt: Double

    var isUser: Bool { role == "user" }
}

struct MobileChat: Decodable, Equatable, Sendable {
    let threadId: String?
    let title: String
    let threads: [MobileThread]
    let messages: [ChatMessage]
    let remainingMessages: Double?
}

struct MobileThread: Decodable, Identifiable, Equatable, Sendable {
    let id: String
    let title: String
    let createdAt: Double
}

struct GenerationResult: Decodable, Sendable {
    let threadId: String
    let order: Double
    let promptMessageId: String
}
