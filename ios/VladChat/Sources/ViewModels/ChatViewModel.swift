import Combine
import ConvexMobile
import Foundation
import UIKit

@MainActor
final class ChatViewModel: ObservableObject {
    @Published var chats: [Chat] = []
    @Published var currentChat: Chat?
    var isLoading: Bool {
        guard let chat = currentChat else { return false }
        let awaitingAcceptance = outgoing[chat.id].map { $0.order == nil } ?? false
        return awaitingAcceptance || editingThreadId == chat.id
            || chat.messages.contains { $0.responseActivity?.phase.isActive == true || $0.isStreaming }
    }
    @Published private var outgoing: [String: OutgoingResponse] = [:]
    @Published private var editingThreadId: String?
    private var stopOrders: [String: Double] = [:]
    private var stoppingThreads: Set<String> = []
    private struct OutgoingResponse {
        let id = UUID()
        let user: Message
        let placeholder: Message
        let previousOrder: Double
        var order: Double?
        var submitted = false
        var stopRequested = false
    }
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
    var isProcessingAttachment: Bool {
        guard let threadId = currentChat?.id, let request = outgoing[threadId] else { return false }
        return !request.submitted && !request.user.attachments.isEmpty
    }
    @Published var attachmentError: String?
    @Published var pendingImageThumbnails: [String: String] = [:]
    @Published var account: MobileAccount?
    @Published var isLinkingAccount = false

    var messages: [Message] { currentChat?.messages ?? [] }

    private var client: ConvexClientWithAuth<ConvexAuthSession>?
    private var authProvider: ConvexAnonymousAuthProvider?
    private var subscriptionTask: Task<Void, Never>?
    private var hasStarted = false
    private var selectedThreadId: String?
    private var messageOrders: [String: Double] = [:]
    private var responseAliases: [String: String] = [:]
    private var serverActivities: [String: ResponseActivity] = [:]
    private var unsentMessages: [String: [Message]] = [:]
    private var loadedThreadId: String?

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
        do {
            let defaultThreads = client.subscribe(to: "threads:getDefaultThreadId", yielding: String?.self).values
            for try await existing in defaultThreads {
                let threadId: String
                if let existing { threadId = existing }
                else { threadId = try await client.mutation("threads:createMobileThread") }
                selectedThreadId = threadId
                currentChat = Chat.create(id: threadId, modelType: currentModel)
                subscribe(using: client, threadId: threadId)
                break
            }
        } catch {
            attachmentError = Self.userFacingMessage(for: error)
        }
    }

    func sendMessage(text rawText: String) {
        let text = rawText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !isLoading, (!text.isEmpty || !pendingAttachments.isEmpty) else { return }
        guard let client, let threadId = selectedThreadId, loadedThreadId == threadId, currentChat?.id == threadId else {
            attachmentError = "Vlad is still connecting."
            return
        }
        let outgoingAttachments = pendingAttachments
        let model = currentModel.id
        let searchEnabled = isWebSearchEnabled
        let user = Message(role: .user, content: text, attachments: outgoingAttachments)
        var placeholder = Message(role: .assistant, content: "")
        placeholder.responseActivity = ResponseActivity(phase: .sending)
        let request = OutgoingResponse(
            user: user, placeholder: placeholder,
            previousOrder: messageOrders.values.max() ?? -1
        )
        outgoing[threadId] = request
        let unsentIDs = Set((unsentMessages.removeValue(forKey: threadId) ?? []).map(\.id))
        updateChat(threadId) { chat in
            chat.messages.removeAll { unsentIDs.contains($0.id) }
            chat.messages.append(contentsOf: [user, placeholder])
        }
        pendingAttachments = []
        pendingImageThumbnails = [:]

        Task { [weak self] in
            guard let self else { return }
            defer {
                if outgoing[threadId]?.id == request.id { outgoing[threadId] = nil }
            }
            do {
                var uploadedAttachments: [UploadedAttachment] = []
                for attachment in outgoingAttachments {
                    guard outgoing[threadId]?.stopRequested != true else {
                        finishLocalResponse(threadId, request: request, phase: .stopped)
                        return
                    }
                    uploadedAttachments.append(
                        try await AttachmentUploadService.upload(attachment, using: client)
                    )
                }
                guard outgoing[threadId]?.stopRequested != true else {
                    finishLocalResponse(threadId, request: request, phase: .stopped)
                    return
                }
                var arguments: [String: ConvexEncodable?] = [
                    "prompt": text, "model": model, "searchEnabled": searchEnabled,
                    "threadId": threadId,
                ]
                if !uploadedAttachments.isEmpty {
                    let values: [ConvexEncodable?] = uploadedAttachments.map(\.convexValue)
                    arguments["attachments"] = values
                }
                outgoing[threadId]?.submitted = true
                updateChat(threadId) { chat in
                    if let index = chat.messages.firstIndex(where: { $0.id == placeholder.id }) {
                        chat.messages[index].responseActivity?.phase = .waiting
                    }
                }
                let _: GenerationResult = try await client.action("threads:generateReply", with: arguments)
            } catch {
                guard outgoing[threadId]?.id == request.id else { return }
                // Server snapshots own accepted response state. Only pre-acceptance failures
                // need a local error row; never erase the user's sent text.
                if outgoing[threadId]?.order == nil {
                    finishLocalResponse(threadId, request: request, phase: .failed,
                                        error: Self.userFacingMessage(for: error))
                } else if currentChat?.id == threadId && outgoing[threadId]?.stopRequested != true {
                    attachmentError = Self.userFacingMessage(for: error)
                }
            }
        }
    }

    func cancelGeneration() {
        guard let threadId = selectedThreadId else { return }
        if outgoing[threadId] != nil {
            outgoing[threadId]?.stopRequested = true
            updateChat(threadId) { chat in
                if let index = chat.messages.lastIndex(where: { $0.role == .assistant }) {
                    chat.messages[index].responseActivity?.phase = .stopping
                }
            }
            // Before acceptance, retain the request and stop as soon as its order arrives.
            if let order = outgoing[threadId]?.order { stopResponse(threadId, order: order) }
        } else if let message = messages.last(where: { $0.responseActivity?.phase.isActive == true }),
                  let order = messageOrders[message.id] {
            stopResponse(threadId, order: order)
        }
    }

    private func stopResponse(_ threadId: String, order: Double) {
        stopOrders[threadId] = order
        guard let client, !stoppingThreads.contains(threadId) else { return }
        stoppingThreads.insert(threadId)
        Task { [weak self] in
            guard let self else { return }
            do {
                let result: AbortReplyResult = try await client.mutation(
                    "threads:abortReply", with: ["threadId": threadId, "order": order]
                )
                stoppingThreads.remove(threadId)
                if result.aborted || result.failedPending > 0 { stopOrders[threadId] = nil }
            } catch {
                outgoing[threadId]?.stopRequested = false
                stoppingThreads.remove(threadId)
                stopOrders[threadId] = nil
                updateChat(threadId) { chat in
                    for index in chat.messages.indices where chat.messages[index].responseActivity?.phase == .stopping {
                        chat.messages[index].responseActivity = serverActivities[chat.messages[index].id]
                            ?? ResponseActivity(phase: .waiting)
                    }
                }
                if currentChat?.id == threadId { attachmentError = Self.userFacingMessage(for: error) }
            }
        }
    }

    private func updateChat(_ threadId: String, _ update: (inout Chat) -> Void) {
        guard var chat = currentChat?.id == threadId ? currentChat : chats.first(where: { $0.id == threadId }) else { return }
        update(&chat)
        replaceChat(chat)
        if currentChat?.id == threadId { currentChat = chat }
    }

    private func finishLocalResponse(_ threadId: String, request: OutgoingResponse,
                                     phase: ResponsePhase, error: String? = nil) {
        var response = request.placeholder
        response.responseActivity = ResponseActivity(phase: phase, error: error)
        unsentMessages[threadId] = [request.user, response]
        updateChat(threadId) { chat in
            if let index = chat.messages.firstIndex(where: { $0.id == request.placeholder.id }) {
                chat.messages[index] = response
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
        loadedThreadId = nil
        messageOrders = [:]
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
        replaceMessages(from: index, with: newContent)
    }

    func regenerateLastResponse() {
        guard !isLoading, let index = messages.lastIndex(where: { $0.role == .user }) else { return }
        if messageOrders[messages[index].id] == nil, let threadId = currentChat?.id {
            let user = messages[index]
            updateChat(threadId) { $0.messages.removeSubrange(index...) }
            let draftAttachments = pendingAttachments
            pendingAttachments = user.attachments
            sendMessage(text: user.content)
            pendingAttachments = draftAttachments
        } else {
            regenerateMessage(at: index)
        }
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
                mimeType: Self.mimeType(for: url.pathExtension),
                base64: data.base64EncodedString(),
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

    func transcribeAudio(at fileURL: URL) async throws -> String {
        guard let client else {
            throw AudioRecordingError.transcriptionFailed("Vlad is still connecting.")
        }
        return try await AudioRecordingService.shared.transcribe(
            fileURL: fileURL,
            client: client
        )
    }

    func linkGoogleAccount() {
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
                    with: ["provider": "google", "params": params]
                )
                try await authProvider.completeGoogleSignIn(start)
                if case .failure(let error) = await client.login() {
                    throw error
                }
                subscribe(using: client, threadId: selectedThreadId)
            } catch {
                attachmentError = Self.userFacingMessage(for: error)
            }
        }
    }

    func redeemStoreTransaction(_ transactionId: UInt64) async throws {
        guard let client else {
            throw StorePurchaseError.productUnavailable
        }
        let _: StoreRedemptionResult = try await client.action(
            "storekit:redeemTransaction",
            with: ["transactionId": String(transactionId)]
        )
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
                guard !Task.isCancelled else { return }
                self?.attachmentError = Self.userFacingMessage(for: error)
            }
        }
    }

    func apply(_ mobileChat: MobileChat) {
        loadedThreadId = mobileChat.threadId
        account = mobileChat.account
        if let threadId = mobileChat.threadId, var request = outgoing[threadId], request.submitted {
            request.order = request.order ?? mobileChat.messages
                .first(where: { $0.isUser && $0.order > request.previousOrder })?.order
            outgoing[threadId] = request
            if let response = mobileChat.messages.first(where: { !$0.isUser && $0.order == request.order }) {
                responseAliases[response.id] = request.placeholder.id
            }
        }
        messageOrders = Dictionary(
            uniqueKeysWithValues: mobileChat.messages.map { (responseAliases[$0.id] ?? $0.id, $0.order) }
        )
        var mapped = mobileChat.messages.map { item in
            var message = Message(
                id: responseAliases[item.id] ?? item.id,
                role: item.isUser ? .user : .assistant,
                content: item.text,
                timestamp: Date(timeIntervalSince1970: item.createdAt / 1_000),
                attachments: item.attachments.map { attachment in
                    let inlineBase64 = Self.inlineBase64(from: attachment.url)
                    return Attachment(
                        id: attachment.id,
                        type: attachment.type == "image" ? .image : .document,
                        fileName: attachment.fileName,
                        mimeType: attachment.mimeType,
                        base64: inlineBase64,
                        thumbnailBase64: inlineBase64,
                        url: inlineBase64 == nil ? attachment.url : nil,
                        processingState: .completed
                    )
                }
            )
            message.responseActivity = item.response ?? ResponseActivity(
                phase: item.status == "streaming" || item.status == "pending" ? .waiting
                    : item.status == "failed" ? .failed : .complete
            )
            if item.isUser { message.responseActivity = nil }
            message.isStreaming = message.responseActivity?.phase.isActive == true
            serverActivities[message.id] = message.responseActivity
            return message
        }
        let selectedId = mobileChat.threadId
        if let selectedId, outgoing[selectedId] == nil {
            mapped.append(contentsOf: unsentMessages[selectedId] ?? [])
        }
        if let selectedId, let request = outgoing[selectedId] {
            let acceptedOrder = request.order
            let hasResponse = acceptedOrder.map { order in
                mobileChat.messages.contains { !$0.isUser && $0.order == order }
            } ?? false
            if !hasResponse {
                if acceptedOrder == nil { mapped.append(request.user) }
                var placeholder = request.placeholder
                placeholder.responseActivity?.phase = request.stopRequested ? .stopping
                    : request.submitted ? .waiting : .sending
                mapped.append(placeholder)
            }
            if request.stopRequested, let acceptedOrder,
               mobileChat.messages.contains(where: { !$0.isUser && $0.order == acceptedOrder && $0.response?.phase.isActive == true }) {
                stopResponse(selectedId, order: acceptedOrder)
            }
        }
        if let selectedId, let order = stopOrders[selectedId] {
            if mobileChat.messages.contains(where: { !$0.isUser && $0.order == order && $0.response?.phase.isActive == false }) {
                stopOrders[selectedId] = nil
                outgoing[selectedId]?.stopRequested = false
            } else {
                stopResponse(selectedId, order: order)
                if let index = mapped.firstIndex(where: { messageOrders[$0.id] == order && $0.role == .assistant }) {
                    mapped[index].responseActivity?.phase = .stopping
                }
            }
        }
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

    private func replaceMessages(from index: Int, with rawText: String) {
        let text = rawText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !isLoading,
              !text.isEmpty,
              messages.indices.contains(index),
              let client,
              let threadId = selectedThreadId,
              let order = messageOrders[messages[index].id] else { return }

        editingThreadId = threadId
        Task { [weak self] in
            guard let self else { return }
            do {
                let _: DeleteMobileMessagesResult = try await client.action(
                    "threads:deleteMobileMessagesFrom",
                    with: ["threadId": threadId, "startOrder": order]
                )
                updateChat(threadId) { $0.messages.removeSubrange(index...) }
                let remainingIDs = Set(messages.map(\.id))
                messageOrders = messageOrders.filter { remainingIDs.contains($0.key) }
                guard currentChat?.id == threadId else {
                    editingThreadId = nil
                    return
                }
                let composingAttachments = pendingAttachments
                let composingThumbnails = pendingImageThumbnails
                pendingAttachments = []
                pendingImageThumbnails = [:]
                editingThreadId = nil
                sendMessage(text: text)
                pendingAttachments = composingAttachments
                pendingImageThumbnails = composingThumbnails
            } catch {
                editingThreadId = nil
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

    private static func mimeType(for fileExtension: String) -> String {
        switch fileExtension.lowercased() {
        case "pdf": "application/pdf"
        case "txt": "text/plain"
        case "md": "text/markdown"
        case "csv": "text/csv"
        case "html", "htm": "text/html"
        default: "application/octet-stream"
        }
    }

    private static func inlineBase64(from url: String) -> String? {
        guard url.hasPrefix("data:"),
              let comma = url.firstIndex(of: ","),
              url[..<comma].hasSuffix(";base64") else { return nil }
        return String(url[url.index(after: comma)...])
    }
}
