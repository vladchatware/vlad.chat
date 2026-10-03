import Foundation

extension AgentRunState {
    var liveActivityState: AgentActivityAttributes.ContentState? {
        guard runId != nil else { return nil }
        let phase: AgentActivityAttributes.Phase
        switch status {
        case .running:
            if inFlightPhase == "tool" {
                phase = .executing
            } else if inFlightPhase == "model" || (stepCount ?? 0) > 0 {
                phase = .running
            } else {
                phase = .starting
            }
        case .stopRequested: phase = .stopping
        case .paused: phase = .paused
        case .completed: phase = .completed
        case .failed: phase = .failed
        case .idle, .queued, .unknown: return nil
        }
        return .init(
            phase: phase,
            stepCount: max(0, stepCount ?? 0),
            updatedAt: (updatedAt ?? Date().timeIntervalSince1970 * 1_000) / 1_000
        )
    }
}
