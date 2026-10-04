import SwiftUI

struct AgentRunStatusIndicator: View {
    let presentation: AgentRunStatusPresentation

    @ViewBuilder
    private var statusGlyph: some View {
        switch presentation.phase {
        case .starting, .running, .executing, .stopping:
            ProgressView()
                .controlSize(.mini)
                .tint(.secondary)
                .accessibilityHidden(true)
        case .paused:
            Image(systemName: "pause.fill")
                .font(.caption2)
                .accessibilityHidden(true)
        case .statusUnavailable:
            Image(systemName: "exclamationmark.circle")
                .font(.caption2)
                .accessibilityHidden(true)
        }
    }

    var body: some View {
        HStack(spacing: 4) {
            statusGlyph
            Text(presentation.statusDescription)
                .font(.caption.weight(.medium))
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
        .accessibilityHidden(true)
    }
}
