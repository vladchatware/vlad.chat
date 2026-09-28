//
//  ComputerUseBox.swift
//  VladChat
//
//  Computer-use status cards and handoff callouts.
//

import SwiftUI
import Combine
import UIKit

/// Inline computer-use tool card shown in the transcript.
struct ComputerUseToolCard: View {
    let tool: ResponseTool
    let result: ComputerToolResult?
    let isDarkMode: Bool
    let isStreaming: Bool

    private var op: ComputerToolOp {
        result?.op ?? opFromToolName
    }

    private var opFromToolName: ComputerToolOp {
        let name = tool.name.lowercased()
        if name.contains("screenshot") { return .screenshot }
        if name.contains("open") { return .open }
        if name.contains("act") { return .act }
        if name.contains("handoff") { return .handoff }
        if name.contains("end") { return .end }
        return .unknown
    }

    private var displayStatus: ComputerUseDisplayStatus {
        ComputerUseDisplayStatus(toolStatus: tool.status, result: result)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Dimensions.relatedItemSpacing) {
            headerRow

            if let inputSummary = tool.inputSummary, !inputSummary.isEmpty, result?.url == nil {
                Text(inputSummary)
                    .font(Theme.Typography.activitySecondary)
                    .foregroundColor(secondaryForeground)
                    .lineLimit(2)
                    .truncationMode(.tail)
            }

            if let result {
                if let handoff = result.handoff {
                    ComputerHandoffBanner(handoff: handoff, isDarkMode: isDarkMode)
                }

                if shouldShowStatusSummary(result) {
                    Text(result.statusSummary)
                        .font(Theme.Typography.activitySecondary)
                        .foregroundColor(secondaryForeground)
                        .lineLimit(2)
                }

                if let budget = result.budget {
                    Text(budget.displaySummary)
                        .font(Theme.Typography.caption)
                        .foregroundColor(tertiaryForeground)
                }

                if !result.ok, let code = result.code, code != .unknown, result.handoff == nil {
                    Text(code.displayTitle)
                        .font(Theme.Typography.caption)
                        .foregroundColor(.red.opacity(0.75))
                }
            } else if tool.status == .running || tool.status == .pending {
                Text(tool.inputSummary ?? "Working in the browser…")
                    .font(Theme.Typography.activitySecondary)
                    .foregroundColor(secondaryForeground)
                    .lineLimit(2)
                    .modifier(TextPulseAnimation())
            }

            if let errorText = tool.errorText ?? result?.error, !errorText.isEmpty, result?.handoff == nil {
                Text(errorText)
                    .font(Theme.Typography.activitySecondary)
                    .foregroundColor(.red.opacity(0.82))
                    .lineLimit(3)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .activityCard(isDarkMode: isDarkMode, emphasized: displayStatus.needsAttention)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityLabel(op.displayTitle)
        .accessibilityValue(accessibilityStatus)
        .accessibilityIdentifier("computerUseToolCard")
    }


    private func shouldShowStatusSummary(_ result: ComputerToolResult) -> Bool {
        if result.hasHandoff, result.statusSummary == result.handoff?.reason.displayTitle {
            return false
        }
        return !result.statusSummary.isEmpty
    }

    private var headerRow: some View {

        HStack(spacing: Theme.Dimensions.relatedItemSpacing) {
            Image(systemName: op.systemImage)
                .font(.system(size: 13, weight: .semibold))
                .foregroundColor(headerTint)
                .frame(width: 18)

            Text(displayTitle)
                .font(Theme.Typography.activityTitle)
                .foregroundColor(primaryForeground)

            Text(statusLabel)
                .font(Theme.Typography.caption)
                .foregroundColor(displayStatus.needsAttention ? headerTint : tertiaryForeground)

            if displayStatus == .running {
                InlineLoadingDotsView(isDarkMode: isDarkMode)
            }

            Spacer(minLength: 0)
        }
    }

    private var displayTitle: String {
        if let title = tool.title?.trimmingCharacters(in: .whitespacesAndNewlines), !title.isEmpty {
            return title
        }
        return op.displayTitle
    }

    private var headerTint: Color {
        switch displayStatus {
        case .needsUser: return .orange
        case .failed: return .red
        case .done: return isDarkMode ? .white.opacity(0.72) : Color.black.opacity(0.55)
        case .running: return isDarkMode ? .white.opacity(0.78) : Color.black.opacity(0.62)
        default: return isDarkMode ? .white.opacity(0.55) : Color.black.opacity(0.45)
        }
    }

    private var primaryForeground: Color {
        isDarkMode ? .white.opacity(0.92) : Color.black.opacity(0.86)
    }

    private var secondaryForeground: Color {
        isDarkMode ? .white.opacity(0.62) : Color.black.opacity(0.58)
    }

    private var tertiaryForeground: Color {
        isDarkMode ? .white.opacity(0.48) : Color.black.opacity(0.45)
    }

    private var statusLabel: String {
        displayStatus.label
    }

    private var accessibilityStatus: String {
        if let handoff = result?.handoff {
            return "\(statusLabel). \(handoff.reason.displayTitle). \(handoff.message)"
        }
        return statusLabel
    }
}

/// Transcript status for the computer session. Live viewing happens in the floating computer preview.
struct ComputerUseSessionCard: View {
    let tools: [ResponseTool]
    let isDarkMode: Bool

    private var results: [ComputerToolResult] {
        tools.compactMap(\.computerResult)
    }

    private var screenshots: [ComputerToolResult] {
        results.filter(\.hasScreenshot)
    }

    private var latestResult: ComputerToolResult? {
        tools.last?.computerResult
    }

    private var displayStatus: ComputerUseDisplayStatus {
        ComputerUseDisplayStatus(toolStatus: tools.last?.status, result: latestResult)
    }

    private var budget: ComputerBudgetStatus? {
        results.reversed().compactMap(\.budget).first
    }

    private var statusTint: Color {
        switch displayStatus {
        case .needsUser: return .orange
        case .failed: return .red
        default: return isDarkMode ? .white.opacity(0.55) : .black.opacity(0.5)
        }
    }

    private var foreground: Color {
        isDarkMode ? .white.opacity(0.92) : Color.black.opacity(0.86)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Dimensions.relatedItemSpacing) {
            HStack(spacing: 10) {
                Image(systemName: "desktopcomputer")
                    .foregroundColor(displayStatus.needsAttention ? statusTint : foreground)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Computer use")
                        .font(Theme.Typography.activityTitle)
                        .foregroundColor(foreground)
                    HStack(spacing: 6) {
                        Text(displayStatus.label)
                            .foregroundColor(statusTint)
                        if !screenshots.isEmpty {
                            Text("· \(screenshots.count) \(screenshots.count == 1 ? "screen" : "screens")")
                        }
                        if displayStatus == .running || displayStatus == .waiting {
                            InlineLoadingDotsView(isDarkMode: isDarkMode)
                        }
                    }
                    .font(Theme.Typography.caption)
                    .foregroundColor(isDarkMode ? .white.opacity(0.55) : .black.opacity(0.5))
                }
                Spacer(minLength: 0)
            }
            if let handoff = latestResult?.handoff {
                ComputerHandoffBanner(handoff: handoff, isDarkMode: isDarkMode)
            }
            if let budget {
                Text(budget.displaySummary)
                    .font(Theme.Typography.caption)
                    .foregroundColor(isDarkMode ? .white.opacity(0.55) : .black.opacity(0.5))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .activityCard(isDarkMode: isDarkMode, emphasized: displayStatus.needsAttention)
        .accessibilityLabel("Computer use")
        .accessibilityValue(accessibilityStatus)
        .accessibilityIdentifier("computerUseSessionCard")
    }

    private var accessibilityStatus: String {
        var parts = [displayStatus.label]
        if let handoff = latestResult?.handoff {
            parts.append(handoff.reason.displayTitle)
            parts.append(handoff.message)
        }
        if let budget { parts.append(budget.displaySummary) }
        return parts.joined(separator: ". ")
    }
}

/// Compact amber banner for `computer_handoff` events.
struct ComputerHandoffBanner: View {
    let handoff: ComputerHandoffEvent
    let isDarkMode: Bool

    var body: some View {
        HStack(alignment: .top, spacing: Theme.Dimensions.relatedItemSpacing) {
            Image(systemName: handoff.reason.systemImage)
                .font(.system(size: 14, weight: .semibold))
                .foregroundColor(.orange)

            VStack(alignment: .leading, spacing: 2) {
                Text(handoff.reason.displayTitle)
                    .font(Theme.Typography.activityTitle)
                    .foregroundColor(isDarkMode ? .white.opacity(0.92) : Color.black.opacity(0.86))
                Text(handoff.message)
                    .font(Theme.Typography.activitySecondary)
                    .foregroundColor(isDarkMode ? .white.opacity(0.68) : Color.black.opacity(0.62))
                    .fixedSize(horizontal: false, vertical: true)
            }

            Spacer(minLength: 0)
        }
        .padding(Theme.Dimensions.paddingSmall)
        .background(
            RoundedRectangle(cornerRadius: Theme.Dimensions.cornerRadiusSmall, style: .continuous)
                .fill(Color.orange.opacity(isDarkMode ? 0.14 : 0.10))
        )
        .accessibilityIdentifier("computerHandoffBanner")
    }
}

extension ComputerToolResult {
    var validatedViewerURL: URL? {
        guard op != .end,
              let viewerUrl,
              let url = URL(string: viewerUrl),
              url.scheme == "https",
              url.host?.hasSuffix(".vercel.run") == true,
              url.path.lowercased().contains("vnc") else {
            return nil
        }
        return url
    }

    var validatedNativeViewerURL: URL? {
        guard op != .end,
              let nativeViewerUrl,
              let url = URL(string: nativeViewerUrl),
              url.scheme == "https",
              url.host?.hasSuffix(".vercel.run") == true,
              url.path == "/vladchat.html" else {
            return nil
        }
        return url
    }

}
