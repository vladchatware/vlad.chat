import Foundation
import Security

#if targetEnvironment(simulator)
// Locally signed Simulator builds have no keychain access group, so keep auth tokens in process.
// Device builds continue to use the system Keychain below.
private final class SimulatorKeychain: @unchecked Sendable {
    static let shared = SimulatorKeychain()

    private let lock = NSLock()
    private var values: [String: Data] = [:]

    func save(_ data: Data, key: String) {
        lock.lock()
        defer { lock.unlock() }
        values[key] = data
    }

    func load(key: String) -> Data? {
        lock.lock()
        defer { lock.unlock() }
        return values[key]
    }

    func delete(key: String) {
        lock.lock()
        defer { lock.unlock() }
        values[key] = nil
    }
}
#endif

struct KeychainStore: Sendable {
    private let service: String

    init(service: String = "chat.vlad.ios.auth") {
        self.service = service
    }

    func save(_ data: Data, account: String) throws {
        #if targetEnvironment(simulator)
        SimulatorKeychain.shared.save(data, key: storageKey(account: account))
        #else
        let query: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: service,
            kSecAttrAccount: account,
        ]
        let attributes: [CFString: Any] = [
            kSecValueData: data,
            kSecAttrAccessible: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]

        let status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            var inserted = query
            attributes.forEach { inserted[$0.key] = $0.value }
            let addStatus = SecItemAdd(inserted as CFDictionary, nil)
            guard addStatus == errSecSuccess else { throw KeychainError(status: addStatus) }
        } else if status != errSecSuccess {
            throw KeychainError(status: status)
        }
        #endif
    }

    func load(account: String) throws -> Data? {
        #if targetEnvironment(simulator)
        return SimulatorKeychain.shared.load(key: storageKey(account: account))
        #else
        let query: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: service,
            kSecAttrAccount: account,
            kSecReturnData: true,
            kSecMatchLimit: kSecMatchLimitOne,
        ]
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else {
            throw KeychainError(status: status)
        }
        return data
        #endif
    }

    func delete(account: String) throws {
        #if targetEnvironment(simulator)
        SimulatorKeychain.shared.delete(key: storageKey(account: account))
        #else
        let query: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: service,
            kSecAttrAccount: account,
        ]
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw KeychainError(status: status)
        }
        #endif
    }

    private func storageKey(account: String) -> String {
        "\(service):\(account)"
    }
}

struct KeychainError: LocalizedError {
    let status: OSStatus

    var errorDescription: String? {
        SecCopyErrorMessageString(status, nil) as String? ?? "Keychain error \(status)"
    }
}
