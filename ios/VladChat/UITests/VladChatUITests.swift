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

    func testCompletedSandboxResumeFailureShowsTerminalErrorWithoutLiveSpinner() {
        app.launchArguments = ["--ui-test-computer-sandbox-failure"]
        app.launch()

        let sessionCard = app.descendants(matching: .any)
            .matching(identifier: "computerUseSessionCard")
            .firstMatch
        XCTAssertTrue(sessionCard.waitForExistence(timeout: 5))
        XCTAssertEqual(sessionCard.label, "Computer use")
        XCTAssertTrue(sessionCard.value as? String == "Failed")
        XCTAssertFalse(app.buttons["computerUseSessionCard"].exists)
        sessionCard.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        XCTAssertFalse(app.navigationBars["Computer Open"].exists)
        XCTAssertFalse(app.staticTexts["Connecting to live browser…"].exists)
    }

    func testComputerViewerCollapsesAndOpensKeyboardFromInspector() {
        app.launchArguments = ["--ui-test-computer-viewer"]
        app.launch()

        let preview = app.webViews["computerDesktopPreview"]
        XCTAssertTrue(preview.waitForExistence(timeout: 5))
        let chatCanvas = app.staticTexts["chatCanvas"]
        let composer = app.descendants(matching: .any)["chatComposer"]
        let header = app.navigationBars.firstMatch
        XCTAssertTrue(chatCanvas.exists)
        XCTAssertTrue(composer.exists)
        XCTAssertTrue(header.exists)
        XCTAssertTrue(app.buttons["showChats"].exists)
        XCTAssertFalse(app.staticTexts["Computer"].exists)
        XCTAssertFalse(app.buttons["Hide computer"].exists)
        XCTAssertEqual(preview.frame.width / preview.frame.height, 16.0 / 9.0, accuracy: 0.03)
        XCTAssertGreaterThanOrEqual(preview.frame.minY, header.frame.maxY, "The floating preview should stay below the chat header")
        XCTAssertLessThanOrEqual(preview.frame.maxY, composer.frame.minY - 8, "The floating preview should stay above the composer")
        preview.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).press(
            forDuration: 0.1,
            thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.18, dy: 0.35))
        )
        XCTAssertLessThan(preview.frame.minX, 28, "The floating preview should settle against the left dock after dragging")
        let upperLaneY = preview.frame.midY
        XCTAssertGreaterThanOrEqual(preview.frame.minY, header.frame.maxY)
        XCTAssertLessThan(preview.frame.maxY, composer.frame.minY)
        preview.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).press(
            forDuration: 0.1,
            thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.82, dy: 0.35))
        )
        XCTAssertGreaterThan(preview.frame.maxX, app.frame.maxX - 28, "Dragging from the left dock should follow the swipe to the right dock")
        XCTAssertEqual(preview.frame.midY, upperLaneY, accuracy: 20, "A horizontal swipe should keep the preview at its vertical position")
        preview.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).press(
            forDuration: 0.1,
            thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.82, dy: 0.78))
        )
        XCTAssertGreaterThan(preview.frame.maxX, app.frame.maxX - 28)
        let lowerLaneY = preview.frame.midY
        XCTAssertGreaterThan(lowerLaneY, upperLaneY + 100, "A vertical swipe should keep the preview near its release point")
        XCTAssertLessThanOrEqual(preview.frame.maxY, composer.frame.minY - 8, "The lower dock should remain above the composer")
        preview.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).press(
            forDuration: 0.1,
            thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.18, dy: 0.78))
        )
        XCTAssertLessThan(preview.frame.minX, 28)
        XCTAssertEqual(preview.frame.midY, lowerLaneY, accuracy: 20, "A horizontal swipe should preserve the lower vertical position")
        let foldY = preview.frame.midY
        preview.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).press(
            forDuration: 0.1,
            thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0.78))
        )
        let restorePreview = app.buttons["Restore computer preview"]
        XCTAssertTrue(restorePreview.waitForExistence(timeout: 5))
        XCTAssertLessThan(restorePreview.frame.minX, 28, "A leftward fold should leave restore tab at the same screen edge")
        XCTAssertEqual(restorePreview.frame.midY, foldY, accuracy: 30, "Restore tab should stay at the preview's folded vertical position")
        restorePreview.tap()
        XCTAssertTrue(preview.waitForExistence(timeout: 5))
        XCTAssertLessThan(preview.frame.minX, 28)
        XCTAssertEqual(preview.frame.midY, foldY, accuracy: 30, "Unfolding should restore preview at its previous position")
        preview.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).press(
            forDuration: 0.1,
            thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.18, dy: 0.1))
        )
        XCTAssertGreaterThanOrEqual(
            preview.frame.minY,
            header.frame.maxY + 8,
            "The top dock should leave room for the navigation bar"
        )
        preview.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).press(
            forDuration: 0.1,
            thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0.1))
        )
        XCTAssertTrue(restorePreview.waitForExistence(timeout: 5))
        XCTAssertGreaterThanOrEqual(
            restorePreview.frame.minY,
            header.frame.maxY + 8,
            "A folded tab should stay below the navigation bar"
        )
        restorePreview.tap()
        XCTAssertGreaterThanOrEqual(preview.frame.minY, header.frame.maxY + 8)
        let expandTarget = app.buttons["computerExpandTarget"]
        XCTAssertTrue(expandTarget.waitForExistence(timeout: 5))
        expandTarget.tap()

        XCTAssertFalse(chatCanvas.isHittable, "The chat should be covered by the inspector modal")
        XCTAssertFalse(app.buttons["showChats"].isHittable, "The inspector modal should block the chat navigation control")
        XCTAssertTrue(app.navigationBars["Inspector"].exists)
        XCTAssertTrue(app.webViews["computerInspectorPreview"].exists)
        let trackpad = app.descendants(matching: .any)
            .matching(identifier: "computerTrackpad")
            .firstMatch
        XCTAssertTrue(trackpad.waitForExistence(timeout: 5))
        let initialCursor = trackpad.value as? String
        trackpad.swipeRight()
        XCTAssertNotEqual(trackpad.value as? String, initialCursor, "A trackpad swipe should move the remote cursor")
        XCTAssertFalse(app.staticTexts["Computer"].exists)
        XCTAssertFalse(app.staticTexts["You have control"].exists)
        XCTAssertFalse(app.buttons["Hide computer"].exists)
        XCTAssertTrue(app.buttons["Collapse to preview"].exists)
        app.buttons["Collapse to preview"].tap()
        XCTAssertTrue(preview.waitForExistence(timeout: 5))
        XCTAssertTrue(chatCanvas.isHittable)
        XCTAssertTrue(app.buttons["showChats"].isHittable)
        XCTAssertFalse(app.navigationBars["Inspector"].exists)
        XCTAssertFalse(app.buttons["Collapse to preview"].exists)
        XCTAssertTrue(expandTarget.isHittable)
        XCTAssertLessThanOrEqual(preview.frame.width, 300)
        expandTarget.tap()

        XCTAssertTrue(app.buttons["Collapse to preview"].waitForExistence(timeout: 5))
        let keyboard = app.buttons["Keyboard"]
        XCTAssertTrue(keyboard.waitForExistence(timeout: 5))
        keyboard.tap()
        XCTAssertTrue(app.textFields["Type to computer"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["remoteKey_Escape"].exists)
        app.buttons["Collapse to preview"].tap()
        XCTAssertTrue(preview.waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["Collapse to preview"].exists)
        XCTAssertTrue(expandTarget.isHittable)
    }

    func testOpeningInspectorShowsLoadingWhileVNCConnects() {
        app.launchArguments = ["--ui-test-computer-viewer-connecting"]
        app.launch()

        let openingIndicator = app.descendants(matching: .any)["computerOpeningIndicator"]
        XCTAssertTrue(openingIndicator.waitForExistence(timeout: 5))

        app.buttons["computerExpandTarget"].tap()

        XCTAssertTrue(app.navigationBars["Inspector"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.webViews["computerInspectorPreview"].exists)
        XCTAssertTrue(
            app.descendants(matching: .any)["computerInspectorLoading"].waitForExistence(timeout: 2),
            "Inspector should show loading feedback instead of a blank pause while VNC connects"
        )
        XCTAssertFalse(app.buttons["showChats"].isHittable)
    }

    private func launchGallery() {
        app.launchArguments = ["--ui-test-gallery"]
        app.launch()
    }
}
