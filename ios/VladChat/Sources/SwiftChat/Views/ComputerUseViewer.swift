import SwiftUI
import WebKit
import UIKit

enum ComputerViewerPresentation: Equatable {
    case hidden
    case floating
    case tucked
    case inspector
}

enum ComputerConnectionState: Equatable {
    case idle
    case starting
    case connecting
    case live
    case reconnecting
    case failed
    case ended

    var canSendInput: Bool { self == .live }
}

struct ComputerComposerTopPreferenceKey: PreferenceKey {
    static let defaultValue: CGFloat? = nil

    static func reduce(value: inout CGFloat?, nextValue: () -> CGFloat?) {
        value = nextValue() ?? value
    }
}

private struct NavigationBarFrameReader: UIViewRepresentable {
    let onBottomChange: (CGFloat) -> Void

    func makeUIView(context: Context) -> NavigationBarFrameProbeView {
        let view = NavigationBarFrameProbeView()
        view.onBottomChange = onBottomChange
        return view
    }

    func updateUIView(_ uiView: NavigationBarFrameProbeView, context: Context) {
        uiView.onBottomChange = onBottomChange
        uiView.reportNavigationBarFrame()
    }
}

private final class NavigationBarFrameProbeView: UIView {
    var onBottomChange: ((CGFloat) -> Void)?
    private var lastReportedBottom: CGFloat?

    override func didMoveToWindow() {
        super.didMoveToWindow()
        reportNavigationBarFrame()
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        reportNavigationBarFrame()
    }

    func reportNavigationBarFrame() {
        DispatchQueue.main.async { [weak self] in
            guard let self, let window = self.window else { return }

            var responder: UIResponder? = self
            while let current = responder {
                if let navigationController = current as? UINavigationController {
                    let navigationBar = navigationController.navigationBar
                    let bottom = navigationBar.convert(navigationBar.bounds, to: window).maxY
                    guard bottom != self.lastReportedBottom else { return }
                    self.lastReportedBottom = bottom
                    self.onBottomChange?(bottom)
                    return
                }
                responder = current.next
            }
        }
    }
}

@MainActor
final class ComputerUseSessionController: NSObject, ObservableObject, WKNavigationDelegate, WKScriptMessageHandler {
    @Published private(set) var state = ComputerConnectionState.idle
    @Published private(set) var presentation: ComputerViewerPresentation = .hidden
    @Published private(set) var isExpanding = false
    @Published private(set) var canControl = false
    @Published private(set) var desktopSize = CGSize(width: 1280, height: 720)
    @Published private(set) var errorMessage: String?
    @Published private(set) var cursor = CGPoint(x: 0.5, y: 0.5)

    @Published private(set) var activeModifiers: Set<String> = []

    let webView: WKWebView
    private let scriptMessageProxy = WeakVNCMessageHandler()
    private var sessionID: String?
    private var activeNavigationID: String?
    private(set) var owningThreadID: String?
    private var viewerURL: URL?
    private var heldButtons = 0
    private var pendingPointer: CGPoint?
    private var pointerFlushTask: Task<Void, Never>?
    private var connectionDeadlineTask: Task<Void, Never>?
    private var didAutoReconnect = false
    private var activeNavigation: WKNavigation?

    var retryIsUnavailable: Bool { viewerURL == nil }


    override init() {
        let contentController = WKUserContentController()
        let configuration = WKWebViewConfiguration()
        configuration.userContentController = contentController
        configuration.allowsInlineMediaPlayback = true
        webView = WKWebView(frame: .zero, configuration: configuration)
        super.init()
        scriptMessageProxy.target = self
        contentController.add(scriptMessageProxy, name: "vnc")
        webView.navigationDelegate = self
        webView.scrollView.isScrollEnabled = false
        webView.scrollView.bounces = false
        webView.isOpaque = false
        webView.backgroundColor = .black
        webView.scrollView.backgroundColor = .black
    }

#if DEBUG
    func loadUITestFixture(isConnecting: Bool = false, connectionTimeoutSeconds: UInt64? = nil) {
        sessionID = "ui-test-vnc-session"
        presentation = .floating
        state = isConnecting ? .connecting : .live
        canControl = !isConnecting
        guard !isConnecting else {
            if let connectionTimeoutSeconds {
                beginConnectionDeadline(
                    after: connectionTimeoutSeconds,
                    message: "Computer connection timed out. Retry to try again."
                )
            }
            return
        }
        let fixture = """
        <!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
        <style>
        *{box-sizing:border-box}body{margin:0;background:#f7f6f2;color:#20221f;font:14px -apple-system,BlinkMacSystemFont,sans-serif}
        .browser{height:28px;background:#f0efec;border-bottom:1px solid #deddd8;display:flex;align-items:center;gap:5px;padding:0 10px}
        .dot{width:7px;height:7px;border-radius:50%;background:#c8c6c0}.url{height:16px;flex:1;margin-left:8px;border-radius:5px;background:#e5e4df;color:#898981;font-size:8px;padding:3px 8px}
        main{position:relative;min-height:calc(100vh - 28px);overflow:hidden;padding:8% 9%;background:linear-gradient(120deg,#fbfaf7 0%,#f3f0e9 100%)}
        nav{display:flex;justify-content:space-between;align-items:center;font-size:clamp(7px,1vw,13px);color:#66665f}nav strong{font-size:1.35em;color:#272923;letter-spacing:-.05em}
        h1{position:relative;z-index:1;max-width:67%;font:clamp(23px,4.4vw,58px)/.98 Georgia,serif;letter-spacing:-.04em;margin:12% 0 4%}
        p{position:relative;z-index:1;max-width:48%;font-size:clamp(8px,1.2vw,15px);line-height:1.5;color:#696960}
        .cta{display:inline-block;margin-top:4%;padding:9px 17px;border-radius:99px;background:#344b3e;color:white;font-size:clamp(7px,.9vw,12px)}
        .art{position:absolute;right:7%;bottom:0;width:34%;height:58%;border-radius:48% 48% 0 0;background:linear-gradient(155deg,#d7c2a7,#98836a 54%,#566653)}
        .art:after{content:"";position:absolute;inset:24% 22% 0;border-radius:48% 48% 0 0;background:linear-gradient(160deg,#c8bdab,#64705e)}
        </style></head><body><div class="browser"><i class="dot"></i><i class="dot"></i><i class="dot"></i><div class="url">linear.app/pricing</div></div>
        <main><nav><strong>linear</strong><span>Product　 Resources　 Pricing</span></nav><h1>Plan and build<br>your best work.</h1><p>A tool for teams who want to move with focus and clarity.</p><span class="cta">Start building →</span><div class="art"></div></main>
        <script>window.webkit.messageHandlers.vnc.postMessage({type:'connected'});window.webkit.messageHandlers.vnc.postMessage({type:'desktop',width:1280,height:720});</script>
        </body></html>
        """
        webView.loadHTMLString(fixture, baseURL: URL(string: "https://fixture.invalid"))
    }
#endif

    func start(url: URL, sessionID: String, threadID: String? = nil) {
        guard url.scheme == "https",
              url.host?.hasSuffix(".vercel.run") == true,
              url.path == "/vladchat.html" else {
            fail("This computer session has no valid iOS VNC endpoint.")
            return
        }
        if self.sessionID == sessionID, viewerURL == url, state != .failed, state != .ended { return }
        releaseKeyboardModifiers()
        releasePointer()
        self.sessionID = sessionID
        owningThreadID = threadID
        viewerURL = url
        isExpanding = false
        state = .connecting
        errorMessage = nil
        presentation = .floating
        didAutoReconnect = false
        beginConnectionDeadline(message: "Computer did not connect in time. Retry to try again.")
        loadViewer(url)
    }

    func showStarting(sessionID: String, threadID: String?) {
        guard self.sessionID == nil || state == .idle || state == .failed || state == .ended else { return }
        self.sessionID = sessionID
        owningThreadID = threadID
        viewerURL = nil
        activeNavigationID = nil
        state = .starting
        errorMessage = nil
        presentation = .floating
        beginConnectionDeadline(
            after: 90,
            message: "Computer is taking longer than expected. Retry from the conversation."
        )
    }

    func showFailure(_ message: String, sessionID: String, threadID: String?) {
        cancelConnectionDeadline()
        releaseKeyboardModifiers()
        releasePointer()
        activeNavigation = nil
        activeNavigationID = nil
        webView.stopLoading()
        webView.loadHTMLString("", baseURL: nil)
        self.sessionID = sessionID
        owningThreadID = threadID
        viewerURL = nil
        state = .failed
        errorMessage = message
        presentation = .floating
    }

    func markEndedIfActive(message: String = "This computer session has ended. Start a new computer session to continue.") {
        guard sessionID != nil, state != .idle, state != .ended else { return }
        cancelConnectionDeadline()
        releaseKeyboardModifiers()
        releasePointer()
        activeNavigation = nil
        activeNavigationID = nil
        webView.stopLoading()
        webView.loadHTMLString("", baseURL: nil)
        state = .ended
        errorMessage = message
        if presentation != .inspector { presentation = .hidden }
    }

    func updateAgentState(isActive: Bool, needsUser: Bool) {
        canControl = needsUser || !isActive
        if !canControl {
            releaseKeyboardModifiers()
            releasePointer()
        }
    }

    func retry() {
        guard let viewerURL else { return }
        releaseKeyboardModifiers()
        releasePointer()
        state = .connecting
        errorMessage = nil
        didAutoReconnect = false
        beginConnectionDeadline(message: "Computer did not reconnect in time. Retry to try again.")
        loadViewer(viewerURL)
    }

    func stop() {
        cancelConnectionDeadline()
        isExpanding = false
        pointerFlushTask?.cancel()
        pointerFlushTask = nil
        pendingPointer = nil
        releaseKeyboardModifiers()
        releasePointer()
        sessionID = nil
        viewerURL = nil
        owningThreadID = nil
        activeNavigation = nil
        activeNavigationID = nil
        presentation = .hidden
        state = .idle
        errorMessage = nil
        webView.stopLoading()
        webView.loadHTMLString("", baseURL: nil)
    }

    func expand() {
        guard presentation != .hidden else { return }
        isExpanding = true
        presentation = .inspector
    }

    func finishInspectorExpansion() {
        isExpanding = false
    }

    func collapse() {
        isExpanding = false
        releaseKeyboardModifiers()
        releasePointer()
        presentation = .floating
    }

    func tuck() {
        releaseKeyboardModifiers()
        releasePointer()
        presentation = .tucked
    }

    func restore() {
        presentation = .floating
    }

    func movePointer(by delta: CGSize, velocity: CGPoint, in viewSize: CGSize) {
        guard canControl, state.canSendInput, viewSize.width > 0, viewSize.height > 0 else { return }
        let speed = hypot(velocity.x, velocity.y)
        let acceleration = 1 + min(1.5, max(0, (speed - 120) / 720))
        let normalizedX = delta.width * acceleration / viewSize.width
        let normalizedY = delta.height * acceleration / viewSize.height
        cursor.x = min(1, max(0, cursor.x + normalizedX))
        cursor.y = min(1, max(0, cursor.y + normalizedY))
        pendingPointer = cursor
        schedulePointerFlush()
    }

    func click(buttonMask: Int = 1, count: Int = 1) {
        guard canControl, state.canSendInput else { return }
        for _ in 0..<max(1, count) {
            heldButtons = buttonMask
            sendPointer(mask: heldButtons)
            heldButtons = 0
            sendPointer(mask: heldButtons)
        }
    }

    func beginDrag() {
        guard canControl, state.canSendInput else { return }
        heldButtons = 1
        sendPointer(mask: heldButtons)
    }

    func endDrag() {
        heldButtons = 0
        sendPointer(mask: 0)
    }

    func scroll(deltaY: CGFloat) {
        guard canControl, state.canSendInput else { return }
        let mask = deltaY >= 0 ? 16 : 8
        sendPointer(mask: mask)
        sendPointer(mask: 0)
    }

    func sendSpecialKey(_ key: RemoteKey) {
        guard canControl, state.canSendInput else { return }
        if key.isModifier {
            let pressed = !activeModifiers.contains(key.code)
            if pressed { activeModifiers.insert(key.code) }
            else { activeModifiers.remove(key.code) }
            webView.evaluateJavaScript("window.vladVNC?.key(\(key.keysym), \(Self.jsonString(key.code)), \(pressed));")
            return
        }
        let source = "window.vladVNC?.key(\(key.keysym), \(Self.jsonString(key.code)), true); window.vladVNC?.key(\(key.keysym), \(Self.jsonString(key.code)), false);"
        webView.evaluateJavaScript(source)
    }

    func releaseKeyboardModifiers() {
        for key in RemoteKey.accessory where activeModifiers.contains(key.code) {
            webView.evaluateJavaScript("window.vladVNC?.key(\(key.keysym), \(Self.jsonString(key.code)), false);")
        }
        activeModifiers.removeAll()
    }

    func sendText(_ value: String) {
        guard canControl, state.canSendInput, !value.isEmpty else { return }
        webView.evaluateJavaScript("window.vladVNC?.text(\(Self.jsonString(value))); ")
    }

    func fitDesktop() {
        webView.evaluateJavaScript("if (window.vladVNC) window.vladVNC.fit();")
    }

    private func sendPointer(mask: Int) {
        let x = Int((cursor.x * CGFloat(max(1, Int(desktopSize.width) - 1))).rounded())
        let y = Int((cursor.y * CGFloat(max(1, Int(desktopSize.height) - 1))).rounded())
        webView.evaluateJavaScript("window.vladVNC?.pointer(\(x), \(y), \(mask));")
    }

    private func schedulePointerFlush() {
        guard pointerFlushTask == nil else { return }
        pointerFlushTask = Task { [weak self] in
            do {
                try await Task.sleep(nanoseconds: 33_000_000)
            } catch {
                return
            }
            guard let self else { return }
            pointerFlushTask = nil
            guard pendingPointer != nil else { return }
            pendingPointer = nil
            sendPointer(mask: heldButtons)
        }
    }

    private func releasePointer() {
        guard heldButtons != 0 else { return }
        heldButtons = 0
        sendPointer(mask: 0)
    }

    private func fail(_ message: String) {
        cancelConnectionDeadline()
        releaseKeyboardModifiers()
        releasePointer()
        activeNavigation = nil
        activeNavigationID = nil
        webView.stopLoading()
        webView.loadHTMLString("", baseURL: nil)
        state = .failed
        errorMessage = message
    }

    private func beginConnectionDeadline(after seconds: UInt64 = 15, message: String) {
        cancelConnectionDeadline()
        let expectedSessionID = sessionID
        connectionDeadlineTask = Task { [weak self] in
            do {
                try await Task.sleep(for: .seconds(seconds))
            } catch {
                return
            }
            guard let self,
                  self.sessionID == expectedSessionID,
                  self.state == .starting || self.state == .connecting || self.state == .reconnecting else { return }
            self.fail(message)
        }
    }

    private func cancelConnectionDeadline() {
        connectionDeadlineTask?.cancel()
        connectionDeadlineTask = nil
    }

    private func reconnectIfNeeded() {
        guard state == .live || state == .connecting else { return }
        releaseKeyboardModifiers()
        releasePointer()
        state = .reconnecting
        errorMessage = "Connection interrupted. Reconnecting…"
        beginConnectionDeadline(message: "Computer connection was lost. Retry to reconnect.")
        guard !didAutoReconnect, let viewerURL else { return }
        didAutoReconnect = true
        loadViewer(viewerURL)
    }

    private func loadViewer(_ url: URL) {
        let navigationID = UUID().uuidString
        activeNavigationID = navigationID
        activeNavigation = webView.load(URLRequest(url: connectionURL(url, navigationID: navigationID), cachePolicy: .reloadIgnoringLocalCacheData))
    }

    private func connectionURL(_ url: URL, navigationID: String) -> URL {
        guard var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return url }
        var items = components.queryItems ?? []
        items.removeAll { $0.name == "clientNavigation" }
        items.append(URLQueryItem(name: "clientNavigation", value: navigationID))
        components.queryItems = items
        return components.url ?? url
    }

    private static func jsonString(_ value: String) -> String {
        guard let data = try? JSONEncoder().encode(value),
              let result = String(data: data, encoding: .utf8) else { return "\"\"" }
        return result
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let payload = message.body as? [String: Any],
              let type = payload["type"] as? String else { return }
        if let messageNavigationID = payload["clientNavigation"] as? String {
            guard messageNavigationID == activeNavigationID else { return }
        } else if viewerURL != nil {
            return
        }
        switch type {
        case "connecting":
            if state == .live { reconnectIfNeeded() }
            else if state != .reconnecting { state = .connecting }
        case "connected":
            cancelConnectionDeadline()
            activeNavigation = nil
            state = .live
            errorMessage = nil
            didAutoReconnect = false
        case "disconnected":
            reconnectIfNeeded()
        case "desktop":
            if let width = payload["width"] as? CGFloat,
               let height = payload["height"] as? CGFloat,
               width > 0, height > 0 {
                desktopSize = CGSize(width: width, height: height)
            }
        default: break
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        guard navigation === activeNavigation else { return }
        guard (error as NSError).code != NSURLErrorCancelled else { return }
        if state == .live || state == .reconnecting { reconnectIfNeeded() }
        else { fail("Could not load the computer viewer. Check connection and retry.") }
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        guard navigation === activeNavigation else { return }
        guard (error as NSError).code != NSURLErrorCancelled else { return }
        if state == .reconnecting { fail("Computer connection was lost. Retry to reconnect.") }
        else { fail("Could not connect to computer. Check connection and retry.") }
    }
}

struct RemoteKey: Identifiable {
    let label: String
    let code: String
    let keysym: Int
    var id: String { code }
    var isModifier: Bool { ["ControlLeft", "AltLeft", "ShiftLeft"].contains(code) }

    static let accessory: [RemoteKey] = [
        .init(label: "Esc", code: "Escape", keysym: 0xFF1B),
        .init(label: "Tab", code: "Tab", keysym: 0xFF09),
        .init(label: "Ctrl", code: "ControlLeft", keysym: 0xFFE3),
        .init(label: "Alt", code: "AltLeft", keysym: 0xFFE9),
        .init(label: "Shift", code: "ShiftLeft", keysym: 0xFFE1),
        .init(label: "←", code: "ArrowLeft", keysym: 0xFF51),
        .init(label: "↑", code: "ArrowUp", keysym: 0xFF52),
        .init(label: "↓", code: "ArrowDown", keysym: 0xFF54),
        .init(label: "→", code: "ArrowRight", keysym: 0xFF53),
        .init(label: "↵", code: "Enter", keysym: 0xFF0D),
    ]

    static let backspace = RemoteKey(label: "Delete", code: "Backspace", keysym: 0xFF08)
}

private final class WeakVNCMessageHandler: NSObject, WKScriptMessageHandler {
    weak var target: ComputerUseSessionController?
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(userContentController, didReceive: message)
    }
}

struct ComputerVNCWebView: UIViewRepresentable {
    @ObservedObject var controller: ComputerUseSessionController

    func makeUIView(context: Context) -> WKWebView { controller.webView }

    func updateUIView(_ view: WKWebView, context: Context) {
        view.scrollView.isScrollEnabled = false
        view.scrollView.bounces = false
        view.isOpaque = false
    }
}

private struct ComputerConnectionStatusView: View {
    @ObservedObject var controller: ComputerUseSessionController
    let compact: Bool

    var body: some View {
        switch controller.state {
        case .idle, .live:
            if controller.isExpanding { ProgressView().tint(.white) }
        case .starting, .connecting, .reconnecting:
            HStack(spacing: 8) {
                ProgressView().tint(.white)
                Text(label).font(.caption.weight(.medium)).foregroundStyle(.white)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 9)
            .background(.black.opacity(0.68), in: Capsule())
            .accessibilityElement(children: .combine)
            .accessibilityLabel(label)
            .accessibilityIdentifier(compact ? "computerOpeningIndicator" : "computerInspectorLoading")
        case .failed, .ended:
            VStack(spacing: 8) {
                Image(systemName: controller.state == .ended ? "desktopcomputer" : "wifi.exclamationmark")
                    .font(.title2)
                Text(controller.state == .ended ? "Session ended" : "Computer unavailable")
                    .font(.headline)
                Text(controller.errorMessage ?? "Start a new computer session to continue.")
                    .font(.footnote)
                    .multilineTextAlignment(.center)
                if controller.state == .failed && !controller.retryIsUnavailable {
                    Button("Retry") { controller.retry() }
                        .buttonStyle(.borderedProminent)
                }
            }
            .foregroundStyle(.white)
            .padding(16)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(.black.opacity(0.94))
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier(controller.state == .ended ? "computerSessionEnded" : "computerConnectionFailed")
        }
    }

    private var label: String {
        switch controller.state {
        case .starting: return "Starting computer…"
        case .connecting: return "Connecting to computer…"
        case .reconnecting: return "Reconnecting…"
        case .idle, .live, .failed, .ended: return ""
        }
    }
}

struct ComputerTrackpad: UIViewRepresentable {
    @ObservedObject var controller: ComputerUseSessionController

    func makeUIView(context: Context) -> TrackpadSurface {
        let view = TrackpadSurface()
        let coordinator = context.coordinator
        view.coordinator = coordinator
        coordinator.view = view
        let pan = UIPanGestureRecognizer(target: coordinator, action: #selector(Coordinator.pan(_:)))
        pan.minimumNumberOfTouches = 1
        pan.maximumNumberOfTouches = 1
        pan.delegate = coordinator
        pan.cancelsTouchesInView = false
        let twoFinger = UIPanGestureRecognizer(target: coordinator, action: #selector(Coordinator.scroll(_:)))
        twoFinger.minimumNumberOfTouches = 2
        twoFinger.maximumNumberOfTouches = 2
        twoFinger.delegate = coordinator
        twoFinger.cancelsTouchesInView = false
        let longPress = UILongPressGestureRecognizer(target: coordinator, action: #selector(Coordinator.longPress(_:)))
        longPress.minimumPressDuration = 0.42
        longPress.delegate = coordinator
        longPress.cancelsTouchesInView = false
        let singleTap = UITapGestureRecognizer(target: coordinator, action: #selector(Coordinator.singleTap(_:)))
        let doubleTap = UITapGestureRecognizer(target: coordinator, action: #selector(Coordinator.doubleTap(_:)))
        doubleTap.numberOfTapsRequired = 2
        singleTap.require(toFail: doubleTap)
        let secondaryTap = UITapGestureRecognizer(target: coordinator, action: #selector(Coordinator.secondaryTap(_:)))
        secondaryTap.numberOfTouchesRequired = 2
        for recognizer in [pan, twoFinger, longPress, singleTap, doubleTap, secondaryTap] {
            view.addGestureRecognizer(recognizer)
        }
        return view
    }

    func updateUIView(_ view: TrackpadSurface, context: Context) {
        context.coordinator.controller = controller
        view.isUserInteractionEnabled = controller.canControl && controller.state.canSendInput
        view.accessibilityValue = "\(Int(controller.cursor.x * 100)), \(Int(controller.cursor.y * 100))"
    }

    func makeCoordinator() -> Coordinator { Coordinator(controller: controller) }

    final class TrackpadSurface: UIView {
        weak var coordinator: Coordinator?
        override init(frame: CGRect) {
            super.init(frame: frame)
            isAccessibilityElement = true
            accessibilityLabel = "Computer trackpad"
            accessibilityIdentifier = "computerTrackpad"
        }

        required init?(coder: NSCoder) {
            super.init(coder: coder)
            isAccessibilityElement = true
            accessibilityLabel = "Computer trackpad"
            accessibilityIdentifier = "computerTrackpad"
        }

        override class var layerClass: AnyClass { CATransformLayer.self }
    }

    final class Coordinator: NSObject, UIGestureRecognizerDelegate {
        weak var view: UIView?
        weak var controller: ComputerUseSessionController?
        private var previousPoint: CGPoint?
        private var longPressActive = false
        private var scrollRemainder: CGFloat = 0

        init(controller: ComputerUseSessionController) { self.controller = controller }

        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer) -> Bool {
            if let pan = gestureRecognizer as? UIPanGestureRecognizer,
               pan.minimumNumberOfTouches == 1,
               otherGestureRecognizer is UILongPressGestureRecognizer {
                return true
            }
            if let pan = otherGestureRecognizer as? UIPanGestureRecognizer,
               pan.minimumNumberOfTouches == 1,
               gestureRecognizer is UILongPressGestureRecognizer {
                return true
            }
            if let pan = gestureRecognizer as? UIPanGestureRecognizer,
               pan.minimumNumberOfTouches == 2,
               let tap = otherGestureRecognizer as? UITapGestureRecognizer,
               tap.numberOfTouchesRequired == 2 {
                return true
            }
            if let pan = otherGestureRecognizer as? UIPanGestureRecognizer,
               pan.minimumNumberOfTouches == 2,
               let tap = gestureRecognizer as? UITapGestureRecognizer,
               tap.numberOfTouchesRequired == 2 {
                return true
            }
            return false
        }

        @objc func pan(_ gesture: UIPanGestureRecognizer) {
            guard let view else { return }
            let point = gesture.location(in: view)
            switch gesture.state {
            case .began:
                previousPoint = point
            case .changed:
                if let previousPoint {
                    controller?.movePointer(
                        by: CGSize(width: point.x - previousPoint.x, height: point.y - previousPoint.y),
                        velocity: gesture.velocity(in: view),
                        in: view.bounds.size
                    )
                }
                previousPoint = point
            case .ended, .cancelled, .failed:
                if longPressActive { controller?.endDrag() }
                longPressActive = false
                previousPoint = nil
            default: break
            }
        }

        @objc func scroll(_ gesture: UIPanGestureRecognizer) {
            switch gesture.state {
            case .changed:
                let translation = gesture.translation(in: gesture.view)
                scrollRemainder += translation.y
                while abs(scrollRemainder) >= 24 {
                    let direction: CGFloat = scrollRemainder > 0 ? 1 : -1
                    controller?.scroll(deltaY: direction)
                    scrollRemainder -= direction * 24
                }
                gesture.setTranslation(.zero, in: gesture.view)
            case .ended, .cancelled, .failed:
                scrollRemainder = 0
                gesture.setTranslation(.zero, in: gesture.view)
            default:
                break
            }
        }

        @objc func longPress(_ gesture: UILongPressGestureRecognizer) {
            switch gesture.state {
            case .began:
                longPressActive = true
                controller?.beginDrag()
            case .ended, .cancelled, .failed:
                if longPressActive { controller?.endDrag() }
                longPressActive = false
            default: break
            }
        }

        @objc func singleTap(_ gesture: UITapGestureRecognizer) { if gesture.state == .ended { controller?.click() } }
        @objc func doubleTap(_ gesture: UITapGestureRecognizer) { if gesture.state == .ended { controller?.click(count: 2) } }
        @objc func secondaryTap(_ gesture: UITapGestureRecognizer) { if gesture.state == .ended { controller?.click(buttonMask: 4) } }
    }
}

struct ComputerUseViewerOverlay: View {
    private static let navigationBarHeight: CGFloat = 44
    private static let dockSpacing: CGFloat = 12
    private static let tuckedHandleHitWidth: CGFloat = 44
    private static let tuckedHandleVisibleWidth: CGFloat = 24
    private static let tuckedHandleHeight: CGFloat = 96
    private static let tuckedHandleCornerRadius: CGFloat = 16

    private enum TuckedSide: Equatable {
        case leading
        case trailing
    }

    @ObservedObject var controller: ComputerUseSessionController
    let composerTop: CGFloat?
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var floatWidth: CGFloat = 208
    @State private var dockOffset = CGSize.zero
    @State private var dragTranslation = CGSize.zero
    @State private var pinchStartWidth: CGFloat?
    @State private var tuckedSide: TuckedSide = .trailing
    @State private var tuckedTop: CGFloat = 12
    @State private var isTuckedHandleVisible = false
    @State private var navigationBarBottom: CGFloat?
#if DEBUG
    @State private var isSamplingDragMotion = false
    @State private var dragMotionSamples: [String] = []

    private var capturesDragMotion: Bool {
        ProcessInfo.processInfo.arguments.contains("--ui-test-computer-viewer")
    }
#endif

    var body: some View {
        GeometryReader { geometry in
            Group {
                switch controller.presentation {
                case .hidden: EmptyView()
                case .floating: floatingViewer(geometry: geometry).transition(.identity)
                case .tucked: tuckedTab(geometry: geometry).transition(.identity)
                case .inspector:
                    if controller.isExpanding && horizontalSizeClass == .compact {
                        floatingViewer(geometry: geometry)
                    }
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
            .background {
                NavigationBarFrameReader { bottom in
                    navigationBarBottom = bottom
                }
                .frame(width: 0, height: 0)
            }
        }
    }

    private func floatingViewer(geometry: GeometryProxy) -> some View {
        let previewHeight = floatWidth * controller.desktopSize.height / max(1, controller.desktopSize.width)
        let restingTop = restingPreviewTop(previewHeight: previewHeight, geometry: geometry)
        let currentTop = clampedTop(restingTop + dragTranslation.height, height: previewHeight, geometry: geometry)
        return ZStack {
            desktopSurface(cornerRadius: 18)
                .frame(
                    width: floatWidth,
                    height: previewHeight
                )
                .allowsHitTesting(false)
            Color.clear
                .contentShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                .onTapGesture { controller.expand() }
                .highPriorityGesture(floatingDrag(in: geometry))
                .simultaneousGesture(floatingPinch)
                .accessibilityElement()
                .accessibilityLabel("Open computer inspector")
                .accessibilityIdentifier("computerExpandTarget")
                .accessibilityAddTraits(.isButton)
#if DEBUG
                .accessibilityValue(dragMotionSamples.joined(separator: ";"))
#endif
        }
        .frame(width: floatWidth)
        .fixedSize(horizontal: false, vertical: true)
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(.primary.opacity(0.12), lineWidth: 1))
        .shadow(color: .black.opacity(0.2), radius: 18, y: 8)
        .offset(
            x: -12 + dockOffset.width + dragTranslation.width,
            y: currentTop
        )
        .accessibilityElement(children: .contain)
    }

    private func desktopSurface(cornerRadius: CGFloat) -> some View {
        ZStack {
            if controller.state != .failed && controller.state != .ended {
                ComputerVNCWebView(controller: controller)
                    .accessibilityLabel("Computer desktop preview")
                    .accessibilityIdentifier("computerDesktopPreview")
                    .background(.black)
            }
            ComputerConnectionStatusView(controller: controller, compact: true)
        }
        .background(.black)
        .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
    }

    private func tuckedTab(geometry: GeometryProxy) -> some View {
        let roundsLeadingEdge = tuckedSide == .trailing
        let handleShape = UnevenRoundedRectangle(
            topLeadingRadius: roundsLeadingEdge ? Self.tuckedHandleCornerRadius : 0,
            bottomLeadingRadius: roundsLeadingEdge ? Self.tuckedHandleCornerRadius : 0,
            bottomTrailingRadius: roundsLeadingEdge ? 0 : Self.tuckedHandleCornerRadius,
            topTrailingRadius: roundsLeadingEdge ? 0 : Self.tuckedHandleCornerRadius
        )
        let handleGradient = LinearGradient(
            colors: colorScheme == .dark
                ? [Color.white.opacity(0.95), Color.white.opacity(0.78)]
                : [Color.black.opacity(0.52), Color.black.opacity(0.88)],
            startPoint: .top,
            endPoint: .bottom
        )
        let handle = TuckChevron(pointsRight: tuckedSide == .leading)
            .stroke(
                colorScheme == .dark ? Color.black : Color.white,
                style: StrokeStyle(lineWidth: 3.5, lineCap: .round, lineJoin: .round)
            )
            .frame(width: 10, height: 26)
            .frame(width: Self.tuckedHandleVisibleWidth, height: Self.tuckedHandleHeight)
            .background(handleGradient, in: handleShape)
            .accessibilityHidden(true)
        let button = Button {
            isTuckedHandleVisible = false
            controller.restore()
        } label: {
            HStack(spacing: 0) {
                if tuckedSide == .trailing { Spacer(minLength: 0) }
                handle
                if tuckedSide == .leading { Spacer(minLength: 0) }
            }
            .frame(width: Self.tuckedHandleHitWidth, height: Self.tuckedHandleHeight)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Restore computer preview")
        .accessibilityValue(tuckedSide == .leading ? "Left edge" : "Right edge")
        .transition(.asymmetric(
            insertion: .move(edge: tuckedSide == .trailing ? .trailing : .leading),
            removal: .identity
        ))

        return VStack(spacing: 0) {
            Color.clear.frame(height: clampedTop(tuckedTop, height: Self.tuckedHandleHeight, geometry: geometry))
            HStack(spacing: 0) {
                if isTuckedHandleVisible {
                    if tuckedSide == .leading {
                        button
                        Spacer(minLength: 0)
                    } else {
                        Spacer(minLength: 0)
                        button
                    }
                } else {
                    Spacer(minLength: 0)
                }
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func floatingDrag(in geometry: GeometryProxy) -> some Gesture {
        DragGesture(minimumDistance: 8, coordinateSpace: .global)
            .onChanged { value in
                let previewHeight = floatWidth * controller.desktopSize.height / max(1, controller.desktopSize.width)
                let startTop = restingPreviewTop(previewHeight: previewHeight, geometry: geometry)
                let proposedTop = startTop + value.translation.height
                let boundedTop = clampedTop(proposedTop, height: previewHeight, geometry: geometry)
#if DEBUG
                if capturesDragMotion {
                    if !isSamplingDragMotion {
                        dragMotionSamples = []
                        isSamplingDragMotion = true
                    }
                    let globalMinY = geometry.frame(in: .global).minY
                    let topBound = globalMinY + topDock(geometry: geometry)
                    let bottomBound = globalMinY + bottomDockTop(previewHeight: previewHeight, geometry: geometry) + previewHeight
                    let frameTop = globalMinY + boundedTop
                    let sample = [frameTop, frameTop + previewHeight, topBound, bottomBound]
                        .map { String(Int($0.rounded())) }
                        .joined(separator: ",")
                    dragMotionSamples.append(sample)
                    if dragMotionSamples.count > 120 {
                        dragMotionSamples.removeFirst(dragMotionSamples.count - 120)
                    }
                }
#endif
                dragTranslation = CGSize(
                    width: value.translation.width,
                    height: boundedTop - startTop
                )
            }
            .onEnded { value in
#if DEBUG
                isSamplingDragMotion = false
#endif
                guard abs(value.translation.width) >= 8 || abs(value.translation.height) >= 8 else { return }
                let size = geometry.size
                let baseLeft = size.width - floatWidth - 12
                let proposedLeft = baseLeft + dockOffset.width + value.translation.width
                if proposedLeft <= -floatWidth * 0.5 || proposedLeft >= size.width - floatWidth * 0.5 {
                    let side: TuckedSide = proposedLeft <= -floatWidth * 0.5 ? .leading : .trailing
                    let previewHeight = floatWidth * controller.desktopSize.height / max(1, controller.desktopSize.width)
                    let bottomDock = bottomDockTop(previewHeight: previewHeight, geometry: geometry)
                    let startTop = restingPreviewTop(previewHeight: previewHeight, geometry: geometry)
                    let dockTop = clampedTop(startTop + value.translation.height, height: previewHeight, geometry: geometry)
                    let dockLeft = side == .leading ? 12 : baseLeft
                    let tabHeight = Self.tuckedHandleHeight
                    let tabTop = clampedTop(
                        dockTop + (previewHeight - tabHeight) / 2,
                        height: tabHeight,
                        geometry: geometry
                    )
                    withTransaction(Transaction(animation: nil)) {
                        dockOffset = CGSize(width: dockLeft - baseLeft, height: dockTop - bottomDock)
                        dragTranslation = .zero
                        tuckedSide = side
                        tuckedTop = tabTop
                        controller.tuck()
                    }
                    DispatchQueue.main.async {
                        withAnimation(dockSettleAnimation) {
                            isTuckedHandleVisible = true
                        }
                    }
                } else {
                    let dockLeft = proposedLeft + floatWidth / 2 < size.width / 2 ? 12 : baseLeft
                    let previewHeight = floatWidth * controller.desktopSize.height / max(1, controller.desktopSize.width)
                    let bottomDock = bottomDockTop(previewHeight: previewHeight, geometry: geometry)
                    let startTop = restingPreviewTop(previewHeight: previewHeight, geometry: geometry)
                    let dockTop = clampedTop(startTop + value.translation.height, height: previewHeight, geometry: geometry)
                    withAnimation(dockSettleAnimation) {
                        dockOffset = CGSize(
                            width: dockLeft - baseLeft,
                            height: dockTop - bottomDock
                        )
                        dragTranslation = .zero
                    }
                }
            }
    }

    private var dockSettleAnimation: Animation? {
        reduceMotion ? nil : .spring(response: 0.38, dampingFraction: 0.82)
    }

    private func restingPreviewTop(previewHeight: CGFloat, geometry: GeometryProxy) -> CGFloat {
        let top = topDock(geometry: geometry)
        let bottom = bottomDockTop(previewHeight: previewHeight, geometry: geometry)
        let preferred = bottom + dockOffset.height
        return min(max(preferred, top), bottom)
    }

    private func bottomDockTop(previewHeight: CGFloat, geometry: GeometryProxy) -> CGFloat {
        let topDock = topDock(geometry: geometry)
        let dockAboveComposer = composerTop.map {
            $0 - geometry.frame(in: .global).minY - previewHeight - Self.dockSpacing
        } ?? (geometry.size.height - previewHeight + geometry.safeAreaInsets.bottom - Self.dockSpacing)
        return max(topDock, dockAboveComposer)
    }

    private func clampedTop(_ proposedTop: CGFloat, height: CGFloat, geometry: GeometryProxy) -> CGFloat {
        let topDock = topDock(geometry: geometry)
        let bottomDock = bottomDockTop(previewHeight: height, geometry: geometry)
        return min(max(proposedTop, topDock), max(topDock, bottomDock))
    }

    private func topDock(geometry: GeometryProxy) -> CGFloat {
        let measuredTop = navigationBarBottom.map {
            $0 - geometry.frame(in: .global).minY
        } ?? (geometry.safeAreaInsets.top + Self.navigationBarHeight)
        return measuredTop + Self.dockSpacing
    }

    private var floatingPinch: some Gesture {
        MagnificationGesture()
            .onChanged { scale in
                let start = pinchStartWidth ?? floatWidth
                pinchStartWidth = start
                floatWidth = min(300, max(176, start * scale))
            }
            .onEnded { _ in pinchStartWidth = nil }
    }
}

private struct TuckChevron: Shape {
    let pointsRight: Bool

    func path(in rect: CGRect) -> Path {
        let outerX = rect.width * (pointsRight ? 0.18 : 0.82)
        let inwardX = rect.width * (pointsRight ? 0.82 : 0.18)
        var path = Path()
        path.move(to: CGPoint(x: outerX, y: rect.minY))
        path.addLine(to: CGPoint(x: inwardX, y: rect.midY))
        path.addLine(to: CGPoint(x: outerX, y: rect.maxY))
        return path
    }
}

struct ComputerUseInspectorScreen: View {
    @ObservedObject var controller: ComputerUseSessionController
    @State private var remoteText = ""
    @FocusState private var textFocused: Bool
    @Environment(\.scenePhase) private var scenePhase
    @State private var keyboardFocusRequest = 0

    var body: some View {
        VStack(spacing: 0) {
            GeometryReader { geometry in
                ComputerInspectorPreview(controller: controller)
                    .frame(maxWidth: geometry.size.width, maxHeight: geometry.size.height)
                    .frame(width: geometry.size.width, height: geometry.size.height)
            }
            .padding(.horizontal, 12)

            ComputerInspectorControls(controller: controller) {
                textFocused = true
            }
            .padding(.horizontal, 12)
            .padding(.top, 8)

            ComputerInspectorKeyboard(
                controller: controller,
                text: $remoteText,
                isFocused: $textFocused
            )
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            ComputerInspectorKeyAccessory(controller: controller)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(uiColor: .systemBackground))
        .navigationTitle("Computer")
        .navigationBarTitleDisplayMode(.inline)
        .tint(.primary)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    textFocused = false
                    controller.collapse()
                } label: {
                    Image(systemName: "chevron.down")
                        .frame(width: 44, height: 44)
                        .contentShape(Rectangle())
                }
                .accessibilityLabel("Collapse to preview")
            }
        }
        .task(id: keyboardFocusRequest) {
            // Rotation can dismiss UIKit's keyboard without updating FocusState.
            // Re-establish focus after the presentation/rotation transition settles.
            textFocused = false
            do {
                try await Task.sleep(for: .milliseconds(350))
            } catch {
                return
            }
            guard controller.presentation == .inspector, scenePhase == .active else { return }
            textFocused = controller.canControl && controller.state.canSendInput
            controller.finishInspectorExpansion()
        }
        .onReceive(NotificationCenter.default.publisher(for: UIDevice.orientationDidChangeNotification)) { _ in
            guard UIDevice.current.orientation.isValidInterfaceOrientation else { return }
            keyboardFocusRequest += 1
        }
        .onChange(of: controller.presentation) { _, presentation in
            if presentation != .inspector { textFocused = false }
        }
        .onChange(of: textFocused) { _, focused in
            if !focused { controller.releaseKeyboardModifiers() }
        }
        .onChange(of: controller.canControl) { _, canControl in
            textFocused = canControl && controller.state.canSendInput
        }
        .onChange(of: controller.state) { _, state in
            textFocused = controller.canControl && state.canSendInput
        }
        .onChange(of: scenePhase) { _, phase in
            if phase != .active {
                textFocused = false
                controller.releaseKeyboardModifiers()
            } else {
                textFocused = controller.canControl && controller.state.canSendInput
            }
        }
        .onDisappear {
            textFocused = false
            controller.releaseKeyboardModifiers()
        }
    }
}

private struct ComputerInspectorPreview: View {
    @ObservedObject var controller: ComputerUseSessionController

    var body: some View {
        ZStack {
            if controller.state != .failed && controller.state != .ended {
                ComputerVNCWebView(controller: controller)
                    .accessibilityIdentifier("computerInspectorPreview")
                    .opacity(controller.state == .live || controller.state == .reconnecting ? 1 : 0)
            }
            if controller.state == .live || controller.state == .reconnecting {
                ComputerTrackpad(controller: controller)
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel("Computer trackpad")
                    .accessibilityValue("\(Int(controller.cursor.x * 100)), \(Int(controller.cursor.y * 100))")
                    .accessibilityIdentifier("computerTrackpad")
                GeometryReader { proxy in
                    Image(systemName: "arrow.up.left")
                        .font(.system(size: 17, weight: .bold))
                        .foregroundStyle(.black, .white)
                        .position(x: controller.cursor.x * proxy.size.width, y: controller.cursor.y * proxy.size.height)
                }
                .allowsHitTesting(false)
            }
            ComputerConnectionStatusView(controller: controller, compact: false)
        }
        .background(.black)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .aspectRatio(controller.desktopSize.width / max(1, controller.desktopSize.height), contentMode: .fit)
    }
}

private struct ComputerInspectorControls: View {
    @ObservedObject var controller: ComputerUseSessionController
    let focusKeyboard: () -> Void

    var body: some View {
        HStack(spacing: 7) {
            controlButton("cursorarrow.click", title: "Click") { controller.click() }
            controlButton("cursorarrow.click.2", title: "Right click") { controller.click(buttonMask: 4) }
            controlButton("keyboard", title: "Keyboard", action: focusKeyboard)
            controlButton("arrow.up.left.and.arrow.down.right", title: "Fit") { controller.fitDesktop() }
        }
    }

    private func controlButton(_ symbol: String, title: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 4) {
                Image(systemName: symbol).font(.system(size: 15, weight: .medium))
                Text(title).font(.caption2).lineLimit(1)
            }
            .frame(maxWidth: .infinity, minHeight: 48)
            .foregroundStyle(.primary)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .strokeBorder(Color.primary.opacity(0.08), lineWidth: 1)
            }
        }
        .buttonStyle(.plain)
        .tint(.primary)
        .disabled(!controller.canControl || !controller.state.canSendInput)
        .accessibilityLabel(title)
    }
}

private struct ComputerInspectorKeyboard: View {
    @ObservedObject var controller: ComputerUseSessionController
    @Binding var text: String
    var isFocused: FocusState<Bool>.Binding

    var body: some View {
        VStack(spacing: 8) {
            TextField("Type to computer", text: $text)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .focused(isFocused)
                .onChange(of: text) { old, new in
                    if new.hasPrefix(old) { controller.sendText(String(new.dropFirst(old.count))) }
                    else if old.hasPrefix(new) {
                        for _ in 0..<old.count - new.count { controller.sendSpecialKey(.backspace) }
                    }
                }
                .submitLabel(.return)
                .onSubmit {
                    controller.sendSpecialKey(.init(label: "Enter", code: "Enter", keysym: 0xFF0D))
                    isFocused.wrappedValue = true
                }
                .textFieldStyle(.roundedBorder)
                .disabled(!controller.canControl || !controller.state.canSendInput)
                .accessibilityIdentifier("computerRemoteText")

        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
    }
}

private struct ComputerInspectorKeyAccessory: View {
    @ObservedObject var controller: ComputerUseSessionController

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(RemoteKey.accessory) { key in
                    Button(key.label) { controller.sendSpecialKey(key) }
                        .font(.system(size: 13, weight: .medium))
                        .frame(minWidth: 42, minHeight: 44)
                        .foregroundStyle(.primary)
                        .background(
                            controller.activeModifiers.contains(key.code)
                                ? Color.accentColor.opacity(0.25)
                                : Color(uiColor: .tertiarySystemFill),
                            in: RoundedRectangle(cornerRadius: 8, style: .continuous)
                        )
                        .buttonStyle(.plain)
                        .disabled(!controller.canControl || !controller.state.canSendInput)
                        .accessibilityValue(controller.activeModifiers.contains(key.code) ? "Pressed" : "Released")
                        .accessibilityIdentifier("remoteKey_\(key.code)")
                }
            }
            .padding(.horizontal, 12)
        }
        .frame(height: 44)
        .padding(.vertical, 6)
        .background(.bar)
        .accessibilityIdentifier("computerKeyAccessory")
    }
}

#if DEBUG
struct ComputerUseE2EHarnessView: View {
    enum Scenario: Equatable { case sandboxResumeFailure, viewerFixture, viewerConnecting, viewerTimeout }
    let scenario: Scenario
    @StateObject private var controller = ComputerUseSessionController()
    @State private var viewerPresentation: ComputerViewerPresentation = .hidden

    var body: some View {
        Group {
            if scenario == .sandboxResumeFailure {
                ComputerUseSessionCard(tools: [failedOpenTool], isDarkMode: false)
                    .padding(24)
            } else {
                NavigationStack {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 20) {
                            Text("Chat canvas")
                                .accessibilityIdentifier("chatCanvas")
                            Text("TRANSCRIPT_SCROLL_ANCHOR")
                                .accessibilityIdentifier("transcriptScrollAnchor")
                            ForEach(0..<30, id: \.self) { index in
                                Text("Transcript row \(index + 1)")
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            }
                        }
                        .padding(24)
                    }
                    .accessibilityIdentifier("chatTranscriptScroll")
                    .background(Color(uiColor: .systemBackground))
                    .overlay(alignment: .topTrailing) {
                        Text("Session: \(String(describing: controller.state))")
                            .accessibilityIdentifier("computerFixtureSessionState")
                    }
                    .safeAreaInset(edge: .bottom, spacing: 0) {
                            RoundedRectangle(cornerRadius: 22, style: .continuous)
                                .fill(Color(uiColor: .secondarySystemBackground))
                                .overlay(alignment: .leading) {
                                    Text("Message")
                                        .foregroundStyle(.secondary)
                                        .padding(.horizontal, 16)
                                }
                                .frame(height: 88)
                                .accessibilityElement(children: .combine)
                                .accessibilityIdentifier("chatComposer")
                                .background {
                                    GeometryReader { proxy in
                                        Color.clear.preference(
                                            key: ComputerComposerTopPreferenceKey.self,
                                            value: proxy.frame(in: .global).minY
                                        )
                                    }
                                }
                    }
                    .overlayPreferenceValue(ComputerComposerTopPreferenceKey.self) { composerTop in
                            ComputerUseViewerOverlay(controller: controller, composerTop: composerTop)
                        }
                        .toolbar {
                        ToolbarItem(placement: .topBarLeading) {
                            Button("Chats") {}
                                .accessibilityIdentifier("showChats")
                        }
                        }
                }
                .fullScreenCover(isPresented: Binding(
                    get: { viewerPresentation == .inspector },
                    set: { if !$0 { controller.collapse() } }
                )) {
                    NavigationStack {
                        ComputerUseInspectorScreen(controller: controller)
                    }
                }
            }
        }
        .task {
            switch scenario {
            case .viewerFixture:
                controller.loadUITestFixture()
            case .viewerConnecting:
                controller.loadUITestFixture(isConnecting: true)
            case .viewerTimeout:
                controller.loadUITestFixture(isConnecting: true, connectionTimeoutSeconds: 3)
            case .sandboxResumeFailure:
                break
            }
        }
        .onReceive(controller.$presentation) { presentation in
            viewerPresentation = presentation
        }
    }

    private var failedOpenTool: ResponseTool {
        ResponseTool(
            id: "ui-test-computer-open-failed",
            name: "computer_open",
            status: .failed,
            output: #"{"ok":false,"op":"open","error":"Cannot resume sandbox: no snapshot available","code":"runtime"}"#,
            title: "Computer use",
            inputSummary: "Open the computer session",
            outputTruncated: false,
            errorText: "Cannot resume sandbox: no snapshot available"
        )
    }
}
#endif
