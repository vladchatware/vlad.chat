import SwiftUI

@main
struct VladChatApp: App {
    @StateObject private var chat = ChatViewModel()

    var body: some Scene {
        WindowGroup {
            ChatContainer()
                .environmentObject(chat)
                .task {
                    await chat.start()
                }
        }
    }
}
