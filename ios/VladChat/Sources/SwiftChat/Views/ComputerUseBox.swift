//
//  ComputerUseBox.swift
//  VladChat
//
//  Graceful rendering for V-83 computer-use tool results:
//  screenshotUrl thumbnails + computer_handoff callouts.
//  No VNC / live desktop (that is V-84).
//

import SwiftUI

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

    private var isEmphasized: Bool {
        result?.hasHandoff == true || tool.status == .failed
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

                if result.hasScreenshot, let urlString = result.screenshotUrl, let url = URL(string: urlString) {
                    ComputerScreenshotThumbnail(
                        url: url,
                        width: result.width,
                        height: result.height,
                        pageTitle: result.title,
                        pageURL: result.url,
                        isDarkMode: isDarkMode
                    )
                } else if shouldShowStatusSummary(result) {
                    Text(result.statusSummary)
                        .font(Theme.Typography.activitySecondary)
                        .foregroundColor(secondaryForeground)
                        .lineLimit(2)
                }

                if let budget = result.budget {
                    Text("\(budget.stepsUsed)/\(budget.maxSteps) steps")
                        .font(Theme.Typography.caption)
                        .foregroundColor(tertiaryForeground)
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
        .activityCard(isDarkMode: isDarkMode, emphasized: isEmphasized)
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
                .foregroundColor(tertiaryForeground)

            if tool.status == .running {
                InlineLoadingDotsView(isDarkMode: isDarkMode)
            }

            Spacer(minLength: 0)

            Image(systemName: "chevron.right")
                .font(.system(size: 11, weight: .medium))
                .foregroundColor(tertiaryForeground)
        }
    }

    private var displayTitle: String {
        if let title = tool.title?.trimmingCharacters(in: .whitespacesAndNewlines), !title.isEmpty {
            return title
        }
        return op.displayTitle
    }

    private var headerTint: Color {
        if result?.hasHandoff == true { return .orange }
        switch tool.status {
        case .failed: return .red
        case .completed: return isDarkMode ? .white.opacity(0.72) : Color.black.opacity(0.55)
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
        if result?.hasHandoff == true { return "Handoff" }
        switch tool.status {
        case .pending: return "Waiting"
        case .running: return "Running"
        case .completed: return "Done"
        case .failed: return "Failed"
        case .stopped: return "Stopped"
        case .unknown: return "Unknown"
        }
    }

    private var accessibilityStatus: String {
        if let handoff = result?.handoff {
            return "\(handoff.reason.displayTitle). \(handoff.message)"
        }
        return statusLabel
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

/// Async screenshot thumbnail for `screenshotUrl` — not a live VNC surface.
struct ComputerScreenshotThumbnail: View {
    let url: URL
    let width: Int?
    let height: Int?
    let pageTitle: String?
    let pageURL: String?
    let isDarkMode: Bool

    private var aspect: CGFloat {
        guard let width, let height, width > 0, height > 0 else {
            return 16.0 / 9.0
        }
        return CGFloat(width) / CGFloat(height)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Dimensions.compactItemSpacing) {
            if let pageTitle, !pageTitle.isEmpty {
                Text(pageTitle)
                    .font(Theme.Typography.activitySecondary)
                    .foregroundColor(isDarkMode ? .white.opacity(0.7) : Color.black.opacity(0.6))
                    .lineLimit(1)
            } else if let pageURL, let host = URL(string: pageURL)?.host {
                Text(host.replacingOccurrences(of: "www.", with: ""))
                    .font(Theme.Typography.caption)
                    .foregroundColor(isDarkMode ? .white.opacity(0.5) : Color.black.opacity(0.5))
                    .lineLimit(1)
            }

            AsyncImage(url: url) { phase in
                switch phase {
                case .empty:
                    placeholder
                        .overlay { ProgressView().scaleEffect(0.8) }
                case .success(let image):
                    image
                        .resizable()
                        .aspectRatio(contentMode: .fit)
                case .failure:
                    placeholder
                        .overlay {
                            Image(systemName: "photo")
                                .foregroundColor(isDarkMode ? .white.opacity(0.4) : .black.opacity(0.35))
                        }
                @unknown default:
                    placeholder
                }
            }
            .frame(maxWidth: .infinity)
            .aspectRatio(aspect, contentMode: .fit)
            .clipShape(RoundedRectangle(cornerRadius: Theme.Dimensions.cornerRadiusMedium, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: Theme.Dimensions.cornerRadiusMedium, style: .continuous)
                    .strokeBorder(isDarkMode ? Color.white.opacity(0.12) : Color.black.opacity(0.08), lineWidth: 1)
            )
            .accessibilityLabel("Computer-use screenshot")
            .accessibilityIdentifier("computerScreenshotThumbnail")
        }
    }

    private var placeholder: some View {
        RoundedRectangle(cornerRadius: Theme.Dimensions.cornerRadiusMedium, style: .continuous)
            .fill(isDarkMode ? Color.white.opacity(0.06) : Color.black.opacity(0.04))
            .aspectRatio(aspect, contentMode: .fit)
            .frame(maxWidth: .infinity)
    }
}

/// Detail sheet content when a computer-use tool is opened.
struct ComputerUseDetailContent: View {
    let tool: ResponseTool
    let result: ComputerToolResult?
    let isDarkMode: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Dimensions.responseSectionSpacing) {
            if let result {
                if let handoff = result.handoff {
                    ComputerHandoffBanner(handoff: handoff, isDarkMode: isDarkMode)
                }

                if result.hasScreenshot, let urlString = result.screenshotUrl, let url = URL(string: urlString) {
                    ComputerScreenshotThumbnail(
                        url: url,
                        width: result.width,
                        height: result.height,
                        pageTitle: result.title,
                        pageURL: result.url,
                        isDarkMode: isDarkMode
                    )
                }

                metaGrid(result)

                if let error = result.error, !error.isEmpty, result.handoff == nil {
                    Text(error)
                        .font(.system(.body))
                        .foregroundColor(.red.opacity(0.82))
                }
            }

            if let inputSummary = tool.inputSummary, !inputSummary.isEmpty {
                labeledBlock(title: "Input", body: inputSummary)
            }

            if let output = tool.output, !output.isEmpty {
                labeledBlock(title: "Raw output", body: output, monospaced: true)
            } else if result == nil, let errorText = tool.errorText {
                labeledBlock(title: "Error", body: errorText)
            }

            if tool.outputTruncated == true {
                Text("Preview truncated")
                    .font(Theme.Typography.caption)
                    .foregroundColor(isDarkMode ? .white.opacity(0.55) : Color.black.opacity(0.55))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private func metaGrid(_ result: ComputerToolResult) -> some View {
        VStack(alignment: .leading, spacing: Theme.Dimensions.compactItemSpacing) {
            metaRow("Operation", result.op.rawValue)
            if let url = result.url { metaRow("URL", url) }
            if let title = result.title { metaRow("Title", title) }
            if let action = result.action { metaRow("Action", action) }
            if let budget = result.budget {
                metaRow("Budget", "\(budget.stepsUsed)/\(budget.maxSteps) steps · \(budget.stepsRemaining) left")
            }
            if let code = result.code { metaRow("Code", code) }
        }
    }

    private func metaRow(_ label: String, _ value: String) -> some View {
        HStack(alignment: .top) {
            Text(label)
                .font(Theme.Typography.caption)
                .foregroundColor(isDarkMode ? .white.opacity(0.5) : Color.black.opacity(0.5))
                .frame(width: 88, alignment: .leading)
            Text(value)
                .font(Theme.Typography.activitySecondary)
                .foregroundColor(isDarkMode ? .white.opacity(0.85) : Color.black.opacity(0.8))
                .textSelection(.enabled)
            Spacer(minLength: 0)
        }
    }

    private func labeledBlock(title: String, body: String, monospaced: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(Theme.Typography.caption)
                .foregroundColor(isDarkMode ? .white.opacity(0.5) : Color.black.opacity(0.5))
            Text(body)
                .font(monospaced ? .system(.footnote, design: .monospaced) : Theme.Typography.activitySecondary)
                .foregroundColor(isDarkMode ? .white.opacity(0.88) : Color.black.opacity(0.8))
                .textSelection(.enabled)
        }
    }
}
