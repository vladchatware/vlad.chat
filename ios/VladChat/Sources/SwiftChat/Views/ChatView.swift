//
//  ChatView.swift
//  SwiftChat
//
//  Created on 03/25/26.
//  Copyright © 2026 Sacha Servan-Schreiber. All rights reserved.
//


import SwiftUI


// MARK: - ChatContainer

/// The primary SwiftUI container for the single chat interface.
struct ChatContainer: View {
    @Environment(\.colorScheme) var colorScheme
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @EnvironmentObject private var viewModel: ChatViewModel

    private let agentRunStatusOverride: AgentRunStatusPresentation?

    @State private var messageText = ""
    @State private var isAccountPromptPresented = false
    @State private var isAccountSheetPresented = false
    @State private var selectedThreadID: String?
    @State private var columnVisibility = NavigationSplitViewVisibility.automatic
    @State private var computerViewerPresentation: ComputerViewerPresentation = .hidden

    init(agentRunStatusOverride: AgentRunStatusPresentation? = nil) {
        self.agentRunStatusOverride = agentRunStatusOverride
    }

    var body: some View {
        NavigationSplitView(columnVisibility: $columnVisibility) {
            ChatSidebar(selection: $selectedThreadID, viewModel: viewModel)
                .navigationSplitViewColumnWidth(min: 260, ideal: 300, max: 360)
        } detail: {
            GeometryReader { geometry in
                let inspectorOpen = computerViewerPresentation == .inspector
                let canvas = ChatCanvasColumn(
                    isDarkMode: colorScheme == .dark,
                    isLoading: viewModel.isLoading,
                    viewModel: viewModel,
                    agentRunStatusOverride: agentRunStatusOverride,
                    messageText: $messageText,
                    isAccountPromptPresented: $isAccountPromptPresented,
                    showsCustomChatsButton: horizontalSizeClass == .compact,
                    onShowChats: showChats,
                    onOpenAccount: { isAccountSheetPresented = true },
                    returnToChats: showChats
                )

                if inspectorOpen, usesInlineComputerInspector {
                    HStack(spacing: 0) {
                        canvas
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                        ComputerUseInspectorScreen(controller: viewModel.computerUseController)
                            .frame(width: min(410, geometry.size.width * 0.39))
                    }
                } else {
                    canvas
                }
            }
        }
        .navigationSplitViewStyle(.balanced)
        .onAppear {
            selectedThreadID = viewModel.currentChat?.id
            computerViewerPresentation = viewModel.computerUseController.presentation
            setupNavigationBarAppearance()
        }
        .onReceive(viewModel.computerUseController.$presentation) { presentation in
            computerViewerPresentation = presentation
        }
        .onChange(of: selectedThreadID) { _, threadID in
            guard let threadID,
                  let chat = viewModel.chats.first(where: { $0.id == threadID }) else { return }
            viewModel.selectChat(chat)
        }
        .onChange(of: viewModel.currentChat?.id) { _, threadID in
            selectedThreadID = threadID
        }
        .onChange(of: colorScheme) { _, _ in
            setupNavigationBarAppearance()
        }
        .sheet(isPresented: $isAccountSheetPresented) {
            AccountView(viewModel: viewModel)
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
        }
        .environmentObject(viewModel)
        .fullScreenCover(isPresented: $viewModel.showImageViewer) {
            ImageViewerOverlay(
                images: viewModel.imageViewerImages,
                initialIndex: viewModel.imageViewerIndex,
                onDismiss: { viewModel.showImageViewer = false }
            )
        }
        .fullScreenCover(isPresented: computerInspectorPresented) {
            NavigationStack {
                ComputerUseInspectorScreen(controller: viewModel.computerUseController)
            }
        }
    }

    private func showChats() {
        if horizontalSizeClass == .compact {
            selectedThreadID = nil
        } else {
            columnVisibility = .all
        }
    }

    private var computerInspectorPresented: Binding<Bool> {
        Binding(
            get: {
                !usesInlineComputerInspector && computerViewerPresentation == .inspector
            },
            set: { isPresented in
                if !isPresented, viewModel.computerUseController.presentation == .inspector {
                    viewModel.computerUseController.collapse()
                }
            }
        )
    }

    // Large iPhones can become regular-width in landscape. Keep their active
    // inspector in the same modal host rather than moving its WKWebView between
    // the cover and split-view detail while the cover is being dismissed.
    private var usesInlineComputerInspector: Bool {
        UIDevice.current.userInterfaceIdiom == .pad && horizontalSizeClass == .regular
    }

    /// Configure navigation bar appearance
    private func setupNavigationBarAppearance() {
        guard #unavailable(iOS 26) else { return }

        let appearance = UINavigationBarAppearance()
        appearance.configureWithOpaqueBackground()
        appearance.backgroundColor = colorScheme == .dark ? UIColor(Color.backgroundPrimary) : .white
        appearance.shadowColor = .clear
        updateAllNavigationBars(with: appearance)
    }

    private func updateAllNavigationBars(with appearance: UINavigationBarAppearance) {
        let tintColor: UIColor = colorScheme == .dark ? .white : .black
        UINavigationBar.appearance().standardAppearance = appearance
        UINavigationBar.appearance().compactAppearance = appearance
        UINavigationBar.appearance().scrollEdgeAppearance = appearance
        UINavigationBar.appearance().tintColor = tintColor

        for scene in UIApplication.shared.connectedScenes {
            if let windowScene = scene as? UIWindowScene {
                for window in windowScene.windows {
                    if let navigationBar = window.rootViewController?.navigationController?.navigationBar {
                        navigationBar.standardAppearance = appearance
                        navigationBar.compactAppearance = appearance
                        navigationBar.scrollEdgeAppearance = appearance
                        navigationBar.tintColor = tintColor
                    }
                }
            }
        }
    }

}

private struct ChatCanvasTopFramePreferenceKey: PreferenceKey {
    static var defaultValue: CGRect?

    static func reduce(value: inout CGRect?, nextValue: () -> CGRect?) {
        value = nextValue() ?? value
    }
}

private struct PrincipalHeaderFramePreferenceKey: PreferenceKey {
    static var defaultValue: CGRect?

    static func reduce(value: inout CGRect?, nextValue: () -> CGRect?) {
        value = nextValue() ?? value
    }
}

private struct ChatCanvasColumn: View {
    let isDarkMode: Bool
    let isLoading: Bool
    @ObservedObject var viewModel: ChatViewModel
    let agentRunStatusOverride: AgentRunStatusPresentation?
    @Binding var messageText: String
    @Binding var isAccountPromptPresented: Bool
    let showsCustomChatsButton: Bool
    let onShowChats: () -> Void
    let onOpenAccount: () -> Void
    let returnToChats: () -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var chatCanvasFrame: CGRect?
    @State private var principalHeaderFrame: CGRect?

    private var agentRunPresentation: AgentRunStatusPresentation? {
        agentRunStatusOverride ?? viewModel.agentRunStatusPresentation
    }

    private var agentStatusTopPadding: CGFloat {
        guard let chatCanvasFrame, let principalHeaderFrame else { return 36 }
        return max(36, principalHeaderFrame.maxY - chatCanvasFrame.minY + 8)
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                if let presentation = agentRunPresentation {
                    HStack {
                        AgentRunStatusPill(presentation: presentation)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.horizontal, 8)
                    .padding(.top, agentStatusTopPadding)
                    .padding(.bottom, 7)
                    .transition(.opacity)
                }

                ChatListView(
                    isDarkMode: isDarkMode,
                    isLoading: isLoading,
                    viewModel: viewModel,
                    messageText: $messageText,
                    isAccountPromptPresented: $isAccountPromptPresented
                )
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            .background {
                Color.chatBackground(isDarkMode: isDarkMode)
                    .ignoresSafeArea(edges: .top)
            }
            .background {
                GeometryReader { geometry in
                    Color.clear.preference(
                        key: ChatCanvasTopFramePreferenceKey.self,
                        value: geometry.frame(in: .global)
                    )
                }
            }
            .tint(isDarkMode ? .white : .black)
            .navigationBarTitleDisplayMode(.inline)
            .navigationBarBackButtonHidden(true)
            .applySystemGlassToolbarIfAvailable()
            .toolbar {
                if showsCustomChatsButton {
                    ToolbarItem(placement: .topBarLeading) {
                        Button(action: onShowChats) {
                            Image(systemName: "sidebar.left")
                        }
                        .accessibilityLabel("Chats")
                        .accessibilityHint("Shows your chat list")
                        .accessibilityIdentifier("showChats")
                    }
                }

                ToolbarItem(placement: .principal) {
                    Button(action: onOpenAccount) {
                        VladIdentityHeader()
                    }
                    .buttonStyle(.plain)
                    .background {
                        GeometryReader { geometry in
                            Color.clear.preference(
                                key: PrincipalHeaderFramePreferenceKey.self,
                                value: geometry.frame(in: .global)
                            )
                        }
                    }
                    .accessibilityLabel(Text("Vlad account", comment: "Opens account settings when the user taps Vlad's name or picture in the chat header."))
                    .accessibilityHint("Opens account settings")
                    .accessibilityIdentifier("openAccount")
                }
            }
            .simultaneousGesture(returnToChatsGesture)
            .onPreferenceChange(ChatCanvasTopFramePreferenceKey.self) { frame in
                chatCanvasFrame = frame
            }
            .onPreferenceChange(PrincipalHeaderFramePreferenceKey.self) { frame in
                principalHeaderFrame = frame
            }
            .animation(
                reduceMotion ? nil : .easeInOut(duration: 0.18),
                value: agentRunPresentation != nil
            )
        }
    }

    private var returnToChatsGesture: some Gesture {
        DragGesture(minimumDistance: 12, coordinateSpace: .local)
            .onEnded { value in
                let horizontal = value.translation.width
                guard value.startLocation.x <= 28,
                      horizontal >= 56,
                      horizontal > abs(value.translation.height) * 1.3 else { return }
                returnToChats()
            }
    }
}

// MARK: - VladIdentityHeader

struct VladIdentityHeader: View {
    var body: some View {
        VStack(spacing: -7) {
            Image("Vlad")
                .resizable()
                .scaledToFill()
                .frame(width: 58, height: 58)
                .clipShape(Circle())
                .overlay {
                    Circle()
                        .stroke(.primary.opacity(0.08), lineWidth: 1)
                }
                .shadow(color: .black.opacity(0.16), radius: 3, y: 2)
                .zIndex(1)
                .accessibilityHidden(true)

            VladNamePill()
                .zIndex(0)
        }
        .offset(y: 28)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Vlad")
    }
}

struct VladNamePill: View {
    var body: some View {
        if #available(iOS 26, *) {
            Text("Vlad", comment: "Name shown beneath Vlad's profile photo in the chat header.")
                .font(.headline)
                .padding(.horizontal, 14)
                .padding(.vertical, 7)
                .glassEffect(.regular, in: Capsule())
                .shadow(color: .black.opacity(0.10), radius: 14, y: 8)
        } else {
            Text("Vlad", comment: "Name shown beneath Vlad's profile photo in the chat header.")
                .font(.headline)
                .padding(.horizontal, 14)
                .padding(.vertical, 7)
                .background(.thinMaterial, in: Capsule())
                .shadow(color: .black.opacity(0.10), radius: 14, y: 8)
        }
    }
}

// MARK: - WelcomeView

struct WelcomeView: View {
    let isDarkMode: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Dimensions.responseSectionSpacing) {
            Text("Hello, I am Vlad a software developer.")

            Text(.init("Check out my [shop](https://shop.vlad.chat/) or listen to some [music](https://music.vlad.chat/)."))
                .tint(isDarkMode ? .white : .black)
        }
        .font(.body)
        .foregroundStyle(isDarkMode ? Color.white : Color.primary)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, Theme.Dimensions.transcriptGutter)
        .padding(.top, Theme.Dimensions.paddingExtraLarge)
        .padding(.bottom, Theme.Dimensions.paddingExtraSmall)
    }
}

/// A shape for custom corner rounding
struct RoundedCorner: Shape {
    var radius: CGFloat = .infinity
    var corners: UIRectCorner = .allCorners

    func path(in rect: CGRect) -> Path {
        let path = UIBezierPath(roundedRect: rect, byRoundingCorners: corners, cornerRadii: CGSize(width: radius, height: radius))
        return Path(path.cgPath)
    }
}

/// Extension for applying rounded corners to views
extension View {
    func corners(_ corners: UIRectCorner) -> some View {
        clipShape(RoundedCorner(radius: 15, corners: corners))
    }

    @ViewBuilder func `if`<Content: View>(_ condition: Bool, transform: (Self) -> Content) -> some View {
        if condition {
            transform(self)
        } else {
            self
        }
    }

    @ViewBuilder
    func applySystemGlassToolbarIfAvailable() -> some View {
        if #available(iOS 26, *) {
            self.toolbarBackground(.visible, for: .navigationBar)
        } else {
            self
        }
    }
}

// Helper extension to convert UIView.AnimationCurve to SwiftUI Animation
extension Animation {
    init(curve: UIView.AnimationCurve, duration: Double) {
        switch curve {
        case .easeInOut:
            self = .easeInOut(duration: duration)
        case .easeIn:
            self = .easeIn(duration: duration)
        case .easeOut:
            self = .easeOut(duration: duration)
        case .linear:
            self = .linear(duration: duration)
        @unknown default:
            self = .easeInOut(duration: duration)
        }
    }
}
