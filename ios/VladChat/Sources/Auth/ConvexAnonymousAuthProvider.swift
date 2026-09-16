import ConvexMobile
import Foundation

struct ConvexAuthSession: Codable, Sendable {
    let token: String
    let refreshToken: String
}

private struct ConvexAuthResponse: Decodable {
    let tokens: ConvexAuthSession?
}

enum ConvexAnonymousAuthError: LocalizedError {
    case missingCachedSession
    case missingTokens

    var errorDescription: String? {
        switch self {
        case .missingCachedSession: "No cached Vlad session"
        case .missingTokens: "Convex Auth returned no session tokens"
        }
    }
}

final class ConvexAnonymousAuthProvider: AuthProvider, @unchecked Sendable {
    typealias T = ConvexAuthSession

    private let bootstrapClient: ConvexClient
    private let keychain: KeychainStore
    private let account = "anonymous-session"

    init(deploymentURL: URL, keychain: KeychainStore = KeychainStore()) {
        bootstrapClient = ConvexClient(deploymentUrl: deploymentURL.absoluteString)
        self.keychain = keychain
    }

    func login(onIdToken: @Sendable @escaping (String?) -> Void) async throws -> ConvexAuthSession {
        let response: ConvexAuthResponse = try await bootstrapClient.action(
            "auth:signIn",
            with: ["provider": "anonymous"]
        )
        guard let session = response.tokens else { throw ConvexAnonymousAuthError.missingTokens }
        try persist(session)
        onIdToken(session.token)
        return session
    }

    func loginFromCache(onIdToken: @Sendable @escaping (String?) -> Void) async throws -> ConvexAuthSession {
        guard let cached = try load() else { throw ConvexAnonymousAuthError.missingCachedSession }
        let response: ConvexAuthResponse = try await bootstrapClient.action(
            "auth:signIn",
            with: ["refreshToken": cached.refreshToken]
        )
        guard let session = response.tokens else {
            try keychain.delete(account: account)
            onIdToken(nil)
            throw ConvexAnonymousAuthError.missingTokens
        }
        try persist(session)
        onIdToken(session.token)
        return session
    }

    func logout() async throws {
        try keychain.delete(account: account)
    }

    func extractIdToken(from authResult: ConvexAuthSession) -> String {
        authResult.token
    }

    private func persist(_ session: ConvexAuthSession) throws {
        try keychain.save(JSONEncoder().encode(session), account: account)
    }

    private func load() throws -> ConvexAuthSession? {
        guard let data = try keychain.load(account: account) else { return nil }
        return try JSONDecoder().decode(ConvexAuthSession.self, from: data)
    }
}
