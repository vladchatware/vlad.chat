import SwiftUI
import AuthenticationServices

struct AccountView: View {
    @ObservedObject var viewModel: ChatViewModel
    let onDismiss: () -> Void

    @Environment(\.colorScheme) private var colorScheme

    private var account: MobileAccount? { viewModel.account }
    private var isAnonymous: Bool { account?.isAnonymous ?? true }
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 6) {
                    heading

                    Text(isAnonymous
                         ? "Link an account to keep your chats when you switch devices."
                         : (account?.email ?? "Your chats are linked to this account."))
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Spacer(minLength: 0)

                Button(action: onDismiss) {
                    Image(systemName: "xmark")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(.secondary)
                        .frame(width: 32, height: 32)
                        .contentShape(Circle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Dismiss account notice")
            }

            if isAnonymous {
                HStack(spacing: 8) {
                    GoogleOAuthButton(isEnabled: !viewModel.isLinkingAccount) {
                        viewModel.linkGoogleAccount()
                    }

                    AppleOAuthButton(isEnabled: !viewModel.isLinkingAccount) {
                        viewModel.linkAppleAccount()
                    }
                    .frame(maxWidth: .infinity)
                    .frame(height: 44)
                }
            } else if let account {
                HStack(spacing: 16) {
                    creditValue(title: "Trial", value: account.trialTokens.formatted())
                    creditValue(title: "Purchased", value: account.tokens.formatted())
                }
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background {
            if #available(iOS 26, *) {
                RoundedRectangle(cornerRadius: 26)
                    .fill(.clear)
                    .glassEffect(.regular, in: RoundedRectangle(cornerRadius: 26))
            } else {
                RoundedRectangle(cornerRadius: 26)
                    .fill(.thickMaterial)
            }
        }
    }

    @ViewBuilder
    private var heading: some View {
        if isAnonymous, let account, account.trialMessages <= 2 {
            if account.trialMessages > 0 {
                Text("\(Int(account.trialMessages)) free messages left", comment: "Near-limit notice title showing how many anonymous chat messages remain.")
                    .font(.headline)
            } else {
                Text("No free messages left")
                    .font(.headline)
            }
        } else if isAnonymous {
            Text("Keep your chats")
                .font(.headline)
        } else {
            Text(account?.name ?? "Account")
                .font(.headline)
        }
    }

    @ViewBuilder
    private func creditValue(title: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(value)
                .font(.subheadline.weight(.medium))
                .monospacedDigit()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

}

private struct GoogleOAuthButton: View {
    @Environment(\.colorScheme) private var colorScheme

    let isEnabled: Bool
    let action: () -> Void

    private var backgroundColor: Color {
        colorScheme == .dark
            ? Color(red: 19.0 / 255, green: 19.0 / 255, blue: 20.0 / 255)
            : .white
    }

    private var foregroundColor: Color {
        colorScheme == .dark
            ? Color(red: 227.0 / 255, green: 227.0 / 255, blue: 227.0 / 255)
            : Color(red: 31.0 / 255, green: 31.0 / 255, blue: 31.0 / 255)
    }

    private var borderColor: Color {
        colorScheme == .dark
            ? Color(red: 142.0 / 255, green: 145.0 / 255, blue: 143.0 / 255)
            : Color(red: 116.0 / 255, green: 119.0 / 255, blue: 117.0 / 255)
    }

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Image("GoogleG")
                    .resizable()
                    .scaledToFit()
                    .padding(2)
                    .frame(width: 20, height: 20)
                    .background(.white, in: RoundedRectangle(cornerRadius: 3))
                    .accessibilityHidden(true)

                Text("Continue with Google")
                    .font(.system(size: 12, weight: .medium))
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                    .foregroundStyle(foregroundColor)

                if !isEnabled {
                    ProgressView()
                        .controlSize(.small)
                        .tint(foregroundColor)
                }
            }
            .frame(maxWidth: .infinity, minHeight: 44)
            .background(backgroundColor, in: RoundedRectangle(cornerRadius: 8))
            .overlay {
                RoundedRectangle(cornerRadius: 8)
                    .stroke(borderColor, lineWidth: 1)
            }
            .contentShape(RoundedRectangle(cornerRadius: 8))
        }
        .buttonStyle(.plain)
        .disabled(!isEnabled)
        .accessibilityLabel(Text("Continue with Google"))
        .accessibilityValue(isEnabled ? Text("") : Text("Connecting"))
    }
}

private struct AppleOAuthButton: UIViewRepresentable {
    @Environment(\.colorScheme) private var colorScheme

    let isEnabled: Bool
    let action: () -> Void

    func makeUIView(context: Context) -> ASAuthorizationAppleIDButton {
        let style: ASAuthorizationAppleIDButton.Style = colorScheme == .dark ? .white : .black
        let button = ASAuthorizationAppleIDButton(type: .continue, style: style)
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
