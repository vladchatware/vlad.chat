import SwiftUI

struct AgentRunStatusPill: View {
    let presentation: AgentRunStatusPresentation

    private var phaseTitle: LocalizedStringResource {
        switch presentation.phase {
        case .starting: return "Starting"
        case .running: return "Running"
        case .executing: return "Executing"
        case .stopping: return "Stopping"
        case .paused: return "Paused"
        case .statusUnavailable: return "Status unavailable"
        }
    }

    private var symbol: String {
        switch presentation.phase {
        case .starting: return "sparkle"
        case .running: return "circle.dotted"
        case .executing: return "wrench.and.screwdriver"
        case .stopping: return "stop.circle"
        case .paused: return "pause.circle"
        case .statusUnavailable: return "exclamationmark.circle"
        }
    }

    var body: some View {
        HStack(spacing: 7) {
            Image(systemName: symbol)
                .accessibilityHidden(true)
            Text(phaseTitle)
                .font(.subheadline.weight(.medium))
            if let stepCount = presentation.stepCount {
                Text("Step \(stepCount, format: .number)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .fixedSize(horizontal: false, vertical: true)
        .padding(.horizontal, 12)
        .padding(.vertical, 7)
        .background(.regularMaterial, in: Capsule())
        .overlay {
            Capsule()
                .strokeBorder(.primary.opacity(0.08), lineWidth: 1)
        }
        .shadow(color: .black.opacity(0.08), radius: 8, y: 3)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("agentRunStatusPill")
    }
}
