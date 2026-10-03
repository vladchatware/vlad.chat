import ActivityKit
import Foundation

/// Shared by the app and extension. Never put chat titles, prompts, tool inputs,
/// outputs, or error details into this public, system-rendered payload.
struct AgentActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        var phase: Phase
        var stepCount: Int
        var updatedAt: Double
    }

    enum Phase: String, Codable, CaseIterable {
        case starting, running, executing, stopping, paused, completed, failed

        var isTerminal: Bool { self == .completed || self == .failed }

        var label: LocalizedStringResource {
            switch self {
            case .starting: "Starting"
            case .running: "Running"
            case .executing: "Executing"
            case .stopping: "Stopping"
            case .paused: "Paused"
            case .completed: "Completed"
            case .failed: "Failed"
            }
        }

        var symbol: String {
            switch self {
            case .starting: "hourglass"
            case .running: "sparkles"
            case .executing: "gearshape.2"
            case .stopping: "pause.circle"
            case .paused: "pause.fill"
            case .completed: "checkmark.circle"
            case .failed: "exclamationmark.circle"
            }
        }
    }

    let threadId: String
    let runId: String

    var conversationURL: URL? {
        var components = URLComponents()
        components.scheme = "vladchat"
        components.host = "conversation"
        components.queryItems = [URLQueryItem(name: "threadId", value: threadId)]
        return components.url
    }

    static func conversationID(from url: URL) -> String? {
        guard url.scheme == "vladchat", url.host == "conversation",
              let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let id = components.queryItems?.first(where: { $0.name == "threadId" })?.value,
              !id.isEmpty else { return nil }
        return id
    }
}
