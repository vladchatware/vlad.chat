import Foundation
import Testing
@testable import VladChat

struct VladChatTests {
    @MainActor
    @Test func modelCatalogStartsWithWebDefault() {
        #expect(AppConfig.shared.availableModels.first?.id == "zai/glm-5.3-flash")
    }
}

struct ResponseLifecycleTests {
    @MainActor
    @Test func restoresActivityWithoutALocalGenerationTask() {
        let model = ChatViewModel()
        model.apply(snapshot(phase: .thinking))
        #expect(model.isLoading)
        #expect(model.messages.last?.responseActivity?.phase == .thinking)
        #expect(model.messages.last?.isStreaming == true)

        model.apply(snapshot(phase: .complete))
        #expect(!model.isLoading)
        #expect(model.messages.last?.isStreaming == false)
        #expect(model.messages.last?.id == "thread:assistant:2")
    }

    @MainActor
    @Test func activityBelongsToSelectedConversation() {
        let model = ChatViewModel()
        model.apply(snapshot(phase: .tool))
        #expect(model.isLoading)
        model.apply(snapshot(phase: .complete, threadId: "other"))
        #expect(!model.isLoading)
        model.apply(snapshot(phase: .responding))
        #expect(model.isLoading)
    }

    @MainActor
    @Test func terminalStatesAllowSendingAgain() {
        for phase in [ResponsePhase.complete, .stopped, .failed] {
            let model = ChatViewModel()
            model.apply(snapshot(phase: phase))
            #expect(!model.isLoading)
            #expect(model.messages.last?.responseActivity?.phase == phase)
        }
    }

    @Test func responseActivitySurvivesMessageCoding() throws {
        var message = Message(id: "response", role: .assistant, content: "")
        message.responseActivity = ResponseActivity(phase: .tool, tools: [
            ResponseTool(id: "call", name: "search", status: .running)
        ])
        let data = try JSONEncoder().encode(message)
        let restored = try JSONDecoder().decode(Message.self, from: data)
        #expect(restored.responseActivity == message.responseActivity)
    }

    private func snapshot(phase: ResponsePhase, threadId: String = "thread") -> MobileChat {
        MobileChat(
            threadId: threadId, title: "Chat",
            threads: [MobileThread(id: threadId, title: "Chat", createdAt: 1)],
            messages: [ChatMessage(
                id: "\(threadId):assistant:2", role: "assistant", text: "",
                status: phase.isActive ? "streaming" : "success", order: 2, createdAt: 1,
                attachments: [], response: ResponseActivity(phase: phase)
            )], account: nil, remainingMessages: nil
        )
    }
}
