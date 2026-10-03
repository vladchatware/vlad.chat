import ActivityKit
import SwiftUI
import WidgetKit

@main
struct VladAgentWidgets: WidgetBundle {
    var body: some Widget { AgentLiveActivity() }
}

struct AgentLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: AgentActivityAttributes.self) { context in
            AgentActivitySummary(state: context.state, isStale: context.isStale)
                .padding()
                .activityBackgroundTint(.black)
                .activitySystemActionForegroundColor(.white)
                .widgetURL(context.attributes.conversationURL)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Label("Vlad", systemImage: "sparkles")
                        .font(.headline)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    AgentActivityStatus(state: context.state, isStale: context.isStale)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    if context.isStale {
                        Text("Open chat for latest status")
                    } else {
                        Text("Step \(context.state.stepCount, format: .number)")
                    }
                }
            } compactLeading: {
                Image(systemName: "sparkles")
                    .accessibilityLabel("Vlad agent")
            } compactTrailing: {
                Image(systemName: context.isStale ? "clock.badge.exclamationmark" : context.state.phase.symbol)
                    .accessibilityLabel(context.isStale ? LocalizedStringResource("Status outdated") : context.state.phase.label)
            } minimal: {
                Image(systemName: context.isStale ? "clock.badge.exclamationmark" : context.state.phase.symbol)
                    .accessibilityLabel(context.isStale ? LocalizedStringResource("Status outdated") : context.state.phase.label)
            }
            .widgetURL(context.attributes.conversationURL)
            .keylineTint(.white)
        }
    }
}

private struct AgentActivitySummary: View {
    let state: AgentActivityAttributes.ContentState
    let isStale: Bool

    var body: some View {
        HStack {
            Image(systemName: "sparkles")
                .font(.title2)
            VStack(alignment: .leading, spacing: 4) {
                Text("Vlad agent").font(.headline)
                AgentActivityStatus(state: state, isStale: isStale)
            }
            Spacer()
            if !isStale {
                Text("Step \(state.stepCount, format: .number)")
                    .font(.caption)
            }
        }
        .foregroundStyle(.white)
    }
}

private struct AgentActivityStatus: View {
    let state: AgentActivityAttributes.ContentState
    let isStale: Bool

    var body: some View {
        if isStale {
            Label("Status outdated", systemImage: "clock.badge.exclamationmark")
        } else {
            Label { Text(state.phase.label) } icon: { Image(systemName: state.phase.symbol) }
        }
    }
}
