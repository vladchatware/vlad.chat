import Foundation

enum AppConfiguration {
    static var convexURL: URL? {
        guard
            let value = Bundle.main.object(forInfoDictionaryKey: "ConvexURL") as? String,
            !value.contains("replace-me"),
            let url = URL(string: value),
            url.scheme == "https"
        else {
            return nil
        }
        return url
    }
}
