import ConvexMobile
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
    let screenshot: MobileScreenshotReference?

    init(
        id: String,
        name: String,
        status: Status,
        output: String?,
        title: String?,
        inputSummary: String?,
        outputTruncated: Bool?,
        errorText: String?,
        screenshot: MobileScreenshotReference? = nil
    ) {
        self.id = id
        self.name = name
        self.status = status
        self.output = output
        self.title = title
        self.inputSummary = inputSummary
        self.outputTruncated = outputTruncated
        self.errorText = errorText
        self.screenshot = screenshot
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        name = try container.decode(String.self, forKey: .name)
        status = try container.decode(Status.self, forKey: .status)
        output = try container.decodeIfPresent(String.self, forKey: .output)
        title = try container.decodeIfPresent(String.self, forKey: .title)
        inputSummary = try container.decodeIfPresent(String.self, forKey: .inputSummary)
        outputTruncated = try container.decodeIfPresent(Bool.self, forKey: .outputTruncated)
        errorText = try container.decodeIfPresent(String.self, forKey: .errorText)
        screenshot = try container.decodeIfPresent(MobileScreenshotReference.self, forKey: .screenshot)
    }

    private enum CodingKeys: String, CodingKey {
        case id, name, status, output, title, inputSummary, outputTruncated, errorText, screenshot
    }
}

struct MobileScreenshotReference: Codable, Equatable, Hashable, Sendable {
    enum Availability: String, Codable, Hashable, Sendable {
        case available, unavailable
    }

    let id: String
    let url: String
    let mimeType: String?
    let width: Int?
    let height: Int?
    let sessionId: String?
    let createdAt: Double?
    let size: Int?
    let availability: Availability?
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
    let attachments: [MobileAttachment]?

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
        ["storageId": storageId, "fileName": fileName, "mimeType": mimeType]
    }
}

struct MobileChat: Decodable, Equatable, Sendable {
    let threadId: String?
    let title: String?
    let threads: [MobileThread]?
    let messages: [ChatMessage]
    let account: MobileAccount?
    let remainingMessages: Double?
    let computerViewer: MobileComputerViewerSession?

    func hasObservedLocalGeneration(
        expectedOrder: Double?,
        previousMessages: [String: ChatMessage],
        optimisticText: String?
    ) -> Bool {
        messages.contains { message in
            // Regeneration reuses orders and UI row IDs. Creation time separates
            // the replacement from stale snapshots of the deleted response.
            guard previousMessages[message.id]?.createdAt != message.createdAt else { return false }
            if let expectedOrder {
                return !message.isUser && message.order >= expectedOrder
            }
            guard let optimisticText else { return false }
            guard message.isUser,
                  message.text == optimisticText,
                  let prompt = messages.first(where: {
                      $0.isUser &&
                      $0.text == optimisticText &&
                      previousMessages[$0.id]?.createdAt != $0.createdAt
                  }) else { return false }

            // The action result may arrive after the subscription snapshot. A
            // new prompt alone is not enough to replace the local waiting row:
            // keep it until the corresponding assistant response is observable.
            return messages.contains { response in
                !response.isUser &&
                    response.order >= prompt.order &&
                    previousMessages[response.id]?.createdAt != response.createdAt
            }
        }
    }
}

struct MobileComputerViewerSession: Decodable, Equatable, Sendable {
    let sessionId: String
    let viewerUrl: String?
    let nativeViewerUrl: String?


    var validatedNativeViewerURL: URL? {
        guard let url = URL(string: nativeViewerUrl ?? ""),
              url.scheme == "https",
              url.host?.hasSuffix(".vercel.run") == true,
              url.path == "/vladchat.html" else {
            return nil
        }
        return url
    }
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
    let order: Double?
    let promptMessageId: String?
    let runId: String?
    let queued: Bool?
}

struct AbortReplyResult: Decodable, Sendable {
    let aborted: Bool
    let failedPending: Double
}

struct StopThreadResult: Decodable, Sendable {
    let status: String
}

enum AgentRunStatus: String, Decodable, Sendable {
    case running
    case stopRequested
    case paused
    case queued
    case completed
    case failed
    case idle
    case unknown

    init(from decoder: Decoder) throws {
        let value = try decoder.singleValueContainer().decode(String.self)
        self = Self(rawValue: value) ?? .unknown
    }
}

struct AgentRunState: Decodable, Sendable {
    let runId: String?
    let status: AgentRunStatus
    let stepCount: Int?
    let inFlightPhase: String?
    let queuedRuns: [QueuedAgentRun]?
}

enum AgentRunStatusPresentationPhase: String, Equatable, Sendable {
    case starting
    case running
    case executing
    case stopping
    case paused
    case statusUnavailable
}

struct AgentRunStatusPresentation: Equatable, Sendable {
    let runId: String
    let phase: AgentRunStatusPresentationPhase
    let stepCount: Int?

    var statusDescription: LocalizedStringResource {
        switch phase {
        case .starting: "Starting"
        case .running: "Working"
        case .executing: "Using tools"
        case .stopping: "Stopping"
        case .paused: "Paused"
        case .statusUnavailable: "Status unavailable"
        }
    }

    init?(state: AgentRunState?) {
        guard let state, let runId = state.runId, !runId.isEmpty else { return nil }

        let stepCount = state.stepCount.flatMap { $0 > 0 ? $0 : nil }
        let phase: AgentRunStatusPresentationPhase
        switch state.status {
        case .running:
            if state.inFlightPhase == "tool" {
                phase = .executing
            } else if state.inFlightPhase == "model" || stepCount != nil {
                phase = .running
            } else {
                phase = .starting
            }
        case .stopRequested:
            phase = .stopping
        case .paused:
            phase = .paused
        case .queued, .completed, .failed, .idle, .unknown:
            return nil
        }

        self.runId = runId
        self.phase = phase
        self.stepCount = stepCount
    }

    init(runId: String, phase: AgentRunStatusPresentationPhase, stepCount: Int?) {
        self.runId = runId
        self.phase = phase
        self.stepCount = stepCount
    }

    func markingStatusUnavailable() -> Self {
        Self(runId: runId, phase: .statusUnavailable, stepCount: nil)
    }
}

struct QueuedAgentRun: Decodable, Identifiable, Sendable {
    let runId: String
    let text: String
    let attachmentCount: Double
    let createdAt: Double

    var id: String { runId }
}

struct ResumeThreadResult: Decodable, Sendable {
    let status: AgentRunStatus
}

struct SteerThreadResult: Decodable, Sendable {
    let status: String
    let runId: String
    let steeringId: String
}

struct DeleteMobileMessagesResult: Decodable, Sendable {
    let deleted: Bool
}

struct StoreRedemptionResult: Decodable, Sendable {
    let tokensGranted: Double
    let alreadyRedeemed: Bool
}
