import SwiftUI
import AuthenticationServices

struct AccountView: View {
    @ObservedObject var viewModel: ChatViewModel
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Section("Account") {
                    if let account = viewModel.account, !account.isAnonymous {
                        LabeledContent("Name", value: account.name ?? "Vlad user")
                        if let email = account.email {
                            LabeledContent("Email", value: email)
                        }
                    } else {
                        Text("Anonymous account")
                            .foregroundStyle(.secondary)
                        Text("Link Google or Apple to keep your chats when you switch devices.")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                        VStack(spacing: 12) {
                            GoogleOAuthButton(isEnabled: !viewModel.isLinkingAccount) {
                                viewModel.linkGoogleAccount()
                            }

                            AppleOAuthButton(isEnabled: !viewModel.isLinkingAccount) {
                                viewModel.linkAppleAccount()
                            }
                            .frame(width: 188)
                            .frame(height: 44)
                        }
                        .listRowSeparator(.hidden)
                    }
                }

                if let account = viewModel.account {
                    Section("Credits") {
                        if account.isAnonymous {
                            LabeledContent(
                                "Free messages",
                                value: String(Int(account.trialMessages))
                            )
                        } else {
                            LabeledContent(
                                "Trial tokens",
                                value: account.trialTokens.formatted()
                            )
                            LabeledContent(
                                "Purchased tokens",
                                value: account.tokens.formatted()
                            )
                        }
                    }
                }
            }
            .navigationTitle("Account")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                }
            }
        }
    }
}

private struct GoogleOAuthButton: View {
    let isEnabled: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image("GoogleSignInButton")
                .resizable()
                .scaledToFit()
                .frame(width: 188, height: 44)
                .frame(maxWidth: .infinity)
        }
        .buttonStyle(.plain)
        .disabled(!isEnabled)
        .accessibilityLabel(Text("Sign in with Google"))
        .accessibilityValue(isEnabled ? Text("") : Text("Connecting"))
    }
}

private struct AppleOAuthButton: UIViewRepresentable {
    @Environment(\.colorScheme) private var colorScheme

    let isEnabled: Bool
    let action: () -> Void

    func makeUIView(context: Context) -> ASAuthorizationAppleIDButton {
        let style: ASAuthorizationAppleIDButton.Style = colorScheme == .dark ? .white : .black
        let button = ASAuthorizationAppleIDButton(type: .signIn, style: style)
        button.cornerRadius = 8
        button.addTarget(context.coordinator, action: #selector(Coordinator.didTap), for: .touchUpInside)
        button.isEnabled = isEnabled
        return button
    }

    func updateUIView(_ button: ASAuthorizationAppleIDButton, context: Context) {
        button.isEnabled = isEnabled
        context.coordinator.action = action
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(action: action)
    }

    final class Coordinator: NSObject {
        var action: () -> Void

        init(action: @escaping () -> Void) {
            self.action = action
        }

        @objc func didTap() {
            action()
        }
    }
}
