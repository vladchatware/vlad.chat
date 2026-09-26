import Foundation
import StoreKit

enum StorePurchaseError: LocalizedError {
    case productUnavailable
    case failedVerification
    case pending

    var errorDescription: String? {
        switch self {
        case .productUnavailable:
            "Credit pack isn't available yet. Check App Store Connect product setup and storefront availability."
        case .failedVerification: "StoreKit could not verify the purchase."
        case .pending: "Purchase is awaiting approval."
        }
    }
}

@MainActor
final class StorePurchaseService: ObservableObject {
    static let tokenPackProductId = "chat.vlad.tokens.5"

    @Published private(set) var product: Product?
    @Published private(set) var isLoading = false
    @Published private(set) var isPurchasing = false
    @Published var errorMessage: String?
    @Published var successMessage: String?

    private var updatesTask: Task<Void, Never>?
    private var redeemingTransactionIDs = Set<UInt64>()

    func loadProducts() async {
        guard product == nil, !isLoading else { return }
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }
        do {
            product = try await Product.products(for: [Self.tokenPackProductId]).first
            if product == nil { throw StorePurchaseError.productUnavailable }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func observeTransactions(
        redeem: @escaping (Transaction) async throws -> StoreRedemptionResult
    ) {
        guard updatesTask == nil else { return }
        updatesTask = Task { [weak self] in
            for await verification in Transaction.updates {
                guard !Task.isCancelled else { return }
                do {
                    try await self?.redeem(verification, using: redeem)
                } catch {
                    self?.errorMessage = error.localizedDescription
                }
            }
        }
    }

    func purchase(redeem: @escaping (Transaction) async throws -> StoreRedemptionResult) async {
        guard let product else {
            errorMessage = StorePurchaseError.productUnavailable.localizedDescription
            return
        }
        errorMessage = nil
        successMessage = nil
        isPurchasing = true
        defer { isPurchasing = false }
        do {
            switch try await product.purchase() {
            case .success(let verification):
                try await self.redeem(verification, using: redeem)
            case .pending:
                throw StorePurchaseError.pending
            case .userCancelled:
                return
            @unknown default:
                return
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func finishUnredeemedTransactions(
        redeem: @escaping (Transaction) async throws -> StoreRedemptionResult
    ) async {
        for await verification in Transaction.unfinished {
            do {
                try await self.redeem(verification, using: redeem)
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }

    private func redeem(
        _ verification: VerificationResult<Transaction>,
        using redeemTransaction: (Transaction) async throws -> StoreRedemptionResult
    ) async throws {
        let transaction = try verified(verification)
        guard transaction.productID == Self.tokenPackProductId else { return }
        guard redeemingTransactionIDs.insert(transaction.id).inserted else { return }
        defer { redeemingTransactionIDs.remove(transaction.id) }
        let result = try await redeemTransaction(transaction)
        await transaction.finish()
        errorMessage = nil
        if result.tokensGranted > 0 {
            successMessage = "\(result.tokensGranted.formatted()) tokens added to your credit balance."
        } else if result.alreadyRedeemed {
            successMessage = "This purchase was already credited to your account."
        }
    }

    private func verified<T>(_ result: VerificationResult<T>) throws -> T {
        guard case .verified(let value) = result else {
            throw StorePurchaseError.failedVerification
        }
        return value
    }
}
