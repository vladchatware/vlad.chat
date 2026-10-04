//
//  ChatListView.swift
//  SwiftChat
//
//  Created on 03/25/26.
//  Copyright © 2026 Sacha Servan-Schreiber. All rights reserved.
//

import SwiftUI

struct ChatListView: View {
    let isDarkMode: Bool
    let isLoading: Bool
    @ObservedObject var viewModel: ChatViewModel
    @ObservedObject private var settings = SettingsManager.shared
    @Binding var messageText: String
    @Binding var isAccountPromptPresented: Bool

    @State private var isAtBottom = true
    @State private var userHasScrolled = false
    @State private var showJumpToBottomButton = false
    @State private var isKeyboardVisible = false
    @State private var keyboardHeight: CGFloat = 0
    @State private var scrollTrigger = UUID()
    @State private var scrollToUserTrigger = UUID()
    @State private var tableOpacity = 1.0
    @State private var keyboardObserverTokens: [NSObjectProtocol] = []
    @State private var didDismissNearLimitPrompt = false

    private var messages: [Message] {
        viewModel.messages
    }

    private var isNearMessageLimit: Bool {
        guard let account = viewModel.account, account.isAnonymous else { return false }
        return account.trialMessages <= 2
    }

    private var shouldShowAccountPrompt: Bool {
        isAccountPromptPresented || (isNearMessageLimit && !didDismissNearLimitPrompt)
    }

    private var archivedMessagesStartIndex: Int {
        max(0, messages.count - settings.maxMessages)
    }

    var body: some View {
        MessageTableView(
            archivedMessagesStartIndex: archivedMessagesStartIndex,
            isDarkMode: isDarkMode,
            isLoading: isLoading,
            viewModel: viewModel,
            isAtBottom: $isAtBottom,
            userHasScrolled: $userHasScrolled,
            showJumpToBottomButton: $showJumpToBottomButton,
            scrollTrigger: scrollTrigger,
            scrollToUserTrigger: scrollToUserTrigger,
            tableOpacity: $tableOpacity,
            keyboardHeight: keyboardHeight
        )
        .opacity(tableOpacity)
        .background(Color.chatBackground(isDarkMode: isDarkMode))
        .overlay(alignment: .bottom) {
            if showJumpToBottomButton && !messages.isEmpty && !isKeyboardVisible {
                Group {
                    if #available(iOS 26, *) {
                        Button(action: jumpToLatest) {
                            Image(systemName: "arrow.down")
                                .font(.system(size: 12, weight: .semibold))
                                .frame(width: Constants.UI.scrollToBottomButtonSize, height: Constants.UI.scrollToBottomButtonSize)
                        }
                        .buttonStyle(.glass)
                        .accessibilityIdentifier("jumpToLatestButton")
                        .clipShape(Circle())
                    } else {
                        Button(action: jumpToLatest) {
                            Image(systemName: "arrow.down.circle.fill")
                                .font(.system(size: 24))
                                .foregroundColor(.white)
                                .padding(8)
                                .background(Color.gray.opacity(0.8))
                                .clipShape(Circle())
                        }
                        .accessibilityIdentifier("jumpToLatestButton")
                    }
                }
                .padding(.bottom, 8)
                .transition(.opacity)
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            ChatComposerArea(
                viewModel: viewModel,
                messageText: $messageText,
                shouldShowAccountPrompt: shouldShowAccountPrompt,
                isKeyboardVisible: isKeyboardVisible,
                onDismissAccountPrompt: dismissAccountPrompt
            )
        }
        .overlayPreferenceValue(ComputerComposerTopPreferenceKey.self) { composerTop in
            ComputerUseViewerOverlay(
                controller: viewModel.computerUseController,
                composerTop: composerTop
            )
        }
        .onAppear {
            setupKeyboardObservers()
        }
        .onDisappear {
            removeKeyboardObservers()
            viewModel.isScrollInteractionActive = false
        }
        .onChange(of: messages.map(\.id)) { oldIDs, newIDs in
            guard newIDs.count > oldIDs.count else { return }

            let appendedMessages: ArraySlice<Message>
            if oldIDs.isEmpty {
                appendedMessages = messages[...]
            } else if let previousLastID = oldIDs.last,
                      let previousLastIndex = newIDs.firstIndex(of: previousLastID) {
                appendedMessages = messages.suffix(from: newIDs.index(after: previousLastIndex))
            } else {
                // A replaced/trimmed transcript cannot tell us that a new user
                // message was appended; keep the reader's current position.
                return
            }

            if oldIDs.isEmpty || appendedMessages.contains(where: { $0.role == .user }) {
                userHasScrolled = false
                showJumpToBottomButton = false
                viewModel.isScrollInteractionActive = false
                // Follow the initial history and newly sent messages. Older
                // history inserted ahead of the last known row stays in place.
                scrollTrigger = UUID()
            }
        }
        .onChange(of: viewModel.currentChat?.id) { _, _ in
            userHasScrolled = false
            showJumpToBottomButton = false
            viewModel.isScrollInteractionActive = false

            // Never blank the table on an in-place refresh. The first server
            // snapshot changes createdAt for the same conversation, and hiding
            // the table there caused a full-screen flash before the reply painted.
            tableOpacity = 1.0
            isAtBottom = true

            if !(viewModel.currentChat?.isBlankChat ?? true) {
                scrollTrigger = UUID()
            }
        }
        .onChange(of: viewModel.scrollToUserMessageTrigger) { _, _ in
            userHasScrolled = false
            viewModel.isScrollInteractionActive = false
            scrollToUserTrigger = UUID()
        }
    }

    private func setupKeyboardObservers() {
        removeKeyboardObservers()

        let showToken = NotificationCenter.default.addObserver(forName: UIResponder.keyboardWillShowNotification, object: nil, queue: .main) { notification in
            if let keyboardFrame = notification.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect {
                isKeyboardVisible = true
                self.keyboardHeight = keyboardFrame.height
            }
        }

        let hideToken = NotificationCenter.default.addObserver(forName: UIResponder.keyboardWillHideNotification, object: nil, queue: .main) { _ in
            isKeyboardVisible = false
            keyboardHeight = 0
        }

        keyboardObserverTokens = [showToken, hideToken]
    }

    private func removeKeyboardObservers() {
        for token in keyboardObserverTokens {
            NotificationCenter.default.removeObserver(token)
        }
        keyboardObserverTokens.removeAll()
    }

    private func jumpToLatest() {
        userHasScrolled = false
        showJumpToBottomButton = false
        viewModel.isScrollInteractionActive = false
        scrollTrigger = UUID()
    }

    private func dismissAccountPrompt() {
        if isNearMessageLimit {
            didDismissNearLimitPrompt = true
        }
        isAccountPromptPresented = false
    }

}

private struct ChatComposerArea: View {
    @ObservedObject var viewModel: ChatViewModel
    @Binding var messageText: String
    let shouldShowAccountPrompt: Bool
    let isKeyboardVisible: Bool
    let onDismissAccountPrompt: () -> Void

    var body: some View {
        VStack(spacing: shouldShowAccountPrompt ? 12 : 0) {
            if shouldShowAccountPrompt {
                AccountPromptView(viewModel: viewModel, onDismiss: onDismissAccountPrompt)
                    .frame(maxWidth: 600)
                    .padding(.horizontal, 16)
                    .frame(maxWidth: .infinity)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }

            if let state = viewModel.agentActivityState {
                AgentRunStatusView(
                    state: state,
                    canExpand: viewModel.canExpandAgentActivity,
                    onExpand: { viewModel.showAgentActivity() }
                )
                .frame(maxWidth: 600)
                .padding(.horizontal, 20)
                .padding(.vertical, 4)
            }

            MessageInputView(
                messageText: $messageText,
                viewModel: viewModel,
                isKeyboardVisible: isKeyboardVisible
            )
            .environmentObject(viewModel)
            .if(UIDevice.current.userInterfaceIdiom == .pad) { view in
                HStack {
                    Spacer()
                    view.frame(maxWidth: 600)
                    Spacer()
                }
            }
        }
        .animation(.easeInOut(duration: 0.22), value: shouldShowAccountPrompt)
        .background {
            GeometryReader { proxy in
                Color.clear.preference(
                    key: ComputerComposerTopPreferenceKey.self,
                    value: proxy.frame(in: .global).minY
                )
            }
        }
    }
}

/// A readable status remains in the app after the temporary Island is dismissed
/// and when system Live Activities are disabled.
struct AgentRunStatusView: View {
    let state: AgentActivityAttributes.ContentState
    let canExpand: Bool
    let onExpand: () -> Void

    var body: some View {
        if canExpand {
            Button(action: onExpand) {
                AgentRunStatusLabel(state: state, showsExpansion: true)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Agent run activity")
            .accessibilityValue(Text(state.phase.label))
            .accessibilityHint("Opens expanded run activity")
            .accessibilityIdentifier("expandAgentActivity")
        } else {
            AgentRunStatusLabel(state: state, showsExpansion: false)
                .accessibilityIdentifier("agentRunStatus")
        }
    }
}

private struct AgentRunStatusLabel: View {
    let state: AgentActivityAttributes.ContentState
    let showsExpansion: Bool

    var body: some View {
        HStack(spacing: 8) {
            Label { Text(state.phase.label) } icon: { Image(systemName: state.phase.symbol) }
            Spacer()
            Text("Step \(state.stepCount, format: .number)", comment: "Completed step count for the active agent run.")
                .foregroundStyle(.secondary)
            if showsExpansion {
                Image(systemName: "chevron.up")
                    .accessibilityHidden(true)
            }
        }
        .font(.caption)
        .foregroundStyle(.primary)
        .frame(minHeight: 44)
        .contentShape(Rectangle())
    }
}
