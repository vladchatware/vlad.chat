import XCTest

final class AgentActivityUITests: XCTestCase {
    private var app: XCUIApplication!
    private let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")

    override func setUpWithError() throws {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchArguments = ["--ui-test-agent-activity"]
        app.launch()
        XCTAssertTrue(app.buttons["activity-clear"].waitForExistence(timeout: 10))
        app.buttons["activity-clear"].tap()
        expectActivityCount(0)
        app.buttons["activity-running"].tap()
        expectActivityCount(1)
    }

    override func tearDownWithError() throws {
        app.activate()
        capture("Fixture before cleanup", application: app)
        if app.buttons["activity-clear"].exists {
            app.buttons["activity-clear"].tap()
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
            app.buttons["activity-\(phase)"].tap()
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
        app.buttons["activity-completed"].tap()
        expectActivityCount(0)
        XCUIDevice.shared.press(.home)
        capture("Dynamic Island after completion", application: springboard)
        app.activate()
        app.buttons["activity-clear"].tap()
        app.buttons["activity-running"].tap()
        expectActivityCount(1)
        app.buttons["activity-failed"].tap()
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
        app.buttons["activity-second"].tap()
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
        app.buttons["activity-clear"].tap()
        let count = app.staticTexts["activity-count"]
        let cleared = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "label == %@", "Active activities: 0"), object: count
        )
        XCTAssertEqual(XCTWaiter.wait(for: [cleared], timeout: 5), .completed)

        app.buttons["activity-running"].tap()
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
        app.buttons["activity-clear"].tap()
        let cleanup = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "label == %@", "Active activities: 0"), object: count
        )
        XCTAssertEqual(XCTWaiter.wait(for: [cleanup], timeout: 5), .completed)
    }
}
