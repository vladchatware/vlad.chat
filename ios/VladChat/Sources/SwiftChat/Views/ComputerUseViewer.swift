import SwiftUI
import WebKit
import UIKit

enum ComputerViewerPresentation: Equatable {
    case hidden
    case floating
    case tucked
    case inspector
}

struct ComputerComposerTopPreferenceKey: PreferenceKey {
    static let defaultValue: CGFloat? = nil

    static func reduce(value: inout CGFloat?, nextValue: () -> CGFloat?) {
        value = nextValue() ?? value
    }
}

@MainActor
final class ComputerUseSessionController: NSObject, ObservableObject, WKNavigationDelegate, WKScriptMessageHandler {
    @Published private(set) var state = "idle"
    @Published private(set) var presentation: ComputerViewerPresentation = .hidden
    @Published private(set) var isExpanding = false
    @Published private(set) var canControl = false
    @Published private(set) var desktopSize = CGSize(width: 1280, height: 720)
    @Published private(set) var errorMessage: String?
    @Published private(set) var cursor = CGPoint(x: 0.5, y: 0.5)

    let webView: WKWebView
    private let scriptMessageProxy = WeakVNCMessageHandler()
    private var sessionID: String?
    private var viewerURL: URL?
    private var heldButtons = 0
    private var pendingPointer: CGPoint?
    private var pointerFlushTask: Task<Void, Never>?


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
    func loadUITestFixture(isConnecting: Bool = false) {
        sessionID = "ui-test-vnc-session"
        presentation = .floating
        state = isConnecting ? "connecting" : "connected"
        canControl = !isConnecting
        guard !isConnecting else { return }
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

    func start(url: URL, sessionID: String) {
        guard url.scheme == "https",
              url.host?.hasSuffix(".vercel.run") == true,
              url.path == "/vladchat.html" else {
            fail("This computer session has no valid iOS VNC endpoint.")
            return
        }
        if self.sessionID == sessionID, viewerURL == url, state != "failed" { return }
        releasePointer()
        self.sessionID = sessionID
        viewerURL = url
        isExpanding = false
        state = "connecting"
        errorMessage = nil
        presentation = .floating
        webView.load(URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData))
    }

    func updateAgentState(isActive: Bool, needsUser: Bool) {
        canControl = needsUser || !isActive
        if !canControl { releasePointer() }
    }

    func retry() {
        guard let viewerURL else { return }
        state = "connecting"
        errorMessage = nil
        webView.load(URLRequest(url: viewerURL, cachePolicy: .reloadIgnoringLocalCacheData))
    }

    func stop() {
        isExpanding = false
        pointerFlushTask?.cancel()
        pointerFlushTask = nil
        pendingPointer = nil
        releasePointer()
        sessionID = nil
        viewerURL = nil
        presentation = .hidden
        state = "idle"
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
        releasePointer()
        presentation = .floating
    }

    func tuck() {
        releasePointer()
        presentation = .tucked
    }

    func restore() {
        presentation = .floating
    }

    func movePointer(by delta: CGSize, velocity: CGPoint, in viewSize: CGSize) {
        guard canControl, state == "connected", viewSize.width > 0, viewSize.height > 0 else { return }
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
        guard canControl, state == "connected" else { return }
        for _ in 0..<max(1, count) {
            heldButtons = buttonMask
            sendPointer(mask: heldButtons)
            heldButtons = 0
            sendPointer(mask: heldButtons)
        }
    }

    func beginDrag() {
        guard canControl, state == "connected" else { return }
        heldButtons = 1
        sendPointer(mask: heldButtons)
    }

    func endDrag() {
        heldButtons = 0
        sendPointer(mask: 0)
    }

    func scroll(deltaY: CGFloat) {
        guard canControl, state == "connected" else { return }
        let mask = deltaY >= 0 ? 16 : 8
        sendPointer(mask: mask)
        sendPointer(mask: 0)
    }

    func sendSpecialKey(_ key: RemoteKey) {
        guard canControl, state == "connected" else { return }
        let source = "window.vladVNC?.key(\(key.keysym), \(Self.jsonString(key.code)), true); window.vladVNC?.key(\(key.keysym), \(Self.jsonString(key.code)), false);"
        webView.evaluateJavaScript(source)
    }

    func sendText(_ value: String) {
        guard canControl, state == "connected", !value.isEmpty else { return }
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
        state = "failed"
        errorMessage = message
    }

    private static func jsonString(_ value: String) -> String {
        guard let data = try? JSONEncoder().encode(value),
              let result = String(data: data, encoding: .utf8) else { return "\"\"" }
        return result
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let payload = message.body as? [String: Any],
              let type = payload["type"] as? String else { return }
        switch type {
        case "connecting": state = "connecting"
        case "connected": state = "connected"
        case "disconnected":
            state = "failed"
            errorMessage = "Computer connection closed. Retry to reconnect."
            releasePointer()
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
        fail("Could not load VNC viewer: \(error.localizedDescription)")
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        fail("Could not connect to computer: \(error.localizedDescription)")
    }
}

struct RemoteKey: Identifiable {
    let label: String
    let code: String
    let keysym: Int
    var id: String { label }

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
        view.isUserInteractionEnabled = controller.canControl && controller.state == "connected"
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

    private enum TuckedSide: Equatable {
        case leading
        case trailing
    }

    @ObservedObject var controller: ComputerUseSessionController
    let composerTop: CGFloat?
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var floatWidth: CGFloat = 208
    @State private var dockOffset = CGSize.zero
    @State private var dragTranslation = CGSize.zero
    @State private var pinchStartWidth: CGFloat?
    @State private var tuckedSide: TuckedSide = .trailing
    @State private var tuckedTop: CGFloat = 12

    var body: some View {
        GeometryReader { geometry in
            Group {
                switch controller.presentation {
                case .hidden: EmptyView()
                case .floating: floatingViewer(geometry: geometry)
                case .tucked: tuckedTab(geometry: geometry)
                case .inspector:
                    if controller.isExpanding && horizontalSizeClass == .compact {
                        floatingViewer(geometry: geometry)
                    }
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
            .animation(.easeInOut(duration: 0.24), value: controller.presentation)
        }
    }

    private func floatingViewer(geometry: GeometryProxy) -> some View {
        let previewHeight = floatWidth * controller.desktopSize.height / max(1, controller.desktopSize.width)
        let bottomDockTop = bottomDockTop(previewHeight: previewHeight, geometry: geometry)
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
        }
        .frame(width: floatWidth)
        .fixedSize(horizontal: false, vertical: true)
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(.primary.opacity(0.12), lineWidth: 1))
        .shadow(color: .black.opacity(0.2), radius: 18, y: 8)
        .offset(
            x: -12 + dockOffset.width + dragTranslation.width,
            y: bottomDockTop + dockOffset.height + dragTranslation.height
        )
        .accessibilityElement(children: .contain)
    }

    private func desktopSurface(cornerRadius: CGFloat) -> some View {
        ComputerVNCWebView(controller: controller)
            .accessibilityLabel("Computer desktop preview")
            .accessibilityIdentifier("computerDesktopPreview")
            .background(.black)
            .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
            .overlay {
                if controller.isExpanding || controller.state == "connecting" {
                    HStack(spacing: 8) {
                        ProgressView()
                            .tint(.white)
                        Text("Connecting")
                            .font(.caption.weight(.medium))
                            .foregroundStyle(.white)
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 9)
                    .background(.black.opacity(0.65), in: Capsule())
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel("Connecting to computer")
                    .accessibilityIdentifier("computerOpeningIndicator")
                } else if controller.state == "failed" {
                    ContentUnavailableView("Computer unavailable", systemImage: "desktopcomputer", description: Text(controller.errorMessage ?? "Reconnect to resume this session."))
                }
            }
    }

    private func tuckedTab(geometry: GeometryProxy) -> some View {
        let roundsLeadingEdge = tuckedSide == .trailing
        let button = Button { controller.restore() } label: {
            Image(systemName: "desktopcomputer")
                .frame(width: 44, height: 64)
                .background(
                    .regularMaterial,
                    in: UnevenRoundedRectangle(
                        topLeadingRadius: roundsLeadingEdge ? 12 : 0,
                        bottomLeadingRadius: roundsLeadingEdge ? 12 : 0,
                        bottomTrailingRadius: roundsLeadingEdge ? 0 : 12,
                        topTrailingRadius: roundsLeadingEdge ? 0 : 12
                    )
                )
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Restore computer preview")

        return VStack(spacing: 0) {
            Color.clear.frame(height: clampedTop(tuckedTop, height: 64, geometry: geometry))
            HStack(spacing: 0) {
                if tuckedSide == .leading {
                    button
                    Spacer(minLength: 0)
                } else {
                    Spacer(minLength: 0)
                    button
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
                let topDock = topDock(geometry: geometry)
                let bottomDock = bottomDockTop(previewHeight: previewHeight, geometry: geometry)
                let startTop = bottomDock + dockOffset.height
                let proposedTop = startTop + value.translation.height
                let clampedTop = min(max(proposedTop, topDock), bottomDock)
                dragTranslation = CGSize(
                    width: value.translation.width,
                    height: clampedTop - startTop
                )
            }
            .onEnded { value in
                guard abs(value.translation.width) >= 8 || abs(value.translation.height) >= 8 else { return }
                let size = geometry.size
                let baseLeft = size.width - floatWidth - 12
                let proposedLeft = baseLeft + dockOffset.width + value.translation.width
                if proposedLeft <= -floatWidth * 0.5 || proposedLeft >= size.width - floatWidth * 0.5 {
                    let side: TuckedSide = proposedLeft <= -floatWidth * 0.5 ? .leading : .trailing
                    let previewHeight = floatWidth * controller.desktopSize.height / max(1, controller.desktopSize.width)
                    let topDock = topDock(geometry: geometry)
                    let bottomDock = bottomDockTop(previewHeight: previewHeight, geometry: geometry)
                    let proposedTop = bottomDock + dockOffset.height + value.translation.height
                    let dockTop = min(max(proposedTop, topDock), bottomDock)
                    let dockLeft = side == .leading ? 12 : baseLeft
                    let tabHeight: CGFloat = 64
                    let tabTop = clampedTop(
                        dockTop + (previewHeight - tabHeight) / 2,
                        height: tabHeight,
                        geometry: geometry
                    )
                    withAnimation(dockSettleAnimation) {
                        dockOffset = CGSize(width: dockLeft - baseLeft, height: dockTop - bottomDock)
                        dragTranslation = .zero
                        tuckedSide = side
                        tuckedTop = tabTop
                        controller.tuck()
                    }
                } else {
                    let dockLeft = proposedLeft + floatWidth / 2 < size.width / 2 ? 12 : baseLeft
                    let previewHeight = floatWidth * controller.desktopSize.height / max(1, controller.desktopSize.width)
                    let topDock = topDock(geometry: geometry)
                    let bottomDock = bottomDockTop(previewHeight: previewHeight, geometry: geometry)
                    let proposedTop = bottomDock + dockOffset.height + value.translation.height
                    let dockTop = min(max(proposedTop, topDock), bottomDock)
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
        geometry.safeAreaInsets.top + Self.navigationBarHeight + Self.dockSpacing
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

struct ComputerUseInspectorScreen: View {
    @ObservedObject var controller: ComputerUseSessionController
    @State private var remoteText = ""
    @FocusState private var textFocused: Bool

    var body: some View {
        VStack(spacing: 0) {
            ComputerInspectorPreview(controller: controller)
                .padding(.horizontal, 12)

            if let error = controller.errorMessage {
                HStack {
                    Text(error).font(.footnote).foregroundStyle(.red)
                    Spacer()
                    Button("Retry") { controller.retry() }
                }
                .padding(.horizontal, 16)
                .padding(.top, 8)
            }

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

            Spacer(minLength: 10)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(uiColor: .systemBackground))
        .navigationTitle("Inspector")
        .navigationBarTitleDisplayMode(.inline)
        .tint(.primary)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("Done") {
                    textFocused = false
                    controller.collapse()
                }
                .accessibilityLabel("Collapse to preview")
            }
        }
        .task {
            guard controller.isExpanding else { return }
            do {
                try await Task.sleep(nanoseconds: 350_000_000)
            } catch {
                return
            }
            controller.finishInspectorExpansion()
        }
        .onChange(of: controller.presentation) { _, presentation in
            if presentation != .inspector { textFocused = false }
        }
    }
}

private struct ComputerInspectorPreview: View {
    @ObservedObject var controller: ComputerUseSessionController

    var body: some View {
        ComputerVNCWebView(controller: controller)
            .accessibilityIdentifier("computerInspectorPreview")
            .background(.black)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay {
                if controller.isExpanding || controller.state == "connecting" {
                    HStack(spacing: 8) {
                        ProgressView()
                            .tint(.white)
                        Text("Connecting to computer…")
                            .font(.caption.weight(.medium))
                            .foregroundStyle(.white)
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 9)
                    .background(.black.opacity(0.65), in: Capsule())
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel("Connecting to computer")
                    .accessibilityIdentifier("computerInspectorLoading")
                } else if controller.state == "failed" {
                    ContentUnavailableView(
                        "Computer unavailable",
                        systemImage: "desktopcomputer",
                        description: Text(controller.errorMessage ?? "Reconnect to resume this session.")
                    )
                }
            }
            .aspectRatio(controller.desktopSize.width / max(1, controller.desktopSize.height), contentMode: .fit)
            .overlay {
                ComputerTrackpad(controller: controller)
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel("Computer trackpad")
                    .accessibilityValue("\(Int(controller.cursor.x * 100)), \(Int(controller.cursor.y * 100))")
                    .accessibilityIdentifier("computerTrackpad")
                GeometryReader { proxy in
                    Image(systemName: "arrow.up.left")
                        .font(.system(size: 17, weight: .bold))
                        .foregroundStyle(.black, .white)
                        .position(
                            x: controller.cursor.x * proxy.size.width,
                            y: controller.cursor.y * proxy.size.height
                        )
                }
                .allowsHitTesting(false)
            }
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
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
        .disabled(!controller.canControl || controller.state != "connected")
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
                .textFieldStyle(.roundedBorder)
                .disabled(!controller.canControl || controller.state != "connected")
                .accessibilityIdentifier("computerRemoteText")

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(RemoteKey.accessory) { key in
                        Button(key.label) { controller.sendSpecialKey(key) }
                            .font(.system(size: 13, weight: .medium))
                            .frame(minWidth: 42, minHeight: 44)
                            .foregroundStyle(.primary)
                            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                            .overlay {
                                RoundedRectangle(cornerRadius: 8, style: .continuous)
                                    .strokeBorder(Color.primary.opacity(0.08), lineWidth: 1)
                            }
                            .tint(.primary)
                            .disabled(!controller.canControl)
                            .accessibilityIdentifier("remoteKey_\(key.code)")
                    }
                }
                .padding(.horizontal, 12)
            }
        }
        .padding(.horizontal, 12)
        .padding(.top, 9)
    }
}

#if DEBUG
struct ComputerUseE2EHarnessView: View {
    enum Scenario: Equatable { case sandboxResumeFailure, viewerFixture, viewerConnecting }
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
                    Color(uiColor: .systemBackground)
                        .ignoresSafeArea()
                        .overlay(alignment: .topTrailing) {
                            Text("Chat canvas")
                                .accessibilityIdentifier("chatCanvas")
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
