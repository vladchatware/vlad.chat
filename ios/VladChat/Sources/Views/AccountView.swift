import SwiftUI

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
                        Button {
                            viewModel.linkGoogleAccount()
                        } label: {
                            HStack {
                                Text("Continue with Google")
                                Spacer()
                                if viewModel.isLinkingAccount {
                                    ProgressView()
                                }
                            }
                        }
                        .disabled(viewModel.isLinkingAccount)
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
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }
}
