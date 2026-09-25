import Combine
import ConvexMobile
import Foundation
import UIKit

@MainActor
final class ChatViewModel: ObservableObject {
    @Published var chats: [Chat] = []
    @Published var currentChat: Chat?
    @Published var isLoading = false
    @Published var thinkingSummary = ""
    @Published var webSearchSummary = ""
    @Published var scrollTargetMessageId: String?
    @Published var scrollTargetOffset: CGFloat = 0
    @Published var shouldFocusInput = false
    @Published var isScrollInteractionActive = false
    @Published var isAtBottom = true
    @Published var scrollToBottomTrigger = UUID()
    @Published var scrollToUserMessageTrigger = UUID()
    @Published var isWebSearchEnabled = SettingsManager.shared.webSearchEnabled
    @Published var imageViewerImages: [Attachment] = []
    @Published var imageViewerIndex = 0
    @Published var showImageViewer = false
    @Published var editRequestedForMessageIndex: Int?
    @Published var currentModel: ModelType
    @Published var pendingAttachments: [Attachment] = []
    @Published var isProcessingAttachment = false
    @Published var attachmentError: String?
    @Published var pendingImageThumbnails: [String: String] = [:]
    @Published var account: MobileAccount?
    @Published var isLinkingAccount = false

    var messages: [Message] { currentChat?.messages ?? [] }

    private var client: ConvexClientWithAuth<ConvexAuthSession>?
    private var authProvider: ConvexAnonymousAuthProvider?
    private var subscriptionTask: Task<Void, Never>?
    private var presentationTask: Task<Void, Never>?
    private var presentationTaskID: UUID?
    private var pendingMobileChat: MobileChat?
    private var generationTask: Task<Void, Never>?
    private var activeGenerationID: UUID?
    private var localGenerationActive = false
    private var localGenerationExpectedOrder: Double?
    private var localGenerationPreviousMaxOrder: Double?
    private var localGenerationMessageID: String?
    private var hasStarted = false
    private var messageOrders: [String: Double] = [:]
    private var streamingChunkers: [String: StreamingMarkdownChunker] = [:]
    private var streamingContent: [String: String] = [:]

    init() {
        guard let model = AppConfig.shared.currentModel ?? AppConfig.shared.availableModels.first else {
            fatalError("Vlad requires at least one configured model.")
        }
        currentModel = model
        let chat = Chat.create(title: "Vlad", modelType: model)
        currentChat = chat
        chats = [chat]
    }

    func start() async {
        guard !hasStarted else { return }
        hasStarted = true
        guard let deploymentURL = AppConfiguration.convexURL else {
            attachmentError = "Convex deployment URL is missing."
            return
        }

        let provider = ConvexAnonymousAuthProvider(deploymentURL: deploymentURL)
        authProvider = provider
        let client = ConvexClientWithAuth(
            deploymentUrl: deploymentURL.absoluteString,
            authProvider: provider
        )
        self.client = client

        if case .failure = await client.loginFromCache(),
           case .failure = await client.login() {
            attachmentError = "Could not create a secure Vlad session."
            return
        }
        subscribe(using: client)
    }

    func sendMessage(text rawText: String) {
        let text = rawText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !isLoading, (!text.isEmpty || !pendingAttachments.isEmpty) else { return }
        guard pendingAttachments.isEmpty else {
            attachmentError = "Attachments need the Convex upload bridge before they can be sent."
            return
        }
        guard let client else {
            attachmentError = "Vlad is still connecting."
            return
        }

        let generationID = UUID()
        let localAssistantID = "local-response-\(generationID.uuidString)"
        let optimistic = Message(
            id: "optimistic-\(UUID().uuidString)",
            role: .user,
            content: text,
            timestamp: Date()
        )
        if var chat = currentChat {
            chat.messages.append(optimistic)

            var waitingMessage = Message(
                id: localAssistantID,
                role: .assistant,
                content: "",
                timestamp: Date()
            )
            waitingMessage.isStreaming = true
            waitingMessage.responseActivity = ResponseActivity(phase: .waiting, tools: [])
            chat.messages.append(waitingMessage)

            currentChat = chat
            replaceChat(chat)
        }

        isLoading = true
        localGenerationActive = true
        localGenerationExpectedOrder = nil
        localGenerationPreviousMaxOrder = messageOrders.values.max()
        localGenerationMessageID = localAssistantID
        activeGenerationID = generationID
        let modelID = currentModel.id
        let searchEnabled = isWebSearchEnabled
        generationTask?.cancel()
        generationTask = Task { [weak self] in
            guard let self else { return }
            do {
                let result: GenerationResult = try await client.action(
                    "threads:generateReply",
                    with: [
                        "prompt": text,
                        "model": modelID,
                        "searchEnabled": searchEnabled,
                    ]
                )
                guard activeGenerationID == generationID else { return }
                localGenerationExpectedOrder = result.order
                if hasObservedLocalGeneration(order: result.order) {
                    localGenerationActive = false
                    localGenerationExpectedOrder = nil
                    localGenerationPreviousMaxOrder = nil
                    localGenerationMessageID = nil
                    isLoading = hasActiveObservedResponse(order: result.order)
                }
            } catch {
                guard !Task.isCancelled else { return }
                guard activeGenerationID == generationID else { return }
                localGenerationActive = false
                localGenerationExpectedOrder = nil
                localGenerationPreviousMaxOrder = nil
                localGenerationMessageID = nil
                activeGenerationID = nil
                removeMessage(id: optimistic.id)
                removeMessage(id: localAssistantID)
                attachmentError = Self.userFacingMessage(for: error)
            }
            guard activeGenerationID == generationID else { return }
            activeGenerationID = nil
        }
    }

    func cancelGeneration() {
        generationTask?.cancel()
        generationTask = nil
        activeGenerationID = nil
        localGenerationActive = false
        localGenerationExpectedOrder = nil
        localGenerationPreviousMaxOrder = nil
        localGenerationMessageID = nil
        isLoading = false
        guard let client, let threadId = currentChat?.id else { return }
        let activeOrder = currentChat?.messages
            .last(where: { $0.role == .assistant && $0.isStreaming })
            .flatMap { messageOrders[$0.id] }
        Task { [weak self] in
            do {
                var arguments: [String: ConvexEncodable?] = ["threadId": threadId]
                if let activeOrder { arguments["order"] = activeOrder }
                let _: AbortReplyResult = try await client.mutation(
                    "threads:abortReply",
                    with: arguments
                )
            } catch {
                self?.attachmentError = Self.userFacingMessage(for: error)
            }
        }
    }

    func changeModel(to model: ModelType) {
        currentModel = model
        AppConfig.shared.currentModel = model
        if var chat = currentChat {
            chat.modelType = model
            currentChat = chat
            replaceChat(chat)
        }
    }

    func createNewChat(language: String? = nil, modelType: ModelType? = nil, focusInput: Bool = true) {
        guard messages.isEmpty else {
            attachmentError = "Multiple Convex threads are next; this build uses your current Vlad thread."
            return
        }
        shouldFocusInput = focusInput
    }

    func selectChat(_ chat: Chat) { currentChat = chat }

    func deleteChat(_ id: String) {
        attachmentError = "Deleting Convex threads is not wired yet."
    }

    func updateChatTitle(_ id: String, newTitle: String) {
        guard var chat = chats.first(where: { $0.id == id }) else { return }
        chat.title = newTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        chat.titleState = .manual
        replaceChat(chat)
        if currentChat?.id == id { currentChat = chat }
    }

    func editMessage(at index: Int, newContent: String) {
        guard messages.indices.contains(index), messages[index].role == .user else { return }
        replaceMessages(from: index, with: newContent)
    }

    func regenerateLastResponse() {
        guard let index = messages.lastIndex(where: { $0.role == .user }) else { return }
        regenerateMessage(at: index)
    }

    func regenerateMessage(at index: Int) {
        guard messages.indices.contains(index), messages[index].role == .user else { return }
        replaceMessages(from: index, with: messages[index].content)
    }

    func addImageAttachment(data: Data, fileName: String) {
        guard Int64(data.count) <= Constants.Attachments.maxImageSizeBytes else {
            attachmentError = "Image exceeds the 10 MB limit."
            return
        }
        let attachment = Attachment(
            type: .image,
            fileName: fileName,
            mimeType: Constants.Attachments.defaultImageMimeType,
            base64: data.base64EncodedString(),
            thumbnailBase64: data.base64EncodedString(),
            fileSize: Int64(data.count),
            processingState: .completed
        )
        pendingAttachments.append(attachment)
        pendingImageThumbnails[attachment.id] = attachment.thumbnailBase64
    }

    func addDocumentAttachment(url: URL, fileName: String) {
        let accessing = url.startAccessingSecurityScopedResource()
        defer { if accessing { url.stopAccessingSecurityScopedResource() } }
        do {
            let data = try Data(contentsOf: url)
            guard Int64(data.count) <= Constants.Attachments.maxFileSizeBytes else {
                attachmentError = "Document exceeds the 20 MB limit."
                return
            }
            pendingAttachments.append(Attachment(
                type: .document,
                fileName: fileName,
                textContent: String(data: data, encoding: .utf8),
                fileSize: Int64(data.count),
                processingState: .completed
            ))
        } catch {
            attachmentError = error.localizedDescription
        }
    }

    func removePendingAttachment(id: String) {
        pendingAttachments.removeAll { $0.id == id }
        pendingImageThumbnails[id] = nil
    }

    func linkGoogleAccount() {
        linkOAuthAccount(provider: "google")
    }

    func linkAppleAccount() {
        linkOAuthAccount(provider: "apple")
    }

    private func linkOAuthAccount(provider: String) {
        guard let client, let authProvider, account?.isAnonymous != false else { return }
        isLinkingAccount = true
        Task { [weak self] in
            guard let self else { return }
            defer { isLinkingAccount = false }
            do {
                let params: [String: ConvexEncodable?] = [
                    "redirectTo": "vladchat://auth"
                ]
                let start: ConvexOAuthStartResponse = try await client.action(
                    "auth:signIn",
                    with: ["provider": provider, "params": params]
                )
                try await authProvider.completeOAuthSignIn(start)
                if case .failure(let error) = await client.login() {
                    throw error
                }
                subscribe(using: client)
            } catch {
                attachmentError = Self.userFacingMessage(for: error)
            }
        }
    }

    private func subscribe(using client: ConvexClientWithAuth<ConvexAuthSession>) {
        subscriptionTask?.cancel()
        presentationTask?.cancel()
        presentationTask = nil
        presentationTaskID = nil
        pendingMobileChat = nil
        subscriptionTask = Task { [weak self] in
            let updates = client.subscribe(to: "threads:getMobileChat", yielding: MobileChat.self).values
            do {
                for try await mobileChat in updates {
                    guard !Task.isCancelled else { return }
                    self?.enqueue(mobileChat)
                }
            } catch {
                self?.attachmentError = Self.userFacingMessage(for: error)
            }
        }
    }

    /// Limits view publication to a bounded cadence while allowing terminal
    /// snapshots to appear immediately. The server remains authoritative; this
    /// only separates transport burst frequency from rendering frequency.
    private func enqueue(_ mobileChat: MobileChat) {
        pendingMobileChat = mobileChat

        if !hasActiveServerResponse(in: mobileChat) && !localGenerationActive {
            presentationTask?.cancel()
            presentationTask = nil
            presentationTaskID = nil
            pendingMobileChat = nil
            apply(mobileChat)
            return
        }

        guard presentationTask == nil else { return }
        let taskID = UUID()
        presentationTaskID = taskID
        presentationTask = Task { @MainActor [weak self] in
            defer {
                if let self, self.presentationTaskID == taskID {
                    self.presentationTask = nil
                    self.presentationTaskID = nil
                }
            }

            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 33_000_000)
                guard !Task.isCancelled, let self else { return }
                guard let next = self.pendingMobileChat else { return }
                self.pendingMobileChat = nil
                self.apply(next)

                if self.pendingMobileChat == nil {
                    return
                }
            }
        }
    }

    private func apply(_ mobileChat: MobileChat) {
        account = mobileChat.account
        if let expectedOrder = localGenerationExpectedOrder,
           hasObservedLocalGeneration(in: mobileChat, order: expectedOrder) {
            localGenerationActive = false
            localGenerationExpectedOrder = nil
            localGenerationPreviousMaxOrder = nil
            localGenerationMessageID = nil
        }

        let hasActiveServerResponse = hasActiveServerResponse(in: mobileChat)
        if hasActiveServerResponse {
            isLoading = true
        } else if localGenerationActive {
            isLoading = true
        } else {
            isLoading = false
        }

        let previousMessagesByOrder = (currentChat?.messages ?? []).reduce(into: [Double: Message]()) { result, message in
            guard message.role == .assistant, let order = messageOrders[message.id] else { return }
            result[order] = message
        }
        messageOrders = Dictionary(
            uniqueKeysWithValues: mobileChat.messages.map { ($0.id, $0.order) }
        )
        var activeMessageIds = Set<String>()
        var mapped = mobileChat.messages.map { item in
            let responseIsStreaming =
                (item.status == "pending" || item.status == "streaming") &&
                !isTerminal(item.response?.phase)
            var message = Message(
                id: item.id,
                role: item.isUser ? .user : .assistant,
                content: item.text,
                timestamp: Date(timeIntervalSince1970: item.createdAt / 1_000)
            )
            message.isStreaming = responseIsStreaming
            let response = item.response?.retainingReasoning(
                from: previousMessagesByOrder[item.order]?.responseActivity
            )
            message.responseActivity = response
            if let response {
                let reasoning = response.parts
                    .filter { (part: ResponsePart) in part.type == .reasoning }
                    .compactMap(\.text)
                    .joined(separator: "\n")
                message.thoughts = reasoning.isEmpty ? nil : reasoning
                message.isThinking = response.phase == .thinking
                message.streamError = item.errorText ?? response.errorText
                message.isRequestError = message.streamError != nil
            } else if let errorText = item.errorText {
                message.streamError = errorText
                message.isRequestError = true
            }
            if !item.isUser {
                activeMessageIds.insert(item.id)
                message.contentChunks = contentChunks(
                    for: item.id,
                    content: item.text,
                    isStreaming: responseIsStreaming
                )
            }
            return message
        }

        // Keep the sent message and an explicit waiting response visible while
        // the action result and the subscription snapshot cross in flight. The
        // server remains authoritative once it publishes the generated order.
        if localGenerationActive &&
            !hasActiveServerResponse &&
            !hasServerResponseForLocalGeneration(in: mobileChat) {
            if let optimisticUser = currentChat?.messages.last(where: {
                $0.role == .user && $0.id.hasPrefix("optimistic-")
            }), !mapped.contains(where: { $0.role == .user && $0.content == optimisticUser.content }) {
                mapped.append(optimisticUser)
            }

            if let localGenerationMessageID {
                var waitingMessage = Message(
                    id: localGenerationMessageID,
                    role: .assistant,
                    content: "",
                    timestamp: Date()
                )
                waitingMessage.isStreaming = true
                waitingMessage.responseActivity = ResponseActivity(phase: .waiting, tools: [])
                mapped.append(waitingMessage)
            }
        }
        streamingChunkers = streamingChunkers.filter { activeMessageIds.contains($0.key) }
        streamingContent = streamingContent.filter { activeMessageIds.contains($0.key) }
        let title = mapped.first(where: { $0.role == .user })?.content
            .split(separator: " ")
            .prefix(5)
            .joined(separator: " ") ?? "Vlad"
        let chat = Chat(
            id: mobileChat.threadId ?? "current",
            title: title,
            messages: mapped,
            createdAt: mapped.first?.timestamp ?? Date(),
            modelType: currentModel
        )
        currentChat = chat
        chats = [chat]
    }

    private func hasActiveServerResponse(in mobileChat: MobileChat) -> Bool {
        mobileChat.messages.contains {
            !$0.isUser &&
            ($0.status == "pending" || $0.status == "streaming") &&
            !isTerminal($0.response?.phase)
        }
    }

    private func hasServerResponseForLocalGeneration(in mobileChat: MobileChat) -> Bool {
        guard let optimisticText = currentChat?.messages.last(where: {
            $0.role == .user && $0.id.hasPrefix("optimistic-")
        })?.content,
        let serverUser = mobileChat.messages.last(where: {
            $0.isUser && $0.text == optimisticText
        }) else {
            return false
        }

        return mobileChat.messages.contains {
            !$0.isUser && $0.order > serverUser.order
        }
    }

    private func isTerminal(_ phase: ResponseActivity.Phase?) -> Bool {
        switch phase {
        case .complete, .stopped, .failed:
            return true
        case .waiting, .thinking, .tool, .responding, .unknown, .none:
            return false
        }
    }

    private func hasObservedLocalGeneration(order: Double) -> Bool {
        let previousMaxOrder = localGenerationPreviousMaxOrder ?? -.infinity
        return currentChat?.messages.contains { message in
            guard message.role != .user,
                  let messageOrder = messageOrders[message.id] else { return false }
            return messageOrder >= order && messageOrder > previousMaxOrder
        } ?? false
    }

    private func hasObservedLocalGeneration(in mobileChat: MobileChat, order: Double) -> Bool {
        let previousMaxOrder = localGenerationPreviousMaxOrder ?? -.infinity
        return mobileChat.messages.contains {
            !$0.isUser && $0.order >= order && $0.order > previousMaxOrder
        }
    }

    private func hasActiveObservedResponse(order: Double) -> Bool {
        currentChat?.messages.contains(where: { (message: Message) in
            guard message.role != .user,
                  let messageOrder = messageOrders[message.id],
                  messageOrder >= order else { return false }
            if message.isStreaming { return true }
            guard let phase = message.responseActivity?.phase else { return false }
            switch phase {
            case .waiting, .thinking, .tool, .responding, .unknown:
                return true
            case .complete, .stopped, .failed:
                return false
            }
        }) ?? false
    }

    private func contentChunks(
        for messageId: String,
        content: String,
        isStreaming: Bool
    ) -> [ContentChunk] {
        let previousContent = streamingContent[messageId] ?? ""
        if !content.hasPrefix(previousContent) {
            streamingChunkers[messageId] = StreamingMarkdownChunker()
        }

        let chunker = streamingChunkers[messageId] ?? StreamingMarkdownChunker()
        if content.hasPrefix(previousContent) {
            let delta = String(content.dropFirst(previousContent.count))
            if !delta.isEmpty {
                chunker.appendToken(delta)
            }
        } else if !content.isEmpty {
            chunker.appendToken(content)
        }

        streamingContent[messageId] = content
        if !isStreaming {
            chunker.finalize()
        }
        streamingChunkers[messageId] = chunker
        return chunker.getAllChunks()
    }

    private func replaceMessages(from index: Int, with rawText: String) {
        let text = rawText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !isLoading,
              !text.isEmpty,
              messages.indices.contains(index),
              let client,
              let threadId = currentChat?.id,
              let order = messageOrders[messages[index].id] else { return }

        isLoading = true
        localGenerationActive = true
        Task { [weak self] in
            guard let self else { return }
            do {
                let _: DeleteMobileMessagesResult = try await client.action(
                    "threads:deleteMobileMessagesFrom",
                    with: ["threadId": threadId, "startOrder": order]
                )
                if var chat = currentChat {
                    chat.messages.removeSubrange(index...)
                    currentChat = chat
                    replaceChat(chat)
                }
                let composingAttachments = pendingAttachments
                let composingThumbnails = pendingImageThumbnails
                pendingAttachments = []
                pendingImageThumbnails = [:]
                isLoading = false
                sendMessage(text: text)
                pendingAttachments = composingAttachments
                pendingImageThumbnails = composingThumbnails
            } catch {
                localGenerationActive = false
                localGenerationPreviousMaxOrder = nil
                localGenerationMessageID = nil
                isLoading = false
                attachmentError = Self.userFacingMessage(for: error)
            }
        }
    }

    private func replaceChat(_ chat: Chat) {
        if let index = chats.firstIndex(where: { $0.id == chat.id }) {
            chats[index] = chat
        } else {
            chats.insert(chat, at: 0)
        }
    }

    private func removeMessage(id: String) {
        guard var chat = currentChat else { return }
        chat.messages.removeAll { $0.id == id }
        currentChat = chat
        replaceChat(chat)
    }

    private static func userFacingMessage(for error: Error) -> String {
        let text = error.localizedDescription
        if let range = text.range(of: "ConvexError: ") {
            return String(text[range.upperBound...]).components(separatedBy: " at ").first ?? text
        }
        return text
    }
}
