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

    var messages: [Message] { currentChat?.messages ?? [] }

    private var client: ConvexClientWithAuth<ConvexAuthSession>?
    private var subscriptionTask: Task<Void, Never>?
    private var generationTask: Task<Void, Never>?
    private var hasStarted = false
    private var messageOrders: [String: Double] = [:]

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
        guard let client else {
            attachmentError = "Vlad is still connecting."
            return
        }
        guard pendingAttachments.isEmpty else {
            attachmentError = "Attachments need the Convex upload bridge before they can be sent."
            return
        }

        let optimistic = Message(
            id: "optimistic-\(UUID().uuidString)",
            role: .user,
            content: text,
            timestamp: Date()
        )
        if var chat = currentChat {
            chat.messages.append(optimistic)
            currentChat = chat
            replaceChat(chat)
        }

        isLoading = true
        generationTask?.cancel()
        generationTask = Task { [weak self] in
            guard let self else { return }
            do {
                let _: GenerationResult = try await client.action(
                    "threads:generateReply",
                    with: [
                        "prompt": text,
                        "model": currentModel.id,
                        "searchEnabled": isWebSearchEnabled,
                    ]
                )
            } catch {
                guard !Task.isCancelled else { return }
                removeMessage(id: optimistic.id)
                attachmentError = Self.userFacingMessage(for: error)
            }
            isLoading = false
        }
    }

    func cancelGeneration() {
        generationTask?.cancel()
        generationTask = nil
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

    private func subscribe(using client: ConvexClientWithAuth<ConvexAuthSession>) {
        subscriptionTask?.cancel()
        subscriptionTask = Task { [weak self] in
            let updates = client.subscribe(to: "threads:getMobileChat", yielding: MobileChat.self).values
            do {
                for try await mobileChat in updates {
                    guard !Task.isCancelled else { return }
                    self?.apply(mobileChat)
                }
            } catch {
                self?.attachmentError = Self.userFacingMessage(for: error)
            }
        }
    }

    private func apply(_ mobileChat: MobileChat) {
        messageOrders = Dictionary(
            uniqueKeysWithValues: mobileChat.messages.map { ($0.id, $0.order) }
        )
        let mapped = mobileChat.messages.map { item in
            var message = Message(
                id: item.id,
                role: item.isUser ? .user : .assistant,
                content: item.text,
                timestamp: Date(timeIntervalSince1970: item.createdAt / 1_000)
            )
            message.isStreaming = item.status == "streaming"
            message.responseActivity = item.response
            return message
        }
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
        scrollToBottomTrigger = UUID()
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
