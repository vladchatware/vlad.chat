//
//  MessageTableView.swift
//  SwiftChat
//
//  Created on 03/25/26.
//  Copyright © 2026 Sacha Servan-Schreiber. All rights reserved.
//

import SwiftUI
import Combine
import QuartzCore

/// Self-sizing hosting cells can resolve their heights after a scroll finishes.
final class TranscriptTableView: UITableView {
    var contentSizeDidChange: (() -> Void)?
    private var lastContentSize = CGSize.zero

    override func layoutSubviews() {
        super.layoutSubviews()
        guard contentSize != lastContentSize else { return }
        lastContentSize = contentSize
        contentSizeDidChange?()
    }
}

/// Owns the transcript's safe area and the material beneath its floating composer.
final class MessageTableViewController: UIViewController {
    let tableView: UITableView
    var composerTop: CGFloat? {
        didSet {
            if isViewLoaded, composerTop != oldValue { view.setNeedsLayout() }
        }
    }
    var isDarkMode: Bool {
        didSet {
            if isViewLoaded, isDarkMode != oldValue { view.setNeedsLayout() }
        }
    }
    private let bottomBlur = UIVisualEffectView()
    private let bottomBlurMask = CAGradientLayer()
    private var isBottomBlurConfigured = false

    init(tableView: UITableView, composerTop: CGFloat?, isDarkMode: Bool) {
        self.tableView = tableView
        self.composerTop = composerTop
        self.isDarkMode = isDarkMode
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func loadView() {
        let container = UIView()
        container.backgroundColor = .clear
        tableView.frame = container.bounds
        tableView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        container.addSubview(tableView)

        view = container

        guard #available(iOS 26, *) else { return }
        bottomBlur.isUserInteractionEnabled = false
        bottomBlurMask.colors = [
            UIColor.clear.cgColor,
            UIColor.black.cgColor,
            UIColor.black.cgColor,
        ]
        bottomBlurMask.locations = [0, 0.8, 1]
        bottomBlurMask.startPoint = CGPoint(x: 0.5, y: 0)
        bottomBlurMask.endPoint = CGPoint(x: 0.5, y: 1)
        bottomBlur.layer.mask = bottomBlurMask
        container.addSubview(bottomBlur)
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        guard #available(iOS 26, *), !isBottomBlurConfigured else { return }
        // Configure the partial effect after attachment to its window; UIKit
        // can rebuild material effects when an unattached view first appears.
        let animator = UIViewPropertyAnimator(duration: 1, curve: .linear) { [bottomBlur] in
            bottomBlur.effect = UIBlurEffect(style: .regular)
        }
        animator.startAnimation()
        animator.pauseAnimation()
        animator.fractionComplete = 0.2
        // Commit the partial material as a finished effect. Keeping a paused
        // animator active makes UI automation wait indefinitely for idle.
        animator.stopAnimation(false)
        animator.finishAnimation(at: .current)
        isBottomBlurConfigured = true
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        updateComposerSafeArea()
        updateBottomBlur()
    }

    func updateComposerSafeArea() {
        guard #available(iOS 26, *), isViewLoaded, let window = view.window else { return }
        let overlap = composerTop.map { top in
            max(0, view.convert(view.bounds, to: window).maxY - top)
        } ?? 0
        let systemBottomInset = max(0, view.safeAreaInsets.bottom - additionalSafeAreaInsets.bottom)
        let bottomInset = max(0, overlap - systemBottomInset)
        if abs(additionalSafeAreaInsets.bottom - bottomInset) > 0.5 {
            additionalSafeAreaInsets.bottom = bottomInset
        }
    }

    private func updateBottomBlur() {
        guard #available(iOS 26, *), let window = view.window, let composerTop else {
            bottomBlur.isHidden = true
            return
        }
        // Begin the soft material at zero at the composer's top. A single
        // restrained pass avoids compounding tint beneath the composer glass.
        tableView.bottomEdgeEffect.isHidden = true
        let composerY = view.convert(CGPoint(x: 0, y: composerTop), from: window).y
        let startY = max(0, composerY)
        let height = max(0, view.bounds.height - startY)
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        bottomBlur.isHidden = height == 0
        bottomBlur.frame = CGRect(x: 0, y: startY, width: view.bounds.width, height: height)
        bottomBlurMask.frame = bottomBlur.bounds
        CATransaction.commit()
    }
}

struct MessageTableView: UIViewControllerRepresentable {
    let archivedMessagesStartIndex: Int
    let isDarkMode: Bool
    let isLoading: Bool
    @ObservedObject var viewModel: ChatViewModel
    @Binding var isAtBottom: Bool
    @Binding var userHasScrolled: Bool
    @Binding var showJumpToBottomButton: Bool
    let scrollTrigger: UUID
    let scrollToUserTrigger: UUID
    @Binding var tableOpacity: Double
    let keyboardHeight: CGFloat
    var composerTop: CGFloat? = nil

    private var messages: [Message] {
        viewModel.messages
    }

    func makeUIViewController(context: Context) -> MessageTableViewController {
        let tableView = TranscriptTableView(frame: .zero, style: .plain)
        tableView.backgroundColor = .clear
        tableView.separatorStyle = .none
        tableView.delegate = context.coordinator
        tableView.dataSource = context.coordinator
        tableView.keyboardDismissMode = .onDrag
        tableView.allowsSelection = false
        tableView.estimatedRowHeight = 100
        tableView.rowHeight = UITableView.automaticDimension
        tableView.showsVerticalScrollIndicator = true
        tableView.contentInsetAdjustmentBehavior = .automatic
        tableView.clipsToBounds = false

        if #available(iOS 26, *) {
            tableView.bottomEdgeEffect.style = .soft
        }

        if #available(iOS 15.0, *) {
            tableView.isPrefetchingEnabled = true
        }

        context.coordinator.tableView = tableView
        tableView.contentSizeDidChange = { [weak coordinator = context.coordinator] in
            coordinator?.resumeFollowingLatestAfterLayout()
        }

        return MessageTableViewController(tableView: tableView, composerTop: composerTop, isDarkMode: isDarkMode)
    }

    func updateUIViewController(_ controller: MessageTableViewController, context: Context) {
        let tableView = controller.tableView
        controller.composerTop = composerTop
        controller.isDarkMode = isDarkMode
        controller.updateComposerSafeArea()
        context.coordinator.parent = self

        let keyboardHeightChanged = context.coordinator.lastKeyboardHeight != keyboardHeight
        if keyboardHeightChanged {
            let wasAtBottom = context.coordinator.parent.isAtBottom
            context.coordinator.lastKeyboardHeight = keyboardHeight

            if wasAtBottom && keyboardHeight > 0 {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
                    context.coordinator.scrollToBottom(animated: true)
                }
            }
        }

        let currentChatId = viewModel.currentChat?.id
        let previousChatId = context.coordinator.lastChatId
        let chatIdChanged = previousChatId != currentChatId

        // Detect ID conversion (temp → permanent) by checking if message IDs match
        // This is more reliable than checking wrappers since wrappers only exist for rendered cells
        let currentMessageIds = Set(viewModel.messages.map { $0.id })
        let currentMessageSequence = viewModel.messages.map { $0.id }
        let isIdConversion = chatIdChanged && !currentMessageIds.isEmpty &&
            currentMessageIds == context.coordinator.lastMessageIds
        let preservedMessageIdentities = context.coordinator.reconcileMessageIdentities(
            from: context.coordinator.lastMessageSequence,
            to: viewModel.messages
        )

        if chatIdChanged {
            context.coordinator.lastChatId = currentChatId
            context.coordinator.resetUserScrollDisplacement()

            if !isIdConversion && !preservedMessageIdentities {
                context.coordinator.messageWrappers.removeAll()
                context.coordinator.shownMessageIds.removeAll()
            } else if preservedMessageIdentities {
                context.coordinator.messageWrappers = context.coordinator.messageWrappers.filter {
                    currentMessageIds.contains($0.key)
                }
            }
            context.coordinator.lastMessageIds = currentMessageIds
            context.coordinator.lastMessageSequence = currentMessageSequence
        } else if currentMessageIds != context.coordinator.lastMessageIds {
            // Message IDs changed without chat ID changing (e.g., regenerate)
            let idsWereReplaced = !currentMessageIds.isEmpty &&
                                  !context.coordinator.lastMessageIds.isEmpty &&
                                  currentMessageIds.isDisjoint(with: context.coordinator.lastMessageIds)

            if idsWereReplaced && !preservedMessageIdentities {
                // All message IDs are different - clear stale wrappers
                context.coordinator.messageWrappers.removeAll()
                context.coordinator.shownMessageIds.removeAll()
                context.coordinator.heightCache.removeAll()
            }
            context.coordinator.lastMessageIds = currentMessageIds
            context.coordinator.lastMessageSequence = currentMessageSequence
            context.coordinator.reloadDataPreservingReaderPosition()
        }

        let isDarkModeChanged = context.coordinator.lastIsDarkMode != isDarkMode
        let messageCountChanged = context.coordinator.lastMessageCount != messages.count
        let showsWaitingRow = context.coordinator.showsWaitingRow
        let waitingRowChanged = context.coordinator.lastShowsWaitingRow != showsWaitingRow
        context.coordinator.lastShowsWaitingRow = showsWaitingRow
        let isLoadingChanged = context.coordinator.lastIsLoading != isLoading
        let isCompletingStream = isLoadingChanged && !isLoading
        let completionAppendsText: Bool
        if isCompletingStream,
           let lastMessage = messages.last,
           let wrapper = context.coordinator.messageWrappers[lastMessage.id] {
            let previousText = wrapper.message.content
            completionAppendsText = lastMessage.content != previousText &&
                lastMessage.content.hasPrefix(previousText)
        } else {
            completionAppendsText = false
        }
        context.coordinator.lastIsLoading = isLoading

        if isDarkModeChanged {
            context.coordinator.lastIsDarkMode = isDarkMode
            DispatchQueue.main.async {
                for wrapper in context.coordinator.messageWrappers.values {
                    wrapper.isDarkMode = isDarkMode
                }
            }
        }

        if messageCountChanged || waitingRowChanged || (chatIdChanged && !isIdConversion) {
            context.coordinator.lastMessageCount = messages.count
            context.coordinator.heightCache.removeAll()
            context.coordinator.reloadDataPreservingReaderPosition()
            if !isCompletingStream {
                context.coordinator.scheduleFollowLatestIfNeeded()
            }
        } else if !messages.isEmpty {
            // Reconcile the last row for both streaming and terminal snapshots.
            // A reconnect can deliver new content after local loading is already false.
            if let lastMessage = messages.last,
               let wrapper = context.coordinator.messageWrappers[lastMessage.id] {

                let isArchived = messages.count - 1 < archivedMessagesStartIndex
                let showArchiveSeparator = messages.count - 1 == archivedMessagesStartIndex && archivedMessagesStartIndex > 0

                let coordinator = context.coordinator
                let didUpdate = wrapper.update(
                    message: lastMessage,
                    isDarkMode: isDarkMode,
                    isLastMessage: true,
                    isLoading: isLoading,
                    isArchived: isArchived,
                    showArchiveSeparator: showArchiveSeparator,
                    messageIndex: messages.count - 1
                )
                if didUpdate {
                    if userHasScrolled {
                        coordinator.scheduleReaderPositionRestoreIfNeeded()
                    } else if !isCompletingStream {
                        coordinator.scheduleFollowLatestIfNeeded()
                    }
                }
            }
        }

        if isLoadingChanged && !isLoading {
            // Final Markdown rendering can change the self-sizing row after the
            // stream ends. Stop the streaming follower here so that this layout
            // pass preserves the reader's viewport. Only newly appended text
            // should resume following after the terminal layout settles.
            context.coordinator.stopFollowingLatest()

            // Streaming just ended - update the last message wrapper to reflect final state (including any errors)
            if let lastMessage = messages.last,
               let wrapper = context.coordinator.messageWrappers[lastMessage.id] {
                let isArchived = messages.count - 1 < archivedMessagesStartIndex
                let showArchiveSeparator = messages.count - 1 == archivedMessagesStartIndex && archivedMessagesStartIndex > 0
                wrapper.update(
                    message: lastMessage,
                    isDarkMode: isDarkMode,
                    isLastMessage: true,
                    isLoading: false,
                    isArchived: isArchived,
                    showArchiveSeparator: showArchiveSeparator,
                    messageIndex: messages.count - 1
                )

            }

            DispatchQueue.main.async {
                UIView.performWithoutAnimation {
                    context.coordinator.isUserMessageScrollMode = false
                    let currentOffset = tableView.contentOffset.y
                    context.coordinator.updateContentInset()
                    tableView.layoutIfNeeded()
                    tableView.contentOffset.y = currentOffset
                }
                // A terminal snapshot can also deliver the final text chunk.
                // Follow that new content; a Markdown-only reflow above keeps
                // the reader's viewport, and manual scrolling still opts out.
                if completionAppendsText {
                    context.coordinator.scheduleFollowLatestIfNeeded()
                }
            }
        }

        if context.coordinator.lastScrollToUserTrigger != scrollToUserTrigger {
            context.coordinator.lastScrollToUserTrigger = scrollToUserTrigger
            context.coordinator.shouldScrollToUserMessageAfterLayout = true
            context.coordinator.shouldScrollToBottomAfterLayout = false
            context.coordinator.isUserMessageScrollMode = true

            DispatchQueue.main.async {
                context.coordinator.scrollToUserMessage(animated: false)

                DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                    if context.coordinator.shouldScrollToUserMessageAfterLayout {
                        context.coordinator.scrollToUserMessage(animated: false)
                        context.coordinator.shouldScrollToUserMessageAfterLayout = false

                        withAnimation(.easeIn(duration: 0.2)) {
                            self.tableOpacity = 1.0
                        }
                    }
                }
            }
        }

        if context.coordinator.lastScrollTrigger != scrollTrigger {
            context.coordinator.lastScrollTrigger = scrollTrigger
            context.coordinator.resetUserScrollDisplacement()
            context.coordinator.shouldScrollToBottomAfterLayout = true
            context.coordinator.shouldScrollToUserMessageAfterLayout = false
            context.coordinator.isUserMessageScrollMode = false

            DispatchQueue.main.async {
                context.coordinator.scrollToBottom(animated: false)

                DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                    if context.coordinator.shouldScrollToBottomAfterLayout {
                        context.coordinator.scrollToBottom(animated: false)
                        context.coordinator.shouldScrollToBottomAfterLayout = false

                        withAnimation(.easeIn(duration: 0.2)) {
                            self.tableOpacity = 1.0
                        }
                    }
                }
            }
        }

        DispatchQueue.main.async {
            context.coordinator.checkIfAtBottom()
        }
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }

    class Coordinator: NSObject, UITableViewDelegate, UITableViewDataSource {
        var parent: MessageTableView
        weak var tableView: UITableView?
        var lastScrollTrigger: UUID?
        var lastScrollToUserTrigger: UUID?
        var lastMessageCount: Int = 0
        var lastShowsWaitingRow = false
        var lastIsLoading: Bool = false
        var cellReuseIdentifierSuffix: String = ""
        var lastKeyboardHeight: CGFloat = 0
        var lastIsDarkMode: Bool = false
        var lastChatId: String? = nil
        var lastMessageIds: Set<String> = []
        var lastMessageSequence: [String] = []
        private var renderedMessageSequence: [String] = []
        private var isDragging = false
        private var userScrollDisplacementFromBottom: CGFloat = 0
        private var userScrollDisplacementAtDragStart: CGFloat = 0
        private var isUpdatingContentInset = false
        var messageWrappers: [String: ObservableMessageWrapper] = [:]
        var shouldScrollToBottomAfterLayout = false
        var shouldScrollToUserMessageAfterLayout = false
        /// Stays true while streaming after user sent a message, adjusting the
        /// bottom inset so the user message can be scrolled to the top of the screen.
        var isUserMessageScrollMode = false
        var heightCache: [IndexPath: CGFloat] = [:]
        var messageHeightCache: [String: CGFloat] = [:]
        var shownMessageIds: Set<String> = []
        private var followLatestScheduled = false
        private var followsContentSizeChanges = false
        private var followLatestGeneration = 0
        private var readerPositionRestoreScheduled = false
        private var lastFollowLatestAt: TimeInterval = 0
        private var followLatestDisplayLink: CADisplayLink?
        private lazy var followLatestDisplayLinkTarget = FollowLatestDisplayLinkTarget(coordinator: self)

        private struct ReaderAnchor {
            let id: String
            let viewportY: CGFloat
            let distanceFromCenter: CGFloat
        }

        private static let followLatestResponse: TimeInterval = 0.2
        private static let maximumFollowLatestSpeed: CGFloat = 1_800

        var showsWaitingRow: Bool {
            parent.isLoading && parent.messages.last?.role == .user
        }

        init(_ parent: MessageTableView) {
            self.parent = parent
        }

        deinit {
            followLatestDisplayLink?.invalidate()
        }

        func getOrCreateWrapper(for message: Message, isDarkMode: Bool, isLastMessage: Bool, isLoading: Bool, isArchived: Bool, showArchiveSeparator: Bool, messageIndex: Int) -> ObservableMessageWrapper {
            if let existing = messageWrappers[message.id] {
                existing.update(message: message, isDarkMode: isDarkMode, isLastMessage: isLastMessage, isLoading: isLoading, isArchived: isArchived, showArchiveSeparator: showArchiveSeparator, messageIndex: messageIndex)
                // Never re-animate existing messages
                existing.shouldAnimateAppearance = false
                return existing
            } else {
                let isFirstTimeShown = !shownMessageIds.contains(message.id)
                shownMessageIds.insert(message.id)
                let wrapper = ObservableMessageWrapper(message: message, isDarkMode: isDarkMode, isLastMessage: isLastMessage, isLoading: isLoading, isArchived: isArchived, showArchiveSeparator: showArchiveSeparator, shouldAnimateAppearance: isFirstTimeShown, messageIndex: messageIndex)
                messageWrappers[message.id] = wrapper
                return wrapper
            }
        }

        @discardableResult
        func reconcileMessageIdentities(from previousIDs: [String], to currentMessages: [Message]) -> Bool {
            guard previousIDs.count == currentMessages.count, !previousIDs.isEmpty else { return false }

            var preserved = false
            for (previousID, currentMessage) in zip(previousIDs, currentMessages) {
                guard previousID != currentMessage.id,
                      let wrapper = messageWrappers[previousID],
                      wrapper.message.role == currentMessage.role,
                      compatibleContent(wrapper.message.content, currentMessage.content) else {
                    continue
                }

                messageWrappers.removeValue(forKey: previousID)
                messageWrappers[currentMessage.id] = wrapper
                shownMessageIds.insert(currentMessage.id)
                preserved = true
            }
            return preserved
        }

        private func compatibleContent(_ previous: String, _ current: String) -> Bool {
            previous == current ||
            previous.isEmpty ||
            current.isEmpty ||
            previous.hasPrefix(current) ||
            current.hasPrefix(previous)
        }

        func numberOfSections(in tableView: UITableView) -> Int {
            return 1
        }

        /// Preserve the message the reader is looking at when a subscription
        /// inserts/reconciles rows above it. A raw content offset points to a
        /// different message once variable-height rows move.
        func reloadDataPreservingReaderPosition() {
            guard let tableView else { return }
            guard parent.userHasScrolled,
                  !readerPositionRestoreScheduled,
                  let anchors = readerAnchors(in: tableView),
                  !anchors.isEmpty else {
                tableView.reloadData()
                renderedMessageSequence = parent.messages.map(\.id)
                return
            }

            readerPositionRestoreScheduled = true
            tableView.reloadData()
            renderedMessageSequence = parent.messages.map(\.id)
            DispatchQueue.main.async { [weak self, weak tableView] in
                guard let self, let tableView else { return }
                defer { self.readerPositionRestoreScheduled = false }
                guard self.parent.userHasScrolled, !tableView.isDragging, !tableView.isDecelerating else { return }
                tableView.layoutIfNeeded()
                self.restoreReaderPosition(from: anchors, in: tableView)
                self.recordVisibleRowHeights(in: tableView)
            }
        }

        /// Self-sizing hosting cells publish height changes after their model
        /// updates. Keep the visible message at the same viewport coordinate
        /// while UIKit resolves that new height.
        func scheduleReaderPositionRestoreIfNeeded() {
            guard let tableView,
                  parent.userHasScrolled,
                  !readerPositionRestoreScheduled,
                  let anchors = readerAnchors(in: tableView),
                  !anchors.isEmpty else { return }

            readerPositionRestoreScheduled = true
            DispatchQueue.main.async { [weak self, weak tableView] in
                guard let self, let tableView else { return }
                defer { self.readerPositionRestoreScheduled = false }
                guard self.parent.userHasScrolled, !tableView.isDragging, !tableView.isDecelerating else { return }

                UIView.performWithoutAnimation {
                    tableView.beginUpdates()
                    tableView.endUpdates()
                    tableView.layoutIfNeeded()
                    self.restoreReaderPosition(from: anchors, in: tableView)
                }
                self.recordVisibleRowHeights(in: tableView)
            }
        }

        private func readerAnchors(in tableView: UITableView) -> [ReaderAnchor]? {
            guard let visibleRows = tableView.indexPathsForVisibleRows?.sorted(by: { $0.row < $1.row }) else {
                return nil
            }
            let viewportCenterY = tableView.bounds.midY
            return visibleRows.compactMap { indexPath -> ReaderAnchor? in
                guard renderedMessageSequence.indices.contains(indexPath.row) else { return nil }
                let messageID = renderedMessageSequence[indexPath.row]
                let rowRect = tableView.rectForRow(at: indexPath)
                return ReaderAnchor(
                    id: messageID,
                    viewportY: rowRect.minY - tableView.contentOffset.y,
                    distanceFromCenter: abs(rowRect.midY - tableView.contentOffset.y - viewportCenterY)
                )
            }.sorted { $0.distanceFromCenter < $1.distanceFromCenter }
        }

        private func restoreReaderPosition(from anchors: [ReaderAnchor], in tableView: UITableView) {
            guard let anchor = anchors.first(where: { item in
                parent.messages.contains(where: { $0.id == item.id })
            }),
            let row = parent.messages.firstIndex(where: { $0.id == anchor.id }) else { return }

            let rowTop = tableView.rectForRow(at: IndexPath(row: row, section: 0)).minY
            let minimumOffset = -tableView.adjustedContentInset.top
            let maximumOffset = max(
                minimumOffset,
                tableView.contentSize.height - tableView.bounds.height + tableView.adjustedContentInset.bottom
            )
            let targetOffset = min(max(rowTop - anchor.viewportY, minimumOffset), maximumOffset)
            tableView.setContentOffset(
                CGPoint(x: tableView.contentOffset.x, y: targetOffset),
                animated: false
            )
        }

        private func recordVisibleRowHeights(in tableView: UITableView) {
            guard let visibleRows = tableView.indexPathsForVisibleRows else { return }
            for indexPath in visibleRows {
                let height = tableView.rectForRow(at: indexPath).height
                guard height > 0 else { continue }
                heightCache[indexPath] = height
                if parent.messages.indices.contains(indexPath.row) {
                    messageHeightCache[parent.messages[indexPath.row].id] = height
                }
            }
        }

        func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
            if parent.messages.isEmpty {
                return 1
            }
            return parent.messages.count + (showsWaitingRow ? 1 : 0)
        }

        func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
            let cellIdentifier = (parent.messages.isEmpty ? "WelcomeCell" : "MessageCell") + cellReuseIdentifierSuffix

            let cell = tableView.dequeueReusableCell(withIdentifier: cellIdentifier) ?? UITableViewCell(style: .default, reuseIdentifier: cellIdentifier)
            cell.selectionStyle = .none
            cell.backgroundColor = .clear

            if parent.messages.isEmpty {
                cell.accessibilityIdentifier = "transcriptWelcome"
                cell.contentConfiguration = UIHostingConfiguration {
                    WelcomeView(isDarkMode: parent.isDarkMode)
                        .padding(.vertical, 16)
                        .padding(.horizontal, UIDevice.current.userInterfaceIdiom == .pad ? 100 : 0)
                        .frame(maxWidth: 900)
                        .frame(maxWidth: .infinity)
                }
                .minSize(width: 0, height: 0)
                .margins(.all, 0)
                .background(.clear)
            } else if showsWaitingRow && indexPath.row == parent.messages.count {
                cell.accessibilityIdentifier = "transcriptWaiting"
                cell.contentConfiguration = UIHostingConfiguration {
                    AssistantActivityView(
                        activity: ResponseActivity(phase: .waiting, tools: []),
                        isDarkMode: parent.isDarkMode,
                        isStreaming: true,
                        onSelectTool: { _ in }
                    )
                    .padding(.vertical, Theme.Dimensions.paddingSmall)
                    .padding(.horizontal, UIDevice.current.userInterfaceIdiom == .pad ? 100 : Theme.Dimensions.transcriptGutter)
                    .if(UIDevice.current.userInterfaceIdiom == .pad) { view in
                        view.frame(maxWidth: 900)
                            .frame(maxWidth: .infinity)
                    }
                }
                .minSize(width: 0, height: 0)
                .margins(.all, 0)
                .background(.clear)
            } else {
                let message = parent.messages[indexPath.row]
                cell.accessibilityIdentifier = "transcriptMessage-\(message.id)"
                let isLastMessage = indexPath.row == parent.messages.count - 1
                let isArchived = indexPath.row < parent.archivedMessagesStartIndex
                let showArchiveSeparator = indexPath.row == parent.archivedMessagesStartIndex && parent.archivedMessagesStartIndex > 0

                let wrapper = getOrCreateWrapper(
                    for: message,
                    isDarkMode: parent.isDarkMode,
                    isLastMessage: isLastMessage,
                    isLoading: parent.isLoading && isLastMessage,
                    isArchived: isArchived,
                    showArchiveSeparator: showArchiveSeparator,
                    messageIndex: indexPath.row
                )

                // UIKit reuses the hosting view as well as the cell. Scope its
                // SwiftUI state (including parsed Markdown) to the message's
                // wrapper, which survives streaming and ID reconciliation.
                cell.contentConfiguration = UIHostingConfiguration {
                    ObservableMessageCell(wrapper: wrapper, viewModel: parent.viewModel)
                        .id(ObjectIdentifier(wrapper))
                }
                .minSize(width: 0, height: 0)
                .margins(.all, 0)
                .background(.clear)
            }

            return cell
        }

        func tableView(_ tableView: UITableView, estimatedHeightForRowAt indexPath: IndexPath) -> CGFloat {
            if let cachedHeight = heightCache[indexPath] {
                return cachedHeight
            }
            // Fall back to message-ID-based cache (survives reloadData)
            if indexPath.row < parent.messages.count {
                let messageId = parent.messages[indexPath.row].id
                if let cachedHeight = messageHeightCache[messageId] {
                    return cachedHeight
                }
            }
            return 100
        }

        func tableView(_ tableView: UITableView, willDisplay cell: UITableViewCell, forRowAt indexPath: IndexPath) {
            let height = cell.frame.size.height
            if height > 0 {
                heightCache[indexPath] = height
                if indexPath.row < parent.messages.count {
                    messageHeightCache[parent.messages[indexPath.row].id] = height
                }
            }

            if shouldScrollToBottomAfterLayout {
                let numberOfRows = tableView.numberOfRows(inSection: 0)
                if indexPath.row == numberOfRows - 1 {
                    DispatchQueue.main.async {
                        self.scrollToBottom(animated: false)
                        self.shouldScrollToBottomAfterLayout = false

                        withAnimation(.easeIn(duration: 0.2)) {
                            self.parent.tableOpacity = 1.0
                        }
                    }
                }
            }

            if shouldScrollToUserMessageAfterLayout {
                let numberOfRows = tableView.numberOfRows(inSection: 0)
                if indexPath.row == numberOfRows - 1 {
                    DispatchQueue.main.async {
                        self.scrollToUserMessage(animated: false)
                        self.shouldScrollToUserMessageAfterLayout = false

                        withAnimation(.easeIn(duration: 0.2)) {
                            self.parent.tableOpacity = 1.0
                        }
                    }
                }
            }
        }

        func tableView(_ tableView: UITableView, didEndDisplaying cell: UITableViewCell, forRowAt indexPath: IndexPath) {
        }

        func scrollViewDidScroll(_ scrollView: UIScrollView) {
            updateContentInset()
            checkIfAtBottom()
        }

        func updateContentInset() {
            guard !isUpdatingContentInset else { return }
            guard let tableView = tableView else { return }
            isUpdatingContentInset = true
            defer { isUpdatingContentInset = false }

            let targetInset: CGFloat

            if parent.isLoading && isUserMessageScrollMode {
                targetInset = insetForUserMessageAtTop(tableView)
            } else {
                targetInset = 0
            }

            if tableView.contentInset.bottom != targetInset {
                UIView.performWithoutAnimation {
                    tableView.contentInset.bottom = targetInset
                    tableView.verticalScrollIndicatorInsets.bottom = targetInset
                }
            }
        }

        /// Returns the minimum bottom inset that allows the user message row
        /// (second-to-last) to be scrolled to the top of the visible area.
        private func insetForUserMessageAtTop(_ tableView: UITableView) -> CGFloat {
            let numberOfRows = tableView.numberOfRows(inSection: 0)
            guard numberOfRows >= 2 else { return 0 }
            let userMessageIndexPath = IndexPath(row: numberOfRows - 2, section: 0)
            let userMessageY = tableView.rectForRow(at: userMessageIndexPath).origin.y
            return userMessageY + tableView.bounds.height - tableView.contentSize.height
        }

        func scrollViewWillBeginDragging(_ scrollView: UIScrollView) {
            isDragging = true
            userScrollDisplacementAtDragStart = userScrollDisplacementFromBottom
            parent.userHasScrolled = true
            parent.viewModel.isScrollInteractionActive = true
            shouldScrollToBottomAfterLayout = false
            shouldScrollToUserMessageAfterLayout = false
            stopFollowingLatest()

            UIView.animate(withDuration: 0.3) {
                UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
            }
        }

        func scrollViewDidEndDragging(_ scrollView: UIScrollView, willDecelerate decelerate: Bool) {
            let gestureDisplacement = scrollView.panGestureRecognizer.translation(in: scrollView).y
            userScrollDisplacementFromBottom = max(0, userScrollDisplacementAtDragStart + gestureDisplacement)
            isDragging = false
            if !decelerate {
                checkIfAtBottom(userScrollEnded: true)
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                    self.parent.viewModel.isScrollInteractionActive = false
                }
            }
        }

        func scrollViewDidEndDecelerating(_ scrollView: UIScrollView) {
            checkIfAtBottom(userScrollEnded: true)
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                self.parent.viewModel.isScrollInteractionActive = false
            }
        }

        func scrollToBottom(animated: Bool) {
            guard let tableView = tableView else { return }
            guard !parent.messages.isEmpty else { return }
            followsContentSizeChanges = !parent.userHasScrolled

            updateContentInset()
            tableView.layoutIfNeeded()

            // Unmaterialized self-sizing rows still have estimated heights.
            // A contentSize offset can land several messages before the end.
            // Target the row so UIKit resolves the actual final cells first.
            let lastRow = tableView.numberOfRows(inSection: 0) - 1
            guard lastRow >= 0 else { return }
            let indexPath = IndexPath(row: lastRow, section: 0)

            if animated {
                tableView.scrollToRow(at: indexPath, at: .bottom, animated: true)
            } else {
                UIView.performWithoutAnimation {
                    tableView.scrollToRow(at: indexPath, at: .bottom, animated: false)
                }
            }
        }

        /// Coalesces layout-driven bottom corrections into a modest cadence.
        /// Subscription deltas must never steal the reader's position or force
        /// a scroll correction for every provider token.
        func scheduleFollowLatestIfNeeded() {
            guard !parent.userHasScrolled,
                  !isDragging,
                  !followLatestScheduled else { return }
            followsContentSizeChanges = true
            followLatestScheduled = true
            let generation = followLatestGeneration

            let now = Date().timeIntervalSinceReferenceDate
            let delay = max(0, 0.06 - (now - lastFollowLatestAt))

            DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
                guard let self else { return }
                guard generation == self.followLatestGeneration else { return }
                self.followLatestScheduled = false
                guard !self.parent.userHasScrolled,
                      !self.isDragging,
                      let tableView = self.tableView else { return }

                self.lastFollowLatestAt = Date().timeIntervalSinceReferenceDate

                let expectedRowCount = self.parent.messages.isEmpty
                    ? 1
                    : self.parent.messages.count + (self.showsWaitingRow ? 1 : 0)
                guard tableView.numberOfRows(inSection: 0) == expectedRowCount else {
                    self.reloadDataPreservingReaderPosition()
                    return
                }

                UIView.performWithoutAnimation {
                    let visibleOffset = tableView.contentOffset
                    tableView.beginUpdates()
                    tableView.endUpdates()
                    tableView.layoutIfNeeded()
                    // UITableView can anchor a self-sizing row to its top
                    // while resolving its final height. Keep the reader's
                    // current viewport; the display-link follower handles any
                    // remaining distance to the newest text.
                    tableView.setContentOffset(visibleOffset, animated: false)
                }
                self.recordVisibleRowHeights(in: tableView)

                guard self.followLatestDisplayLink == nil else { return }
                let displayLink = CADisplayLink(
                    target: self.followLatestDisplayLinkTarget,
                    selector: #selector(FollowLatestDisplayLinkTarget.advance(_:))
                )
                displayLink.add(to: .main, forMode: .common)
                self.followLatestDisplayLink = displayLink
            }
        }

        func resumeFollowingLatestAfterLayout() {
            // Reaching the current bottom is temporary while rows self-size.
            // A manual drag or terminal Markdown reflow explicitly ends the
            // follow intent and must not restart it from a layout callback.
            guard followsContentSizeChanges else { return }
            scheduleFollowLatestIfNeeded()
        }

        fileprivate func advanceFollowingLatest(_ displayLink: CADisplayLink) {
            guard !parent.userHasScrolled, !isDragging, let tableView else {
                stopFollowingLatest()
                return
            }

            let inset = tableView.adjustedContentInset
            let targetOffsetY = max(
                -inset.top,
                tableView.contentSize.height - tableView.bounds.height + inset.bottom
            )
            let distance = targetOffsetY - tableView.contentOffset.y

            guard distance > 0.5 else {
                if distance != 0 {
                    tableView.contentOffset.y = targetOffsetY
                }
                stopFollowingLatest(preservingFollowIntent: true)
                checkIfAtBottom()
                return
            }

            let elapsed = min(max(displayLink.targetTimestamp - displayLink.timestamp, 1.0 / 120.0), 1.0 / 30.0)
            let easedStep = distance * CGFloat(1 - exp(-elapsed / Self.followLatestResponse))
            let maximumStep = Self.maximumFollowLatestSpeed * CGFloat(elapsed)
            tableView.contentOffset.y += min(easedStep, maximumStep)
        }

        fileprivate func stopFollowingLatest(preservingFollowIntent: Bool = false) {
            if !preservingFollowIntent {
                followsContentSizeChanges = false
            }
            followLatestGeneration += 1
            followLatestScheduled = false
            followLatestDisplayLink?.invalidate()
            followLatestDisplayLink = nil
        }

        /// Scrolls so the user's message sits at the top of the visible area,
        /// with the assistant response streaming in below it.
        func scrollToUserMessage(animated: Bool) {
            guard let tableView = tableView else { return }

            let numberOfRows = tableView.numberOfRows(inSection: 0)
            guard numberOfRows >= 2 else {
                scrollToBottom(animated: animated)
                return
            }
            guard numberOfRows == parent.messages.count || showsWaitingRow else { return }

            updateContentInset()

            let userMessageIndexPath = IndexPath(row: numberOfRows - 2, section: 0)
            tableView.scrollToRow(at: userMessageIndexPath, at: .top, animated: animated)
        }

        func checkIfAtBottom() {
            checkIfAtBottom(userScrollEnded: false)
        }

        private func checkIfAtBottom(userScrollEnded: Bool) {
            guard let tableView = tableView else { return }
            guard tableView.window != nil else { return }
            guard !readerPositionRestoreScheduled else { return }

            let inset = tableView.adjustedContentInset
            let maxOffset = max(
                -inset.top,
                tableView.contentSize.height - tableView.bounds.height + inset.bottom
            )
            let distanceFromBottom = maxOffset - tableView.contentOffset.y

            let isVisible = distanceFromBottom <= Theme.Dimensions.bottomFollowTolerance
            let isUserScrolling = isDragging || tableView.isDecelerating || userScrollEnded
            let userScrollDisplacement = isDragging
                ? max(
                    0,
                    userScrollDisplacementAtDragStart + tableView.panGestureRecognizer.translation(in: tableView).y
                )
                : userScrollDisplacementFromBottom
            let shouldShowJumpButton: Bool
            if isUserScrolling {
                shouldShowJumpButton = TranscriptScrollPolicy.shouldShowJumpToBottom(
                    distanceFromBottom: distanceFromBottom,
                    userScrollDisplacement: userScrollDisplacement,
                    currentlyShown: parent.showJumpToBottomButton
                )
            } else if parent.showJumpToBottomButton,
                      distanceFromBottom <= TranscriptScrollPolicy.jumpButtonHideThreshold {
                shouldShowJumpButton = false
            } else {
                shouldShowJumpButton = parent.showJumpToBottomButton
            }

            if distanceFromBottom <= TranscriptScrollPolicy.jumpButtonHideThreshold,
               !isDragging, !tableView.isDecelerating {
                userScrollDisplacementFromBottom = 0
            }

            if parent.isAtBottom != isVisible ||
                parent.showJumpToBottomButton != shouldShowJumpButton ||
                (isVisible && parent.userHasScrolled) {
                DispatchQueue.main.async {
                    self.parent.isAtBottom = isVisible
                    self.parent.viewModel.isAtBottom = isVisible
                    self.parent.showJumpToBottomButton = shouldShowJumpButton
                    if isVisible, !self.isDragging, !tableView.isDecelerating,
                       !self.readerPositionRestoreScheduled {
                        self.parent.userHasScrolled = false
                    }
                }
            }
        }

        func resetUserScrollDisplacement() {
            userScrollDisplacementFromBottom = 0
            userScrollDisplacementAtDragStart = 0
        }

    }

    private final class FollowLatestDisplayLinkTarget: NSObject {
        weak var coordinator: Coordinator?

        init(coordinator: Coordinator) {
            self.coordinator = coordinator
        }

        @objc func advance(_ displayLink: CADisplayLink) {
            coordinator?.advanceFollowingLatest(displayLink)
        }
    }
}

class ObservableMessageWrapper: ObservableObject {
    @Published var message: Message
    @Published var isDarkMode: Bool
    @Published var isLastMessage: Bool
    @Published var isLoading: Bool
    @Published var isArchived: Bool
    @Published var showArchiveSeparator: Bool
    @Published var shouldAnimateAppearance: Bool = false
    @Published var messageIndex: Int
    var cachedHeight: CGFloat?
    var cachedHeightKey: Int?
    private var updateScheduled = false
    private var pendingUpdate: (() -> Void)?

    init(message: Message, isDarkMode: Bool, isLastMessage: Bool, isLoading: Bool, isArchived: Bool, showArchiveSeparator: Bool, shouldAnimateAppearance: Bool = true, messageIndex: Int = 0) {
        self.message = message
        self.isDarkMode = isDarkMode
        self.isLastMessage = isLastMessage
        self.isLoading = isLoading
        self.isArchived = isArchived
        self.showArchiveSeparator = showArchiveSeparator
        self.shouldAnimateAppearance = shouldAnimateAppearance
        self.messageIndex = messageIndex
    }

    @discardableResult
    func update(message: Message, isDarkMode: Bool, isLastMessage: Bool, isLoading: Bool, isArchived: Bool, showArchiveSeparator: Bool, messageIndex: Int) -> Bool {
        let contentChanged = self.message.content != message.content ||
                            self.message.thoughts != message.thoughts ||
                            self.message.contentChunks != message.contentChunks ||
                            self.message.thinkingChunks != message.thinkingChunks ||
                            self.message.isThinking != message.isThinking ||
                            self.message.isCollapsed != message.isCollapsed ||
                            self.message.generationTimeSeconds != message.generationTimeSeconds ||
                            self.message.responseActivity != message.responseActivity ||
                            self.message.streamError != message.streamError ||
                            self.isDarkMode != isDarkMode

        let metadataChanged = self.isLastMessage != isLastMessage ||
                              self.isLoading != isLoading ||
                              self.isArchived != isArchived ||
                              self.showArchiveSeparator != showArchiveSeparator ||
                              self.messageIndex != messageIndex

        if !contentChanged && !metadataChanged {
            return false
        }

        if contentChanged {
            cachedHeight = nil
            cachedHeightKey = nil
        }

        // UIHostingConfiguration needs the objectWillChange notification on a
        // later run-loop turn. Keep only the newest streamed snapshot so token
        // bursts cannot queue stale layout passes behind the visible frame.
        pendingUpdate = { [weak self] in
            guard let self else { return }
            self.message = message
            self.isDarkMode = isDarkMode
            self.isLastMessage = isLastMessage
            self.isLoading = isLoading
            self.isArchived = isArchived
            self.showArchiveSeparator = showArchiveSeparator
            self.messageIndex = messageIndex
        }

        guard !updateScheduled else { return true }
        updateScheduled = true
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.updateScheduled = false
            let update = self.pendingUpdate
            self.pendingUpdate = nil
            update?()
        }
        return true
    }

    func getCacheKey() -> Int {
        message.content.hashValue ^
        (message.thoughts?.hashValue ?? 0) ^
        (message.contentChunks.hashValue) ^
        (message.thinkingChunks.hashValue) ^
        (message.responseActivity?.hashValue ?? 0) ^
        isDarkMode.hashValue
    }
}

struct ObservableMessageCell: View {
    @ObservedObject var wrapper: ObservableMessageWrapper
    @ObservedObject var viewModel: ChatViewModel
    @State private var hasAppeared = false

    var body: some View {
        VStack(spacing: 0) {
            if wrapper.showArchiveSeparator {
                HStack(spacing: Theme.Dimensions.relatedItemSpacing) {
                    Rectangle()
                        .frame(height: 1)
                        .foregroundColor(.gray)
                    Text("archived")
                        .foregroundColor(.gray)
                        .font(.system(size: 12))
                    Rectangle()
                        .frame(height: 1)
                        .foregroundColor(.gray)
                }
                .padding(.vertical, Theme.Dimensions.paddingLarge)
                .padding(.horizontal, Theme.Dimensions.paddingExtraLarge)
            }

            ZStack(alignment: .topLeading) {
                MessageView(
                    message: wrapper.message,
                    isDarkMode: wrapper.isDarkMode,
                    isLastMessage: wrapper.isLastMessage,
                    isLoading: wrapper.isLoading,
                    messageIndex: wrapper.messageIndex
                )
                .environmentObject(viewModel)
                .opacity(wrapper.isArchived ? 0.6 : 1.0)
                .padding(.vertical, Theme.Dimensions.messageGroupSpacing / 2)
                .padding(.horizontal, UIDevice.current.userInterfaceIdiom == .pad ? 100 : Theme.Dimensions.transcriptGutter)
                .if(UIDevice.current.userInterfaceIdiom == .pad) { view in
                    view.frame(maxWidth: 900)
                        .frame(maxWidth: .infinity)
                }
            }
        }
        .opacity(wrapper.shouldAnimateAppearance && !hasAppeared ? 0 : 1)
        .onAppear {
            if wrapper.shouldAnimateAppearance && !hasAppeared {
                withAnimation(.easeIn(duration: 0.2)) {
                    hasAppeared = true
                }
            } else {
                hasAppeared = true
            }
        }
    }
}
