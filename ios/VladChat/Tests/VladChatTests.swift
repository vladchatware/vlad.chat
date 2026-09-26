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

    @Test func computerToolResultParsesScreenshotAndHandoff() throws {
        let screenshotJSON = """
        {"ok":true,"op":"screenshot","url":"https://example.com","title":"Example","screenshotUrl":"https://cdn.example/shot.png","screenshotId":"abc","mimeType":"image/png","width":1280,"height":720}
        """
        let shot = ComputerToolResult.parse(from: screenshotJSON)
        #expect(shot?.ok == true)
        #expect(shot?.op == .screenshot)
        #expect(shot?.hasScreenshot == true)
        #expect(shot?.screenshotUrl == "https://cdn.example/shot.png")

        let handoffJSON = """
        {"ok":false,"op":"act","handoff":{"type":"computer_handoff","reason":"sso","message":"Sign in to continue.","requiresUser":true},"error":"Sign in to continue."}
        """
        let handoff = ComputerToolResult.parse(from: handoffJSON)
        #expect(handoff?.hasHandoff == true)
        #expect(handoff?.handoff?.reason == .sso)
        #expect(handoff?.handoff?.requiresUser == true)

        let tool = ResponseTool(
            id: "t1",
            name: "computer_screenshot",
            status: .completed,
            output: screenshotJSON,
            title: nil,
            inputSummary: nil,
            outputTruncated: nil,
            errorText: nil
        )
        #expect(tool.isComputerUseTool)
        #expect(tool.computerResult?.hasScreenshot == true)
    }

    @Test func computerToolResultParsesMCPContentWrapper() {
        // Mirrors lib/computer-use/mcp-tools.ts mcpResult():
        // { content: [{ type: "text", text: JSON.stringify(result) }] }
        let inner =
            #"{"ok":true,"op":"open","url":"https://example.com","title":"Example","screenshotUrl":"https://cdn.example/open.png","screenshotId":"open1","mimeType":"image/png","width":1280,"height":720,"budget":{"stepsUsed":1,"stepsRemaining":19,"maxSteps":20,"ttlMs":480000,"elapsedMs":900,"note":"ok"}}"#
        let mcpObject: [String: Any] = [
            "content": [
                ["type": "text", "text": inner],
            ],
        ]
        let mcpData = try! JSONSerialization.data(withJSONObject: mcpObject)
        let mcpOutput = String(data: mcpData, encoding: .utf8)!

        let parsed = ComputerToolResult.parse(from: mcpOutput)
        #expect(parsed?.ok == true)
        #expect(parsed?.op == .open)
        #expect(parsed?.hasScreenshot == true)
        #expect(parsed?.budget?.stepsUsed == 1)
        #expect(parsed?.budget?.maxSteps == 20)

        let tool = ResponseTool(
            id: "mcp-open",
            name: "computer_open",
            status: .completed,
            output: mcpOutput,
            title: nil,
            inputSummary: "url: https://example.com",
            outputTruncated: false,
            errorText: nil
        )
        #expect(tool.isComputerUseTool)
        #expect(tool.computerResult?.op == .open)
        #expect(tool.computerResult?.hasScreenshot == true)
    }

    @Test func computerToolResultParsesMCPContentArrayAlone() {
        let inner =
            #"{"ok":true,"op":"act","action":"click","screenshotUrl":"https://cdn.example/act.png","width":1280,"height":720}"#
        let array: [Any] = [["type": "text", "text": inner]]
        let data = try! JSONSerialization.data(withJSONObject: array)
        let arrayOutput = String(data: data, encoding: .utf8)!

        let parsed = ComputerToolResult.parse(from: arrayOutput)
        #expect(parsed?.ok == true)
        #expect(parsed?.op == .act)
        #expect(parsed?.action == "click")
        #expect(parsed?.hasScreenshot == true)
    }

    @Test func computerToolResultParsesJSONEncodedString() {
        // Double-encoded: a JSON string whose value is the ComputerToolResult JSON.
        let inner = #"{"ok":true,"op":"screenshot","screenshotUrl":"https://cdn.example/s.png"}"#
        let encodedData = try! JSONSerialization.data(withJSONObject: inner)
        let encoded = String(data: encodedData, encoding: .utf8)!
        let parsed = ComputerToolResult.parse(from: encoded)
        #expect(parsed?.op == .screenshot)
        #expect(parsed?.hasScreenshot == true)
    }

    @Test func computerToolResultParsesBudgetAndErrorCodes() {
        let budgetJSON = """
        {"ok":false,"op":"act","code":"budget_exceeded","error":"Step budget exhausted.","budget":{"stepsUsed":20,"stepsRemaining":0,"maxSteps":20,"ttlMs":480000,"elapsedMs":60000,"note":"hit cap"}}
        """
        let result = ComputerToolResult.parse(from: budgetJSON)
        #expect(result?.ok == false)
        #expect(result?.code == .budgetExceeded)
        #expect(result?.statusSummary == "Budget exceeded")
        #expect(result?.budget?.stepsRemaining == 0)

        let ttl = ComputerToolResult.parse(from: #"{"ok":false,"op":"screenshot","code":"ttl_exceeded","error":"TTL"}"#)
        #expect(ttl?.code == .ttlExceeded)
        #expect(ttl?.statusSummary == "Session timed out")

        let runtime = ComputerToolResult.parse(from: #"{"ok":false,"op":"end","code":"runtime","error":"boom"}"#)
        #expect(runtime?.code == .runtime)

        let future = ComputerToolResult.parse(from: #"{"ok":false,"op":"act","code":"future_code","error":"x"}"#)
        #expect(future?.code == .unknown)
    }

    @Test func computerToolNamesAreRecognizedWithoutOutput() {
        for name in ["computer_open", "computer_screenshot", "computer_act", "computer_handoff", "computer_end"] {
            let tool = ResponseTool(
                id: name,
                name: name,
                status: .running,
                output: nil,
                title: nil,
                inputSummary: nil,
                outputTruncated: nil,
                errorText: nil
            )
            #expect(tool.isComputerUseTool)
        }
    }

    @Test func computerToolResultIgnoresNonJSONOutput() {
        #expect(ComputerToolResult.parse(from: "plain text") == nil)
        #expect(ComputerToolResult.parse(from: nil) == nil)
        let tool = ResponseTool(
            id: "t2",
            name: "web_search",
            status: .completed,
            output: "three sources",
            title: "Search",
            inputSummary: "query: cats",
            outputTruncated: nil,
            errorText: nil
        )
        #expect(tool.isComputerUseTool == false)
    }

    @Test func unknownHandoffReasonFallsBackGracefully() throws {
        let json = """
        {"ok":false,"op":"handoff","handoff":{"type":"computer_handoff","reason":"future_reason","message":"Do the thing.","requiresUser":true}}
        """.data(using: .utf8)!
        let result = try JSONDecoder().decode(ComputerToolResult.self, from: json)
        #expect(result.handoff?.reason == .unknown)
        #expect(result.op == .handoff)
    }
}

