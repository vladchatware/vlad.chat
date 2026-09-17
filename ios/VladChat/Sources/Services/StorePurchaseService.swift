import Foundation
import StoreKit

enum StorePurchaseError: LocalizedError {
    case productUnavailable
    case failedVerification
    case pending

    var errorDescription: String? {
        switch self {
        case .productUnavailable: "Credit pack is unavailable."
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

    func loadProducts() async {
        guard product == nil, !isLoading else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            product = try await Product.products(for: [Self.tokenPackProductId]).first
            if product == nil { throw StorePurchaseError.productUnavailable }
        } catch {
            errorMessage = error.localizedDescription
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
                let transaction = try verified(verification)
                try await redeem(transaction.id)
                await transaction.finish()
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
                let transaction = try verified(verification)
                guard transaction.productID == Self.tokenPackProductId else { continue }
                try await redeem(transaction.id)
                await transaction.finish()
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }

    private func verified<T>(_ result: VerificationResult<T>) throws -> T {
        guard case .verified(let value) = result else {
            throw StorePurchaseError.failedVerification
        }
        return value
    }
}
