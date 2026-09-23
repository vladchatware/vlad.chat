import XCTest

final class VladChatUITests: XCTestCase {
    private var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        app = XCUIApplication()
    }

    func testWebSearchToggleIsIconOnlyAndStateful() {
        app.launch()
        let toggle = app.buttons["webSearchToggle"]

        XCTAssertTrue(toggle.waitForExistence(timeout: 5))
        XCTAssertFalse(app.staticTexts["Web"].exists)

        let initialValue = toggle.value as? String
        toggle.tap()

        XCTAssertNotEqual(toggle.value as? String, initialValue)
    }

    func testInferenceGalleryShowsCoreLoadingReasoningAndToolStates() {
        launchGallery()
        XCTAssertTrue(app.staticTexts["Waiting"].waitForExistence(timeout: 5))

        let gallery = app.scrollViews.firstMatch
        let titles = [
            "Reasoning",
            "Search running",
            "Tool pending",
            "Unknown tool",
            "Text → tool → text",
            "Multiple same-name calls",
            "Truncated output",
            "Tool failed",
            "Stopped",
            "Empty stopped response",
        ]

        for title in titles {
            let fixtureTitle = app.staticTexts[title]
            for _ in 0..<8 where !fixtureTitle.isHittable {
                gallery.swipeUp()
            }
            XCTAssertTrue(fixtureTitle.isHittable, "Gallery fixture never became visible: \(title)")

            if title == "Reasoning" {
                XCTAssertTrue(app.staticTexts["Thinking"].exists)
                XCTAssertTrue(app.staticTexts["Checking the relevant constraints…"].exists)
            }
        }
    }

    func testStreamingRevealAdvancesWithoutReplacingTheWholeResponse() {
        launchGallery()
        let advance = app.buttons["streamingRevealAdvance"]
        XCTAssertTrue(advance.waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["The"].exists)

        advance.tap()

        XCTAssertTrue(app.staticTexts["The response"].waitForExistence(timeout: 2))
        XCTAssertFalse(app.staticTexts["The"].exists)

        advance.tap()
        XCTAssertTrue(app.staticTexts["The response arrives"].waitForExistence(timeout: 2))

        advance.tap()
        XCTAssertTrue(app.staticTexts["The response arrives in calm, short runs."].waitForExistence(timeout: 2))
        XCTAssertEqual(advance.label, "Restart reveal")
    }

    func testStreamCompletionPreservesScrolledTextPosition() {
        app.launchArguments = ["--ui-test-streaming-scroll"]
        app.launch()

        let table = app.tables.firstMatch
        XCTAssertTrue(table.waitForExistence(timeout: 5))

        let anchor = app.staticTexts.containing(
            NSPredicate(format: "label CONTAINS %@", "STREAM_ANCHOR_06")
        ).firstMatch
        XCTAssertTrue(anchor.waitForExistence(timeout: 5))

        for _ in 0..<6 where !anchor.frame.intersects(table.frame) {
            table.swipeDown()
        }
        XCTAssertTrue(anchor.frame.intersects(table.frame), "Middle of the streamed response must be visible before completion")
        let originalY = anchor.frame.minY

        app.buttons["finishStreamingFixture"].tap()

        XCTAssertEqual(app.staticTexts["streamingCompletionStatus"].label, "Complete")
        XCTAssertTrue(anchor.frame.intersects(table.frame), "Completion must not send the reader back to the start")
        XCTAssertLessThan(abs(anchor.frame.minY - originalY), 48, "Visible response position jumped when streaming ended")
    }

    private func launchGallery() {
        app.launchArguments = ["--ui-test-gallery"]
        app.launch()
    }
}
