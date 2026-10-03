import type { Doc } from "../_generated/dataModel";

export type AgentActivityPhase =
  | "starting" | "running" | "executing" | "stopping" | "paused"
  | "completed" | "failed";

export type AgentActivityState = {
  phase: AgentActivityPhase;
  stepCount: number;
  updatedAt: number;
};

// Matches AgentActivityAttributes.ContentState in the iOS app/extension. Only
// public status goes to APNs; never include messages, titles, tools or errors.
export function agentActivityState(
  run: Pick<Doc<"agentRuns">, "status" | "inFlightPhase" | "stepCount" | "updatedAt">,
): AgentActivityState | null {
  let phase: AgentActivityPhase;
  switch (run.status) {
    case "queued": return null;
    case "stopRequested": phase = "stopping"; break;
    case "paused": phase = "paused"; break;
    case "completed": phase = "completed"; break;
    case "failed": phase = "failed"; break;
    case "running":
      phase = run.inFlightPhase === "tool" ? "executing"
        : run.inFlightPhase === "model" || run.stepCount > 0 ? "running"
        : "starting";
      break;
  }
  return { phase, stepCount: Math.max(0, run.stepCount), updatedAt: run.updatedAt / 1000 };
}

export function agentActivityPayload(state: AgentActivityState, timestamp: number) {
  const terminal = state.phase === "completed" || state.phase === "failed";
  return {
    aps: {
      timestamp,
      event: terminal ? "end" : "update",
      "content-state": state,
      ...(terminal ? { "dismissal-date": 0 } : { "stale-date": timestamp + 120 }),
    },
  };
}
