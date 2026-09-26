import AVFoundation
import Combine
import Foundation
import Speech

@MainActor
final class NativeDictationService: ObservableObject {
    @Published private(set) var isRecording = false
    @Published private(set) var isFinalizing = false
    @Published private(set) var isStarting = false
    @Published private(set) var draftText = ""
    @Published private(set) var errorMessage: String?

    private let audioEngine = AVAudioEngine()
    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?
    private var originalDraft = ""
    private var startID = UUID()
    private var systemDictation: (any DictationSession)?

    var isActive: Bool { isStarting || isRecording || isFinalizing }

    func start(with draft: String) async throws {
        guard !isActive else { return }
        errorMessage = nil
        isStarting = true
        let currentStartID = UUID()
        startID = currentStartID
        originalDraft = draft
        draftText = draft

        do {
            try await requestMicrophoneAuthorization()
            guard startID == currentStartID else { throw CancellationError() }

            if #available(iOS 26.0, *) {
                let session = SystemDictationSession()
                session.onTranscript = { [weak self] transcript in
                    guard let self, self.isActive else { return }
                    self.draftText = Self.append(transcript, to: self.originalDraft)
                }
                session.onFailure = { [weak self] error in
                    guard let self, self.isActive else { return }
                    self.errorMessage = "Dictation stopped: \(error.localizedDescription)"
                    self.finish()
                }
                systemDictation = session
                try await session.start()
                guard startID == currentStartID else {
                    await session.cancel()
                    systemDictation = nil
                    throw CancellationError()
                }
            } else {
                guard let recognizer = SFSpeechRecognizer(locale: .current), recognizer.isAvailable else {
                    throw NativeDictationError.recognitionUnavailable
                }
                try await requestSpeechAuthorization()
                guard startID == currentStartID else { throw CancellationError() }
                try startLegacyDictation(using: recognizer)
            }

            isStarting = false
            isRecording = true
        } catch {
            isStarting = false
            if let systemDictation {
                await systemDictation.cancel()
                self.systemDictation = nil
            }
            if audioEngine.isRunning {
                audioEngine.stop()
                audioEngine.inputNode.removeTap(onBus: 0)
            }
            recognitionRequest = nil
            deactivateAudioSession()
            throw error
        }
    }

    private func startLegacyDictation(using recognizer: SFSpeechRecognizer) throws {
        let request = SFSpeechAudioBufferRecognitionRequest()
        request.taskHint = .dictation
        request.shouldReportPartialResults = true
        request.addsPunctuation = true
        if recognizer.supportsOnDeviceRecognition {
            request.requiresOnDeviceRecognition = true
        }
        recognitionRequest = request

        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.record, mode: .measurement)
        try session.setActive(true)

        let inputNode = audioEngine.inputNode
        let format = inputNode.outputFormat(forBus: 0)
        guard format.channelCount > 0 else {
            throw NativeDictationError.microphoneUnavailable
        }

        inputNode.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak request] buffer, _ in
            request?.append(buffer)
        }
        audioEngine.prepare()
        do {
            try audioEngine.start()
        } catch {
            inputNode.removeTap(onBus: 0)
            recognitionRequest = nil
            throw error
        }

        recognizer.queue = .main
        recognitionTask = recognizer.recognitionTask(with: request) { [weak self] result, error in
            let recognizedText = result?.bestTranscription.formattedString
            let isFinal = result?.isFinal ?? false
            let failureMessage = error?.localizedDescription

            Task { @MainActor [weak self] in
                guard let self, self.isActive else { return }
                if let recognizedText {
                    self.draftText = Self.append(recognizedText, to: self.originalDraft)
                }
                if let failureMessage {
                    if self.draftText == self.originalDraft {
                        self.errorMessage = "Dictation stopped: \(failureMessage)"
                    }
                    self.finish()
                } else if isFinal {
                    self.finish()
                }
            }
        }
    }

    func stop() {
        guard isRecording else { return }
        isRecording = false
        isFinalizing = true

        if #available(iOS 26.0, *), let systemDictation {
            Task { @MainActor [weak self] in
                await systemDictation.stop()
                self?.systemDictation = nil
                self?.finish()
            }
            return
        }

        let inputNode = audioEngine.inputNode
        if audioEngine.isRunning {
            audioEngine.stop()
            inputNode.removeTap(onBus: 0)
        }
        recognitionRequest?.endAudio()
        deactivateAudioSession()
    }

    func cancel() {
        guard isActive else { return }
        startID = UUID()
        if #available(iOS 26.0, *), let systemDictation {
            self.systemDictation = nil
            Task { await systemDictation.cancel() }
        }

        if audioEngine.isRunning {
            audioEngine.stop()
            audioEngine.inputNode.removeTap(onBus: 0)
        }
        recognitionRequest?.endAudio()
        recognitionTask?.cancel()
        recognitionTask = nil
        recognitionRequest = nil
        isRecording = false
        isFinalizing = false
        isStarting = false
        draftText = originalDraft
        deactivateAudioSession()
    }

    func clearError() {
        errorMessage = nil
    }

    private func finish() {
        if audioEngine.isRunning {
            audioEngine.stop()
            audioEngine.inputNode.removeTap(onBus: 0)
        }
        if #available(iOS 26.0, *), let systemDictation {
            self.systemDictation = nil
            Task { await systemDictation.cancel() }
        }
        recognitionRequest = nil
        recognitionTask = nil
        isRecording = false
        isFinalizing = false
        isStarting = false
        deactivateAudioSession()
    }

    private func requestSpeechAuthorization() async throws {
        let status = await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { status in
                continuation.resume(returning: status)
            }
        }
        guard status == .authorized else {
            throw NativeDictationError.speechPermissionDenied
        }
    }

    private func requestMicrophoneAuthorization() async throws {
        let isAuthorized = await withCheckedContinuation { continuation in
            AVAudioApplication.requestRecordPermission { granted in
                continuation.resume(returning: granted)
            }
        }
        guard isAuthorized else {
            throw NativeDictationError.microphonePermissionDenied
        }
    }

    private func deactivateAudioSession() {
        try? AVAudioSession.sharedInstance().setActive(
            false,
            options: .notifyOthersOnDeactivation
        )
    }

    private static func append(_ transcription: String, to draft: String) -> String {
        guard !draft.isEmpty else { return transcription }
        let separator = draft.last?.isWhitespace == true ? "" : " "
        return draft + separator + transcription
    }
}

@available(iOS 26.0, *)
@MainActor
private final class SystemDictationSession: DictationSession {
    var onTranscript: ((String) -> Void)?
    var onFailure: ((Error) -> Void)?

    private let audioEngine = AVAudioEngine()
    private var analyzer: SpeechAnalyzer?
    private var audioConverter: AVAudioConverter?
    private var captureContinuation: AsyncStream<AVAudioPCMBuffer>.Continuation?
    private var inputContinuation: AsyncStream<AnalyzerInput>.Continuation?
    private var captureTask: Task<Void, Never>?
    private var resultsTask: Task<Void, Never>?
    private var finalizedTranscript = ""
    private var volatileTranscript = ""

    func start() async throws {
        guard let locale = await DictationTranscriber.supportedLocale(equivalentTo: .current) else {
            throw NativeDictationError.recognitionUnavailable
        }

        let transcriber = DictationTranscriber(locale: locale, preset: .progressiveShortDictation)
        if let request = try await AssetInventory.assetInstallationRequest(supporting: [transcriber]) {
            try await request.downloadAndInstall()
        }

        let audioSession = AVAudioSession.sharedInstance()
        try audioSession.setCategory(.playAndRecord, mode: .spokenAudio)
        try audioSession.setActive(true, options: .notifyOthersOnDeactivation)

        let inputNode = audioEngine.inputNode
        let inputFormat = inputNode.outputFormat(forBus: 0)
        guard inputFormat.channelCount > 0,
              inputFormat.sampleRate > 0,
              let analyzerFormat = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [transcriber]),
              let audioConverter = AVAudioConverter(from: inputFormat, to: analyzerFormat) else {
            throw NativeDictationError.microphoneUnavailable
        }
        let analyzer = SpeechAnalyzer(modules: [transcriber])
        let (inputSequence, inputBuilder) = AsyncStream<AnalyzerInput>.makeStream()
        let (captureSequence, captureBuilder) = AsyncStream<AVAudioPCMBuffer>.makeStream()

        self.analyzer = analyzer
        self.audioConverter = audioConverter
        inputContinuation = inputBuilder
        captureContinuation = captureBuilder
        try await analyzer.start(inputSequence: inputSequence)

        resultsTask = Task { @MainActor [weak self] in
            do {
                for try await result in transcriber.results {
                    guard let self else { return }
                    let text = String(result.text.characters)
                    if result.isFinal {
                        self.finalizedTranscript = Self.appending(text, to: self.finalizedTranscript)
                        self.volatileTranscript = ""
                    } else {
                        self.volatileTranscript = text
                    }
                    self.onTranscript?(Self.appending(self.volatileTranscript, to: self.finalizedTranscript))
                }
            } catch {
                self?.onFailure?(error)
            }
        }

        captureTask = Task { @MainActor [weak self] in
            do {
                for await buffer in captureSequence {
                    let convertedBuffer = try Self.convert(buffer, using: audioConverter, to: analyzerFormat)
                    inputBuilder.yield(AnalyzerInput(buffer: convertedBuffer))
                }
                inputBuilder.finish()
                try await analyzer.finalizeAndFinishThroughEndOfInput()
            } catch {
                self?.onFailure?(error)
                inputBuilder.finish()
            }
        }

        let format = inputNode.outputFormat(forBus: 0)
        guard format.channelCount > 0, format.sampleRate > 0 else {
            throw NativeDictationError.microphoneUnavailable
        }

        inputNode.installTap(onBus: 0, bufferSize: 4096, format: format) { buffer, _ in
            captureBuilder.yield(buffer)
        }
        audioEngine.prepare()
        do {
            try audioEngine.start()
        } catch {
            await cancel()
            throw error
        }
    }

    func stop() async {
        stopAudioCapture()
        captureContinuation?.finish()
        captureContinuation = nil
        await captureTask?.value
        await resultsTask?.value
        deactivateAudioSession()
        clear()
    }

    func cancel() async {
        stopAudioCapture()
        captureContinuation?.finish()
        captureTask?.cancel()
        resultsTask?.cancel()
        if let analyzer { await analyzer.cancelAndFinishNow() }
        deactivateAudioSession()
        clear()
    }

    private func stopAudioCapture() {
        guard audioEngine.isRunning else { return }
        audioEngine.stop()
        audioEngine.inputNode.removeTap(onBus: 0)
    }

    private func clear() {
        captureContinuation = nil
        inputContinuation = nil
        captureTask = nil
        resultsTask = nil
        analyzer = nil
        audioConverter = nil
    }

    private static func convert(
        _ inputBuffer: AVAudioPCMBuffer,
        using converter: AVAudioConverter,
        to outputFormat: AVAudioFormat
    ) throws -> AVAudioPCMBuffer {
        let sampleRateRatio = outputFormat.sampleRate / inputBuffer.format.sampleRate
        let capacity = AVAudioFrameCount(ceil(Double(inputBuffer.frameLength) * sampleRateRatio)) + 1024
        guard let outputBuffer = AVAudioPCMBuffer(pcmFormat: outputFormat, frameCapacity: capacity) else {
            throw NativeDictationError.microphoneUnavailable
        }

        var suppliedInput = false
        var conversionError: NSError?
        let status = converter.convert(to: outputBuffer, error: &conversionError) { _, inputStatus in
            guard !suppliedInput else {
                inputStatus.pointee = .noDataNow
                return nil
            }
            suppliedInput = true
            inputStatus.pointee = .haveData
            return inputBuffer
        }

        if let conversionError { throw conversionError }
        guard status != .error, outputBuffer.frameLength > 0 else {
            throw NativeDictationError.recognitionUnavailable
        }
        return outputBuffer
    }

    private func deactivateAudioSession() {
        try? AVAudioSession.sharedInstance().setActive(
            false,
            options: .notifyOthersOnDeactivation
        )
    }

    private static func appending(_ text: String, to existing: String) -> String {
        guard !text.isEmpty else { return existing }
        guard !existing.isEmpty else { return text }
        let needsSeparator = existing.last?.isWhitespace != true && text.first?.isWhitespace != true
        return existing + (needsSeparator ? " " : "") + text
    }
}

@MainActor
private protocol DictationSession: AnyObject {
    var onTranscript: ((String) -> Void)? { get set }
    var onFailure: ((Error) -> Void)? { get set }
    func start() async throws
    func stop() async
    func cancel() async
}

private enum NativeDictationError: LocalizedError {
    case speechPermissionDenied
    case microphonePermissionDenied
    case recognitionUnavailable
    case microphoneUnavailable

    var errorDescription: String? {
        switch self {
        case .speechPermissionDenied:
            return "Allow Speech Recognition in Settings to dictate messages."
        case .microphonePermissionDenied:
            return "Allow microphone access in Settings to dictate messages."
        case .recognitionUnavailable:
            return "Apple Speech Recognition is unavailable right now. Try again shortly."
        case .microphoneUnavailable:
            return "No microphone input is available on this device."
        }
    }
}
