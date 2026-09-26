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
    @EnvironmentObject private var viewModel: ChatViewModel

    @State private var messageText = ""
    @State private var isAccountPromptPresented = false
    @State private var isAccountSheetPresented = false

    var body: some View {
        NavigationStack {
            ChatListView(
                isDarkMode: colorScheme == .dark,
                isLoading: viewModel.isLoading,
                viewModel: viewModel,
                messageText: $messageText,
                isAccountPromptPresented: $isAccountPromptPresented
            )
                .background(Color.chatBackground(isDarkMode: colorScheme == .dark))
                .ignoresSafeArea(edges: .top)
                .tint(colorScheme == .dark ? .white : .black)
                .navigationBarTitleDisplayMode(.inline)
                .applySystemGlassToolbarIfAvailable()
                .toolbar {
                    ToolbarItem(placement: .principal) {
                        Button {
                            isAccountSheetPresented = true
                        } label: {
                            VladIdentityHeader()
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(Text("Vlad account", comment: "Opens account settings when the user taps Vlad's name or picture in the chat header."))
                        .accessibilityHint("Opens account settings")
                        .accessibilityIdentifier("openAccount")
                    }
                }
        }
        .sheet(isPresented: $isAccountSheetPresented) {
            AccountView(viewModel: viewModel) {
                isAccountSheetPresented = false
            }
            .presentationDetents([.medium])
            .presentationCornerRadius(44)
            .presentationDragIndicator(.visible)
        }
        .environmentObject(viewModel)
        .onAppear {
            setupNavigationBarAppearance()
        }
        .onChange(of: colorScheme) { _, _ in
            setupNavigationBarAppearance()
        }
            .fullScreenCover(isPresented: $viewModel.showImageViewer) {
            ImageViewerOverlay(
                images: viewModel.imageViewerImages,
                initialIndex: viewModel.imageViewerIndex,
                onDismiss: { viewModel.showImageViewer = false }
            )
        }
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
        VStack(alignment: .leading, spacing: 12) {
            Text("Hello, I am Vlad a software developer.")

            Text(.init("Check out my [shop](https://shop.vlad.chat/) or listen to some [music](https://music.vlad.chat/)."))
                .tint(isDarkMode ? .white : .black)
        }
        .font(.body)
        .foregroundStyle(isDarkMode ? Color.white : Color.primary)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 16)
        .padding(.top, 24)
        .padding(.bottom, 4)
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
