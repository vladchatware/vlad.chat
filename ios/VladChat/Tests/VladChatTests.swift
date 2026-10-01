import Foundation
import Testing
@testable import VladChat

struct VladChatTests {
    @Test func queuedGenerationResultDecodesWithoutMessageOrder() throws {
        let payload = """
        {
          "threadId": "thread-1",
          "runId": "run-1",
          "queued": true
        }
        """.data(using: .utf8)!

        let result = try JSONDecoder().decode(GenerationResult.self, from: payload)

        #expect(result.threadId == "thread-1")
        #expect(result.order == nil)
        #expect(result.promptMessageId == nil)
        #expect(result.runId == "run-1")
        #expect(result.queued == true)
    }

    @Test func regeneratedResponseAcknowledgesReusedOrder() {
        for status in ["streaming", "success", "failed"] {
            let snapshot = generationSnapshot([
                generationMessage(id: "answer", role: "assistant", order: 0, status: status, createdAt: 2),
            ])

            #expect(snapshot.hasObservedLocalGeneration(
                expectedOrder: 0,
                previousMessages: previousGenerationMessages(),
                optimisticText: "Hello"
            ))
        }
    }

    @Test func regeneratedPromptAcknowledgesReusedOrderBeforeActionReturns() {
        let snapshot = generationSnapshot([
            generationMessage(id: "user", role: "user", order: 0, createdAt: 2),
        ])

        #expect(snapshot.hasObservedLocalGeneration(
            expectedOrder: nil,
            previousMessages: previousGenerationMessages(),
            optimisticText: "Hello"
        ))
    }

    @Test func staleSnapshotCannotAcknowledgeRegeneration() {
        let snapshot = generationSnapshot([
            generationMessage(id: "user", role: "user", order: 0),
            generationMessage(id: "answer", role: "assistant", order: 0),
        ])
        let expectedOrders: [Double?] = [nil, 0]

        for order in expectedOrders {
            #expect(!snapshot.hasObservedLocalGeneration(
                expectedOrder: order,
                previousMessages: previousGenerationMessages(),
                optimisticText: "Hello"
            ))
        }
    }

    @Test func promptAloneDoesNotAcknowledgeResponseAfterActionReturns() {
        let snapshot = generationSnapshot([
            generationMessage(id: "user", role: "user", order: 0, createdAt: 2),
        ])

        #expect(!snapshot.hasObservedLocalGeneration(
            expectedOrder: 0,
            previousMessages: previousGenerationMessages(),
            optimisticText: "Hello"
        ))
    }

    @Test func responseBeforeExpectedOrderCannotAcknowledgeGeneration() {
        let snapshot = generationSnapshot([
            generationMessage(id: "other-answer", role: "assistant", order: 2),
        ])

        #expect(!snapshot.hasObservedLocalGeneration(
            expectedOrder: 3,
            previousMessages: [:],
            optimisticText: "Hello"
        ))
    }

    private func generationMessage(
        id: String,
        role: String,
        order: Double,
        status: String = "success",
        createdAt: Double = 1
    ) -> ChatMessage {
        ChatMessage(
            id: id,
            role: role,
            text: role == "user" ? "Hello" : "Completed answer",
            status: status,
            order: order,
            createdAt: createdAt,
            response: role == "assistant" ? ResponseActivity(phase: .complete, tools: []) : nil,
            errorText: nil,
            attachments: []
        )
    }

    private func previousGenerationMessages() -> [String: ChatMessage] {
        [
            "user": generationMessage(id: "user", role: "user", order: 0),
            "answer": generationMessage(id: "answer", role: "assistant", order: 0),
        ]
    }

    private func generationSnapshot(_ messages: [ChatMessage]) -> MobileChat {
        MobileChat(
            threadId: "thread-regenerate",
            title: "Reloaded chat",
            threads: nil,
            messages: messages,
            account: nil,
            remainingMessages: nil,
            computerViewer: nil
        )
    }

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

    @Test func computerToolResultPreservesViewerAlongsideMCPMetadata() throws {
        let viewer = "https://sb-example.vercel.run/vnc.html?autoconnect=1&resize=scale"
        let result = #"{"ok":true,"op":"open","viewerUrl":"https://sb-example.vercel.run/vnc.html?autoconnect=1&resize=scale"}"#
        let metadata = #"{"conversation_id":"conversation-example"}"#
        for texts in [[result, metadata], [metadata, result]] {
            let blocks = texts.map { ["type": "text", "text": $0] }
            let payloads = [
                try JSONEncoder().encode(blocks),
                try JSONEncoder().encode(["content": blocks]),
            ]
            for data in payloads {
                let parsed = ComputerToolResult.parse(from: String(decoding: data, as: UTF8.self))
                #expect(parsed?.ok == true)
                #expect(parsed?.op == .open)
                #expect(parsed?.viewerUrl == viewer)
            }
        }
    }

    @Test func computerViewerAcceptsOnlyTrustedSandboxRFBURLs() throws {
        let validURL = "https://sb-example.vercel.run/vladchat.html"
        let valid = try #require(ComputerToolResult.parse(from: """
        {"ok":true,"op":"open","nativeViewerUrl":"\(validURL)"}
        """))
        #expect(valid.nativeViewerUrl == validURL)
        #expect(valid.validatedNativeViewerURL?.absoluteString == validURL)

        let untrusted = try #require(ComputerToolResult.parse(from: """
        {"ok":true,"op":"open","nativeViewerUrl":"https://attacker.example/vladchat.html"}
        """))
        #expect(untrusted.validatedNativeViewerURL == nil)

        let mobileValid = MobileComputerViewerSession(
            sessionId: String(repeating: "c", count: 32),
            viewerUrl: "https://sb-example.vercel.run/vnc.html",
            nativeViewerUrl: validURL
        )
        #expect(mobileValid.validatedNativeViewerURL?.absoluteString == validURL)

        let mobileInvalid = MobileComputerViewerSession(
            sessionId: String(repeating: "c", count: 32),
            viewerUrl: nil,
            nativeViewerUrl: "https://attacker.example/vladchat.html"
        )
        #expect(mobileInvalid.validatedNativeViewerURL == nil)
    }

    @MainActor
    @Test func publishedComputerSessionStartsBeforeToolResultArrives() throws {
        let sessionId = String(repeating: "d", count: 32)
        let viewerURL = "https://sb-example.vercel.run/vladchat.html"
        let viewModel = ChatViewModel()
        defer { viewModel.computerUseController.stop() }

        let mobileChat = MobileChat(
            threadId: "thread-active",
            title: "Active thread",
            threads: nil,
            messages: [],
            account: nil,
            remainingMessages: nil,
            computerViewer: MobileComputerViewerSession(
                sessionId: sessionId,
                viewerUrl: "https://sb-example.vercel.run/vnc.html",
                nativeViewerUrl: viewerURL
            )
        )

        viewModel.updateComputerUseSession(from: mobileChat, isActive: true)

        #expect(viewModel.computerUseController.state == .connecting)
        #expect(viewModel.computerUseController.presentation == .floating)
    }

    @MainActor
    @Test func completedComputerToolCanResumeItsStillLiveSession() throws {
        let sessionId = String(repeating: "f", count: 32)
        let viewerURL = "https://sb-example.vercel.run/vladchat.html"
        let output = """
        {"ok":true,"op":"open","nativeViewerUrl":"\(viewerURL)"}
        """
        let openTool = ResponseTool(
            id: "open-call",
            name: "computer_open",
            status: .completed,
            output: output,
            title: nil,
            inputSummary: nil,
            outputTruncated: nil,
            errorText: nil
        )
        let assistantMessage = ChatMessage(
            id: "completed-message",
            role: "assistant",
            text: "Computer session opened.",
            status: "completed",
            order: 1,
            createdAt: 1,
            response: ResponseActivity(phase: .complete, tools: [openTool]),
            errorText: nil,
            attachments: []
        )
        let viewModel = ChatViewModel()
        defer { viewModel.computerUseController.stop() }

        let mobileChat = MobileChat(
            threadId: "thread-existing",
            title: "Existing thread",
            threads: nil,
            messages: [assistantMessage],
            account: nil,
            remainingMessages: nil,
            computerViewer: MobileComputerViewerSession(
                sessionId: sessionId,
                viewerUrl: "https://sb-example.vercel.run/vnc.html",
                nativeViewerUrl: viewerURL
            )
        )

        viewModel.updateComputerUseSession(from: mobileChat, isActive: false)

        #expect(viewModel.computerUseController.state == .connecting)
        #expect(viewModel.computerUseController.presentation == .floating)
        #expect(viewModel.computerUseController.canControl)
    }

    @MainActor
    @Test func activeComputerOpenResultShowsPreviewBeforeLiveSessionPublication() {
        let viewerURL = "https://sb-example.vercel.run/vladchat.html"
        let openTool = ResponseTool(
            id: "open-call-published-late",
            name: "computer_open",
            status: .completed,
            output: #"{"ok":true,"op":"open","nativeViewerUrl":"https://sb-example.vercel.run/vladchat.html"}"#,
            title: nil,
            inputSummary: nil,
            outputTruncated: nil,
            errorText: nil
        )
        let message = ChatMessage(
            id: "active-open-message",
            role: "assistant",
            text: "The computer is open.",
            status: "streaming",
            order: 1,
            createdAt: 1,
            response: ResponseActivity(phase: .tool, tools: [openTool]),
            errorText: nil,
            attachments: []
        )
        let viewModel = ChatViewModel()
        defer { viewModel.computerUseController.stop() }

        let mobileChat = MobileChat(
            threadId: "thread-live-open",
            title: "Live open thread",
            threads: nil,
            messages: [message],
            account: nil,
            remainingMessages: nil,
            computerViewer: nil
        )

        viewModel.updateComputerUseSession(from: mobileChat, isActive: true)

        #expect(viewModel.computerUseController.state == .connecting)
        #expect(viewModel.computerUseController.presentation == .floating)
        #expect(viewModel.computerUseController.owningThreadID == "thread-live-open")
    }

    @MainActor
    @Test func runningComputerOpenShowsStartingPreviewBeforeSessionPublication() {
        let openTool = ResponseTool(
            id: "open-call-starting",
            name: "computer_open",
            status: .running,
            output: nil,
            title: nil,
            inputSummary: "Opening the requested page",
            outputTruncated: nil,
            errorText: nil
        )
        let message = ChatMessage(
            id: "streaming-open-message",
            role: "assistant",
            text: "",
            status: "streaming",
            order: 1,
            createdAt: 1,
            response: ResponseActivity(phase: .tool, tools: [openTool]),
            errorText: nil,
            attachments: []
        )
        let viewModel = ChatViewModel()
        defer { viewModel.computerUseController.stop() }

        let mobileChat = MobileChat(
            threadId: "thread-starting",
            title: "Starting thread",
            threads: nil,
            messages: [message],
            account: nil,
            remainingMessages: nil,
            computerViewer: nil
        )

        viewModel.updateComputerUseSession(from: mobileChat, isActive: true)

        #expect(viewModel.computerUseController.state == .starting)
        #expect(viewModel.computerUseController.presentation == .floating)
    }

    @MainActor
    @Test func completedComputerToolDoesNotReopenItsHistoricalViewerURL() {
        let staleURL = "https://old-session.vercel.run/vladchat.html"
        let openTool = ResponseTool(
            id: "open-call-expired",
            name: "computer_open",
            status: .completed,
            output: #"{"ok":true,"op":"open","nativeViewerUrl":"https://old-session.vercel.run/vladchat.html"}"#,
            title: nil,
            inputSummary: nil,
            outputTruncated: nil,
            errorText: nil
        )
        let message = ChatMessage(
            id: "completed-old-session",
            role: "assistant",
            text: "The browser task completed.",
            status: "completed",
            order: 1,
            createdAt: 1,
            response: ResponseActivity(phase: .complete, tools: [openTool]),
            errorText: nil,
            attachments: []
        )
        let viewModel = ChatViewModel()
        defer { viewModel.computerUseController.stop() }

        let mobileChat = MobileChat(
            threadId: "thread-expired",
            title: "Expired thread",
            threads: nil,
            messages: [message],
            account: nil,
            remainingMessages: nil,
            computerViewer: nil
        )

        viewModel.updateComputerUseSession(from: mobileChat, isActive: false)

        #expect(viewModel.computerUseController.state == .idle)
        #expect(viewModel.computerUseController.presentation == .hidden)
        #expect(viewModel.computerUseController.webView.url?.absoluteString != staleURL)
    }

    @Test func computerToolResultParsesJSONEncodedString() {
        // Double-encoded: a JSON string whose value is the ComputerToolResult JSON.
        let inner = #"{"ok":true,"op":"screenshot","screenshotUrl":"https://cdn.example/s.png"}"#
        let encodedData = try! JSONEncoder().encode(inner)
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

    @Test func computerToolStatusUsesOperationOutcome() throws {
        let failure = try #require(ComputerToolResult.parse(from:
            #"{"ok":false,"op":"act","code":"runtime","error":"Click failed."}"#
        ))
        let failedStatus = ComputerUseDisplayStatus(toolStatus: .completed, result: failure)
        #expect(failedStatus == .failed)
        #expect(failedStatus.label == "Failed")
        #expect(failedStatus.needsAttention)

        let success = try #require(ComputerToolResult.parse(from: #"{"ok":true,"op":"act"}"#))
        #expect(ComputerUseDisplayStatus(toolStatus: .completed, result: success) == .done)
        #expect(ComputerUseDisplayStatus(toolStatus: .failed, result: success) == .failed)
    }

    @Test func computerToolHandoffNeedsUserRegardlessOfCompletion() throws {
        for ok in [true, false] {
            let result = try #require(ComputerToolResult.parse(from: """
            {"ok":\(ok),"op":"handoff","handoff":{"type":"computer_handoff","reason":"2fa","message":"Enter your verification code.","requiresUser":true}}
            """))
            for transportStatus in [ResponseTool.Status.completed, .failed] {
                let status = ComputerUseDisplayStatus(toolStatus: transportStatus, result: result)
                #expect(status == .needsUser)
                #expect(status.label == "Needs you")
                #expect(status.needsAttention)
            }
        }
    }

    @Test func computerToolStatusPreservesLifecycleWithoutResult() {
        let statuses: [(ResponseTool.Status, ComputerUseDisplayStatus)] = [
            (.pending, .waiting), (.running, .running), (.completed, .done),
            (.failed, .failed), (.stopped, .stopped), (.unknown, .unknown),
        ]
        for (transportStatus, expected) in statuses {
            #expect(ComputerUseDisplayStatus(toolStatus: transportStatus, result: nil) == expected)
        }
        #expect(ComputerUseDisplayStatus(toolStatus: nil, result: nil) == .unknown)
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
