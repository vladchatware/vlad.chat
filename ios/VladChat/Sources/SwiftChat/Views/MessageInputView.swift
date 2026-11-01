//
//  MessageInputView.swift
//  SwiftChat
//
//  Created on 03/25/26.
//  Copyright © 2026 Sacha Servan-Schreiber. All rights reserved.
//

import SwiftUI
import UIKit
import PhotosUI

/// Input area for typing messages, including attachments and send button
struct MessageInputView: View {
    // MARK: - Constants
    fileprivate enum Layout {
        static let defaultHeight: CGFloat = 72
        static let minimumHeight: CGFloat = 72
        static let maximumHeight: CGFloat = 180
        static let controlGap: CGFloat = 8
        static let controlEdgeInset: CGFloat = 8
    }

    private static let placeholderText = "Message"

    @Binding var messageText: String
    @ObservedObject var viewModel: ChatViewModel
    @Environment(\.colorScheme) var colorScheme
    @State private var textHeight: CGFloat = Layout.defaultHeight
    @StateObject private var dictationService = NativeDictationService()
    @ObservedObject private var settings = SettingsManager.shared
    var isKeyboardVisible: Bool = false

    private var isDarkMode: Bool { colorScheme == .dark }
    private var hasDraftContent: Bool {
        !messageText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            || !viewModel.pendingAttachments.isEmpty
    }
    private var isAgentRunActionPending: Bool {
        viewModel.agentRunStatus == .stopRequested
            || viewModel.agentRunStatus == .queued
            || viewModel.isResumingAgentRun
    }
    private var canResumeAgentRun: Bool {
        viewModel.agentRunStatus == .paused
            && !hasDraftContent
            && !dictationService.isActive
    }

    // Attachment picker state
    @State private var showDocumentPicker = false
    @State private var showPhotoPicker = false
    @State private var showCamera = false
    @State private var selectedPhotoItems: [PhotosPickerItem] = []

    private var showAttachmentError: Binding<Bool> {
        Binding(
            get: { viewModel.attachmentError != nil },
            set: { if !$0 { viewModel.attachmentError = nil } }
        )
    }

    @ViewBuilder
    var body: some View {
        inputContent
            .alert("Vlad Error", isPresented: showAttachmentError) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(viewModel.attachmentError ?? "An error occurred")
            }
            .onChange(of: dictationService.draftText) { _, text in
                messageText = text
            }
            .onChange(of: isKeyboardVisible) { _, isVisible in
                if isVisible { stopDictationForKeyboard() }
            }
            .onChange(of: dictationService.errorMessage) { _, message in
                guard let message else { return }
                viewModel.attachmentError = message
                dictationService.clearError()
            }
            .onDisappear {
                dictationService.cancel()
            }
            .sheet(isPresented: $showDocumentPicker) {
                DocumentPickerView { url, fileName in
                    viewModel.addDocumentAttachment(url: url, fileName: fileName)
                }
            }
            .sheet(isPresented: $showPhotoPicker, onDismiss: processSelectedPhotos) {
                NavigationStack {
                    PhotosPicker(selection: $selectedPhotoItems, matching: .images) {
                        Text("Select Photos")
                    }
                    .photosPickerStyle(.inline)
                    .navigationTitle("Select Photos")
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar {
                        ToolbarItem(placement: .topBarTrailing) {
                            Button("Done") { showPhotoPicker = false }
                        }
                    }
                }
                .presentationDetents([.medium, .large])
            }
            .fullScreenCover(isPresented: $showCamera) {
                CameraPickerView { image in
                    if let data = image.jpegData(compressionQuality: CGFloat(Constants.Attachments.imageCompressionQuality)) {
                        viewModel.addImageAttachment(data: data, fileName: "Camera Photo.jpg")
                    }
                }
                .ignoresSafeArea()
            }
    }

    @ViewBuilder
    private var inputContent: some View {
        if #available(iOS 26, *) {
            VStack(spacing: 4) {
                VStack(spacing: 0) {
                    if !viewModel.pendingAttachments.isEmpty {
                        AttachmentPreviewBar(
                            attachments: viewModel.pendingAttachments,
                            thumbnails: viewModel.pendingImageThumbnails,
                            onRemove: { id in viewModel.removePendingAttachment(id: id) }
                        )
                        .padding(.horizontal, Theme.Dimensions.paddingMedium)
                        .padding(.top, 8)
                    }

                    CustomTextEditor(text: $messageText,
                                     textHeight: $textHeight,
                                     placeholderText: Self.placeholderText,
                                     shouldFocusInput: viewModel.shouldFocusInput,
                                     isLoading: viewModel.isLoading,
                                     onEditingBegan: handleComposerEditingBegan,
                                     onFocusHandled: { viewModel.shouldFocusInput = false },
                                     onSendMessage: submitMessage)
                        .frame(height: textHeight)
                        .padding(.horizontal)
                        .accessibilityIdentifier("messageInput")
                        .accessibilityHint("Spoken words appear in this message field.")

                    HStack(spacing: 0) {
                        HStack(spacing: 0) {
                            attachButton
                            modelPickerButton
                            webSearchButton
                                .padding(.leading, Layout.controlGap)
                        }
                        .padding(.leading, Layout.controlEdgeInset)
                        Spacer(minLength: Layout.controlGap)
                        composerActionButton
                    }
                    .padding(.vertical, 8)
                }
                .glassEffect(.regular.interactive(), in: RoundedRectangle(cornerRadius: Theme.Dimensions.composerCornerRadius, style: .continuous))
            }
            .padding(.horizontal, Theme.Dimensions.paddingMedium)
            .padding(.bottom, isKeyboardVisible ? 12 : 0)
        } else {
            VStack(spacing: 4) {
                VStack(spacing: 0) {
                    if !viewModel.pendingAttachments.isEmpty {
                        AttachmentPreviewBar(
                            attachments: viewModel.pendingAttachments,
                            thumbnails: viewModel.pendingImageThumbnails,
                            onRemove: { id in viewModel.removePendingAttachment(id: id) }
                        )
                        .padding(.horizontal, Theme.Dimensions.paddingMedium)
                        .padding(.top, 8)
                    }

                    CustomTextEditor(text: $messageText,
                                     textHeight: $textHeight,
                                     placeholderText: Self.placeholderText,
                                     shouldFocusInput: viewModel.shouldFocusInput,
                                     isLoading: viewModel.isLoading,
                                     onEditingBegan: handleComposerEditingBegan,
                                     onFocusHandled: { viewModel.shouldFocusInput = false },
                                     onSendMessage: submitMessage)
                        .frame(height: textHeight)
                        .padding(.horizontal)
                        .accessibilityIdentifier("messageInput")
                        .accessibilityHint("Spoken words appear in this message field.")

                    HStack(spacing: 0) {
                        HStack(spacing: 0) {
                            attachButton
                            modelPickerButton
                            webSearchButton
                                .padding(.leading, Layout.controlGap)
                        }
                        .padding(.leading, Layout.controlEdgeInset)
                        Spacer(minLength: Layout.controlGap)
                        composerActionButton
                    }
                    .padding(.vertical, 8)
                }
                .background {
                    RoundedRectangle(cornerRadius: Theme.Dimensions.composerCornerRadius, style: .continuous)
                        .fill(.thickMaterial)
                }
            }
            .padding(.horizontal, Theme.Dimensions.paddingMedium)
            .padding(.bottom, isKeyboardVisible ? 12 : 0)
        }
    }

    private var composerActionButton: some View {
        Button(action: handleComposerAction) {
            Image(systemName: composerActionSymbol)
        }
        .buttonStyle(ComposerIconButtonStyle(
            isProminent: viewModel.isLoading
                || viewModel.agentRunStatus == .running
                || canResumeAgentRun
                || hasDraftContent
                || dictationService.isActive,
            isDarkMode: isDarkMode,
            surfaceAlignment: .bottomTrailing
        ))
        .padding(.trailing, Layout.controlEdgeInset)
        .highPriorityGesture(
            LongPressGesture(minimumDuration: 0.45)
                .onEnded { _ in
                    guard canSteerDraft else { return }
                    steerDraft()
                }
        )
        .disabled(
            (isAgentRunActionPending && !hasDraftContent)
                || viewModel.isQueueSubmissionPending
                || viewModel.isSteeringAgentRun
                || (isKeyboardVisible && !hasDraftContent && !hasActiveAgentRun && !canResumeAgentRun)
        )
        .accessibilityLabel(composerActionLabel)
        .accessibilityValue(
            hasDraftContent && hasActiveAgentRun ? "Ready to queue"
                : viewModel.agentRunStatus == .stopRequested ? "Stopping run"
                : viewModel.agentRunStatus == .queued ? "Run queued"
                : viewModel.isResumingAgentRun ? "Resuming run"
                : canResumeAgentRun ? "Run paused"
                : hasDraftContent ? "Ready to send"
                : viewModel.agentRunStatus == .running ? "Run active"
                : viewModel.isLoading ? "Generating"
                : dictationService.isFinalizing ? "Finishing dictation"
                : dictationService.isRecording ? "Dictating"
                : dictationService.isStarting ? "Starting dictation"
                : "Draft empty"
        )
        .accessibilityHint(composerActionHint)
        .accessibilityIdentifier(composerActionIdentifier)
    }

    private var composerActionSymbol: String {
        if isAgentRunActionPending && !hasDraftContent { return "ellipsis" }
        if canResumeAgentRun { return "play.fill" }
        if hasDraftContent { return "arrow.up" }
        if dictationService.isRecording { return "stop.fill" }
        if dictationService.isFinalizing || dictationService.isStarting { return "stop.fill" }
        if viewModel.agentRunStatus == .running || viewModel.isLoading { return "stop.fill" }
        return "mic.fill"
    }

    private var composerActionLabel: String {
        if hasDraftContent && hasActiveAgentRun { return "Queue message" }
        if viewModel.agentRunStatus == .stopRequested { return "Stopping run" }
        if viewModel.agentRunStatus == .queued { return "Run queued" }
        if viewModel.isResumingAgentRun { return "Resuming run" }
        if canResumeAgentRun { return "Resume run" }
        if hasDraftContent { return "Send message" }
        if dictationService.isRecording { return "Stop dictation" }
        if dictationService.isFinalizing { return "Finishing dictation" }
        if dictationService.isStarting { return "Starting dictation" }
        if viewModel.agentRunStatus == .running { return "Stop run" }
        if viewModel.isLoading { return "Stop generation" }
        return "Start dictation"
    }

    private var composerActionHint: String {
        if hasDraftContent && hasActiveAgentRun { return "Tap to add this message to the queue; press and hold to steer the active run" }
        if viewModel.agentRunStatus == .stopRequested { return "Saving this run's checkpoint" }
        if viewModel.agentRunStatus == .queued { return "This run is waiting to start" }
        if viewModel.isResumingAgentRun { return "Resuming from the saved checkpoint" }
        if canResumeAgentRun { return "Continues this run from its saved checkpoint" }
        if hasDraftContent {
            return dictationService.isActive
                ? "Sends the available transcript and stops dictation"
                : "Sends your message"
        }
        if dictationService.isRecording { return "Stops dictation and keeps the recognized text" }
        if dictationService.isFinalizing { return "Wait for the recognized text" }
        if dictationService.isStarting { return "Wait for dictation to start" }
        if viewModel.agentRunStatus == .running { return "Stops this run and saves its checkpoint" }
        if viewModel.isLoading { return "Stops the response" }
        if isKeyboardVisible { return "Dismiss the keyboard to start dictation" }
        return "Starts speaking your message"
    }

    private var composerActionIdentifier: String {
        if isAgentRunActionPending && !hasDraftContent {
            return "agentRunPendingButton"
        }
        if canResumeAgentRun { return "resumeAgentRunButton" }
        if hasDraftContent && hasActiveAgentRun { return "queueMessageButton" }
        if hasDraftContent { return "sendMessageButton" }
        if dictationService.isRecording { return "stopDictationButton" }
        if dictationService.isFinalizing { return "dictationFinalizingButton" }
        if dictationService.isStarting { return "dictationStartingButton" }
        if viewModel.agentRunStatus == .running { return "stopAgentRunButton" }
        if viewModel.isLoading { return "stopGenerationButton" }
        return "dictationButton"
    }

    @ViewBuilder
    private var attachButton: some View {
        Menu {
            Button {
                showPhotoPicker = true
            } label: {
                Label("Attach Image", systemImage: "photo")
            }

            if UIImagePickerController.isSourceTypeAvailable(.camera) {
                Button {
                    showCamera = true
                } label: {
                    Label("Take Photo", systemImage: "camera")
                }
            }

            Button {
                showDocumentPicker = true
            } label: {
                Label("Choose File", systemImage: "folder")
            }

        } label: {
            Image(systemName: "plus")
                .font(.system(size: 20))
                .foregroundColor(.secondary)
                .frame(width: 24, height: 24)
        }
        .simultaneousGesture(TapGesture().onEnded { HapticFeedback.trigger(.menuOpened) })
        .accessibilityLabel("Add attachment")
        .buttonStyle(ComposerIconButtonStyle(
            isProminent: false,
            isDarkMode: isDarkMode,
            surfaceAlignment: .bottomLeading
        ))
        .accessibilityIdentifier("composerAddAttachment")
        .disabled(viewModel.isLoading || viewModel.isProcessingAttachment)
    }

    private var modelPickerButton: some View {
        Menu {
            ForEach(AppConfig.shared.filteredModelTypes()) { model in
                Button {
                    viewModel.changeModel(to: model)
                } label: {
                    if viewModel.currentModel.id == model.id {
                        Label(model.displayName, systemImage: "checkmark")
                    } else {
                        Text(model.displayName)
                    }
                }
                .disabled(!viewModel.canUse(model))
            }
        } label: {
            HStack(spacing: 5) {
                Text(viewModel.currentModel.displayName)
                    .lineLimit(1)
                    .fixedSize(horizontal: true, vertical: false)
                Image(systemName: "chevron.down")
                    .font(.system(size: 9, weight: .semibold))
            }
            .font(.footnote.weight(.medium))
            .foregroundStyle(.primary)
            .padding(.horizontal, 10)
            .frame(height: 36)
            .background(
                Capsule()
                    .fill(Color.actionButtonBackground(isDarkMode: isDarkMode))
            )
            .frame(height: Theme.Dimensions.controlHitTarget, alignment: .bottom)
        }
        .simultaneousGesture(TapGesture().onEnded { HapticFeedback.trigger(.menuOpened) })
        .accessibilityLabel("Choose model")
        .accessibilityValue(viewModel.currentModel.displayName)
        .accessibilityIdentifier("modelPickerButton")
        .disabled(viewModel.isLoading)
    }

    @ViewBuilder
    private var webSearchButton: some View {
        WebSearchToggleButton(
            isEnabled: viewModel.isWebSearchEnabled,
            isDarkMode: isDarkMode,
            onToggle: {
                withAnimation(.easeInOut(duration: 0.2)) {
                    viewModel.isWebSearchEnabled.toggle()
                    settings.webSearchEnabled = viewModel.isWebSearchEnabled
                }
            }
        )
    }

    private var hasActiveAgentRun: Bool {
        viewModel.agentRunStatus == .running
            || viewModel.agentRunStatus == .stopRequested
            || viewModel.agentRunStatus == .paused
            || viewModel.agentRunStatus == .queued
            || viewModel.isLoading
    }

    private var canSteerDraft: Bool {
        hasDraftContent
            && viewModel.pendingAttachments.isEmpty
            && (viewModel.agentRunStatus == .running
                || viewModel.agentRunStatus == .stopRequested
                || viewModel.agentRunStatus == .paused)
    }

    private func steerDraft() {
        let instruction = messageText
        dictationService.cancel()
        viewModel.steerAgentRun(instruction: instruction) {
            messageText = ""
            textHeight = Layout.defaultHeight
            dismissKeyboard()
        }
    }

    private func stopDictationForKeyboard() {
        guard dictationService.isActive else { return }
        let visibleDraft = messageText
        dictationService.cancel(preservingDraft: visibleDraft)
        messageText = visibleDraft
    }

    private func handleComposerEditingBegan() {
        HapticFeedback.trigger(.composerFocused)
        stopDictationForKeyboard()
    }

    private func handleComposerAction() {
        if isAgentRunActionPending {
            if hasDraftContent && hasActiveAgentRun {
                let draft = messageText
                dictationService.cancel()
                queueDraft(draft)
            }
            return
        } else if hasDraftContent {
            let draft = messageText
            dictationService.cancel()
            if hasActiveAgentRun {
                queueDraft(draft)
            } else {
                submitMessage(draft)
            }
        } else if canResumeAgentRun {
            viewModel.resumeAgentRun()
        } else if viewModel.agentRunStatus == .running || viewModel.isLoading {
            viewModel.cancelGeneration()
        } else if dictationService.isRecording {
            dictationService.stop()
        } else if dictationService.isFinalizing {
            return
        } else if dictationService.isStarting {
            dictationService.cancel()
        } else if isKeyboardVisible {
            return
        } else {
            Task {
                do {
                    try await dictationService.start(with: messageText)
                } catch {
                    if !(error is CancellationError) {
                        viewModel.attachmentError = error.localizedDescription
                    }
                }
            }
        }
    }

    private func queueDraft(_ text: String) {
        viewModel.queueMessage(text: text) {
            messageText = ""
            textHeight = Layout.defaultHeight
            dismissKeyboard()
        }
    }

    @discardableResult
    private func submitMessage(_ text: String) -> Bool {
        guard !viewModel.isLoading else { return false }
        let hasText = !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        guard hasText || !viewModel.pendingAttachments.isEmpty else { return false }
        guard viewModel.sendMessage(text: text) else { return false }
        messageText = ""
        textHeight = Layout.defaultHeight
        dismissKeyboard()
        return true
    }

    /// Submitting a message ends the compose gesture: keyboard and input focus
    /// are released so the response can stream without the input competing.
    private func dismissKeyboard() {
        UIApplication.shared.sendAction(
            #selector(UIResponder.resignFirstResponder),
            to: nil,
            from: nil,
            for: nil
        )
    }

    private func processSelectedPhotos() {
        let items = selectedPhotoItems
        selectedPhotoItems = []
        for (index, item) in items.enumerated() {
            Task {
                if let data = try? await item.loadTransferable(type: Data.self) {
                    let fileName = items.count > 1 ? "Photo \(index + 1).jpg" : "Photo.jpg"
                    viewModel.addImageAttachment(data: data, fileName: fileName)
                }
            }
        }
    }
}

/// Shared geometry and surface for composer actions, independent of system button padding.
private struct ComposerIconButtonStyle: ButtonStyle {
    let isProminent: Bool
    let isDarkMode: Bool
    var surfaceAlignment: Alignment = .center

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 16, weight: .semibold))
            .frame(width: 36, height: 36)
            .background(
                Circle()
                    .fill(
                        isProminent
                            ? (isDarkMode ? Color.sendButtonBackgroundDark : Color.sendButtonBackgroundLight)
                            : Color.actionButtonBackground(isDarkMode: isDarkMode)
                    )
            )
            .frame(
                width: Theme.Dimensions.controlHitTarget,
                height: Theme.Dimensions.controlHitTarget,
                alignment: surfaceAlignment
            )
            .foregroundStyle(
                isProminent
                    ? (isDarkMode ? Color.sendButtonForegroundDark : Color.sendButtonForegroundLight)
                    : (isDarkMode ? Color.white.opacity(0.72) : Color.black.opacity(0.62))
            )
            .contentShape(Rectangle())
            .opacity(configuration.isPressed ? 0.8 : 1)
    }
}

/// Stable, neutral web-search toggle shared by the composer and the debug gallery.
struct WebSearchToggleButton: View {
    let isEnabled: Bool
    let isDarkMode: Bool
    let accessibilityIdentifier: String
    let onToggle: () -> Void

    init(
        isEnabled: Bool,
        isDarkMode: Bool,
        accessibilityIdentifier: String = "webSearchToggle",
        onToggle: @escaping () -> Void
    ) {
        self.isEnabled = isEnabled
        self.isDarkMode = isDarkMode
        self.accessibilityIdentifier = accessibilityIdentifier
        self.onToggle = onToggle
    }

    var body: some View {
        Button(action: onToggle) {
            Image(systemName: "globe")
        }
        .buttonStyle(ComposerIconButtonStyle(
            isProminent: isEnabled,
            isDarkMode: isDarkMode,
            surfaceAlignment: .bottomLeading
        ))
        .accessibilityLabel("Web search")
        .accessibilityIdentifier(accessibilityIdentifier)
        .accessibilityValue(isEnabled ? "On" : "Off")
        .accessibilityAddTraits(isEnabled ? .isSelected : [])
    }
}


/// Custom UIViewRepresentable for a properly managed text editor
struct CustomTextEditor: UIViewRepresentable {
    @Binding var text: String
    @Binding var textHeight: CGFloat
    var placeholderText: String
    var shouldFocusInput: Bool
    var isLoading: Bool
    var onEditingBegan: () -> Void
    var onFocusHandled: () -> Void
    var onSendMessage: (String) -> Bool

    func makeUIView(context: Context) -> UITextView {
        let textView = UITextView()
        textView.accessibilityIdentifier = "messageInput"
        textView.delegate = context.coordinator
        textView.font = UIFont.preferredFont(forTextStyle: .body)
        textView.backgroundColor = .clear
        textView.isScrollEnabled = true
        textView.isEditable = true
        textView.isSelectable = true
        textView.keyboardType = .default
        textView.autocorrectionType = .default
        textView.spellCheckingType = .default
        textView.alwaysBounceVertical = false
        textView.scrollsToTop = false
        textView.textContainerInset = UIEdgeInsets(top: 16, left: 2, bottom: 8, right: 5)
        textView.textContainer.lineFragmentPadding = 0
        textView.tintColor = UIColor { traitCollection in
            traitCollection.userInterfaceStyle == .dark ? .white : .black
        }

        if text.isEmpty {
            textView.text = placeholderText
            textView.textColor = .lightGray
        } else {
            textView.text = text
            textView.textColor = UIColor { traitCollection in
                return traitCollection.userInterfaceStyle == .dark ? .white : .black
            }
        }

        return textView
    }

    func updateUIView(_ uiView: UITextView, context: Context) {
        context.coordinator.parent = self
        let isCurrentlyEditing = context.coordinator.isEditing

        if shouldFocusInput && !context.coordinator.hasFocusedFromFlag {
            context.coordinator.hasFocusedFromFlag = true
            DispatchQueue.main.async {
                if !uiView.isFirstResponder { uiView.becomeFirstResponder() }
                self.onFocusHandled()
            }
        } else if !shouldFocusInput {
            context.coordinator.hasFocusedFromFlag = false
        }

        if text.isEmpty && !isCurrentlyEditing && uiView.textColor != .lightGray {
            uiView.text = placeholderText
            uiView.textColor = .lightGray
        } else if text.isEmpty && isCurrentlyEditing {
            if uiView.textColor == .lightGray {
                uiView.text = ""
                uiView.textColor = UIColor { tc in tc.userInterfaceStyle == .dark ? .white : .black }
            } else if !uiView.text.isEmpty {
                uiView.text = ""
            }
        } else if !text.isEmpty && uiView.textColor == .lightGray {
            uiView.text = text
            uiView.textColor = UIColor { tc in tc.userInterfaceStyle == .dark ? .white : .black }
        } else if !text.isEmpty && uiView.text != text && uiView.textColor != .lightGray {
            uiView.text = text
        }

        uiView.isEditable = true

        let size = uiView.sizeThatFits(CGSize(width: uiView.frame.width, height: CGFloat.greatestFiniteMagnitude))
        let newHeight = min(MessageInputView.Layout.maximumHeight, max(MessageInputView.Layout.minimumHeight, size.height))
        if textHeight != newHeight {
            DispatchQueue.main.async { self.textHeight = newHeight }
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    class Coordinator: NSObject, UITextViewDelegate {
        var parent: CustomTextEditor
        var isEditing = false
        var hasFocusedFromFlag = false

        init(_ parent: CustomTextEditor) { self.parent = parent }

        func textView(_ textView: UITextView, shouldChangeTextIn range: NSRange, replacementText text: String) -> Bool {
            if text == "\n" {
                let isMac = ProcessInfo.processInfo.isiOSAppOnMac
                if isMac {
                    let currentText = textView.text ?? ""
                    let trimmedText = currentText.trimmingCharacters(in: .whitespacesAndNewlines)
                    if !trimmedText.isEmpty && !parent.isLoading {
                        guard parent.onSendMessage(trimmedText) else { return false }
                        textView.text = ""
                        parent.text = ""
                        parent.textHeight = MessageInputView.Layout.defaultHeight
                        textView.text = parent.placeholderText
                        textView.textColor = .lightGray
                        textView.resignFirstResponder()
                    }
                    return false
                }
            }

            let currentText = textView.text as NSString
            let newText = currentText.replacingCharacters(in: range, with: text)
            if newText.isEmpty && isEditing { return true }
            return true
        }

        func textViewDidChange(_ textView: UITextView) {
            if textView.textColor != .lightGray {
                parent.text = textView.text
                let size = textView.sizeThatFits(CGSize(width: textView.frame.width, height: CGFloat.greatestFiniteMagnitude))
                let newHeight = min(MessageInputView.Layout.maximumHeight, max(MessageInputView.Layout.minimumHeight, size.height))
                if parent.textHeight != newHeight { parent.textHeight = newHeight }
            }
        }

        func textViewDidBeginEditing(_ textView: UITextView) {
            isEditing = true
            parent.onEditingBegan()
            if textView.textColor == .lightGray {
                textView.text = ""
                textView.textColor = UIColor { tc in tc.userInterfaceStyle == .dark ? .white : .black }
            }
        }

        func textViewDidEndEditing(_ textView: UITextView) {
            isEditing = false
            if textView.text.isEmpty {
                textView.text = parent.placeholderText
                textView.textColor = .lightGray
            }
        }
    }
}
