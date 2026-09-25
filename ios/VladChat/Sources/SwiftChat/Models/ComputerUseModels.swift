//
//  ComputerUseModels.swift
//  VladChat
//
//  Client-side decode of the shared V-83 computer-use tool JSON.
//  Does not fork the backend protocol — mirrors lib/computer-use/types.ts.
//
//  Wire shapes the mobile stream / MCP may deliver as `ResponseTool.output`:
//  - plain JSON object string: {"ok":true,"op":"screenshot",...}
//  - MCP content wrapper: {"content":[{"type":"text","text":"<json>"}]}
//  - MCP content array alone: [{"type":"text","text":"<json>"}]
//  - JSON-encoded string of either of the above
//  Clients only render; no sandbox orchestration on device. No VNC (V-84).
//

import Foundation

/// Reasons the agent must hand control back to the user (SSO / 2FA / etc.).
enum ComputerHandoffReason: String, Codable, Equatable, Sendable {
    case sso
    case twoFA = "2fa"
    case captcha
    case payment
    case signing
    case unknown

    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = Self(rawValue: raw) ?? .unknown
    }

    var displayTitle: String {
        switch self {
        case .sso: return "Sign-in required"
        case .twoFA: return "Verification required"
        case .captcha: return "Captcha required"
        case .payment: return "Payment step"
        case .signing: return "Signing required"
        case .unknown: return "Needs your input"
        }
    }

    var systemImage: String {
        switch self {
        case .sso: return "person.badge.key"
        case .twoFA: return "lock.shield"
        case .captcha: return "shield.lefthalf.filled"
        case .payment: return "creditcard"
        case .signing: return "signature"
        case .unknown: return "hand.raised"
        }
    }
}

struct ComputerHandoffEvent: Codable, Equatable, Sendable {
    let type: String
    let reason: ComputerHandoffReason
    let message: String
    let requiresUser: Bool

    init(type: String = "computer_handoff", reason: ComputerHandoffReason, message: String, requiresUser: Bool = true) {
        self.type = type
        self.reason = reason
        self.message = message
        self.requiresUser = requiresUser
    }
}

enum ComputerToolOp: String, Codable, Equatable, Sendable {
    case open, screenshot, act, handoff, end, unknown

    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = Self(rawValue: raw) ?? .unknown
    }

    var displayTitle: String {
        switch self {
        case .open: return "Opened page"
        case .screenshot: return "Screenshot"
        case .act: return "Browser action"
        case .handoff: return "Needs you"
        case .end: return "Session ended"
        case .unknown: return "Computer use"
        }
    }

    var systemImage: String {
        switch self {
        case .open: return "safari"
        case .screenshot: return "camera.viewfinder"
        case .act: return "hand.tap"
        case .handoff: return "hand.raised"
        case .end: return "xmark.circle"
        case .unknown: return "desktopcomputer"
        }
    }
}

/// Mirrors `ComputerErrorCode` in lib/computer-use/types.ts.
enum ComputerErrorCode: String, Codable, Equatable, Sendable {
    case budgetExceeded = "budget_exceeded"
    case ttlExceeded = "ttl_exceeded"
    case stepLimit = "step_limit"
    case disabled
    case authMissing = "auth_missing"
    case runtime
    case unknown

    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = Self(rawValue: raw) ?? .unknown
    }

    var displayTitle: String {
        switch self {
        case .budgetExceeded: return "Budget exceeded"
        case .ttlExceeded: return "Session timed out"
        case .stepLimit: return "Step limit reached"
        case .disabled: return "Computer use disabled"
        case .authMissing: return "Auth required"
        case .runtime: return "Runtime error"
        case .unknown: return "Error"
        }
    }
}

struct ComputerBudgetStatus: Codable, Equatable, Sendable {
    let stepsUsed: Int
    let stepsRemaining: Int
    let maxSteps: Int
    let ttlMs: Int
    let elapsedMs: Int
    let note: String
}

/// Shared tool-result payload from `computer_*` tools (web + iOS).
struct ComputerToolResult: Codable, Equatable, Sendable {
    let ok: Bool
    let op: ComputerToolOp
    let url: String?
    let title: String?
    let action: String?
    let screenshotUrl: String?
    let screenshotId: String?
    let mimeType: String?
    let width: Int?
    let height: Int?
    let handoff: ComputerHandoffEvent?
    let sandboxName: String?
    let error: String?
    let code: ComputerErrorCode?
    let budget: ComputerBudgetStatus?

    var hasScreenshot: Bool {
        guard let screenshotUrl, !screenshotUrl.isEmpty else { return false }
        return URL(string: screenshotUrl) != nil
    }

    var hasHandoff: Bool {
        handoff != nil
    }

    /// Friendly one-line summary for collapsed tool rows.
    var statusSummary: String {
        if let handoff {
            return handoff.reason.displayTitle
        }
        if !ok {
            if let code, code != .unknown {
                return code.displayTitle
            }
            return error?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty
                ?? "Failed"
        }
        if let title, !title.isEmpty {
            return title
        }
        if let url, let host = URL(string: url)?.host {
            return host.replacingOccurrences(of: "www.", with: "")
        }
        if let action, !action.isEmpty {
            return action
        }
        return op.displayTitle
    }
}

extension ComputerToolResult {
    /// Best-effort parse of a tool `output` string.
    /// Accepts plain `ComputerToolResult` JSON, MCP `{content:[{type:text,text}]}`
    /// wrappers, content arrays, or a JSON-encoded string of any of those.
    static func parse(from output: String?) -> ComputerToolResult? {
        guard let output else { return nil }
        let trimmed = output.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }

        // Mobile stream appends a single ellipsis when truncating at ~4k.
        let candidate = Self.stripTruncationMarker(trimmed)

        if let result = decodeResultObject(from: candidate) {
            return result
        }

        guard let data = candidate.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) else {
            return nil
        }
        return parse(jsonValue: json, depth: 0)
    }

    /// Parse from an already-deserialized JSON value (object / array / string).
    static func parse(jsonValue: Any, depth: Int = 0) -> ComputerToolResult? {
        guard depth < 4 else { return nil }

        if let string = jsonValue as? String {
            return parse(from: string)
        }

        if let dict = jsonValue as? [String: Any] {
            if looksLikeToolResult(dict),
               let data = try? JSONSerialization.data(withJSONObject: dict),
               let result = try? JSONDecoder().decode(ComputerToolResult.self, from: data) {
                return result
            }
            if let text = mcpTextPayload(from: dict) {
                return parse(from: text) ?? parse(jsonValue: text, depth: depth + 1)
            }
        }

        if let array = jsonValue as? [Any], let text = mcpTextFromContentArray(array) {
            return parse(from: text) ?? parse(jsonValue: text, depth: depth + 1)
        }

        return nil
    }

    private static func stripTruncationMarker(_ text: String) -> String {
        if text.hasSuffix("…") {
            return String(text.dropLast()).trimmingCharacters(in: .whitespacesAndNewlines)
        }
        // ASCII "..." sometimes used in fixtures / older paths
        if text.hasSuffix("...") {
            return String(text.dropLast(3)).trimmingCharacters(in: .whitespacesAndNewlines)
        }
        return text
    }

    private static func decodeResultObject(from text: String) -> ComputerToolResult? {
        guard text.hasPrefix("{"), let data = text.data(using: .utf8) else { return nil }
        guard let result = try? JSONDecoder().decode(ComputerToolResult.self, from: data) else {
            return nil
        }
        // Reject accidental decode of MCP wrappers that happen to satisfy Codable
        // with missing required fields — ComputerToolResult requires ok + op.
        return result
    }

    private static func looksLikeToolResult(_ dict: [String: Any]) -> Bool {
        dict["ok"] != nil && dict["op"] != nil
    }

    /// Extract joined text from MCP `{ content: [{ type: "text", text: "..." }, ...] }`.
    private static func mcpTextPayload(from dict: [String: Any]) -> String? {
        guard let content = dict["content"] else { return nil }
        if let array = content as? [Any] {
            return mcpTextFromContentArray(array)
        }
        return nil
    }

    private static func mcpTextFromContentArray(_ array: [Any]) -> String? {
        let texts: [String] = array.compactMap { item in
            guard let part = item as? [String: Any] else { return nil }
            // Prefer explicit text parts; also accept bare `{text: "..."}`.
            if let type = part["type"] as? String, type != "text" { return nil }
            return part["text"] as? String
        }
        let joined = texts.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
        return joined.isEmpty ? nil : joined
    }
}

extension ResponseTool {
    /// Known V-83 MCP / AI-SDK computer-use tool names.
    private static let computerToolNames: Set<String> = [
        "computer_open",
        "computer_screenshot",
        "computer_act",
        "computer_handoff",
        "computer_end",
    ]

    /// True when this tool is part of the V-83 computer-use family.
    var isComputerUseTool: Bool {
        let name = name.lowercased()
        if Self.computerToolNames.contains(name) {
            return true
        }
        if name.hasPrefix("computer_") || name.contains("computer_use") {
            return true
        }
        return ComputerToolResult.parse(from: output) != nil
    }

    var computerResult: ComputerToolResult? {
        ComputerToolResult.parse(from: output)
    }
}

private extension String {
    var nilIfEmpty: String? {
        isEmpty ? nil : self
    }
}
