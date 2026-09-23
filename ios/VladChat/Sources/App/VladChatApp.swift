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
#endif

    var body: some Scene {
        WindowGroup {
#if DEBUG
            if isStreamingScrollUITest {
                StreamingScrollE2EView(viewModel: chat)
            } else if isInferenceGalleryUITest {
                InferenceStateGallery()
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
