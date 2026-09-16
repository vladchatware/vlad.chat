import Foundation

struct ResponseTool: Codable, Equatable, Hashable, Identifiable, Sendable {
    enum Status: String, Codable, Sendable {
        case running, completed, failed, stopped
    }

    let id: String
    let name: String
    let status: Status
    let output: String?
}

struct ResponseActivity: Codable, Equatable, Hashable, Sendable {
    enum Phase: String, Codable, Sendable {
        case waiting, thinking, tool, responding, complete, stopped, failed
    }

    let phase: Phase
    let tools: [ResponseTool]
}

extension ResponseActivity {
    /// Tool rows always render; the bare thinking shimmer only covers the
    /// phases before the answer starts streaming.
    var isDisplayable: Bool {
        if !tools.isEmpty { return true }
        return phase == .waiting || phase == .thinking || phase == .tool
    }
}

struct ChatMessage: Decodable, Identifiable, Equatable, Sendable {
    let id: String
    let role: String
    let text: String
    let status: String
    let order: Double
    let createdAt: Double
    let response: ResponseActivity?

    var isUser: Bool { role == "user" }
}

struct MobileChat: Decodable, Equatable, Sendable {
    let threadId: String?
    let messages: [ChatMessage]
    let account: MobileAccount?
    let remainingMessages: Double?
}

struct MobileAccount: Decodable, Equatable, Sendable {
    let isAnonymous: Bool
    let name: String?
    let email: String?
    let trialMessages: Double
    let trialTokens: Double
    let tokens: Double
}

struct GenerationResult: Decodable, Sendable {
    let threadId: String
    let order: Double
    let promptMessageId: String
}

struct AbortReplyResult: Decodable, Sendable {
    let aborted: Bool
    let failedPending: Double
}

struct DeleteMobileMessagesResult: Decodable, Sendable {
    let deleted: Bool
}
