import SwiftUI
import AuthenticationServices

struct AccountView: View {
    @ObservedObject var viewModel: ChatViewModel
    @StateObject private var store = StorePurchaseService()

    var body: some View {
        ScrollView {
            VStack(spacing: 20) {
                AccountDetailsCard(
                    account: viewModel.account,
                    usageSummary: viewModel.usageSummary
                )

                if viewModel.account?.isAnonymous == false {
                    StorePurchaseSection(viewModel: viewModel, store: store)
                }

                if viewModel.account?.isAnonymous ?? true {
                    AccountLinkingButtons(viewModel: viewModel, stacked: true)
                } else {
                    Button(action: viewModel.logOut) {
                        HStack(spacing: 8) {
                            if viewModel.isLoggingOut {
                                ProgressView()
                                    .controlSize(.small)
                            } else {
                                Image(systemName: "rectangle.portrait.and.arrow.right")
                                    .accessibilityHidden(true)
                            }
                            Text(viewModel.isLoggingOut ? "Signing Out" : "Sign Out")
                        }
                        .font(.body.weight(.medium))
                        .foregroundStyle(.red)
                        .frame(maxWidth: .infinity, minHeight: 44)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .disabled(viewModel.isLoggingOut)
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 16)
            .padding(.bottom, 24)
        }
        .scrollIndicators(.hidden)
        .frame(maxWidth: .infinity, alignment: .leading)
        .task(id: viewModel.account?.isAnonymous) {
            guard viewModel.account?.isAnonymous == false else { return }
            store.observeTransactions(redeem: viewModel.redeemStoreTransaction)
            await store.finishUnredeemedTransactions(redeem: viewModel.redeemStoreTransaction)
            await store.loadProducts()
        }
    }
}

private struct StorePurchaseSection: View {
    @ObservedObject var viewModel: ChatViewModel
    @ObservedObject var store: StorePurchaseService

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Buy credits")
                .font(.headline)

            if let product = store.product {
                Button {
                    Task { await store.purchase(redeem: viewModel.redeemStoreTransaction) }
                } label: {
                    HStack {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(product.displayName)
                            Text("16.6M inference tokens")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        if store.isPurchasing {
                            ProgressView()
                        } else {
                            Text(product.displayPrice)
                        }
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(store.isPurchasing)
            } else if store.isLoading {
                HStack {
                    ProgressView()
                    Text("Loading credit pack…")
                }
            } else {
                Button("Retry loading purchases") {
                    Task { await store.loadProducts() }
                }
            }

            if let errorMessage = store.errorMessage {
                Text(errorMessage)
                    .font(.caption)
                    .foregroundStyle(.red)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 20))
        .alert("Purchase complete", isPresented: Binding(
            get: { store.successMessage != nil },
            set: { if !$0 { store.successMessage = nil } }
        )) {
            Button("OK") { store.successMessage = nil }
        } message: {
            Text(store.successMessage ?? "Credits were added to your account.")
        }
    }
}

private struct AccountDetailsCard: View {
    let account: MobileAccount?
    let usageSummary: MobileUsageSummary?

    private var isAnonymous: Bool { account?.isAnonymous ?? true }

    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(isAnonymous ? "Anonymous account" : (account?.name ?? "Account"))
                        .font(.title3.weight(.semibold))
                        .lineLimit(2)

                    if let email = account?.email, !email.isEmpty {
                        Text(email)
                            .font(.body)
                            .foregroundStyle(.secondary)
                            .textSelection(.enabled)
                    } else if isAnonymous {
                        Text("Link an account to keep your chats when you switch devices.")
                            .font(.body)
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }

            }

            HStack(spacing: 16) {
                if isAnonymous {
                    tokenValue(
                        title: "Free messages left",
                        value: account?.trialMessages.formatted()
                            ?? usageSummary?.freeMessagesLeft.formatted()
                            ?? "—"
                    )
                } else {
                    tokenValue(title: "Trial tokens left", value: account?.trialTokens.formatted() ?? "—")
                }
                tokenValue(title: "Total tokens used", value: usageSummary?.totalTokensTracked.formatted() ?? "—")
            }

            if !isAnonymous {
                tokenValue(title: "Purchased credits left", value: account?.tokens.formatted() ?? "—")
            }

            AccountUsageSection(summary: usageSummary, isAnonymous: isAnonymous)
        }
        .padding(.horizontal, 22)
        .padding(.vertical, 28)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background {
            if #available(iOS 26, *) {
                Color.clear
                    .glassEffect(.regular, in: .rect(corners: .concentric(minimum: .fixed(16))))
            } else {
                RoundedRectangle(cornerRadius: 28)
                    .fill(.regularMaterial)
            }
        }
    }

    private func tokenValue(title: LocalizedStringResource, value: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.subheadline)
                .foregroundStyle(.secondary)
            Text(value)
                .font(.title3)
                .monospacedDigit()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct AccountUsageSection: View {
    let summary: MobileUsageSummary?
    let isAnonymous: Bool

    private var usage: Double {
        min(max(summary?.usageTrackedPercent ?? 0, 0), 100)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text(usageLabel)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)

                Spacer()

                if let summary {
                    Text(summary.usageTrackedPercent / 100, format: .percent.precision(.fractionLength(0)))
                        .font(.subheadline.weight(.medium))
                        .monospacedDigit()
                } else {
                    Text("—")
                        .font(.subheadline.weight(.medium))
                }
            }

            ProgressView(value: usage, total: 100)
                .tint(.primary)

            if let summary, !isAnonymous {
                UsageWindowRow(
                    title: "5h",
                    used: summary.fiveHourCreditsUsed,
                    limit: summary.fiveHourCreditsLimit
                )
                UsageWindowRow(
                    title: "Weekly",
                    used: summary.weeklyCreditsUsed,
                    limit: summary.weeklyCreditsLimit
                )
            }

            if let summary, isAnonymous {
                Text("\(summary.freeMessagesLeft.formatted()) messages left")
                    .foregroundStyle(.secondary)
                    .font(.caption)
            }
        }
    }

    private var usageLabel: LocalizedStringResource {
        isAnonymous ? "Free Message Usage" : "Trial Usage"
    }
}

private struct UsageWindowRow: View {
    let title: LocalizedStringResource
    let used: Double
    let limit: Double

    private var progress: Double {
        guard limit > 0 else { return 0 }
        return min(max(used / limit, 0), 1)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(title)
                    .font(.subheadline)

                Spacer()

                Text(progress, format: .percent.precision(.fractionLength(0)))
                    .font(.subheadline.weight(.medium))
                    .monospacedDigit()
            }

            Text("\(used.formatted()) / \(limit.formatted()) credits")
                .font(.caption)
                .foregroundStyle(.secondary)
                .monospacedDigit()

            ProgressView(value: progress)
                .tint(.primary)
        }
    }
}

struct AccountPromptView: View {
    @ObservedObject var viewModel: ChatViewModel
    let onDismiss: () -> Void

    private var isAnonymous: Bool { viewModel.account?.isAnonymous ?? true }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 6) {
                    heading

                    Text("Link an account to keep your chats when you switch devices.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Spacer(minLength: 0)

                Button(action: onDismiss) {
                    Image(systemName: "xmark")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(.secondary)
                        .frame(width: 44, height: 44)
                        .contentShape(Circle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Dismiss account notice")
            }

            AccountLinkingButtons(viewModel: viewModel)
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
        if isAnonymous, let account = viewModel.account, account.trialMessages <= 2 {
            if account.trialMessages > 0 {
                Text("\(Int(account.trialMessages)) free messages left", comment: "Near-limit notice title showing how many anonymous chat messages remain.")
                    .font(.headline)
            } else {
                Text("No free messages left")
                    .font(.headline)
            }
        } else {
            Text("Keep your chats")
                .font(.headline)
        }
    }
}

private struct AccountLinkingButtons: View {
    @ObservedObject var viewModel: ChatViewModel
    var stacked = false

    var body: some View {
        Group {
            if stacked {
                VStack(spacing: 8) {
                    googleButton
                    appleButton
                }
            } else {
                HStack(spacing: 8) {
                    googleButton
                    appleButton
                }
            }
        }
    }

    private var googleButton: some View {
        GoogleOAuthButton(isEnabled: !viewModel.isLinkingAccount) {
            viewModel.linkGoogleAccount()
        }
    }

    private var appleButton: some View {
        AppleOAuthButton(isEnabled: !viewModel.isLinkingAccount) {
            viewModel.linkAppleAccount()
        }
        .frame(maxWidth: .infinity)
        .frame(height: 44)
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
