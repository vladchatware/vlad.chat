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

    private var computerUseE2EScenario: ComputerUseE2EHarnessView.Scenario? {
        if ProcessInfo.processInfo.arguments.contains("--ui-test-computer-sandbox-failure") {
            return .sandboxResumeFailure
        }
        if ProcessInfo.processInfo.arguments.contains("--ui-test-computer-viewer") {
            return .viewerFixture
        }
        if ProcessInfo.processInfo.arguments.contains("--ui-test-computer-viewer-connecting") {
            return .viewerConnecting
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
            } else if isThinkingLabelUITest {
                ThinkingLabelE2EView(viewModel: chat)
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
