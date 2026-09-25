//
//  ComputerUseModels.swift
//  VladChat
//
//  Client-side decode of the shared V-83 computer-use tool JSON.
//  Does not fork the backend protocol — mirrors lib/computer-use/types.ts.
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
    let code: String?
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
            return error?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty
                ?? code
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
    /// Best-effort parse of a tool `output` string that may be JSON or truncated JSON.
    static func parse(from output: String?) -> ComputerToolResult? {
        guard let output else { return nil }
        let trimmed = output.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.hasPrefix("{"), let data = trimmed.data(using: .utf8) else {
            return nil
        }
        return try? JSONDecoder().decode(ComputerToolResult.self, from: data)
    }
}

extension ResponseTool {
    /// True when this tool is part of the V-83 computer-use family.
    var isComputerUseTool: Bool {
        let name = name.lowercased()
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
