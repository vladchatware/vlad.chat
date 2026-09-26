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

    func testStreamCompletionDoesNotStartSecondBottomScrollAfterMarkdownReflow() {
        app.launchArguments = ["--ui-test-streaming-scroll", "--ui-test-streaming-markdown-reflow"]
        app.launch()

        let table = app.tables.firstMatch
        XCTAssertTrue(table.waitForExistence(timeout: 5))

        let anchor = app.staticTexts.containing(
            NSPredicate(format: "label CONTAINS %@", "STREAM_ANCHOR_09")
        ).firstMatch
        XCTAssertTrue(anchor.waitForExistence(timeout: 5))
        XCTAssertTrue(anchor.frame.intersects(table.frame), "The viewport should already be following the response before completion")
        let originalY = anchor.frame.minY

        app.buttons["finishStreamingFixture"].tap()

        XCTAssertEqual(app.staticTexts["streamingCompletionStatus"].label, "Complete")
        XCTAssertTrue(app.staticTexts.containing(
            NSPredicate(format: "label CONTAINS %@", "STREAM_FINAL_MARKDOWN")
        ).firstMatch.waitForExistence(timeout: 2))
        let settledY = anchor.frame.minY

        // The final table replaces the streaming placeholder asynchronously.
        // Let its self-sizing layout settle and make sure it does not trigger a
        // second animated follow-to-bottom after the response is complete.
        Thread.sleep(forTimeInterval: 1.2)

        XCTAssertTrue(anchor.frame.intersects(table.frame), "The response text should remain in the visible viewport")
        XCTAssertLessThan(abs(anchor.frame.minY - settledY), 8, "Markdown's final layout restarted a second scroll to the bottom")
        XCTAssertLessThan(abs(settledY - originalY), 48, "The final Markdown layout displaced the reader's position")
    }

    func testSeededChatHistoryStreamsThroughProductionChatToLatestText() {
        app.launchArguments = ["--ui-test-seeded-chat-history"]
        app.launch()

        let table = app.tables.firstMatch
        XCTAssertTrue(table.waitForExistence(timeout: 8))
        XCTAssertTrue(app.staticTexts.containing(
            NSPredicate(format: "label CONTAINS %@", "SEEDED_HISTORY_ASSISTANT_8")
        ).firstMatch.waitForExistence(timeout: 8))

        let finalSegment = app.staticTexts.containing(
            NSPredicate(format: "label CONTAINS %@", "SEEDED_STREAM_SEGMENT_32")
        ).firstMatch
        XCTAssertTrue(finalSegment.waitForExistence(timeout: 20), "The final streamed text never arrived")

        let sendButton = app.buttons["sendMessageButton"]
        XCTAssertTrue(sendButton.waitForExistence(timeout: 10), "The response should finish after the final text arrives")
        XCTAssertTrue(sendButton.isEnabled)
        XCTAssertTrue(finalSegment.frame.intersects(table.frame), "Final text must stay visible at the end of the seeded-history stream")
        XCTAssertLessThanOrEqual(finalSegment.frame.maxY, table.frame.maxY + 4, "Scroll stopped before the final message text")
    }

    func testHistoryInsertionPreservesScrolledMessagePosition() {
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
        XCTAssertTrue(anchor.frame.intersects(table.frame), "Target text must be visible before history is inserted")
        let originalY = anchor.frame.minY

        app.buttons["insertHistoryRowFixture"].tap()

        XCTAssertTrue(app.staticTexts["A newly arrived older history message."].waitForExistence(timeout: 2))
        XCTAssertTrue(anchor.frame.intersects(table.frame), "History insertion must not displace the reader's message")
        XCTAssertLessThan(abs(anchor.frame.minY - originalY), 24, "History insertion moved the visible text")
    }

    func testThinkingPreviewRemainsBelowVisibleAnswerAfterCompletion() {
        app.launchArguments = ["--ui-test-thinking-label"]
        app.launch()

        let table = app.tables.firstMatch
        XCTAssertTrue(table.waitForExistence(timeout: 5))
        let answer = app.staticTexts.containing(
            NSPredicate(format: "label CONTAINS %@", "ANSWER_VISIBLE")
        ).firstMatch
        let preview = app.buttons["responseThinkingPreview"]
        XCTAssertTrue(answer.waitForExistence(timeout: 5))
        XCTAssertTrue(preview.waitForExistence(timeout: 5))
        XCTAssertTrue(preview.label.contains("THINKING_PREVIEW_VISIBLE"))
        XCTAssertGreaterThan(preview.frame.minY, answer.frame.minY, "The fixture should reproduce the preview below visible answer text")

        app.buttons["completeThinkingResponseFixture"].tap()

        XCTAssertEqual(app.staticTexts["thinkingCompletionStatus"].label, "Complete")
        let previewRemainsVisible = NSPredicate(format: "label CONTAINS %@", "THINKING_PREVIEW_VISIBLE")
        expectation(for: previewRemainsVisible, evaluatedWith: preview)
        waitForExpectations(timeout: 3)
        XCTAssertTrue(answer.exists, "The answer must remain visible after the terminal snapshot")
        XCTAssertGreaterThan(preview.frame.minY, answer.frame.minY)
        XCTAssertFalse(app.staticTexts["Thinking"].exists, "The transient Thinking label must disappear when the response completes")
        Thread.sleep(forTimeInterval: 1)
    }

    private func launchGallery() {
        app.launchArguments = ["--ui-test-gallery"]
        app.launch()
    }
}
