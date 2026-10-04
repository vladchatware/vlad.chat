import XCTest

private func tapFixtureControl(_ identifier: String, in app: XCUIApplication) {
    let button = app.buttons[identifier]
    XCTAssertTrue(button.waitForExistence(timeout: 5))
    for _ in 0..<6 where !button.isHittable {
        if button.frame.minY < app.frame.minY {
            app.scrollViews.firstMatch.swipeDown()
        } else {
            app.scrollViews.firstMatch.swipeUp()
        }
    }
    XCTAssertTrue(button.isHittable, "Fixture control must be visible before tapping: \(identifier)")
    button.tap()
}

final class AgentActivityUITests: XCTestCase {
    private var app: XCUIApplication!
    private let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")

    override func setUpWithError() throws {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchArguments = ["--ui-test-agent-activity"]
        app.launch()
        XCTAssertTrue(app.buttons["activity-clear"].waitForExistence(timeout: 10))
        tapFixtureControl("activity-clear", in: app)
        expectActivityCount(0)
        tapFixtureControl("activity-running", in: app)
        expectActivityCount(1)
    }

    override func tearDownWithError() throws {
        app.activate()
        capture("Fixture before cleanup", application: app)
        if app.buttons["activity-clear"].exists {
            tapFixtureControl("activity-clear", in: app)
            expectActivityCount(0)
        }
    }

    func testLifecycleRetainsActivityUntilTerminalState() {
        for (phase, label) in [
            ("starting", "Starting"),
            ("executing", "Executing"),
            ("stopping", "Stopping"),
            ("paused", "Paused"),
            ("running", "Running"),
        ] {
            tapFixtureControl("activity-\(phase)", in: app)
            let phaseExpectation = XCTNSPredicateExpectation(
                predicate: NSPredicate(format: "label == %@", label),
                object: app.staticTexts["fixture-phase"]
            )
            XCTAssertEqual(XCTWaiter.wait(for: [phaseExpectation], timeout: 5), .completed)
            expectActivityCount(1)
            XCUIDevice.shared.press(.home)
            capture("Dynamic Island compact — \(phase)", application: springboard)
            app.activate()
            capture("Fixture after returning from \(phase)", application: app)
        }
        tapFixtureControl("activity-completed", in: app)
        expectActivityCount(0)
        XCUIDevice.shared.press(.home)
        capture("Dynamic Island after completion", application: springboard)
        app.activate()
        tapFixtureControl("activity-clear", in: app)
        tapFixtureControl("activity-running", in: app)
        expectActivityCount(1)
        tapFixtureControl("activity-failed", in: app)
        expectActivityCount(0)
    }

    func testExpandedIslandOpensAssociatedConversation() {
        XCUIDevice.shared.press(.home)
        capture("Dynamic Island before expansion", application: springboard)
        let island = springboard.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.035))
        island.press(forDuration: 1.2)
        let title = springboard.staticTexts["Vlad"].firstMatch
        XCTAssertTrue(title.waitForExistence(timeout: 5), "Long press must expand the agent Live Activity")
        capture("Dynamic Island expanded", application: springboard)
        title.tap()
        XCTAssertTrue(app.staticTexts["opened-thread"].waitForExistence(timeout: 5))
        XCTAssertEqual(app.staticTexts["opened-thread"].label, "live-activity-fixture")
        capture("Conversation route from expanded Island", application: app)
    }

    func testTwoActivitiesAndLockScreenPresentation() {
        tapFixtureControl("activity-second", in: app)
        expectActivityCount(2)
        XCUIDevice.shared.press(.home)
        capture("Dynamic Island with two activities", application: springboard)
        // Notification Center shows the system's Lock Screen presentation.
        // An actual Sleep/Wake check is performed separately in Simulator.
        let top = springboard.coordinate(withNormalizedOffset: CGVector(dx: 0.15, dy: 0.01))
        let bottom = springboard.coordinate(withNormalizedOffset: CGVector(dx: 0.15, dy: 0.8))
        top.press(forDuration: 0.1, thenDragTo: bottom)
        let agent = springboard.staticTexts["Vlad agent"].firstMatch
        XCTAssertTrue(agent.waitForExistence(timeout: 5), "Lock Screen presentation must show the agent activity")
        capture("Lock Screen presentation with two activities", application: springboard)
        // Same-app activities are a collapsed stack on Lock Screen. First tap
        // expands that stack; the selected activity then opens its widget URL.
        agent.tap()
        capture("Lock Screen activity stack expanded", application: springboard)
        springboard.staticTexts["Vlad agent"].firstMatch.tap()
        let routeExpectation = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "label IN %@", ["live-activity-fixture", "live-activity-second-fixture"]),
            object: app.staticTexts["opened-thread"]
        )
        XCTAssertEqual(XCTWaiter.wait(for: [routeExpectation], timeout: 5), .completed)
        capture("Conversation route from Lock Screen presentation", application: app)
    }

    private func expectActivityCount(_ count: Int, file: StaticString = #filePath, line: UInt = #line) {
        let label = app.staticTexts["activity-count"]
        let predicate = NSPredicate(format: "label == %@", "Active activities: \(count)")
        let expectation = XCTNSPredicateExpectation(predicate: predicate, object: label)
        XCTAssertEqual(XCTWaiter.wait(for: [expectation], timeout: 12), .completed, file: file, line: line)
    }

    private func capture(_ name: String, application: XCUIApplication) {
        let hierarchy = XCTAttachment(string: application.debugDescription)
        hierarchy.name = "\(name) — hierarchy"
        hierarchy.lifetime = .keepAlways
        add(hierarchy)
        let screenshot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        screenshot.name = name
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }
}

final class AgentActivityBackgroundUITests: XCTestCase {
    func testLeavingBeforeCreationDelayStillStartsActivity() {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--ui-test-agent-activity"]
        app.launch()
        XCTAssertTrue(app.buttons["activity-clear"].waitForExistence(timeout: 10))
        tapFixtureControl("activity-clear", in: app)
        let count = app.staticTexts["activity-count"]
        let cleared = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "label == %@", "Active activities: 0"), object: count
        )
        XCTAssertEqual(XCTWaiter.wait(for: [cleared], timeout: 5), .completed)

        tapFixtureControl("activity-running", in: app)
        XCUIDevice.shared.press(.home)
        let screenshot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        screenshot.name = "Dynamic Island after leaving before creation delay"
        screenshot.lifetime = .keepAlways
        add(screenshot)
        app.activate()
        let started = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "label == %@", "Active activities: 1"), object: count
        )
        XCTAssertEqual(XCTWaiter.wait(for: [started], timeout: 4), .completed)
        let hierarchy = XCTAttachment(string: app.debugDescription)
        hierarchy.name = "Activity after immediate background transition"
        hierarchy.lifetime = .keepAlways
        add(hierarchy)
        tapFixtureControl("activity-clear", in: app)
        let cleanup = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "label == %@", "Active activities: 0"), object: count
        )
        XCTAssertEqual(XCTWaiter.wait(for: [cleanup], timeout: 5), .completed)
    }
}

final class AgentForegroundActivityUITests: XCTestCase {
    private var app: XCUIApplication!
    private let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")

    override func setUpWithError() throws {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchArguments = ["--ui-test-agent-activity"]
        if name.contains("Replay") { app.launchArguments.append("--ui-test-transient-replay") }
        app.launch()
        tapFixtureControl("activity-clear", in: app)
        expectCount("activity-count", label: "Active activities: 0")
        expectCount("foreground-count", label: "Foreground activities: 0")
        tapFixtureControl("activity-running", in: app)
        expectCount("activity-count", label: "Active activities: 1")
    }

    override func tearDownWithError() throws {
        app.activate()
        capture("Foreground fixture before cleanup")
        tapFixtureControl("activity-clear", in: app)
        expectCount("activity-count", label: "Active activities: 0")
        expectCount("foreground-count", label: "Foreground activities: 0")
    }

    func testForegroundPresentationDismissesReopensAndEndsOnHome() {
        showForegroundActivity()
        capture("Transient expanded above owning app")

        // Updating through an outside control both dismisses the system overlay
        // and supplies another run snapshot. That snapshot must not reopen it.
        tapFixtureControl("activity-running", in: app)
        expectCount("foreground-count", label: "Foreground activities: 0")
        expectCount("activity-count", label: "Active activities: 1")
        XCTAssertFalse(springboard.staticTexts["Vlad"].exists)
        capture("Outside dismissal preserves standard activity")

        showForegroundActivity()
        capture("Explicitly reopened transient activity")
        XCUIDevice.shared.press(.home)
        capture("Home retains standard activity after transient ends")
        app.activate()
        capture("Owning app after returning from Home")
        expectCount("foreground-count", label: "Foreground activities: 0")
        expectCount("activity-count", label: "Active activities: 1")
        XCTAssertFalse(springboard.staticTexts["Vlad"].exists)
    }

    func testForegroundReplayUpdatesExpandedIslandAndClearsAtCompletion() {
        showForegroundActivity()
        for phase in ["Executing", "Paused"] {
            let label = springboard.staticTexts[phase].firstMatch
            XCTAssertTrue(label.waitForExistence(timeout: 6), "Expanded Island must show replay phase \(phase)")
            XCTAssertEqual(app.state, .runningForeground)
            XCTAssertTrue(springboard.staticTexts["Vlad"].exists)
            capture("Foreground replay — \(phase)")
        }
        expectCount("foreground-count", label: "Foreground activities: 0")
        expectCount("activity-count", label: "Active activities: 0")
        XCTAssertEqual(app.staticTexts["fixture-phase"].label, "Completed")
        XCTAssertFalse(springboard.staticTexts["Vlad"].exists)
        capture("Terminal replay removes both activity instances")
    }

    func testConversationSwitchAndResetCleanForegroundActivity() {
        showForegroundActivity()
        tapFixtureControl("activity-switch", in: app)
        expectCount("foreground-count", label: "Foreground activities: 0")
        expectCount("activity-count", label: "Active activities: 1")
        tapFixtureControl("expandAgentActivity", in: app)
        expectCount("foreground-count", label: "Foreground activities: 0")
        XCTAssertFalse(springboard.staticTexts["Vlad"].exists)
        capture("Conversation switch prevents old foreground presentation")

        tapFixtureControl("activity-running", in: app)
        showForegroundActivity()
        tapFixtureControl("activity-clear", in: app)
        expectCount("foreground-count", label: "Foreground activities: 0")
        expectCount("activity-count", label: "Active activities: 0")
        XCTAssertFalse(springboard.staticTexts["Vlad"].exists)
        capture("Reset removes foreground and standard activities")
    }

    private func showForegroundActivity() {
        tapFixtureControl("expandAgentActivity", in: app)
        expectCount("foreground-count", label: "Foreground activities: 1")
        XCTAssertEqual(app.state, .runningForeground)
        XCTAssertTrue(springboard.staticTexts["Vlad"].waitForExistence(timeout: 5))
        XCTAssertTrue(springboard.staticTexts["Step 1"].exists)
    }

    private func expectCount(_ identifier: String, label: String) {
        let expectation = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "label == %@", label), object: app.staticTexts[identifier]
        )
        XCTAssertEqual(XCTWaiter.wait(for: [expectation], timeout: 12), .completed)
    }

    private func capture(_ name: String) {
        let hierarchy = XCTAttachment(string: app.debugDescription + "\n" + springboard.debugDescription)
        hierarchy.name = "\(name) — hierarchy"
        hierarchy.lifetime = .keepAlways
        add(hierarchy)
        let screenshot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        screenshot.name = name
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }
}
