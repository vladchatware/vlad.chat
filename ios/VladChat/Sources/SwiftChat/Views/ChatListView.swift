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
            scrollTrigger: scrollTrigger,
            scrollToUserTrigger: scrollToUserTrigger,
            tableOpacity: $tableOpacity,
            keyboardHeight: keyboardHeight
        )
        .opacity(tableOpacity)
        .background(Color.chatBackground(isDarkMode: isDarkMode))
        .overlay(alignment: .bottom) {
            if userHasScrolled && !messages.isEmpty && !isKeyboardVisible {
                Group {
                    if #available(iOS 26, *) {
                        Button(action: jumpToLatest) {
                            Image(systemName: "arrow.down")
                                .font(.system(size: 12, weight: .semibold))
                                .frame(width: Constants.UI.scrollToBottomButtonSize, height: Constants.UI.scrollToBottomButtonSize)
                        }
                        .buttonStyle(.glass)
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
                    }
                }
                .padding(.bottom, 8)
                .transition(.opacity)
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            VStack(spacing: shouldShowAccountPrompt ? 12 : 0) {
                if shouldShowAccountPrompt {
                    AccountView(viewModel: viewModel, onDismiss: dismissAccountPrompt)
                        .frame(maxWidth: 600)
                        .padding(.horizontal, 16)
                        .frame(maxWidth: .infinity)
                        .transition(.move(edge: .bottom).combined(with: .opacity))
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
        }
        .onAppear {
            setupKeyboardObservers()
        }
        .onDisappear {
            removeKeyboardObservers()
            viewModel.isScrollInteractionActive = false
        }
        .onChange(of: messages.count) { oldCount, newCount in
            if newCount > oldCount {
                let newMessages = messages.suffix(newCount - oldCount)
                let hasUserMessage = newMessages.contains { $0.role == .user }
                let wasInitialLoad = oldCount == 0

                if hasUserMessage || wasInitialLoad {
                    userHasScrolled = false
                    viewModel.isScrollInteractionActive = false
                    // Stay anchored at the bottom. Pinning the sent message to the
                    // top created an empty viewport that the next stream update
                    // immediately scrolled away from, which read as a vertical jump.
                    scrollTrigger = UUID()
                }
            }
        }
        .onChange(of: viewModel.currentChat?.createdAt) { _, _ in
            userHasScrolled = false
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
        .onChange(of: viewModel.scrollToBottomTrigger) { _, _ in
            userHasScrolled = false
            viewModel.isScrollInteractionActive = false
            scrollTrigger = UUID()
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
