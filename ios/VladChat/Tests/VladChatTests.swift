import Foundation
import Testing
@testable import VladChat

struct VladChatTests {
    @MainActor
    @Test func modelCatalogStartsWithWebDefault() {
        #expect(AppConfig.shared.availableModels.first?.id == "zai/glm-5.3-flash")
    }

    @Test func mobileResponseDecodesFutureValuesWithoutDroppingTheMessage() throws {
        let payload = """
        {
          "phase": "reconnecting",
          "tools": [
            {
              "id": "call-1",
              "name": "future_search",
              "status": "paused"
            }
          ],
          "parts": [
            {
              "id": "part-1",
              "type": "future-part",
              "state": "partial",
              "text": "Still available"
            }
          ]
        }
        """.data(using: .utf8)!

        let activity = try JSONDecoder().decode(ResponseActivity.self, from: payload)

        #expect(activity.phase == .unknown)
        #expect(activity.tools[0].status == .unknown)
        #expect(activity.parts[0].type == .unknown)
        #expect(activity.parts[0].state == .unknown)
        #expect(activity.parts[0].text == "Still available")
    }

    @Test func streamingChunkerKeepsCompletedBlockIdentityStable() {
        let chunker = StreamingMarkdownChunker()
        chunker.appendToken("First paragraph\n\n")
        let firstSnapshot = chunker.getAllChunks()

        chunker.appendToken("Second paragraph\n\n")
        let secondSnapshot = chunker.getAllChunks()

        #expect(firstSnapshot.first?.id == "paragraph_0")
        #expect(secondSnapshot.first?.id == firstSnapshot.first?.id)
        #expect(secondSnapshot.dropFirst().first?.id == "paragraph_1")
    }

    @Test func streamingChunkerKeepsActiveBlockIdentityWhenItFinalizes() {
        let chunker = StreamingMarkdownChunker()
        chunker.appendToken("Growing paragraph")
        let activeSnapshot = chunker.getAllChunks()

        chunker.appendToken("\n\n")
        let completedSnapshot = chunker.getAllChunks()

        #expect(completedSnapshot.first?.id == activeSnapshot.first?.id)
        #expect(completedSnapshot.first?.isComplete == true)
    }

    @Test func terminalResponseKeepsReasoningFromTheLastStreamingSnapshot() {
        let reasoning = ResponsePart(
            id: "reasoning-live",
            type: .reasoning,
            text: "The final thinking stays attached to this answer.",
            state: .done,
            sourceId: nil,
            url: nil,
            title: nil,
            tool: nil
        )
        let previous = ResponseActivity(
            phase: .responding,
            tools: [],
            parts: [reasoning]
        )
        let finalText = ResponsePart(
            id: "text-stored",
            type: .text,
            text: "The answer is complete.",
            state: .done,
            sourceId: nil,
            url: nil,
            title: nil,
            tool: nil
        )
        let terminal = ResponseActivity(
            phase: .complete,
            tools: [],
            parts: [finalText]
        )

        let retained = terminal.retainingReasoning(from: previous)

        #expect(retained.phase == .complete)
        #expect(retained.parts.map(\.id) == [reasoning.id, finalText.id])
        #expect(retained.parts.filter { $0.type == .reasoning }.count == 1)
    }
}
