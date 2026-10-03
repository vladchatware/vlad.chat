import ActivityKit
import ConvexMobile
import Foundation
import OSLog
import UIKit

/// Owns activities independently of the selected conversation. The app's normal
/// query supplies the first snapshot; an activity retains its own subscription.
@MainActor
final class AgentLiveActivityController {
    private let logger = Logger(subsystem: "chat.vlad.ios", category: "LiveActivity")
    private var client: ConvexClientWithAuth<ConvexAuthSession>?
    private var snapshots: [String: AgentRunState] = [:]
    private var dirtyThreads: Set<String> = []
    private var readyRuns: Set<String> = []
    private var dismissedRuns: Set<String> = []
    private var delays: [String: Task<Void, Never>] = [:]
    private var subscriptions: [String: Task<Void, Never>] = [:]
    private var activityObservers: [String: Task<Void, Never>] = [:]
    private var reconciliation: Task<Void, Never>?

    func connect(_ client: ConvexClientWithAuth<ConvexAuthSession>) {
        self.client = client
        for activity in Activity<AgentActivityAttributes>.activities {
            if activity.activityState == .ended || activity.activityState == .dismissed { continue }
            readyRuns.insert(activity.attributes.runId)
            watch(activity)
            subscribe(threadId: activity.attributes.threadId)
        }
    }

    func receive(_ state: AgentRunState?, threadId: String) {
        snapshots[threadId] = state
        if let content = state?.liveActivityState, !content.phase.isTerminal {
            subscribe(threadId: threadId)
        }
        dirtyThreads.insert(threadId)
        reconcile()
    }

    func refresh() {
        for threadId in Array(subscriptions.keys) {
            subscriptions.removeValue(forKey: threadId)?.cancel()
            subscribe(threadId: threadId)
        }
        dirtyThreads.formUnion(snapshots.keys)
        reconcile()
    }

    /// ActivityKit cannot create an activity after suspension. Flush the delay
    /// while still in the foreground when the person leaves the app.
    func prepareForBackground() {
        guard UIApplication.shared.applicationState != .background else { return }
        for (threadId, state) in snapshots {
            guard let runId = state.runId, let content = state.liveActivityState,
                  !content.phase.isTerminal else { continue }
            delays.removeValue(forKey: threadId)?.cancel()
            readyRuns.insert(runId)
            startActivity(threadId: threadId, runId: runId, content: content)
        }
    }

    func remove(threadId: String) {
        subscriptions.removeValue(forKey: threadId)?.cancel()
        delays.removeValue(forKey: threadId)?.cancel()
        receive(nil, threadId: threadId)
    }

    func reset() async {
        subscriptions.values.forEach { $0.cancel() }
        delays.values.forEach { $0.cancel() }
        activityObservers.values.forEach { $0.cancel() }
        subscriptions.removeAll()
        delays.removeAll()
        activityObservers.removeAll()
        snapshots.removeAll()
        dirtyThreads.removeAll()
        readyRuns.removeAll()
        dismissedRuns.removeAll()
        reconciliation?.cancel()
        await reconciliation?.value
        reconciliation = nil
        for activity in Activity<AgentActivityAttributes>.activities {
            await activity.end(nil, dismissalPolicy: .immediate)
        }
        client = nil
    }

    private func reconcile() {
        guard reconciliation == nil else { return }
        reconciliation = Task { [weak self] in
            guard let self else { return }
            defer { reconciliation = nil }
            while let threadId = dirtyThreads.first, !Task.isCancelled {
                dirtyThreads.remove(threadId)
                await apply(threadId: threadId)
            }
        }
    }

    private func apply(threadId: String) async {
        let state = snapshots[threadId]
        let content = state?.liveActivityState
        let activities = Activity<AgentActivityAttributes>.activities.filter {
            $0.attributes.threadId == threadId
        }
        for activity in activities where activity.attributes.runId != state?.runId || content == nil || content?.phase.isTerminal == true {
            activityObservers.removeValue(forKey: activity.id)?.cancel()
            await activity.end(content.map { ActivityContent(state: $0, staleDate: nil) }, dismissalPolicy: .immediate)
        }
        guard !Task.isCancelled else { return }
        // An update may have arrived while ending the previous run.
        guard state?.runId == snapshots[threadId]?.runId,
              content == snapshots[threadId]?.liveActivityState,
              let runId = state?.runId, let content, !content.phase.isTerminal else {
            delays.removeValue(forKey: threadId)?.cancel()
            return
        }
        let current = Activity<AgentActivityAttributes>.activities.first {
            $0.attributes.threadId == threadId && $0.attributes.runId == runId
                && ($0.activityState == .active || $0.activityState == .stale)
        }
        if let current {
            await current.update(ActivityContent(state: content, staleDate: Date().addingTimeInterval(120)))
            return
        }
        guard ActivityAuthorizationInfo().areActivitiesEnabled,
              UIApplication.shared.applicationState == .active,
              !dismissedRuns.contains(runId) else { return }
        guard readyRuns.contains(runId) else {
            if delays[threadId] == nil {
                delays[threadId] = Task { [weak self] in
                    try? await Task.sleep(for: .seconds(5))
                    guard !Task.isCancelled, let self else { return }
                    delays.removeValue(forKey: threadId)
                    guard snapshots[threadId]?.runId == runId else {
                        dirtyThreads.insert(threadId)
                        reconcile()
                        return
                    }
                    readyRuns.insert(runId)
                    dirtyThreads.insert(threadId)
                    reconcile()
                }
            }
            return
        }
        startActivity(threadId: threadId, runId: runId, content: content)
    }

    private func startActivity(threadId: String, runId: String, content: AgentActivityAttributes.ContentState) {
        guard ActivityAuthorizationInfo().areActivitiesEnabled, !dismissedRuns.contains(runId),
              !Activity<AgentActivityAttributes>.activities.contains(where: {
                  $0.attributes.runId == runId && ($0.activityState == .active || $0.activityState == .stale)
              }) else { return }
        do {
            let activity = try Activity.request(
                attributes: AgentActivityAttributes(threadId: threadId, runId: runId),
                content: ActivityContent(state: content, staleDate: Date().addingTimeInterval(120)),
                pushType: nil
            )
            watch(activity)
            subscribe(threadId: threadId)
        } catch {
            logger.error("Could not start agent Live Activity: \(error.localizedDescription, privacy: .public)")
        }
    }

    private func watch(_ activity: Activity<AgentActivityAttributes>) {
        guard activityObservers[activity.id] == nil else { return }
        activityObservers[activity.id] = Task { [weak self] in
            for await state in activity.activityStateUpdates {
                guard !Task.isCancelled, let self else { return }
                if state == .dismissed || state == .ended {
                    dismissedRuns.insert(activity.attributes.runId)
                    subscriptions.removeValue(forKey: activity.attributes.threadId)?.cancel()
                    activityObservers.removeValue(forKey: activity.id)
                    return
                }
            }
        }
    }

    private func subscribe(threadId: String) {
        guard subscriptions[threadId] == nil, let client else { return }
        subscriptions[threadId] = Task { [weak self] in
            var retryDelay: UInt64 = 1_000_000_000
            while !Task.isCancelled {
                do {
                    for try await state in client.subscribe(
                        to: "threads:getAgentRunState",
                        with: ["threadId": threadId],
                        yielding: AgentRunState?.self
                    ).values {
                        guard !Task.isCancelled, let self else { return }
                        receive(state, threadId: threadId)
                        retryDelay = 1_000_000_000
                        if state?.liveActivityState?.phase.isTerminal == true || state == nil {
                            subscriptions.removeValue(forKey: threadId)
                            return
                        }
                    }
                } catch {
                    guard !Task.isCancelled, let self else { return }
                    // Don't claim completion on transport failure. Widget's
                    // stale presentation replaces live status until reconnect.
                    logger.error("Agent Live Activity subscription interrupted")
                }
                try? await Task.sleep(nanoseconds: retryDelay)
                retryDelay = min(retryDelay * 2, 30_000_000_000)
            }
        }
    }
}
