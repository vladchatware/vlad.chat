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
