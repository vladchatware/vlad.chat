import Foundation
import Testing
@testable import VladChat

struct AgentActivityTests {
    @Test func inAppStatusOnlyExposesOngoingRuns() throws {
        for status in ["completed", "failed", "queued", "idle"] {
            let json = "{\"runId\":\"run-1\",\"status\":\"\(status)\",\"updatedAt\":1000}"
            let state = try JSONDecoder().decode(AgentRunState.self, from: Data(json.utf8))
            #expect(state.ongoingActivityState == nil)
        }
        let paused = try JSONDecoder().decode(AgentRunState.self, from: Data(#"{"runId":"run-1","status":"paused","stepCount":4,"updatedAt":1000}"#.utf8))
        #expect(paused.ongoingActivityState?.phase == .paused)
        #expect(paused.ongoingActivityState?.stepCount == 4)
    }

    @Test func lifecycleUsesRunStatusAndStepPhase() throws {
        let fixtures: [(String, AgentActivityAttributes.Phase?)] = [
            (#"{"status":"running","stepCount":0}"#, .starting),
            (#"{"status":"running","stepCount":0,"inFlightPhase":"model"}"#, .running),
            (#"{"status":"running","stepCount":1,"inFlightPhase":"tool"}"#, .executing),
            (#"{"status":"stopRequested","inFlightPhase":"tool"}"#, .stopping),
            (#"{"status":"paused","inFlightPhase":"model"}"#, .paused),
            (#"{"status":"running","stepCount":2}"#, .running),
            (#"{"status":"completed","inFlightPhase":"tool"}"#, .completed),
            (#"{"status":"failed","inFlightPhase":"model"}"#, .failed),
            (#"{"status":"queued"}"#, nil),
            (#"{"status":"idle"}"#, nil),
            (#"{"status":"future-status"}"#, nil),
        ]
        for (fixture, phase) in fixtures {
            let json = fixture.dropLast() + #", "runId":"run-1","updatedAt":1000}"#
            let state = try JSONDecoder().decode(AgentRunState.self, from: Data(json.utf8))
            #expect(state.liveActivityState?.phase == phase)
            if phase != nil { #expect(state.liveActivityState?.updatedAt == 1) }
        }
    }

    @Test func legacySnapshotsDoNotCreateActivities() throws {
        let state = try JSONDecoder().decode(AgentRunState.self, from: Data(#"{"status":"running"}"#.utf8))
        #expect(state.liveActivityState == nil)
    }

    @Test func publicPayloadExcludesConversationContent() throws {
        let state = try JSONDecoder().decode(AgentRunState.self, from: Data(#"{"runId":"run-1","status":"failed","lastError":"private failure","queuedRuns":[{"text":"private prompt"}],"updatedAt":1000}"#.utf8))
        let content = try #require(state.liveActivityState)
        let data = try JSONEncoder().encode(content)
        let serialized = try #require(String(data: data, encoding: .utf8))
        #expect(!serialized.contains("private"))
        #expect(!serialized.contains("lastError"))
        #expect(!serialized.contains("queuedRuns"))
        #expect(content.phase.isTerminal)
    }

    @Test func deepLinksRoundTripAndRejectUnrelatedURLs() throws {
        let attributes = AgentActivityAttributes(threadId: "a+b/&?=é", runId: "run-1")
        let url = try #require(attributes.conversationURL)
        #expect(AgentActivityAttributes.conversationID(from: url) == attributes.threadId)
        #expect(AgentActivityAttributes.conversationID(from: URL(string: "vladchat://auth?threadId=123")!) == nil)
        #expect(AgentActivityAttributes.conversationID(from: URL(string: "https://conversation?threadId=123")!) == nil)
        #expect(AgentActivityAttributes.conversationID(from: URL(string: "vladchat://conversation?threadId=")!) == nil)
    }
}
