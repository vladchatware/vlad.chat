import XCTest

final class VladChatUITests: XCTestCase {
    private var app: XCUIApplication!
    private enum PreviewDragBoundary {
        case header
        case composer
    }

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
        XCUIDevice.shared.orientation = .portrait
        defer { XCUIDevice.shared.orientation = .portrait }
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
                let reasoningPreview = app.buttons["responseThinkingPreview"]
                XCTAssertTrue(reasoningPreview.exists)
                XCTAssertTrue(reasoningPreview.label.contains("Checking the relevant constraints"))
            }
        }
    }

    func testComputerScreenshotToolResultsRenderInlineCarousel() {
        XCUIDevice.shared.orientation = .portrait
        defer { XCUIDevice.shared.orientation = .portrait }
        launchGallery()

        let gallery = app.scrollViews.firstMatch
        let fixtureTitle = app.staticTexts["Computer screenshot carousel"]
        for _ in 0..<16 where !fixtureTitle.isHittable {
            gallery.swipeUp()
        }
        XCTAssertTrue(fixtureTitle.isHittable, "Screenshot carousel fixture never became visible")

        let pagers = app.collectionViews.matching(identifier: "computerScreenshotPager")
        for _ in 0..<6 where pagers.count < 2 {
            gallery.swipeUp()
        }
        XCTAssertEqual(pagers.count, 2, "Expected the existing single screenshot plus the three-page fixture")
        let pager = pagers.element(boundBy: 1)
        XCTAssertTrue(pager.waitForExistence(timeout: 5))
        XCTAssertEqual(app.staticTexts["computerScreenshotPageIndicator"].label, "1 / 3")

        for _ in 0..<12 where !pager.isHittable {
            gallery.swipeUp()
        }
        XCTAssertTrue(pager.isHittable, "The three-page screenshot carousel should be on screen before it is swiped")
        pager.swipeLeft()

        XCTAssertEqual(app.staticTexts["computerScreenshotPageIndicator"].label, "2 / 3")
        XCTAssertTrue(app.descendants(matching: .any)["computerScreenshotPage-2"].exists)
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
        XCUIDevice.shared.orientation = .portrait
        defer { XCUIDevice.shared.orientation = .portrait }
        app.launchArguments = ["--ui-test-streaming-scroll"]
        app.launch()

        let table = app.tables.firstMatch
        XCTAssertTrue(table.waitForExistence(timeout: 5))

        let anchor = app.staticTexts.containing(
            NSPredicate(format: "label CONTAINS %@", "STREAM_ANCHOR_06")
        ).firstMatch
        XCTAssertTrue(anchor.waitForExistence(timeout: 5))

        let latestParagraph = app.staticTexts.containing(
            NSPredicate(format: "label CONTAINS %@", "STREAM_ANCHOR_10")
        ).firstMatch
        let latestParagraphIsVisible = NSPredicate { _, _ in
            latestParagraph.frame.intersects(table.frame)
        }
        XCTAssertEqual(
            XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: latestParagraphIsVisible, object: nil)], timeout: 8),
            .completed,
            "The fixture should finish its initial follow-to-bottom before the reader scrolls"
        )

        table.swipeDown()
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

    func testStreamingRowGrowthPreservesReaderPosition() {
        app.launchArguments = ["--ui-test-streaming-scroll"]
        app.launch()

        let table = app.tables.firstMatch
        XCTAssertTrue(table.waitForExistence(timeout: 5))
        let anchor = app.staticTexts.containing(
            NSPredicate(format: "label CONTAINS %@", "STREAM_ANCHOR_06")
        ).firstMatch
        XCTAssertTrue(anchor.waitForExistence(timeout: 5))

        table.swipeDown()
        for _ in 0..<6 where !anchor.frame.intersects(table.frame) {
            table.swipeDown()
        }
        XCTAssertTrue(anchor.frame.intersects(table.frame))
        let originalY = anchor.frame.minY

        let appendChunk = app.buttons["appendStreamingChunkFixture"]
        XCTAssertTrue(appendChunk.exists)
        for _ in 0..<4 {
            appendChunk.tap()
        }

        XCTAssertTrue(app.staticTexts.containing(
            NSPredicate(format: "label CONTAINS %@", "STREAM_APPEND_4")
        ).firstMatch.waitForExistence(timeout: 2))
        let anchorMoved = NSPredicate { _, _ in
            !anchor.frame.intersects(table.frame) || abs(anchor.frame.minY - originalY) > 8
        }
        let deferredLayoutMovedAnchor = XCTNSPredicateExpectation(predicate: anchorMoved, object: nil)
        deferredLayoutMovedAnchor.isInverted = true
        XCTAssertEqual(
            XCTWaiter.wait(for: [deferredLayoutMovedAnchor], timeout: 1),
            .completed,
            "Deferred self-sizing moved the reader's visual anchor"
        )
        XCTAssertTrue(anchor.frame.intersects(table.frame))
        XCTAssertEqual(anchor.frame.minY, originalY, accuracy: 8, "Async row growth moved the reader's visual anchor")
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

        let dictationButton = app.buttons["dictationButton"]
        XCTAssertTrue(dictationButton.waitForExistence(timeout: 10), "The response should finish after the final text arrives")
        XCTAssertTrue(dictationButton.isEnabled)
        // The final Markdown row resolves its height asynchronously. Check the
        // viewport after that layout has settled, not only at stream completion.
        Thread.sleep(forTimeInterval: 1.2)
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

        // Opt out of automatic following even if the target is already visible.
        table.swipeDown()
        for _ in 0..<6 where !anchor.frame.intersects(table.frame) {
            table.swipeDown()
        }
        XCTAssertTrue(anchor.frame.intersects(table.frame), "Target text must be visible before history is inserted")
        let originalY = anchor.frame.minY

        let insertButton = app.buttons["insertHistoryRowFixture"]
        insertButton.tap()

        // The inserted row is above the viewport and need not have a cell yet.
        expectation(for: NSPredicate(format: "isEnabled == false"), evaluatedWith: insertButton)
        waitForExpectations(timeout: 2)
        XCTAssertTrue(anchor.frame.intersects(table.frame), "History insertion must not displace the reader's message")
        XCTAssertLessThan(abs(anchor.frame.minY - originalY), 24, "History insertion moved the visible text")
    }

    func testSameThreadSyncDoesNotPullReaderToLatest() {
        app.launchArguments = ["--ui-test-thread-sync-scroll"]
        app.launch()

        let table = app.tables.firstMatch
        XCTAssertTrue(table.waitForExistence(timeout: 8))
        let anchor = app.staticTexts.containing(
            NSPredicate(format: "label CONTAINS %@", "SYNC_HISTORY_ASSISTANT_4")
        ).firstMatch
        XCTAssertTrue(anchor.waitForExistence(timeout: 8))
        for _ in 0..<8 where !anchor.frame.intersects(table.frame) {
            table.swipeDown()
        }
        XCTAssertTrue(anchor.frame.intersects(table.frame), "An earlier message must be visible before the same-thread snapshot arrives")
        let originalY = anchor.frame.minY

        app.buttons["applySameThreadSyncFixture"].tap()

        XCTAssertTrue(app.staticTexts.containing(
            NSPredicate(format: "label CONTAINS %@", "Update 1")
        ).firstMatch.waitForExistence(timeout: 3))
        XCTAssertTrue(anchor.frame.intersects(table.frame), "A same-thread snapshot should not jump the reader to the latest response")
        XCTAssertLessThan(abs(anchor.frame.minY - originalY), 48, "A same-thread sync update moved the reader's viewport")
    }

    func testJumpToBottomButtonWaitsForIntentionalScroll() {
        app.launchArguments = ["--ui-test-thread-sync-scroll"]
        app.launch()

        let table = app.tables.firstMatch
        XCTAssertTrue(table.waitForExistence(timeout: 8))
        let jumpButton = app.buttons["jumpToLatestButton"]
        XCTAssertFalse(jumpButton.exists, "The button should be hidden at the latest message")

        let start = table.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.55))
        let tinyNudge = table.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.565))
        start.press(
            forDuration: 0.2,
            thenDragTo: tinyNudge,
            withVelocity: .slow,
            thenHoldForDuration: 0.15
        )
        XCTAssertFalse(jumpButton.exists, "A small scroll nudge should stay inside the hidden tolerance zone")

        table.swipeDown()
        XCTAssertTrue(jumpButton.waitForExistence(timeout: 2), "A meaningful scroll away from the latest message should reveal the button")

        for _ in 0..<8 where jumpButton.exists {
            table.swipeUp()
        }
        XCTAssertFalse(jumpButton.exists, "Returning near the latest message should hide the button")
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
        XCUIDevice.shared.orientation = .portrait
        defer { XCUIDevice.shared.orientation = .portrait }
        app.launchArguments = ["--ui-test-computer-viewer"]
        app.launch()

        let preview = app.webViews["computerDesktopPreview"]
        XCTAssertTrue(preview.waitForExistence(timeout: 5))
        let chatCanvas = app.staticTexts["chatCanvas"]
        let composer = app.descendants(matching: .any)["chatComposer"]
        let header = app.navigationBars.firstMatch
        let transcriptAnchor = app.staticTexts["transcriptScrollAnchor"]
        let transcriptTail = app.staticTexts["Transcript row 30"]
        let sessionState = app.staticTexts["computerFixtureSessionState"]
        XCTAssertTrue(chatCanvas.exists)
        XCTAssertTrue(composer.exists)
        XCTAssertTrue(header.exists)
        XCTAssertTrue(transcriptAnchor.exists)
        XCTAssertGreaterThan(transcriptTail.frame.maxY, app.frame.maxY, "The fixture transcript must extend beyond the viewport so drag scrolling can be detected")
        XCTAssertEqual(sessionState.label, "Session: live")
        let transcriptAnchorY = transcriptAnchor.frame.minY
        XCTAssertTrue(app.buttons["showChats"].exists)
        XCTAssertFalse(app.staticTexts["Computer"].exists)
        XCTAssertFalse(app.buttons["Hide computer"].exists)
        XCTAssertEqual(preview.frame.width / preview.frame.height, 16.0 / 9.0, accuracy: 0.03)
        XCTAssertGreaterThanOrEqual(preview.frame.minY, header.frame.maxY, "The floating preview should stay below the chat header")
        XCTAssertLessThanOrEqual(preview.frame.maxY, composer.frame.minY - 8, "The floating preview should stay above the composer")
        let floatingWindow = app.buttons["computerExpandTarget"]
        XCTAssertTrue(floatingWindow.waitForExistence(timeout: 5))
        floatingWindow.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).press(
            forDuration: 0.1,
            thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.18, dy: 0.35))
        )
        XCTAssertEqual(transcriptAnchor.frame.minY, transcriptAnchorY, accuracy: 1, "Dragging the preview must not scroll the transcript")
        XCTAssertLessThan(preview.frame.minX, 28, "The floating preview should settle against the left dock after dragging")
        XCTAssertEqual(sessionState.label, "Session: live", "Docking must preserve the live computer session")
        let upperLaneY = preview.frame.midY
        XCTAssertGreaterThanOrEqual(preview.frame.minY, header.frame.maxY)
        XCTAssertLessThan(preview.frame.maxY, composer.frame.minY)
        floatingWindow.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).press(
            forDuration: 0.1,
            thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.82, dy: 0.35))
        )
        XCTAssertEqual(transcriptAnchor.frame.minY, transcriptAnchorY, accuracy: 1, "Dragging the preview across the chat must not scroll the transcript")
        XCTAssertGreaterThan(preview.frame.maxX, app.frame.maxX - 28, "Dragging from the left dock should follow the swipe to the right dock")
        XCTAssertEqual(preview.frame.midY, upperLaneY, accuracy: 20, "A horizontal swipe should keep the preview at its vertical position")
        floatingWindow.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).press(
            forDuration: 0.1,
            thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.82, dy: 0.78))
        )
        XCTAssertEqual(transcriptAnchor.frame.minY, transcriptAnchorY, accuracy: 1, "Moving the preview vertically must not scroll the transcript")
        XCTAssertGreaterThan(preview.frame.maxX, app.frame.maxX - 28)
        let lowerLaneY = preview.frame.midY
        XCTAssertGreaterThan(lowerLaneY, upperLaneY + 100, "A vertical swipe should keep the preview near its release point")
        XCTAssertLessThanOrEqual(preview.frame.maxY, composer.frame.minY - 8, "The lower dock should remain above the composer")
        floatingWindow.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).press(
            forDuration: 0.1,
            thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.18, dy: 0.78))
        )
        XCTAssertEqual(transcriptAnchor.frame.minY, transcriptAnchorY, accuracy: 1, "Moving the preview back across the chat must not scroll the transcript")
        XCTAssertLessThan(preview.frame.minX, 28)
        XCTAssertEqual(preview.frame.midY, lowerLaneY, accuracy: 20, "A horizontal swipe should preserve the lower vertical position")
        let foldY = preview.frame.midY
        let foldWidth = preview.frame.width
        floatingWindow.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).press(
            forDuration: 0.1,
            thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0.78))
        )
        XCTAssertEqual(transcriptAnchor.frame.minY, transcriptAnchorY, accuracy: 1, "Tucking the preview must not scroll the transcript")
        let restorePreview = app.buttons["Restore computer preview"]
        XCTAssertTrue(restorePreview.waitForExistence(timeout: 5))
        XCTAssertEqual(restorePreview.frame.width, 44, accuracy: 1, "The edge handle should expose a 44pt-wide touch target")
        XCTAssertEqual(restorePreview.frame.height, 96, accuracy: 1, "The edge handle should match the reference proportions")
        XCTAssertEqual(restorePreview.value as? String, "Left edge", "VoiceOver should announce where the tucked preview can be restored")
        XCTAssertFalse(app.buttons["chevron.right"].exists, "The chevron must not appear as a duplicate VoiceOver action")
        XCTAssertLessThan(restorePreview.frame.minX, 28, "A leftward fold should leave restore tab at the same screen edge")
        XCTAssertEqual(restorePreview.frame.midY, foldY, accuracy: 30, "Restore tab should stay at the preview's folded vertical position")
        restorePreview.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.5)).tap()
        XCTAssertTrue(preview.waitForExistence(timeout: 5))
        XCTAssertEqual(sessionState.label, "Session: live", "Restoring the preview must preserve the live computer session")
        XCTAssertLessThan(preview.frame.minX, 28)
        XCTAssertEqual(preview.frame.midY, foldY, accuracy: 30, "Unfolding should restore preview at its previous position")
        XCTAssertEqual(preview.frame.width, foldWidth, accuracy: 1, "Unfolding should preserve preview size")
        preview.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).press(
            forDuration: 0.1,
            thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 1.0, dy: 0.78))
        )
        XCTAssertEqual(transcriptAnchor.frame.minY, transcriptAnchorY, accuracy: 1, "Trailing-edge tuck must not scroll the transcript")
        let restoreRightPreview = app.buttons["Restore computer preview"]
        XCTAssertTrue(restoreRightPreview.waitForExistence(timeout: 5))
        XCTAssertEqual(restoreRightPreview.frame.width, 44, accuracy: 1, "The trailing handle should retain a 44pt-wide touch target")
        XCTAssertEqual(restoreRightPreview.frame.height, 96, accuracy: 1, "The trailing handle should match the reference proportions")
        XCTAssertGreaterThan(restoreRightPreview.frame.maxX, app.frame.maxX - 28, "A rightward fold should leave the restore handle on the trailing edge")
        XCTAssertEqual(restoreRightPreview.frame.midY, foldY, accuracy: 30, "The trailing restore handle should remember the preview height")
        XCTAssertEqual(restoreRightPreview.value as? String, "Right edge", "VoiceOver should announce where the tucked preview can be restored")
        XCTAssertFalse(app.buttons["chevron.left"].exists, "The chevron must not appear as a duplicate VoiceOver action")
        restoreRightPreview.coordinate(withNormalizedOffset: CGVector(dx: 0.1, dy: 0.5)).tap()
        XCTAssertTrue(preview.waitForExistence(timeout: 5))
        XCTAssertEqual(sessionState.label, "Session: live", "Trailing-edge restore must preserve the live computer session")
        XCTAssertGreaterThan(preview.frame.maxX, app.frame.maxX - 28)
        XCTAssertEqual(preview.frame.midY, foldY, accuracy: 30, "Trailing restore should return to the remembered preview height")
        XCTAssertEqual(preview.frame.width, foldWidth, accuracy: 1, "Trailing restore should preserve preview size")
        preview.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).press(
            forDuration: 0.1,
            thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.99)),
            withVelocity: .slow,
            thenHoldForDuration: 0.4
        )
        assertDragMotionStayedWithinBounds(floatingWindow, preview: preview, toward: .composer)
        XCTAssertEqual(transcriptAnchor.frame.minY, transcriptAnchorY, accuracy: 1, "Held composer-boundary dragging must not scroll the transcript")
        XCTAssertEqual(sessionState.label, "Session: live")
        XCTAssertGreaterThanOrEqual(
            preview.frame.minY,
            header.frame.maxY + 8,
            "The top dock should leave room for the navigation bar"
        )
        preview.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).press(
            forDuration: 0.1,
            thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.01)),
            withVelocity: .slow,
            thenHoldForDuration: 0.4
        )
        assertDragMotionStayedWithinBounds(floatingWindow, preview: preview, toward: .header)
        XCTAssertEqual(transcriptAnchor.frame.minY, transcriptAnchorY, accuracy: 1, "Held header-boundary dragging must not scroll the transcript")
        XCTAssertLessThanOrEqual(
            preview.frame.maxY,
            composer.frame.minY - 8,
            "The lower dock should leave room for the composer after release"
        )
        let expandTarget = app.buttons["computerExpandTarget"]
        XCTAssertTrue(expandTarget.waitForExistence(timeout: 5))
        expandTarget.tap()

        XCTAssertEqual(sessionState.label, "Session: live", "Opening the inspector must preserve the live computer session")
        XCTAssertFalse(chatCanvas.isHittable, "The chat should be covered by the inspector modal")
        XCTAssertFalse(app.buttons["showChats"].isHittable, "The inspector modal should block the chat navigation control")
        XCTAssertTrue(app.navigationBars["Computer"].exists)
        XCTAssertTrue(app.webViews["computerInspectorPreview"].exists)
        let trackpad = app.descendants(matching: .any)
            .matching(identifier: "computerTrackpad")
            .firstMatch
        XCTAssertTrue(trackpad.waitForExistence(timeout: 5))
        let initialCursor = trackpad.value as? String
        trackpad.swipeRight()
        XCTAssertNotEqual(trackpad.value as? String, initialCursor, "A trackpad swipe should move the remote cursor")
        XCTAssertFalse(app.staticTexts["You have control"].exists)
        XCTAssertFalse(app.buttons["Hide computer"].exists)
        XCTAssertTrue(app.buttons["Collapse to preview"].exists)
        app.buttons["Collapse to preview"].tap()
        XCTAssertTrue(preview.waitForExistence(timeout: 5))
        XCTAssertEqual(sessionState.label, "Session: live", "Collapsing the inspector must preserve the live computer session")
        XCTAssertTrue(chatCanvas.isHittable)
        XCTAssertTrue(app.buttons["showChats"].isHittable)
        XCTAssertFalse(app.navigationBars["Computer"].exists)
        XCTAssertFalse(app.buttons["Collapse to preview"].exists)
        XCTAssertTrue(expandTarget.isHittable)
        XCTAssertLessThanOrEqual(preview.frame.width, 300)
        expandTarget.tap()

        XCTAssertEqual(sessionState.label, "Session: live", "Reopening the inspector must preserve the live computer session")
        XCTAssertTrue(app.buttons["Collapse to preview"].waitForExistence(timeout: 5))
        let keyboard = app.buttons["Keyboard"]
        XCTAssertTrue(keyboard.waitForExistence(timeout: 5))
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
        keyboard.tap()
        XCTAssertEqual(keyboard.value as? String, "Hidden")
        let hiddenKeyboard = NSPredicate { _, _ in !self.app.keyboards.firstMatch.exists }
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: hiddenKeyboard, object: nil)], timeout: 5), .completed)
        keyboard.tap()
        let remoteInput = app.textFields["computerRemoteText"]
        XCTAssertTrue(remoteInput.waitForExistence(timeout: 5))
        XCTAssertLessThanOrEqual(remoteInput.frame.width, 1.5, "The native keyboard target should not occupy an input row")
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["remoteKey_Escape"].exists)
        app.buttons["Collapse to preview"].tap()
        XCTAssertTrue(preview.waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["Collapse to preview"].exists)
        XCTAssertTrue(expandTarget.isHittable)
    }

    func testInspectorAutomaticallyFocusesKeyboardAndReleasesModifiersAcrossReopen() {
        app.launchArguments = ["--ui-test-computer-viewer"]
        app.launch()
        let expand = app.buttons["computerExpandTarget"]
        XCTAssertTrue(expand.waitForExistence(timeout: 5))
        expand.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
        let control = app.buttons["remoteKey_ControlLeft"]
        XCTAssertTrue(control.waitForExistence(timeout: 5))
        control.tap()
        XCTAssertEqual(control.value as? String, "Pressed")
        app.buttons["Collapse to preview"].tap()
        XCTAssertTrue(expand.waitForExistence(timeout: 5))
        expand.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
        XCTAssertEqual(control.value as? String, "Released")
    }

    func testPortraitTypingUsesKeyboardWithoutVisibleInputField() {
        app.launchArguments = ["--ui-test-computer-viewer"]
        app.launch()

        let expand = app.buttons["computerExpandTarget"]
        XCTAssertTrue(expand.waitForExistence(timeout: 5))
        expand.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))

        let remoteInput = app.textFields["computerRemoteText"]
        XCTAssertTrue(remoteInput.waitForExistence(timeout: 5))
        XCTAssertLessThanOrEqual(remoteInput.frame.width, 1.5, "Portrait typing should not occupy an input row")
        app.keys["o"].tap()
        app.keys["k"].tap()

        let desktop = app.webViews["computerInspectorPreview"]
        for event in ["Text: o", "Text: k"] {
            XCTAssertTrue(
                desktop.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", event)).firstMatch.waitForExistence(timeout: 5),
                "Portrait keyboard input should send \(event) to the active computer"
            )
        }
    }

    func testInspectorUsesDirectLandscapeKeyboardWithoutSystemKeyboard() {
        app.launchArguments = ["--ui-test-computer-viewer"]
        XCUIDevice.shared.orientation = .portrait
        defer { XCUIDevice.shared.orientation = .portrait }
        app.launch()
        let expand = app.buttons["computerExpandTarget"]
        XCTAssertTrue(expand.waitForExistence(timeout: 5))
        expand.tap()
        XCTAssertTrue(app.navigationBars["Computer"].waitForExistence(timeout: 8), "Opening the inspector should present its navigation screen")
        let desktop = app.webViews["computerInspectorPreview"]
        XCTAssertTrue(desktop.staticTexts["No input yet"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))

        func assertReceived(_ event: String) {
            let received = desktop.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", event)).firstMatch
            XCTAssertTrue(received.waitForExistence(timeout: 5), "Viewer should receive \(event)")
        }

        app.buttons["Click"].tap()
        assertReceived("Pointer: 640, 360, 1 | Pointer: 640, 360, 0")
        app.buttons["Right click"].tap()
        assertReceived("Pointer: 640, 360, 4 | Pointer: 640, 360, 0")
        app.buttons["remoteKey_Escape"].tap()
        assertReceived("Key: Escape, true | Key: Escape, false")
        app.buttons["Fit"].tap()
        assertReceived("Fit applied")

        app.keys["o"].tap()
        app.keys["k"].tap()
        assertReceived("Text: o")
        assertReceived("Text: k")

        let keyboard = app.buttons["Keyboard"]
        keyboard.tap()
        XCTAssertEqual(keyboard.value as? String, "Hidden")
        let keyboardHidden = NSPredicate { _, _ in !self.app.keyboards.firstMatch.exists }
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: keyboardHidden, object: nil)], timeout: 5), .completed)
        XCUIDevice.shared.orientation = .landscapeLeft
        let landscapeKeyboardKey = app.buttons["computerKey_q"]
        XCTAssertTrue(landscapeKeyboardKey.waitForExistence(timeout: 10), "Landscape should show the app-owned keyboard beside the remote screen")
        XCTAssertEqual(keyboard.value as? String, "Shown")
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: keyboardHidden, object: nil)], timeout: 5), .completed)
        XCTAssertFalse(app.textFields["computerRemoteText"].exists, "Landscape typing must not require a dedicated text field")
        XCTAssertFalse(app.navigationBars["Computer"].exists, "Landscape should reclaim the navigation-title strip")
        XCTAssertFalse(app.descendants(matching: .any)["computerKeyAccessory"].exists, "Landscape shortcuts belong with the right-side keyboard, not in a second full-width strip")
        XCTAssertTrue(app.buttons["remoteKey_Escape"].isHittable)
        XCTAssertTrue(app.buttons["computerKeyboardEnter"].isHittable)
        XCTAssertTrue(app.buttons["Collapse to preview"].isHittable, "The compact landscape control should remain available without the navigation bar")
        XCTAssertTrue(desktop.exists)
        app.buttons["remoteKey_Escape"].tap()
        assertReceived("Key: Escape, true | Key: Escape, false")
        landscapeKeyboardKey.tap()
        assertReceived("Text: q")
        app.buttons["computerKeyboardSpace"].tap()
        assertReceived("Text: [space]")
        keyboard.tap()
        XCTAssertFalse(landscapeKeyboardKey.exists, "The Keyboard control should reclaim landscape screen space")
        XCTAssertFalse(app.keyboards.firstMatch.exists, "The app-owned keyboard must not open iOS keyboard")
        XCTAssertEqual(keyboard.value as? String, "Hidden")
        keyboard.tap()
        XCTAssertTrue(landscapeKeyboardKey.waitForExistence(timeout: 5))

        let fullscreen = app.buttons["computerFullscreen"]
        XCTAssertTrue(fullscreen.isHittable)
        XCTAssertLessThan(desktop.frame.maxY, fullscreen.frame.midY, "Landscape controls should sit below the remote screen")
        XCTAssertLessThan(fullscreen.frame.maxX, landscapeKeyboardKey.frame.minX, "Controls should stay within the left workspace")
        let workspaceWidth = desktop.frame.width
        fullscreen.tap()
        let restore = app.buttons["computerRestoreLayout"]
        XCTAssertTrue(restore.waitForExistence(timeout: 5))
        XCTAssertFalse(landscapeKeyboardKey.exists)
        XCTAssertFalse(keyboard.exists)
        XCTAssertFalse(app.buttons["Collapse to preview"].exists)
        XCTAssertGreaterThan(desktop.frame.width, workspaceWidth * 1.3, "Full screen should expand the remote viewport")
        restore.tap()
        XCTAssertTrue(landscapeKeyboardKey.waitForExistence(timeout: 5))
        XCTAssertEqual(keyboard.value as? String, "Shown")
        landscapeKeyboardKey.tap()
        assertReceived("Text: q")

        keyboard.tap()
        fullscreen.tap()
        XCTAssertTrue(restore.waitForExistence(timeout: 5))
        restore.tap()
        XCTAssertTrue(keyboard.waitForExistence(timeout: 5))
        XCTAssertEqual(keyboard.value as? String, "Hidden", "Restore should preserve a hidden keyboard")
        XCTAssertFalse(landscapeKeyboardKey.exists)
    }

    func testInspectorExplainsAndDisablesControlsWhileAgentOwnsComputer() {
        app.launchArguments = ["--ui-test-computer-agent-controlling"]
        app.launch()

        let expand = app.buttons["computerExpandTarget"]
        XCTAssertTrue(expand.waitForExistence(timeout: 5))
        expand.tap()
        XCTAssertTrue(app.navigationBars["Computer"].waitForExistence(timeout: 8))

        XCTAssertTrue(app.staticTexts["computerControlUnavailable"].waitForExistence(timeout: 5))
        XCTAssertEqual(app.staticTexts["computerControlUnavailable"].label, "The agent is controlling this computer.")

        for title in ["Click", "Right click", "Keyboard"] {
            XCTAssertTrue(app.buttons[title].exists)
            XCTAssertFalse(app.buttons[title].isEnabled, "\(title) must be disabled while the agent owns computer input")
        }
        XCTAssertTrue(app.buttons["Fit"].isEnabled, "Fit changes local viewer scaling and does not require input ownership")
        XCTAssertFalse(app.textFields["computerRemoteText"].isEnabled)
        XCTAssertFalse(app.buttons["remoteKey_Escape"].isEnabled)

        app.buttons["Fit"].tap()
        let fit = app.webViews["computerInspectorPreview"].staticTexts
            .matching(NSPredicate(format: "label CONTAINS %@", "Fit applied"))
            .firstMatch
        XCTAssertTrue(fit.waitForExistence(timeout: 5), "Available viewer controls must still reach the current session")
    }

    func testInspectorKeepsPreviewAndKeyboardControlAvailableAfterRotation() {
        app.launchArguments = ["--ui-test-computer-viewer"]
        XCUIDevice.shared.orientation = .portrait
        defer { XCUIDevice.shared.orientation = .portrait }
        app.launch()
        let expand = app.buttons["computerExpandTarget"]
        XCTAssertTrue(expand.waitForExistence(timeout: 5))
        expand.tap()

        let desktop = app.webViews["computerInspectorPreview"]
        let escape = app.buttons["remoteKey_Escape"]
        let keyboard = app.buttons["Keyboard"]

        for orientation in [UIDeviceOrientation.portrait, .landscapeLeft] {
            XCUIDevice.shared.orientation = orientation
            XCTAssertTrue(desktop.waitForExistence(timeout: 5))
            XCTAssertTrue(escape.isHittable, "The key accessory must remain available after rotation")
            XCTAssertTrue(keyboard.isHittable, "The Keyboard control must remain available after rotation")
            XCTAssertTrue(app.buttons["Click"].isHittable)
            XCTAssertGreaterThan(desktop.frame.height, 0)

            let isLandscape = orientation.isLandscape
            let customKeyboardKey = app.buttons["computerKey_q"]
            let keyboardSettled = NSPredicate { _, _ in
                let isVisible = isLandscape ? customKeyboardKey.exists : self.app.keyboards.firstMatch.exists
                return keyboard.value as? String == (isVisible ? "Shown" : "Hidden")
            }
            XCTAssertEqual(
                XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: keyboardSettled, object: nil)], timeout: 5),
                .completed,
                "The Keyboard control should reflect the keyboard used in the current orientation"
            )

            if isLandscape {
                XCTAssertTrue(customKeyboardKey.exists)
                XCTAssertFalse(app.keyboards.firstMatch.exists)
                keyboard.tap()
                XCTAssertFalse(customKeyboardKey.exists)
                XCTAssertFalse(app.keyboards.firstMatch.exists)
                XCTAssertEqual(keyboard.value as? String, "Hidden")
            } else if app.keyboards.firstMatch.exists {
                XCTAssertLessThanOrEqual(desktop.frame.maxY, escape.frame.minY)
                XCTAssertLessThanOrEqual(escape.frame.maxY, app.keyboards.firstMatch.frame.minY)
                keyboard.tap()
                let hidden = NSPredicate { _, _ in !self.app.keyboards.firstMatch.exists }
                XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: hidden, object: nil)], timeout: 5), .completed)
                let keyboardHiddenState = NSPredicate { _, _ in keyboard.value as? String == "Hidden" }
                XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: keyboardHiddenState, object: nil)], timeout: 5), .completed)
            }

            keyboard.tap()
            if isLandscape {
                XCTAssertTrue(customKeyboardKey.waitForExistence(timeout: 5), "The Keyboard control must reopen the app-owned keyboard")
                XCTAssertFalse(app.keyboards.firstMatch.exists)
            } else {
                XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5), "The Keyboard control must reopen the software keyboard")
            }
            let keyboardShown = NSPredicate { _, _ in keyboard.value as? String == "Shown" }
            XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: keyboardShown, object: nil)], timeout: 5), .completed)
            XCTAssertTrue(desktop.exists)
        }
    }

    func testProductionInspectorKeepsOneHostAndRenderedScreenAcrossRepeatedRotations() {
        app.launchArguments = ["--ui-test-computer-production"]
        XCUIDevice.shared.orientation = .portrait
        defer { XCUIDevice.shared.orientation = .portrait }
        app.launch()
        let expand = app.buttons["computerExpandTarget"]
        XCTAssertTrue(expand.waitForExistence(timeout: 5))
        expand.tap()
        XCTAssertTrue(app.navigationBars["Computer"].waitForExistence(timeout: 8), "Opening the production inspector should present its navigation screen")
        let desktop = app.webViews["computerInspectorPreview"]
        XCTAssertTrue(desktop.staticTexts["No input yet"].waitForExistence(timeout: 5))
        let keyboard = app.buttons["Keyboard"]
        XCTAssertTrue(keyboard.waitForExistence(timeout: 5))
        if !app.keyboards.firstMatch.exists {
            XCTAssertEqual(keyboard.value as? String, "Hidden")
            keyboard.tap()
        }
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5), "The Keyboard control should open the software keyboard")
        let keyboardShown = NSPredicate { _, _ in keyboard.value as? String == "Shown" }
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: keyboardShown, object: nil)], timeout: 5), .completed)
        app.buttons["Click"].tap()
        let capture = desktop.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "Pointer: 640, 360, 1")).firstMatch
        XCTAssertTrue(capture.waitForExistence(timeout: 5))

        for orientation in [UIDeviceOrientation.landscapeLeft, .portrait, .landscapeRight, .portrait] {
            XCUIDevice.shared.orientation = orientation
            XCTAssertTrue(capture.waitForExistence(timeout: 5), "Rotation must retain the loaded viewer document")
            XCTAssertEqual(app.webViews.matching(identifier: "computerInspectorPreview").count, 1)
            XCTAssertEqual(app.navigationBars.matching(identifier: "Computer").count, 1)
            XCTAssertEqual(app.buttons.matching(identifier: "Collapse to preview").count, 1)
            XCTAssertFalse(app.buttons["showChats"].isHittable)
            XCTAssertTrue(keyboard.isHittable, "The Keyboard control must remain available after rotation")
            XCTAssertGreaterThan(desktop.frame.height, 40, "The remote screen must retain usable space after rotation")

            let isLandscape = orientation.isLandscape
            let customKeyboardKey = app.buttons["computerKey_q"]
            let keyboardSettled = NSPredicate { _, _ in
                let isVisible = isLandscape ? customKeyboardKey.exists : self.app.keyboards.firstMatch.exists
                return keyboard.value as? String == (isVisible ? "Shown" : "Hidden")
            }
            XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: keyboardSettled, object: nil)], timeout: 5), .completed)

            if isLandscape {
                XCTAssertTrue(customKeyboardKey.exists)
                XCTAssertFalse(app.keyboards.firstMatch.exists)
                app.buttons["computerKey_q"].tap()
                let typed = desktop.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "Text: q")).firstMatch
                XCTAssertTrue(typed.waitForExistence(timeout: 5), "Landscape keyboard keys must reach the existing viewer")
                keyboard.tap()
                XCTAssertFalse(customKeyboardKey.exists)
            } else if app.keyboards.firstMatch.exists {
                keyboard.tap()
                let keyboardHidden = NSPredicate { _, _ in !self.app.keyboards.firstMatch.exists }
                XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: keyboardHidden, object: nil)], timeout: 5), .completed)
                let keyboardHiddenState = NSPredicate { _, _ in keyboard.value as? String == "Hidden" }
                XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: keyboardHiddenState, object: nil)], timeout: 5), .completed)
            }

            keyboard.tap()
            if isLandscape {
                XCTAssertTrue(customKeyboardKey.waitForExistence(timeout: 5), "The Keyboard control must reopen the app-owned keyboard")
                XCTAssertFalse(app.keyboards.firstMatch.exists)
            } else {
                XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5), "The Keyboard control must reopen the software keyboard")
            }
            let keyboardShown = NSPredicate { _, _ in keyboard.value as? String == "Shown" }
            XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: keyboardShown, object: nil)], timeout: 5), .completed)
            XCTAssertTrue(capture.exists)
            app.buttons["Fit"].tap()
            let fit = desktop.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "Fit applied")).firstMatch
            XCTAssertTrue(fit.waitForExistence(timeout: 5))
        }
        app.buttons["Collapse to preview"].tap()
        XCTAssertTrue(expand.waitForExistence(timeout: 5))
        XCTAssertFalse(app.navigationBars["Computer"].exists)
    }

    func testRegularWidthInspectorDoesNotDuplicateSystemSidebarControl() {
        XCUIDevice.shared.orientation = .portrait
        defer { XCUIDevice.shared.orientation = .portrait }
        app.launchArguments = ["--ui-test-computer-production"]
        app.launch()

        let expand = app.buttons["computerExpandTarget"]
        XCTAssertTrue(expand.waitForExistence(timeout: 5))
        expand.tap()

        let desktop = app.webViews["computerInspectorPreview"]
        XCTAssertTrue(desktop.waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["showChats"].exists, "Regular-width NavigationSplitView supplies its own sidebar control")
        let showSidebar = app.buttons.matching(NSPredicate(format: "label == %@", "Show Sidebar"))
        XCTAssertEqual(showSidebar.count, 1)
        XCTAssertEqual(app.webViews.matching(identifier: "computerInspectorPreview").count, 1)

        showSidebar.firstMatch.tap()
        let hideSidebar = app.buttons["Hide Sidebar"]
        XCTAssertTrue(hideSidebar.waitForExistence(timeout: 5), "The single native sidebar control must open the chat sidebar")
        hideSidebar.tap()
        XCTAssertTrue(showSidebar.firstMatch.waitForExistence(timeout: 5), "The native sidebar control must close the chat sidebar")

        let hierarchy = XCTAttachment(string: app.debugDescription)
        hierarchy.name = "Regular-width Computer inspector accessibility tree"
        hierarchy.lifetime = .keepAlways
        add(hierarchy)

        let screenshot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        screenshot.name = "Regular-width Computer inspector"
        screenshot.lifetime = .keepAlways
        add(screenshot)

        for orientation in [UIDeviceOrientation.landscapeLeft, .portrait, .landscapeRight, .portrait] {
            XCUIDevice.shared.orientation = orientation
            XCTAssertTrue(desktop.waitForExistence(timeout: 5), "Rotation must preserve the inline inspector")
            XCTAssertFalse(app.buttons["showChats"].exists, "Rotation must not mount a second custom sidebar control")
            let showSidebar = app.buttons.matching(NSPredicate(format: "label == %@", "Show Sidebar"))
            XCTAssertEqual(showSidebar.count, 1, "Rotation must retain exactly one native sidebar control")
            XCTAssertEqual(app.webViews.matching(identifier: "computerInspectorPreview").count, 1)
            XCTAssertTrue(app.buttons["Click"].isHittable)
            XCTAssertTrue(app.buttons["Fit"].isHittable)
        }
    }

    func testOpeningInspectorShowsLoadingWhileVNCConnects() {
        app.launchArguments = ["--ui-test-computer-viewer-connecting"]
        app.launch()

        let openingIndicator = app.descendants(matching: .any)["computerOpeningIndicator"]
        XCTAssertTrue(openingIndicator.waitForExistence(timeout: 5))

        app.buttons["computerExpandTarget"].tap()

        XCTAssertTrue(app.navigationBars["Computer"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.webViews["computerInspectorPreview"].exists)
        XCTAssertTrue(
            app.descendants(matching: .any)["computerInspectorLoading"].waitForExistence(timeout: 2),
            "Inspector should show loading feedback instead of a blank pause while VNC connects"
        )
        XCTAssertFalse(app.buttons["showChats"].isHittable)
    }

    func testViewerConnectionTimeoutReplacesBlankDesktopWithFailureState() {
        app.launchArguments = ["--ui-test-computer-viewer-timeout"]
        app.launch()

        XCTAssertTrue(app.descendants(matching: .any)["computerOpeningIndicator"].waitForExistence(timeout: 5))
        app.buttons["computerExpandTarget"].tap()
        XCTAssertTrue(app.navigationBars["Computer"].waitForExistence(timeout: 5))
        let loading = app.descendants(matching: .any)["computerInspectorLoading"]
        let failure = app.descendants(matching: .any)["computerConnectionFailed"]
        XCTAssertTrue(loading.exists || failure.exists, "Inspector must show either connection progress or its bounded failure state")
        XCTAssertTrue(failure.waitForExistence(timeout: 6))
        XCTAssertFalse(app.descendants(matching: .any)["computerInspectorLoading"].exists)
        XCTAssertFalse(app.webViews["computerInspectorPreview"].exists)
        XCTAssertTrue(app.staticTexts["Computer unavailable"].exists)
        XCTAssertFalse(app.buttons["Retry"].exists, "A timeout before receiving a session URL cannot retry stale viewer state")
    }

    private func launchGallery() {
        app.launchArguments = ["--ui-test-gallery"]
        app.launch()
    }

    private func assertDragMotionStayedWithinBounds(
        _ target: XCUIElement,
        preview: XCUIElement,
        toward boundary: PreviewDragBoundary,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        guard let trace = target.value as? String else {
            XCTFail("The active drag should expose motion samples", file: file, line: line)
            return
        }

        let attachment = XCTAttachment(string: trace)
        attachment.name = "V-104 live preview drag frames"
        attachment.lifetime = .keepAlways
        add(attachment)

        let samples = trace.split(separator: ";").compactMap { entry -> [Int]? in
            let values = entry.split(separator: ",").compactMap { Int($0) }
            return values.count == 4 ? values : nil
        }
        XCTAssertGreaterThan(samples.count, 1, "The trace must contain multiple frames from the active drag", file: file, line: line)
        switch boundary {
        case .header:
            let closestHeaderSample = samples.map { abs($0[0] - $0[2]) }.min() ?? Int.max
            XCTAssertLessThanOrEqual(closestHeaderSample, 1, "The held drag should reach the header boundary", file: file, line: line)
        case .composer:
            let closestComposerSample = samples.map { abs($0[3] - $0[1]) }.min() ?? Int.max
            XCTAssertLessThanOrEqual(closestComposerSample, 1, "The held drag should reach the composer boundary", file: file, line: line)
        }
        if let lastSample = samples.last {
            XCTAssertEqual(
                preview.frame.minY,
                CGFloat(lastSample[0]),
                accuracy: 24,
                "The preview should remain at the last bounded frame after release",
                file: file,
                line: line
            )
        }
        for sample in samples {
            XCTAssertGreaterThanOrEqual(sample[0], sample[2] - 1, "Preview crossed the header boundary during drag", file: file, line: line)
            XCTAssertLessThanOrEqual(sample[1], sample[3] + 1, "Preview crossed the composer boundary during drag", file: file, line: line)
        }
    }
}
