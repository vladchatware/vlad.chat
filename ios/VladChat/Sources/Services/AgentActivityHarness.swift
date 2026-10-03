#if DEBUG
import ActivityKit
import SwiftUI

/// Deterministic device fixture. Uses the production controller and extension,
/// with no backend credentials, prompts, or real agent work.
struct AgentActivityHarness: View {
    @Environment(\.scenePhase) private var scenePhase
    @State private var controller = AgentLiveActivityController()
    @State private var phase = AgentActivityAttributes.Phase.running
    @State private var openedThread = ""
    @State private var activityCount = 0
    private let threadId = "live-activity-fixture"

    var body: some View {
        VStack(spacing: 16) {
            Text("Agent activity fixture").font(.title)
            Text(phase.label).accessibilityIdentifier("fixture-phase")
            ForEach(AgentActivityAttributes.Phase.allCases, id: \.rawValue) { phase in
                Button {
                    self.phase = phase
                    publish(phase)
                } label: {
                    Text(phase.label)
                }
                .accessibilityIdentifier("activity-\(phase.rawValue)")
            }
            Text(openedThread).accessibilityIdentifier("opened-thread")
            Text("Active activities: \(activityCount)").accessibilityIdentifier("activity-count")
            Button("Second activity") {
                controller.receive(AgentRunState(
                    status: .running, runId: "fixture-second-run", stepCount: 1,
                    inFlightPhase: "model", updatedAt: Date().timeIntervalSince1970 * 1_000
                ), threadId: "live-activity-second-fixture")
            }
            .accessibilityIdentifier("activity-second")
            Button("Clear activities") { Task { await controller.reset() } }
                .accessibilityIdentifier("activity-clear")
        }
        .task {
            publish(.running)
            while !Task.isCancelled {
                activityCount = Activity<AgentActivityAttributes>.activities.filter {
                    $0.activityState == .active || $0.activityState == .stale
                }.count
                try? await Task.sleep(for: .seconds(1))
            }
        }
        .onOpenURL { url in
            openedThread = AgentActivityAttributes.conversationID(from: url) ?? ""
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .inactive { controller.prepareForBackground() }
            if phase == .active { controller.refresh() }
        }
    }

    private func publish(_ phase: AgentActivityAttributes.Phase) {
        let status: AgentRunStatus
        switch phase {
        case .starting, .running, .executing: status = .running
        case .stopping: status = .stopRequested
        case .paused: status = .paused
        case .completed: status = .completed
        case .failed: status = .failed
        }
        controller.receive(AgentRunState(
            status: status,
            runId: "fixture-run",
            stepCount: phase == .starting ? 0 : 1,
            inFlightPhase: phase == .executing ? "tool" : phase == .starting ? nil : "model",
            updatedAt: Date().timeIntervalSince1970 * 1_000
        ), threadId: threadId)
    }
}
#endif
