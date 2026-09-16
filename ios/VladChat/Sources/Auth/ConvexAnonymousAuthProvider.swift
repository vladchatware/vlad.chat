import ConvexMobile
import Foundation
import AuthenticationServices
import UIKit

struct ConvexAuthSession: Codable, Sendable {
    let token: String
    let refreshToken: String
}

private struct ConvexAuthResponse: Decodable {
    let tokens: ConvexAuthSession?
}

struct ConvexOAuthStartResponse: Decodable {
    let redirect: String?
    let verifier: String?
}

enum ConvexAnonymousAuthError: LocalizedError {
    case missingCachedSession
    case missingTokens
    case invalidOAuthResponse
    case missingOAuthCode

    var errorDescription: String? {
        switch self {
        case .missingCachedSession: "No cached Vlad session"
        case .missingTokens: "Convex Auth returned no session tokens"
        case .invalidOAuthResponse: "Convex Auth returned an invalid Google sign-in response"
        case .missingOAuthCode: "Google sign-in returned no verification code"
        }
    }
}

final class ConvexAnonymousAuthProvider: AuthProvider, @unchecked Sendable {
    typealias T = ConvexAuthSession

    private let bootstrapClient: ConvexClient
    private let keychain: KeychainStore
    private let account = "anonymous-session"
    private let lock = NSLock()
    private var pendingSession: ConvexAuthSession?

    init(deploymentURL: URL, keychain: KeychainStore = KeychainStore()) {
        bootstrapClient = ConvexClient(deploymentUrl: deploymentURL.absoluteString)
        self.keychain = keychain
    }

    func login(onIdToken: @Sendable @escaping (String?) -> Void) async throws -> ConvexAuthSession {
        if let session = takePendingSession() {
            try persist(session)
            onIdToken(session.token)
            return session
        }
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

    func completeGoogleSignIn(_ start: ConvexOAuthStartResponse) async throws {
        guard let redirect = start.redirect,
              let verifier = start.verifier,
              let redirectURL = URL(string: redirect) else {
            throw ConvexAnonymousAuthError.invalidOAuthResponse
        }
        let callbackURL = try await WebAuthenticationSession.shared.authenticate(
            url: redirectURL,
            callbackScheme: "vladchat"
        )
        guard let code = URLComponents(url: callbackURL, resolvingAgainstBaseURL: false)?
            .queryItems?.first(where: { $0.name == "code" })?.value else {
            throw ConvexAnonymousAuthError.missingOAuthCode
        }
        let params: [String: ConvexEncodable?] = ["code": code]
        let response: ConvexAuthResponse = try await bootstrapClient.action(
            "auth:signIn",
            with: ["params": params, "verifier": verifier]
        )
        guard let session = response.tokens else {
            throw ConvexAnonymousAuthError.missingTokens
        }
        lock.lock()
        pendingSession = session
        lock.unlock()
    }

    private func persist(_ session: ConvexAuthSession) throws {
        try keychain.save(JSONEncoder().encode(session), account: account)
    }

    private func load() throws -> ConvexAuthSession? {
        guard let data = try keychain.load(account: account) else { return nil }
        return try JSONDecoder().decode(ConvexAuthSession.self, from: data)
    }

    private func takePendingSession() -> ConvexAuthSession? {
        lock.lock()
        defer { lock.unlock() }
        let session = pendingSession
        pendingSession = nil
        return session
    }
}

@MainActor
private final class WebAuthenticationSession: NSObject, ASWebAuthenticationPresentationContextProviding {
    static let shared = WebAuthenticationSession()
    private var session: ASWebAuthenticationSession?

    func authenticate(url: URL, callbackScheme: String) async throws -> URL {
        try await withCheckedThrowingContinuation { continuation in
            let session = ASWebAuthenticationSession(
                url: url,
                callbackURLScheme: callbackScheme
            ) { [weak self] callbackURL, error in
                self?.session = nil
                if let error {
                    continuation.resume(throwing: error)
                } else if let callbackURL {
                    continuation.resume(returning: callbackURL)
                } else {
                    continuation.resume(throwing: ConvexAnonymousAuthError.invalidOAuthResponse)
                }
            }
            session.presentationContextProvider = self
            session.prefersEphemeralWebBrowserSession = false
            self.session = session
            session.start()
        }
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows)
            .first(where: \.isKeyWindow) ?? ASPresentationAnchor()
    }
}
