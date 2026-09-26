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

    private var updatesTask: Task<Void, Never>?

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
        redeem: @escaping (UInt64) async throws -> Void
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

    func purchase(redeem: @escaping (UInt64) async throws -> Void) async {
        guard let product else {
            errorMessage = StorePurchaseError.productUnavailable.localizedDescription
            return
        }
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
        redeem: @escaping (UInt64) async throws -> Void
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
        using redeemTransaction: (UInt64) async throws -> Void
    ) async throws {
        let transaction = try verified(verification)
        guard transaction.productID == Self.tokenPackProductId else { return }
        try await redeemTransaction(transaction.id)
        await transaction.finish()
        errorMessage = nil
    }

    private func verified<T>(_ result: VerificationResult<T>) throws -> T {
        guard case .verified(let value) = result else {
            throw StorePurchaseError.failedVerification
        }
        return value
    }
}
