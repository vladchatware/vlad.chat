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
    }

    @Binding var messageText: String
    @ObservedObject var viewModel: ChatViewModel
    @Environment(\.colorScheme) var colorScheme
    @State private var textHeight: CGFloat = Layout.defaultHeight
    @ObservedObject private var settings = SettingsManager.shared
    @StateObject private var audioService = AudioRecordingService.shared
    var isKeyboardVisible: Bool = false

    private var isDarkMode: Bool { colorScheme == .dark }

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
                        .padding(.horizontal, 12)
                        .padding(.top, 8)
                    }

                    CustomTextEditor(text: $messageText,
                                     textHeight: $textHeight,
                                     placeholderText: viewModel.currentChat?.messages.isEmpty ?? true ? "What's on your mind?" : "Message",
                                     shouldFocusInput: viewModel.shouldFocusInput,
                                     isLoading: viewModel.isLoading,
                                     onFocusHandled: { viewModel.shouldFocusInput = false },
                                     onSendMessage: submitMessage)
                        .frame(height: textHeight)
                        .padding(.horizontal)
                        .accessibilityIdentifier("messageInput")

                    HStack(spacing: 0) {
                        HStack(spacing: 8) {
                            attachButton
                            modelPickerButton
                            webSearchButton
                        }
                        .padding(.leading, 8)
                        Spacer(minLength: 8)
                        sendButton
                    }
                    .padding(.vertical, 8)
                }
                .glassEffect(.regular.interactive(), in: RoundedRectangle(cornerRadius: 26))
            }
            .padding(.horizontal, 12)
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
                        .padding(.horizontal, 12)
                        .padding(.top, 8)
                    }

                    CustomTextEditor(text: $messageText,
                                     textHeight: $textHeight,
                                     placeholderText: viewModel.currentChat?.messages.isEmpty ?? true ? "What's on your mind?" : "Message",
                                     shouldFocusInput: viewModel.shouldFocusInput,
                                     isLoading: viewModel.isLoading,
                                     onFocusHandled: { viewModel.shouldFocusInput = false },
                                     onSendMessage: submitMessage)
                        .frame(height: textHeight)
                        .padding(.horizontal)

                    HStack(spacing: 0) {
                        HStack(spacing: 8) {
                            attachButton
                            modelPickerButton
                            webSearchButton
                        }
                        .padding(.leading, 8)
                        Spacer(minLength: 8)
                        sendButton
                    }
                    .padding(.vertical, 8)
                }
                .background {
                    RoundedRectangle(cornerRadius: 26)
                        .fill(.thickMaterial)
                }
            }
            .padding(.horizontal, 12)
            .padding(.bottom, isKeyboardVisible ? 12 : 0)
        }
    }

    private var sendButton: some View {
        Button(action: sendOrCancelMessage) {
            Image(systemName: viewModel.isLoading ? "stop.fill" : "arrow.up")
        }
        .buttonStyle(ComposerIconButtonStyle(
            isProminent: true,
            isDarkMode: isDarkMode,
            surfaceAlignment: .bottomTrailing
        ))
        .padding(.trailing, 8)
        .accessibilityLabel(viewModel.isLoading ? "Stop generation" : "Send message")
        .accessibilityValue(messageText.isEmpty ? "Empty" : "Ready")
        .accessibilityIdentifier(viewModel.isLoading ? "stopGenerationButton" : "sendMessageButton")
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
        .accessibilityLabel("Add attachment")
        .buttonStyle(ComposerIconButtonStyle(
            isProminent: false,
            isDarkMode: isDarkMode,
            surfaceAlignment: .bottomLeading
        ))
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
        .accessibilityLabel("Choose model")
        .accessibilityValue(viewModel.currentModel.displayName)
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

    @State private var isPulsing = false

    @ViewBuilder
    private var micButton: some View {
        Button(action: toggleRecording) {
            ZStack {
                if audioService.isRecording {
                    Circle()
                        .fill(Color.red.opacity(0.2))
                        .frame(width: 44, height: 44)
                        .scaleEffect(isPulsing ? 1.1 : 0.9)
                        .animation(
                            .easeInOut(duration: 0.8).repeatForever(autoreverses: true),
                            value: isPulsing
                        )
                }

                Group {
                    if audioService.isTranscribing {
                        ProgressView()
                            .progressViewStyle(CircularProgressViewStyle(tint: .secondary))
                            .scaleEffect(0.8)
                    } else {
                        Image(systemName: audioService.isRecording ? "stop.fill" : "mic.fill")
                            .font(.system(size: 20))
                    }
                }
                .frame(width: 32, height: 32)
                .foregroundColor(audioService.isRecording ? .red : .secondary)
            }
            .frame(width: 32, height: 32)
        }
        .onChange(of: audioService.isRecording) { _, isRecording in
            isPulsing = isRecording
        }
        .disabled(audioService.isTranscribing || viewModel.isLoading)
        .padding(.trailing, 4)
    }

    private func toggleRecording() {
        if audioService.isRecording {
            guard let fileURL = audioService.stopRecording() else { return }
            Task {
                do {
                    let client = AppConfig.shared.makeClient()
                    let text = try await audioService.transcribe(fileURL: fileURL, client: client)
                    messageText += (messageText.isEmpty ? "" : " ") + text
                } catch {
                    viewModel.attachmentError = error.localizedDescription
                }
            }
        } else {
            Task {
                let granted = await audioService.requestPermission()
                guard granted else {
                    viewModel.attachmentError = "Microphone access is required for voice input. Enable it in Settings."
                    return
                }
                do {
                    try audioService.startRecording()
                } catch {
                    viewModel.attachmentError = "Failed to start recording: \(error.localizedDescription)"
                }
            }
        }
    }

    private func sendOrCancelMessage() {
        if viewModel.isLoading {
            viewModel.cancelGeneration()
        } else if !messageText.isEmpty || !viewModel.pendingAttachments.isEmpty {
            submitMessage(messageText)
        }
    }

    private func submitMessage(_ text: String) {
        guard !viewModel.isLoading else { return }
        let hasText = !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        guard hasText || !viewModel.pendingAttachments.isEmpty else { return }
        viewModel.sendMessage(text: text)
        messageText = ""
        textHeight = Layout.defaultHeight
        dismissKeyboard()
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
            surfaceAlignment: .bottom
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
    var onFocusHandled: () -> Void
    var onSendMessage: (String) -> Void

    func makeUIView(context: Context) -> UITextView {
        let textView = UITextView()
        textView.accessibilityIdentifier = "messageInput"
        textView.delegate = context.coordinator
        textView.font = UIFont.preferredFont(forTextStyle: .body)
        textView.backgroundColor = .clear
        textView.isScrollEnabled = true
        textView.isEditable = true
        textView.isSelectable = true
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
                        parent.onSendMessage(trimmedText)
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
