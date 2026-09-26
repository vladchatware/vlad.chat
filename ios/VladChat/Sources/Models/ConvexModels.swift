import Foundation

struct ResponseTool: Codable, Equatable, Hashable, Identifiable, Sendable {
    enum Status: String, Codable, Sendable {
        case pending, running, completed, failed, stopped, unknown

        init(from decoder: Decoder) throws {
            let rawValue = try decoder.singleValueContainer().decode(String.self)
            self = Self(rawValue: rawValue) ?? .unknown
        }
    }

    let id: String
    let name: String
    let status: Status
    let output: String?
    let title: String?
    let inputSummary: String?
    let outputTruncated: Bool?
    let errorText: String?
}

struct ResponsePart: Codable, Equatable, Hashable, Identifiable, Sendable {
    enum Kind: String, Codable, Sendable {
        case text, reasoning, source, tool, unknown

        init(from decoder: Decoder) throws {
            let rawValue = try decoder.singleValueContainer().decode(String.self)
            self = Self(rawValue: rawValue) ?? .unknown
        }
    }

    enum State: String, Codable, Sendable {
        case streaming, done, unknown

        init(from decoder: Decoder) throws {
            let rawValue = try decoder.singleValueContainer().decode(String.self)
            self = Self(rawValue: rawValue) ?? .unknown
        }
    }

    let id: String
    let type: Kind
    let text: String?
    let state: State?
    let sourceId: String?
    let url: String?
    let title: String?
    let tool: ResponseTool?
}

struct ResponseActivity: Codable, Equatable, Hashable, Sendable {
    enum Phase: String, Codable, Sendable {
        case waiting, thinking, tool, responding, complete, stopped, failed, unknown

        init(from decoder: Decoder) throws {
            let rawValue = try decoder.singleValueContainer().decode(String.self)
            self = Self(rawValue: rawValue) ?? .unknown
        }
    }

    let phase: Phase
    let tools: [ResponseTool]
    let parts: [ResponsePart]
    let errorText: String?

    init(
        phase: Phase,
        tools: [ResponseTool],
        parts: [ResponsePart] = [],
        errorText: String? = nil
    ) {
        self.phase = phase
        self.tools = tools
        self.parts = parts
        self.errorText = errorText
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        phase = try container.decode(Phase.self, forKey: .phase)
        tools = try container.decodeIfPresent([ResponseTool].self, forKey: .tools) ?? []
        parts = try container.decodeIfPresent([ResponsePart].self, forKey: .parts) ?? []
        errorText = try container.decodeIfPresent(String.self, forKey: .errorText)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(phase, forKey: .phase)
        try container.encode(tools, forKey: .tools)
        try container.encode(parts, forKey: .parts)
        try container.encodeIfPresent(errorText, forKey: .errorText)
    }

    private enum CodingKeys: String, CodingKey {
        case phase, tools, parts, errorText
    }
}

extension ResponseActivity {
    /// Tool and terminal rows always render; the bare thinking shimmer only
    /// covers the phases before the answer starts streaming.
    var isDisplayable: Bool {
        if !tools.isEmpty { return true }
        return phase == .waiting ||
            phase == .thinking ||
            phase == .tool ||
            phase == .stopped ||
            phase == .failed ||
            phase == .unknown
    }

    func retainingReasoning(from previous: ResponseActivity?) -> ResponseActivity {
        guard phase == .complete || phase == .stopped || phase == .failed,
              let previous else { return self }

        let terminalReasoning = parts.filter { $0.type == .reasoning }
        let missingReasoning = previous.parts.filter { previousPart in
            previousPart.type == .reasoning &&
                !terminalReasoning.contains { $0.id == previousPart.id || $0.text == previousPart.text }
        }
        guard !missingReasoning.isEmpty else { return self }

        var retainedParts = parts
        let firstTextIndex = retainedParts.firstIndex { $0.type == .text } ?? retainedParts.endIndex
        retainedParts.insert(contentsOf: missingReasoning, at: firstTextIndex)
        return ResponseActivity(
            phase: phase,
            tools: tools,
            parts: retainedParts,
            errorText: errorText
        )
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
    let errorText: String?

    var isUser: Bool { role == "user" }
}

struct MobileChat: Decodable, Equatable, Sendable {
    let threadId: String?
    let title: String
    let threads: [MobileThread]
    let messages: [ChatMessage]
    let account: MobileAccount?
    let remainingMessages: Double?
}

struct MobileThread: Decodable, Identifiable, Equatable, Sendable {
    let id: String
    let title: String
    let createdAt: Double
}

struct MobileAccount: Decodable, Equatable, Sendable {
    let isAnonymous: Bool
    let name: String?
    let email: String?
    let trialMessages: Double
    let trialTokens: Double
    let tokens: Double
}

struct MobileUsageSummary: Decodable, Equatable, Sendable {
    let isAnonymous: Bool
    let totalTokensTracked: Double
    let freeMessagesLeft: Double
    let usageTrackedPercent: Double
    let fiveHourCreditsUsed: Double
    let fiveHourCreditsLimit: Double
    let weeklyCreditsUsed: Double
    let weeklyCreditsLimit: Double
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
