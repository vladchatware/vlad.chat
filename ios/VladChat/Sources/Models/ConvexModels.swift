import ConvexMobile
import Foundation

struct ChatMessage: Decodable, Identifiable, Equatable, Sendable {
    let id: String
    let role: String
    let text: String
    let status: String
    let order: Double
    let createdAt: Double
    let attachments: [MobileAttachment]
    let response: ResponseActivity?

    var isUser: Bool { role == "user" }
}

struct MobileAttachment: Decodable, Identifiable, Equatable, Sendable {
    let id: String
    let type: String
    let fileName: String
    let mimeType: String
    let url: String
}

struct AttachmentUploadResponse: Decodable {
    let storageId: String
}

struct UploadedAttachment: Sendable {
    let storageId: String
    let fileName: String
    let mimeType: String

    var convexValue: [String: ConvexEncodable?] {
        [
            "storageId": storageId,
            "fileName": fileName,
            "mimeType": mimeType,
        ]
    }
}

struct MobileChat: Decodable, Equatable, Sendable {
    let threadId: String?
    let title: String
    let threads: [MobileThread]
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

struct AbortReplyResult: Decodable, Sendable {
    let aborted: Bool
    let failedPending: Double
}

struct DeleteMobileMessagesResult: Decodable, Sendable {
    let deleted: Bool
}

struct StoreRedemptionResult: Decodable, Sendable {
    let tokensGranted: Double
    let alreadyRedeemed: Bool
}

/// Server activity is separate from the lifetime of a local network request.
enum ResponsePhase: String, Codable, Sendable {
    case sending, waiting, thinking, tool, responding, stopping, complete, stopped, failed

    var isActive: Bool {
        switch self {
        case .sending, .waiting, .thinking, .tool, .responding, .stopping: return true
        case .complete, .stopped, .failed: return false
        }
    }
}

struct ResponseActivity: Codable, Equatable, Hashable, Sendable {
    var phase: ResponsePhase
    var tools: [ResponseTool] = []
    var error: String? = nil
}

struct ResponseTool: Codable, Equatable, Hashable, Identifiable, Sendable {
    enum Status: String, Codable, Sendable {
        case running, completed, failed, stopped
    }
    let id: String
    let name: String
    let status: Status
}
