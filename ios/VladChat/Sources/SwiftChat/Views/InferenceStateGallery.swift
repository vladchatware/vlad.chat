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

        let paragraphs = (1...10).map { index in
            "STREAM_ANCHOR_\(String(format: "%02d", index)) — Paragraph \(index) keeps enough readable text on screen to exercise streaming row height and scroll preservation. The reader should remain at this paragraph when the stream completes."
        }
        let fullText = paragraphs.joined(separator: "\n\n")
        var assistant = Message(id: "streaming-scroll-assistant", role: .assistant, content: fullText)
        assistant.isStreaming = true
        assistant.contentChunks = paragraphs.enumerated().map { index, paragraph in
            ContentChunk(
                id: "streaming-scroll-paragraph-\(index)",
                type: .paragraph,
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
    ]

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
