import SwiftUI

struct AccountView: View {
    @ObservedObject var viewModel: ChatViewModel
    @Environment(\.dismiss) private var dismiss
    @StateObject private var store = StorePurchaseService()

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

                if viewModel.account?.isAnonymous == false {
                    Section("Buy credits") {
                        if let product = store.product {
                            Button {
                                Task {
                                    await store.purchase(redeem: viewModel.redeemStoreTransaction)
                                }
                            } label: {
                                HStack {
                                    VStack(alignment: .leading) {
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
                            }
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
                }
            }
            .navigationTitle("Account")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .task {
                guard viewModel.account?.isAnonymous == false else { return }
                await store.loadProducts()
                await store.finishUnredeemedTransactions(
                    redeem: viewModel.redeemStoreTransaction
                )
            }
        }
    }
}
