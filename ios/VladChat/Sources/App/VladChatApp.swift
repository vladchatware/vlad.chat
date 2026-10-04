import SwiftUI

@main
struct VladChatApp: App {
    @StateObject private var chat = ChatViewModel()

#if DEBUG
    private var isInferenceGalleryUITest: Bool {
        ProcessInfo.processInfo.arguments.contains("--ui-test-gallery")
    }

    private var isStreamingScrollUITest: Bool {
        ProcessInfo.processInfo.arguments.contains("--ui-test-streaming-scroll")
    }

    private var isThinkingLabelUITest: Bool {
        ProcessInfo.processInfo.arguments.contains("--ui-test-thinking-label")
    }

    private var isSeededChatHistoryUITest: Bool {
        ProcessInfo.processInfo.arguments.contains("--ui-test-seeded-chat-history")
    }

    private var isThreadSyncScrollUITest: Bool {
        ProcessInfo.processInfo.arguments.contains("--ui-test-thread-sync-scroll")
    }

    private var agentRunStatusPillUITestPresentation: AgentRunStatusPresentation? {
        guard ProcessInfo.processInfo.arguments.contains("--ui-test-agent-status-pill") else {
            return nil
        }
        return AgentRunStatusPresentation(
            runId: "ui-test-run",
            phase: .executing,
            stepCount: 4
        )
    }

    private var computerUseE2EScenario: ComputerUseE2EHarnessView.Scenario? {
        if ProcessInfo.processInfo.arguments.contains("--ui-test-computer-sandbox-failure") {
            return .sandboxResumeFailure
        }
        if ProcessInfo.processInfo.arguments.contains("--ui-test-computer-viewer") {
            return .viewerFixture
        }
        if ProcessInfo.processInfo.arguments.contains("--ui-test-computer-production") {
            return .viewerProduction
        }
        if ProcessInfo.processInfo.arguments.contains("--ui-test-computer-viewer-connecting") {
            return .viewerConnecting
        }
        if ProcessInfo.processInfo.arguments.contains("--ui-test-computer-viewer-timeout") {
            return .viewerTimeout
        }
        return nil
    }
#endif

    var body: some Scene {
        WindowGroup {
#if DEBUG
            if isStreamingScrollUITest {
                StreamingScrollE2EView(viewModel: chat)
            } else if isSeededChatHistoryUITest {
                SeededChatHistoryHarnessView(viewModel: chat)
                    .environmentObject(chat)
            } else if isThreadSyncScrollUITest {
                ThreadSyncScrollHarnessView(viewModel: chat)
                    .environmentObject(chat)
            } else if isThinkingLabelUITest {
                ThinkingLabelE2EView(viewModel: chat)
            } else if let agentRunStatusPillUITestPresentation {
                ChatContainer(agentRunStatusOverride: agentRunStatusPillUITestPresentation)
                    .environmentObject(chat)
            } else if isInferenceGalleryUITest {
                InferenceStateGallery()
            } else if let computerUseE2EScenario {
                ComputerUseE2EHarnessView(scenario: computerUseE2EScenario)
            } else {
                chatApplication
            }
#else
            chatApplication
#endif
        }
    }

    private var chatApplication: some View {
        ChatContainer()
            .environmentObject(chat)
            .task {
                await chat.start()
            }
    }
}
