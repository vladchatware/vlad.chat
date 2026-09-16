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
    private var selectedThreadId: String?

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
                var arguments: [String: ConvexEncodable?] = [
                    "prompt": text,
                    "model": currentModel.id,
                    "searchEnabled": isWebSearchEnabled,
                ]
                if let selectedThreadId {
                    arguments["threadId"] = selectedThreadId
                }
                let _: GenerationResult = try await client.action(
                    "threads:generateReply",
                    with: arguments
                )
            } catch {
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
        shouldFocusInput = focusInput
        guard let client else {
            attachmentError = "Vlad is still connecting."
            return
        }
        Task { [weak self] in
            guard let self else { return }
            do {
                let threadId: String = try await client.mutation("threads:createMobileThread")
                selectedThreadId = threadId
                subscribe(using: client, threadId: threadId)
            } catch {
                attachmentError = Self.userFacingMessage(for: error)
            }
        }
    }

    func selectChat(_ chat: Chat) {
        guard selectedThreadId != chat.id, let client else { return }
        selectedThreadId = chat.id
        currentChat = chat
        subscribe(using: client, threadId: chat.id)
    }

    func deleteChat(_ id: String) {
        guard let client else { return }
        let nextThreadId = chats.first(where: { $0.id != id })?.id
        chats.removeAll { $0.id == id }
        if selectedThreadId == id {
            selectedThreadId = nextThreadId
            currentChat = chats.first(where: { $0.id == nextThreadId })
            subscribe(using: client, threadId: nextThreadId)
        }
        Task { [weak self] in
            do {
                try await client.mutation("threads:deleteMobileThread", with: ["threadId": id])
            } catch {
                self?.attachmentError = Self.userFacingMessage(for: error)
            }
        }
    }

    func updateChatTitle(_ id: String, newTitle: String) {
        guard var chat = chats.first(where: { $0.id == id }) else { return }
        chat.title = newTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        chat.titleState = .manual
        replaceChat(chat)
        if currentChat?.id == id { currentChat = chat }
        guard let client else { return }
        Task { [weak self] in
            do {
                try await client.mutation(
                    "threads:renameMobileThread",
                    with: ["threadId": id, "title": chat.title]
                )
            } catch {
                self?.attachmentError = Self.userFacingMessage(for: error)
            }
        }
    }

    func editMessage(at index: Int, newContent: String) {
        guard messages.indices.contains(index), messages[index].role == .user else { return }
        attachmentError = "Editing persisted Convex messages is not wired yet."
    }

    func regenerateLastResponse() {
        guard let prompt = messages.last(where: { $0.role == .user })?.content else { return }
        sendMessage(text: prompt)
    }

    func regenerateMessage(at index: Int) {
        guard messages.indices.contains(index), messages[index].role == .user else { return }
        sendMessage(text: messages[index].content)
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

    private func subscribe(
        using client: ConvexClientWithAuth<ConvexAuthSession>,
        threadId: String? = nil
    ) {
        subscriptionTask?.cancel()
        subscriptionTask = Task { [weak self] in
            let arguments: [String: ConvexEncodable?]? = threadId.map { ["threadId": $0] }
            let updates = client.subscribe(
                to: "threads:getMobileChat",
                with: arguments,
                yielding: MobileChat.self
            ).values
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
        let mapped = mobileChat.messages.map { item in
            var message = Message(
                id: item.id,
                role: item.isUser ? .user : .assistant,
                content: item.text,
                timestamp: Date(timeIntervalSince1970: item.createdAt / 1_000)
            )
            message.isStreaming = item.status == "streaming"
            return message
        }
        let selectedId = mobileChat.threadId
        if selectedThreadId == nil {
            selectedThreadId = selectedId
        }
        chats = mobileChat.threads.map { thread in
            let existing = chats.first(where: { $0.id == thread.id })
            return Chat(
                id: thread.id,
                title: thread.id == selectedId ? mobileChat.title : thread.title,
                titleState: thread.title == "Untitled" ? .placeholder : .manual,
                messages: thread.id == selectedId ? mapped : (existing?.messages ?? []),
                createdAt: Date(timeIntervalSince1970: thread.createdAt / 1_000),
                modelType: existing?.modelType ?? currentModel
            )
        }
        currentChat = chats.first(where: { $0.id == selectedId })
        scrollToBottomTrigger = UUID()
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
