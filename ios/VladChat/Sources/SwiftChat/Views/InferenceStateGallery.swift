#if DEBUG
import SwiftUI

/// Offline gallery for reviewing the production inference states without a
/// network request. Fixtures use the same response DTOs as Convex snapshots.
struct InferenceStateGallery: View {
    @Environment(\.colorScheme) private var colorScheme
    @State private var replayStep = 0

    private var isDarkMode: Bool { colorScheme == .dark }
    private let replayBatches = [
        "The",
        "The response",
        "The response arrives",
        "The response arrives in calm, short runs.",
    ]

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: Theme.Dimensions.messageGroupSpacing) {
                    VStack(alignment: .leading, spacing: Theme.Dimensions.relatedItemSpacing) {
                        Text("Streaming reveal")
                            .font(.headline)
                        Text("Advance deterministic text batches through the production reveal view.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)

                        OrderedResponsePartsView(
                            activity: replayActivity,
                            isDarkMode: isDarkMode,
                            isStreaming: replayStep < replayBatches.count - 1,
                            fallbackContent: "",
                            contentChunks: [],
                            onSelectTool: { _ in },
                            onShowThoughts: {}
                        )

                        Button(replayStep == replayBatches.count - 1 ? "Restart reveal" : "Next batch") {
                            replayStep = replayStep == replayBatches.count - 1 ? 0 : replayStep + 1
                        }
                        .buttonStyle(.bordered)
                        .accessibilityIdentifier("streamingRevealAdvance")
                    }

                    VStack(alignment: .leading, spacing: Theme.Dimensions.relatedItemSpacing) {
                        Text("Web search control")
                            .font(.headline)
                        Text("The label and geometry stay fixed; only selection colors change.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)

                        HStack(spacing: Theme.Dimensions.relatedItemSpacing) {
                            WebSearchToggleButton(
                                isEnabled: false,
                                isDarkMode: isDarkMode,
                                accessibilityIdentifier: "webSearchToggleFixtureOff",
                                onToggle: {}
                            )
                            WebSearchToggleButton(
                                isEnabled: true,
                                isDarkMode: isDarkMode,
                                accessibilityIdentifier: "webSearchToggleFixtureOn",
                                onToggle: {}
                            )
                        }
                    }

                    ForEach(InferenceStateFixture.all) { fixture in
                        VStack(alignment: .leading, spacing: Theme.Dimensions.relatedItemSpacing) {
                            Text(fixture.title)
                                .font(.headline)
                            Text(fixture.description)
                                .font(.footnote)
                                .foregroundStyle(.secondary)

                            fixtureView(fixture)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(.vertical, Theme.Dimensions.paddingSmall)
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, Theme.Dimensions.transcriptGutter)
                .padding(.vertical, Theme.Dimensions.paddingLarge)
            }
            .navigationTitle("Inference states")
            .navigationBarTitleDisplayMode(.inline)
        }
    }

    private var replayActivity: ResponseActivity {
        ResponseActivity(
            phase: replayStep == replayBatches.count - 1 ? .complete : .responding,
            tools: [],
            parts: [
                ResponsePart(
                    id: "replay-text",
                    type: .text,
                    text: replayBatches[replayStep],
                    state: replayStep == replayBatches.count - 1 ? .done : .streaming,
                    sourceId: nil,
                    url: nil,
                    title: nil,
                    tool: nil
                ),
            ]
        )
    }

    @ViewBuilder
    private func fixtureView(_ fixture: InferenceStateFixture) -> some View {
        if fixture.activity.parts.isEmpty {
            AssistantActivityView(
                activity: fixture.activity,
                isDarkMode: isDarkMode,
                isStreaming: fixture.isStreaming,
                onSelectTool: { _ in }
            )
        } else {
            OrderedResponsePartsView(
                activity: fixture.activity,
                isDarkMode: isDarkMode,
                isStreaming: fixture.isStreaming,
                fallbackContent: "",
                contentChunks: [],
                onSelectTool: { _ in },
                onShowThoughts: {}
            )
        }
    }
}

/// Exercises UITableView's self-sizing row update at the end of a long stream.
/// Launched only by the DEBUG UI-test argument in VladChatApp.
struct StreamingScrollE2EView: View {
    @ObservedObject var viewModel: ChatViewModel
    @Environment(\.colorScheme) private var colorScheme
    @State private var isLoading = true
    @State private var isAtBottom = true
    @State private var userHasScrolled = false
    @State private var tableOpacity = 1.0
    @State private var scrollTrigger = UUID()
    @State private var scrollToUserTrigger = UUID()
    @State private var didSeedFixture = false
    @State private var didInsertHistoryRow = false

    private var isDarkMode: Bool { colorScheme == .dark }

    var body: some View {
        MessageTableView(
            archivedMessagesStartIndex: 0,
            isDarkMode: isDarkMode,
            isLoading: isLoading,
            viewModel: viewModel,
            isAtBottom: $isAtBottom,
            userHasScrolled: $userHasScrolled,
            scrollTrigger: scrollTrigger,
            scrollToUserTrigger: scrollToUserTrigger,
            tableOpacity: $tableOpacity,
            keyboardHeight: 0
        )
        .opacity(tableOpacity)
        .background(Color.chatBackground(isDarkMode: isDarkMode))
        .safeAreaInset(edge: .bottom, spacing: 0) {
            HStack {
                Text(isLoading ? "Streaming" : "Complete")
                    .accessibilityIdentifier("streamingCompletionStatus")
                Spacer()
                Button("Complete stream", action: completeStream)
                    .accessibilityIdentifier("finishStreamingFixture")
                    .disabled(!isLoading)
                Button("Insert history row", action: insertHistoryRow)
                    .accessibilityIdentifier("insertHistoryRowFixture")
                    .disabled(didInsertHistoryRow)
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 12)
            .background(Color.chatBackground(isDarkMode: isDarkMode))
        }
        .onAppear(perform: seedFixture)
    }

    private func seedFixture() {
        guard !didSeedFixture else { return }
        didSeedFixture = true

        var paragraphs = (1...10).map { index in
            "STREAM_ANCHOR_\(String(format: "%02d", index)) — Paragraph \(index) keeps enough readable text on screen to exercise streaming row height and scroll preservation. The reader should remain at this paragraph when the stream completes."
        }
        let exercisesMarkdownCompletion = ProcessInfo.processInfo.arguments.contains("--ui-test-streaming-markdown-reflow")
        if exercisesMarkdownCompletion {
            paragraphs[9] = """
            | Column A | Column B |
            | --- | --- |
            | STREAM_FINAL_MARKDOWN | A longer final table row that expands after completion |
            | Row 2 | Value 2 |
            | Row 3 | Value 3 |
            | Row 4 | Value 4 |
            | Row 5 | Value 5 |
            """
        }
        let fullText = paragraphs.joined(separator: "\n\n")
        var assistant = Message(id: "streaming-scroll-assistant", role: .assistant, content: fullText)
        assistant.isStreaming = true
        assistant.contentChunks = paragraphs.enumerated().map { index, paragraph in
            ContentChunk(
                id: "streaming-scroll-paragraph-\(index)",
                type: exercisesMarkdownCompletion && index == paragraphs.count - 1 ? .table : .paragraph,
                content: paragraph,
                isComplete: index < paragraphs.count - 1
            )
        }
        let user = Message(id: "streaming-scroll-user", role: .user, content: "Read this long streamed response.")
        let fixture = Chat(
            id: "streaming-scroll-ui-test",
            title: "Streaming scroll test",
            messages: [user, assistant],
            modelType: viewModel.currentModel
        )
        viewModel.currentChat = fixture
        viewModel.chats = [fixture]
        viewModel.isLoading = true
    }

    private func completeStream() {
        guard var chat = viewModel.currentChat, let lastIndex = chat.messages.indices.last else { return }
        chat.messages[lastIndex].isStreaming = false
        chat.messages[lastIndex].contentChunks = chat.messages[lastIndex].contentChunks.map { chunk in
            ContentChunk(id: chunk.id, type: chunk.type, content: chunk.content, isComplete: true)
        }
        viewModel.currentChat = chat
        viewModel.isLoading = false
        isLoading = false
    }

    private func insertHistoryRow() {
        guard !didInsertHistoryRow, var chat = viewModel.currentChat,
              chat.messages.indices.contains(1) else { return }
        chat.messages.insert(
            Message(id: "streaming-scroll-history-insert", role: .user, content: "A newly arrived older history message."),
            at: 1
        )
        viewModel.currentChat = chat
        viewModel.chats = [chat]
        didInsertHistoryRow = true
    }
}

/// Captures the production message row while its inline reasoning preview sits
/// below visible answer text, then records the terminal snapshot transition.
struct ThinkingLabelE2EView: View {
    @ObservedObject var viewModel: ChatViewModel
    @Environment(\.colorScheme) private var colorScheme
    @State private var isLoading = true
    @State private var isAtBottom = true
    @State private var userHasScrolled = false
    @State private var tableOpacity = 1.0
    @State private var scrollTrigger = UUID()
    @State private var scrollToUserTrigger = UUID()
    @State private var didSeedFixture = false

    private let answer = "ANSWER_VISIBLE — the response is already on screen while the final reasoning preview remains below it."
    private let reasoning = "THINKING_PREVIEW_VISIBLE — checking the final constraint before completion."

    var body: some View {
        MessageTableView(
            archivedMessagesStartIndex: 0,
            isDarkMode: colorScheme == .dark,
            isLoading: isLoading,
            viewModel: viewModel,
            isAtBottom: $isAtBottom,
            userHasScrolled: $userHasScrolled,
            scrollTrigger: scrollTrigger,
            scrollToUserTrigger: scrollToUserTrigger,
            tableOpacity: $tableOpacity,
            keyboardHeight: 0
        )
        .opacity(tableOpacity)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            HStack {
                Text(isLoading ? "Streaming" : "Complete")
                    .accessibilityIdentifier("thinkingCompletionStatus")
                Spacer()
                Button("Complete response", action: completeResponse)
                    .accessibilityIdentifier("completeThinkingResponseFixture")
                    .disabled(!isLoading)
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 12)
            .background(Color.chatBackground(isDarkMode: colorScheme == .dark))
        }
        .onAppear(perform: seedFixture)
    }

    private func seedFixture() {
        guard !didSeedFixture else { return }
        didSeedFixture = true

        var assistant = Message(id: "thinking-label-assistant", role: .assistant, content: answer)
        assistant.isStreaming = true
        assistant.responseActivity = ResponseActivity(
            phase: .responding,
            tools: [],
            parts: [
                ResponsePart(id: "thinking-label-answer", type: .text, text: answer, state: .done, sourceId: nil, url: nil, title: nil, tool: nil),
                ResponsePart(id: "thinking-label-reasoning", type: .reasoning, text: reasoning, state: .streaming, sourceId: nil, url: nil, title: nil, tool: nil),
            ]
        )
        let user = Message(id: "thinking-label-user", role: .user, content: "Show the final reasoning state.")
        let fixture = Chat(
            id: "thinking-label-ui-test",
            title: "Thinking label test",
            messages: [user, assistant],
            modelType: viewModel.currentModel
        )
        viewModel.currentChat = fixture
        viewModel.chats = [fixture]
        viewModel.isLoading = true
    }

    private func completeResponse() {
        guard var chat = viewModel.currentChat, let index = chat.messages.indices.last else { return }
        chat.messages[index].isStreaming = false
        if let activity = chat.messages[index].responseActivity {
            let completedParts = activity.parts.map { part in
                ResponsePart(
                    id: part.id,
                    type: part.type,
                    text: part.text,
                    state: part.type == .reasoning ? .done : part.state,
                    sourceId: part.sourceId,
                    url: part.url,
                    title: part.title,
                    tool: part.tool
                )
            }
            chat.messages[index].responseActivity = ResponseActivity(phase: .complete, tools: activity.tools, parts: completedParts)
        }
        viewModel.currentChat = chat
        viewModel.chats = [chat]
        viewModel.isLoading = false
        isLoading = false
    }
}

/// Replays an expanding assistant response after loading a multi-turn seeded
/// chat into the production ChatContainer. Keeps the real scroll ownership,
/// composer, message wrappers, and row layout in the UI-test path.
struct SeededChatHistoryHarnessView: View {
    @ObservedObject var viewModel: ChatViewModel
    @State private var didStart = false

    private let responseParts = (1...32).map { index in
        if index.isMultiple(of: 8) {
            return "### SEEDED_STREAM_SEGMENT_\(String(format: "%02d", index))\n\nSegment \(index) continues a long response while the chat contains earlier conversation history. The viewport must follow the newest text instead of stopping halfway through this message."
        }
        return "SEEDED_STREAM_SEGMENT_\(String(format: "%02d", index)) — Segment \(index) continues the long response while the chat contains earlier conversation history. The viewport must follow the newest text instead of stopping halfway through this message."
    }

    var body: some View {
        ChatContainer()
            .task {
                await seedAndStream()
            }
    }

    @MainActor
    private func seedAndStream() async {
        guard !didStart else { return }
        didStart = true

        let history = (1...8).flatMap { index in
            [
                Message(
                    id: "seeded-history-user-\(index)",
                    role: .user,
                    content: "SEEDED_HISTORY_USER_\(index) — Can you explain how this part of the project works?"
                ),
                Message(
                    id: "seeded-history-assistant-\(index)",
                    role: .assistant,
                    content: "SEEDED_HISTORY_ASSISTANT_\(index) — It follows the existing conversation context and keeps earlier messages available while new text arrives."
                ),
            ]
        }
        let userMessage = Message(
            id: "seeded-history-current-user",
            role: .user,
            content: "Continue from the existing history and explain the full sequence."
        )
        var assistantMessage = Message(
            id: "seeded-history-current-assistant",
            role: .assistant,
            content: responseParts[0]
        )
        assistantMessage.isStreaming = true
        assistantMessage.contentChunks = [makeChunk(at: 0, complete: false)]
        assistantMessage.responseActivity = responseActivity(
            text: responseParts[0],
            state: .streaming,
            phase: .responding
        )
        let chat = Chat(
            id: "seeded-chat-history-scroll-e2e",
            title: "Seeded chat history scroll E2E",
            messages: history + [userMessage, assistantMessage],
            modelType: viewModel.currentModel
        )
        viewModel.currentChat = chat
        viewModel.chats = [chat]
        viewModel.isLoading = true

        for count in 2...responseParts.count {
            do {
                try await Task.sleep(nanoseconds: 250_000_000)
            } catch {
                return
            }
            guard var currentChat = viewModel.currentChat,
                  let lastIndex = currentChat.messages.indices.last else { return }
            let text = responseParts.prefix(count).joined(separator: "\n\n")
            currentChat.messages[lastIndex].content = text
            currentChat.messages[lastIndex].contentChunks = (0..<count).map { makeChunk(at: $0, complete: $0 < count - 1) }
            currentChat.messages[lastIndex].responseActivity = responseActivity(
                text: text,
                state: .streaming,
                phase: .responding
            )
            viewModel.currentChat = currentChat
        }

        guard var currentChat = viewModel.currentChat,
              let lastIndex = currentChat.messages.indices.last else { return }
        currentChat.messages[lastIndex].isStreaming = false
        currentChat.messages[lastIndex].contentChunks = (0..<responseParts.count).map { makeChunk(at: $0, complete: true) }
        currentChat.messages[lastIndex].responseActivity = responseActivity(
            text: responseParts.joined(separator: "\n\n"),
            state: .done,
            phase: .complete
        )
        viewModel.currentChat = currentChat
        viewModel.isLoading = false
    }

    private func makeChunk(at index: Int, complete: Bool) -> ContentChunk {
        ContentChunk(
            id: "seeded-stream-chunk-\(index + 1)",
            type: (index + 1).isMultiple(of: 8) ? .heading : .paragraph,
            content: responseParts[index],
            isComplete: complete
        )
    }

    private func responseActivity(
        text: String,
        state: ResponsePart.State,
        phase: ResponseActivity.Phase
    ) -> ResponseActivity {
        ResponseActivity(
            phase: phase,
            tools: [],
            parts: [ResponsePart(
                id: "seeded-history-response-text",
                type: .text,
                text: text,
                state: state,
                sourceId: nil,
                url: nil,
                title: nil,
                tool: nil
            )]
        )
    }
}

private struct InferenceStateFixture: Identifiable {
    let id: String
    let title: String
    let description: String
    let activity: ResponseActivity
    let isStreaming: Bool

    static let all: [InferenceStateFixture] = [
        InferenceStateFixture(
            id: "waiting",
            title: "Waiting",
            description: "Immediate feedback before the first server snapshot.",
            activity: ResponseActivity(phase: .waiting, tools: []),
            isStreaming: true
        ),
        InferenceStateFixture(
            id: "reasoning",
            title: "Reasoning",
            description: "Displayable reasoning with a live shimmer.",
            activity: ResponseActivity(
                phase: .thinking,
                tools: [],
                parts: [
                    ResponsePart(
                        id: "reasoning-1",
                        type: .reasoning,
                        text: "Checking the relevant constraints…",
                        state: .streaming,
                        sourceId: nil,
                        url: nil,
                        title: nil,
                        tool: nil
                    ),
                ]
            ),
            isStreaming: true
        ),
        InferenceStateFixture(
            id: "search-running",
            title: "Search running",
            description: "Generic tool row with a query and explicit running state.",
            activity: ResponseActivity(
                phase: .tool,
                tools: [searchTool(status: .running)],
                parts: [toolPart(searchTool(status: .running))]
            ),
            isStreaming: true
        ),
        InferenceStateFixture(
            id: "tool-pending",
            title: "Tool pending",
            description: "Input has started, but the tool has not begun execution.",
            activity: ResponseActivity(
                phase: .tool,
                tools: [searchTool(status: .pending)],
                parts: [toolPart(searchTool(status: .pending))]
            ),
            isStreaming: true
        ),
        InferenceStateFixture(
            id: "unknown-tool",
            title: "Unknown tool",
            description: "Future tool names and statuses remain readable and inspectable.",
            activity: ResponseActivity(
                phase: .unknown,
                tools: [
                    ResponseTool(
                        id: "call-future",
                        name: "future_provider_tool",
                        status: .unknown,
                        output: nil,
                        title: nil,
                        inputSummary: "query: preserved for inspection",
                        outputTruncated: nil,
                        errorText: nil
                    ),
                ],
                parts: [
                    ResponsePart(
                        id: "call-future",
                        type: .tool,
                        text: nil,
                        state: nil,
                        sourceId: nil,
                        url: nil,
                        title: nil,
                        tool: ResponseTool(
                            id: "call-future",
                            name: "future_provider_tool",
                            status: .unknown,
                            output: nil,
                            title: nil,
                            inputSummary: "query: preserved for inspection",
                            outputTruncated: nil,
                            errorText: nil
                        )
                    ),
                ]
            ),
            isStreaming: false
        ),
        InferenceStateFixture(
            id: "ordered",
            title: "Text → tool → text",
            description: "The response sequence stays in provider order.",
            activity: ResponseActivity(
                phase: .responding,
                tools: [searchTool(status: .completed)],
                parts: [
                    textPart(id: "text-1", text: "Before the search.", state: .done),
                    toolPart(searchTool(status: .completed)),
                    sourcePart,
                    textPart(id: "text-2", text: "After the search.", state: .streaming),
                ]
            ),
            isStreaming: true
        ),
        InferenceStateFixture(
            id: "multiple-tools",
            title: "Multiple same-name calls",
            description: "Two search calls remain separate by call ID while one is still running.",
            activity: ResponseActivity(
                phase: .tool,
                tools: [
                    searchTool(id: "call-search-1", status: .completed),
                    searchTool(id: "call-search-2", status: .running),
                ],
                parts: [
                    toolPart(searchTool(id: "call-search-1", status: .completed)),
                    toolPart(searchTool(id: "call-search-2", status: .running)),
                ]
            ),
            isStreaming: true
        ),
        InferenceStateFixture(
            id: "truncated-tool",
            title: "Truncated output",
            description: "A bounded preview declares that more tool output exists.",
            activity: ResponseActivity(
                phase: .complete,
                tools: [
                    ResponseTool(
                        id: "call-truncated",
                        name: "read_page",
                        status: .completed,
                        output: "A bounded result preview shown in the native card.",
                        title: "Read page",
                        inputSummary: "url: https://example.com",
                        outputTruncated: true,
                        errorText: nil
                    ),
                ],
                parts: [
                    toolPart(
                        ResponseTool(
                            id: "call-truncated",
                            name: "read_page",
                            status: .completed,
                            output: "A bounded result preview shown in the native card.",
                            title: "Read page",
                            inputSummary: "url: https://example.com",
                            outputTruncated: true,
                            errorText: nil
                        )
                    ),
                ]
            ),
            isStreaming: false
        ),
        InferenceStateFixture(
            id: "failed",
            title: "Tool failed",
            description: "Failure is readable without relying on red tint alone.",
            activity: ResponseActivity(
                phase: .failed,
                tools: [
                    ResponseTool(
                        id: "call-failed",
                        name: "web_search",
                        status: .failed,
                        output: nil,
                        title: "Web search",
                        inputSummary: "query: unavailable",
                        outputTruncated: nil,
                        errorText: "Search provider unavailable"
                    ),
                ],
                errorText: "Search provider unavailable"
            ),
            isStreaming: false
        ),
        InferenceStateFixture(
            id: "stopped",
            title: "Stopped",
            description: "Partial response remains visible after cancellation.",
            activity: ResponseActivity(
                phase: .stopped,
                tools: [],
                parts: [textPart(id: "partial", text: "Partial answer kept after stop.", state: .done)],
                errorText: "User stopped generation"
            ),
            isStreaming: false
        ),
        InferenceStateFixture(
            id: "empty-stopped",
            title: "Empty stopped response",
            description: "A terminal stop remains visible even before any answer text arrives.",
            activity: ResponseActivity(
                phase: .stopped,
                tools: [],
                errorText: "User stopped generation"
            ),
            isStreaming: false
        ),
        InferenceStateFixture(
            id: "computer-screenshot",
            title: "Computer screenshot",
            description: "V-83 screenshotUrl card — thumbnail, not live VNC.",
            activity: ResponseActivity(
                phase: .tool,
                tools: [computerScreenshotTool()],
                parts: [toolPart(computerScreenshotTool())]
            ),
            isStreaming: false
        ),
        InferenceStateFixture(
            id: "computer-handoff",
            title: "Computer handoff",
            description: "Structured computer_handoff banner for SSO / 2FA / captcha.",
            activity: ResponseActivity(
                phase: .tool,
                tools: [computerHandoffTool()],
                parts: [toolPart(computerHandoffTool())]
            ),
            isStreaming: false
        ),
        InferenceStateFixture(
            id: "computer-running",
            title: "Computer running",
            description: "In-progress browser action before screenshot returns.",
            activity: ResponseActivity(
                phase: .tool,
                tools: [
                    ResponseTool(
                        id: "call-computer-running",
                        name: "computer_act",
                        status: .running,
                        output: nil,
                        title: "Browser action",
                        inputSummary: "click (640, 360)",
                        outputTruncated: nil,
                        errorText: nil
                    )
                ],
                parts: []
            ),
            isStreaming: true
        ),
    ]


    private static func computerScreenshotTool() -> ResponseTool {
        let output = """
        {"ok":true,"op":"screenshot","url":"https://example.com/docs","title":"Example Docs","screenshotUrl":"https://picsum.photos/seed/vladchat-v85/1280/720","screenshotId":"shot_demo","mimeType":"image/png","width":1280,"height":720,"budget":{"stepsUsed":3,"stepsRemaining":17,"maxSteps":20,"ttlMs":480000,"elapsedMs":12000,"note":"demo"}}
        """
        return ResponseTool(
            id: "call-computer-shot",
            name: "computer_screenshot",
            status: .completed,
            output: output,
            title: "Screenshot",
            inputSummary: nil,
            outputTruncated: false,
            errorText: nil
        )
    }

    private static func computerHandoffTool() -> ResponseTool {
        let output = """
        {"ok":false,"op":"handoff","handoff":{"type":"computer_handoff","reason":"2fa","message":"Enter the verification code to continue.","requiresUser":true},"error":"Enter the verification code to continue."}
        """
        return ResponseTool(
            id: "call-computer-handoff",
            name: "computer_handoff",
            status: .failed,
            output: output,
            title: "Needs you",
            inputSummary: nil,
            outputTruncated: false,
            errorText: "Enter the verification code to continue."
        )
    }

    private static func searchTool(id: String = "call-search", status: ResponseTool.Status) -> ResponseTool {

        ResponseTool(
            id: id,
            name: "web_search",
            status: status,
            output: status == .completed ? "Three relevant sources found." : nil,
            title: "Web search",
            inputSummary: "query: iOS streaming UX",
            outputTruncated: nil,
            errorText: nil
        )
    }

    private static func toolPart(_ tool: ResponseTool) -> ResponsePart {
        ResponsePart(
            id: tool.id,
            type: .tool,
            text: nil,
            state: nil,
            sourceId: nil,
            url: nil,
            title: nil,
            tool: tool
        )
    }

    private static func textPart(
        id: String,
        text: String,
        state: ResponsePart.State
    ) -> ResponsePart {
        ResponsePart(
            id: id,
            type: .text,
            text: text,
            state: state,
            sourceId: nil,
            url: nil,
            title: nil,
            tool: nil
        )
    }

    private static var sourcePart: ResponsePart {
        ResponsePart(
            id: "source-1",
            type: .source,
            text: nil,
            state: nil,
            sourceId: "source-1",
            url: "https://example.com/ios-streaming",
            title: "Example source",
            tool: nil
        )
    }
}

#Preview("Inference states") {
    InferenceStateGallery()
}
#endif
