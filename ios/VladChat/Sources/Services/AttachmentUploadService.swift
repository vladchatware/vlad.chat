import ConvexMobile
import Foundation

enum AttachmentUploadError: LocalizedError {
    case missingData(String)
    case invalidUploadURL
    case uploadFailed

    var errorDescription: String? {
        switch self {
        case .missingData(let fileName): "Could not read attachment '\(fileName)'."
        case .invalidUploadURL: "Vlad returned an invalid attachment upload URL."
        case .uploadFailed: "Attachment upload failed."
        }
    }
}

enum AttachmentUploadService {
    static func upload(
        _ attachment: Attachment,
        using client: ConvexClientWithAuth<ConvexAuthSession>
    ) async throws -> UploadedAttachment {
        let uploadURLString: String = try await client.mutation(
            "threads:generateMobileAttachmentUploadUrl"
        )
        guard let uploadURL = URL(string: uploadURLString) else {
            throw AttachmentUploadError.invalidUploadURL
        }
        guard let data = attachmentData(attachment) else {
            throw AttachmentUploadError.missingData(attachment.fileName)
        }

        var request = URLRequest(url: uploadURL)
        request.httpMethod = "POST"
        request.setValue(attachment.mimeType ?? "application/octet-stream", forHTTPHeaderField: "Content-Type")
        request.httpBody = data
        let (responseData, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse,
              (200..<300).contains(httpResponse.statusCode) else {
            throw AttachmentUploadError.uploadFailed
        }
        let result = try JSONDecoder().decode(AttachmentUploadResponse.self, from: responseData)
        return UploadedAttachment(
            storageId: result.storageId,
            fileName: attachment.fileName,
            mimeType: attachment.mimeType ?? "application/octet-stream"
        )
    }

    private static func attachmentData(_ attachment: Attachment) -> Data? {
        if let base64 = attachment.base64 {
            return Data(base64Encoded: base64)
        }
        return attachment.textContent?.data(using: .utf8)
    }
}
