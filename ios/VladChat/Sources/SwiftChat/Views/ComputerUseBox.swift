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
                if let screenshot = ComputerScreenshotFrame(toolID: tool.id, result: result) {
                    ComputerScreenshotCarousel(screenshots: [screenshot], isDarkMode: isDarkMode)
                }

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
        .accessibilityElement(children: .contain)
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

    private var screenshots: [ComputerScreenshotFrame] {
        tools.compactMap { tool in
            guard let result = tool.computerResult else { return nil }
            return ComputerScreenshotFrame(toolID: tool.id, result: result)
        }
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
            if !screenshots.isEmpty {
                ComputerScreenshotCarousel(screenshots: screenshots, isDarkMode: isDarkMode)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .activityCard(isDarkMode: isDarkMode, emphasized: displayStatus.needsAttention)
        .accessibilityLabel("Computer use")
        .accessibilityValue(accessibilityStatus)
        .accessibilityIdentifier("computerUseSessionCard")
        .accessibilityElement(children: .contain)
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

private struct ComputerScreenshotFrame: Identifiable {
    let id: String
    let url: URL
    let title: String

    init?(toolID: String, result: ComputerToolResult) {
        guard let rawURL = result.screenshotUrl,
              let url = URL(string: rawURL),
              url.scheme?.lowercased() == "https" else {
            return nil
        }

        self.id = toolID
        self.url = url
        let resultTitle = result.title?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let pageURL = result.url?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        self.title = !resultTitle.isEmpty ? resultTitle : (!pageURL.isEmpty ? pageURL : result.op.displayTitle)
    }
}

private struct ComputerScreenshotCarousel: View {
    let screenshots: [ComputerScreenshotFrame]
    let isDarkMode: Bool

    @State private var selectedIndex = 0

    private var pageBackground: Color {
        isDarkMode ? Color.white.opacity(0.08) : Color.black.opacity(0.06)
    }

    var body: some View {
        VStack(spacing: 8) {
            ZStack(alignment: .top) {
                if screenshots.count > 1 {
                    ForEach(1...min(screenshots.count - 1, 2), id: \.self) { depth in
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .fill(pageBackground)
                            .padding(.horizontal, CGFloat(depth) * 7)
                            .offset(y: CGFloat(depth) * 6)
                    }
                }

                TabView(selection: $selectedIndex) {
                    ForEach(Array(screenshots.enumerated()), id: \.element.id) { index, screenshot in
                        ComputerScreenshotPage(
                            screenshot: screenshot,
                            page: index + 1,
                            pageCount: screenshots.count,
                            isDarkMode: isDarkMode
                        )
                        .tag(index)
                    }
                }
                .tabViewStyle(.page(indexDisplayMode: .never))
                .frame(height: 196)
                .accessibilityIdentifier("computerScreenshotPager")
            }
            .padding(.bottom, screenshots.count > 1 ? 10 : 0)

            if screenshots.count > 1 {
                HStack(spacing: 8) {
                    HStack(spacing: 4) {
                        ForEach(screenshots.indices, id: \.self) { index in
                            Capsule()
                                .fill(index == selectedIndex
                                    ? (isDarkMode ? Color.white.opacity(0.88) : Color.black.opacity(0.72))
                                    : (isDarkMode ? Color.white.opacity(0.24) : Color.black.opacity(0.18)))
                                .frame(width: index == selectedIndex ? 14 : 5, height: 5)
                        }
                    }
                    Spacer(minLength: 0)
                    Text("\(selectedIndex + 1) / \(screenshots.count)")
                        .font(Theme.Typography.caption)
                        .foregroundColor(isDarkMode ? .white.opacity(0.58) : .black.opacity(0.52))
                        .accessibilityIdentifier("computerScreenshotPageIndicator")
                }
            }
        }
        .onChange(of: screenshots.count) { _, count in
            selectedIndex = min(selectedIndex, max(count - 1, 0))
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Screenshots")
        .accessibilityValue("\(min(selectedIndex + 1, screenshots.count)) of \(screenshots.count)")
        .accessibilityIdentifier("computerScreenshotCarousel")
    }
}

private struct ComputerScreenshotPage: View {
    let screenshot: ComputerScreenshotFrame
    let page: Int
    let pageCount: Int
    let isDarkMode: Bool

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            AsyncImage(url: screenshot.url) { phase in
                switch phase {
                case .success(let image):
                    image
                        .resizable()
                        .scaledToFit()
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                case .failure:
                    unavailable
                case .empty:
                    ProgressView()
                        .tint(.white.opacity(0.8))
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                @unknown default:
                    unavailable
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color.black.opacity(0.92))

            LinearGradient(
                colors: [.clear, .black.opacity(0.72)],
                startPoint: .center,
                endPoint: .bottom
            )
            .allowsHitTesting(false)

            Text(screenshot.title)
                .font(.system(size: 12, weight: .medium))
                .foregroundColor(.white.opacity(0.92))
                .lineLimit(1)
                .padding(.horizontal, 10)
                .padding(.bottom, 9)

            Text("\(page) / \(pageCount)")
                .font(.system(size: 11, weight: .semibold, design: .rounded))
                .foregroundColor(.white.opacity(0.88))
                .padding(.horizontal, 8)
                .padding(.vertical, 5)
                .background(.black.opacity(0.44), in: Capsule())
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
                .padding(8)
        }
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(isDarkMode ? Color.white.opacity(0.10) : Color.black.opacity(0.08), lineWidth: 1)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Screenshot \(page) of \(pageCount): \(screenshot.title)")
        .accessibilityIdentifier("computerScreenshotPage-\(page)")
    }

    private var unavailable: some View {
        VStack(spacing: 6) {
            Image(systemName: "photo")
                .font(.system(size: 20, weight: .medium))
            Text("Screenshot unavailable")
                .font(Theme.Typography.caption)
        }
        .foregroundColor(.white.opacity(0.7))
        .frame(maxWidth: .infinity, maxHeight: .infinity)
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
