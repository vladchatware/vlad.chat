"use node";

import { connect } from "node:http2";
import { importPKCS8, SignJWT } from "jose";
import { v } from "convex/values";
import { z } from "zod/v3";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { agentActivityPayload } from "./lib/agentActivityState";

// APNs requires HTTP/2. Hosts and topic are server-owned; a client supplies only
// its ActivityKit token and the signed app's APNs environment.
async function sendToAPNs(
  environment: "sandbox" | "production", token: string, jwt: string,
  body: string, terminal: boolean,
): Promise<{ status: number; invalidToken: boolean }> {
  const host = environment === "sandbox" ? "https://api.sandbox.push.apple.com" : "https://api.push.apple.com";
  const session = connect(host);
  try {
    return await new Promise<{ status: number; invalidToken: boolean }>((resolve, reject) => {
      let responseStatus = 0;
      let responseBody = "";
      let finished = false;
      session.on("error", () => reject(new Error("APNs connection failed.")));
      session.setTimeout(10_000, () => {
        session.destroy();
        reject(new Error("APNs connection timed out."));
      });
      const request = session.request({
        ":method": "POST",
        ":path": `/3/device/${token}`,
        "authorization": `bearer ${jwt}`,
        "apns-topic": `${process.env.APNS_BUNDLE_ID ?? "chat.vlad.ios"}.push-type.liveactivity`,
        "apns-push-type": "liveactivity",
        "apns-priority": terminal ? "10" : "5",
        "apns-expiration": "0",
        "content-type": "application/json",
      });
      request.on("response", (headers) => { responseStatus = Number(headers[":status"] ?? 0); });
      // Parse only the diagnostic reason. Never log or persist the body/token.
      request.setEncoding("utf8");
      request.on("data", (chunk: string) => { responseBody = (responseBody + chunk).slice(0, 1024); });
      request.on("error", () => reject(new Error("APNs request failed.")));
      request.on("aborted", () => reject(new Error("APNs request aborted.")));
      request.on("close", () => {
        if (!finished) reject(new Error("APNs request closed before completion."));
      });
      request.on("end", () => {
        finished = true;
        let invalidToken = responseStatus === 410;
        if (responseStatus === 400) {
          try {
            const diagnostic = z.object({ reason: z.string() }).safeParse(JSON.parse(responseBody));
            invalidToken = diagnostic.success && diagnostic.data.reason === "BadDeviceToken";
          } catch {
            // Malformed diagnostics don't justify deleting a usable token.
            invalidToken = false;
          }
        }
        resolve({ status: responseStatus, invalidToken });
      });
      request.end(body);
    });
  } finally {
    session.close();
  }
}

export const send = internalAction({
  args: { registrationId: v.id("agentActivities"), revision: v.number(), attempt: v.number() },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const keyId = process.env.APNS_KEY_ID;
    const teamId = process.env.APNS_TEAM_ID;
    const privateKey = process.env.APNS_PRIVATE_KEY;
    if (!keyId || !teamId || !privateKey) {
      console.error("Live Activity delivery requires APNS_KEY_ID, APNS_TEAM_ID, and APNS_PRIVATE_KEY.");
      return null;
    }
    const { registrationId, revision } = args;
    const delivery = await ctx.runMutation(internal.agentActivities.prepareDelivery, { registrationId, revision });
    if (!delivery) return null;
    const terminal = delivery.state.phase === "completed" || delivery.state.phase === "failed";
    let status = 0;
    let invalidToken = false;
    try {
      const key = await importPKCS8(privateKey.replace(/\\n/g, "\n"), "ES256");
      const jwt = await new SignJWT({}).setProtectedHeader({ alg: "ES256", kid: keyId })
        .setIssuer(teamId).setIssuedAt().sign(key);
      const response = await sendToAPNs(delivery.environment, delivery.pushToken, jwt,
        JSON.stringify(agentActivityPayload(delivery.state, delivery.timestamp)), terminal);
      status = response.status;
      invalidToken = response.invalidToken;
    } catch {
      console.error("Live Activity APNs delivery failed.");
    }
    if (status === 200 || invalidToken) {
      await ctx.runMutation(internal.agentActivities.finishDelivery, {
        registrationId: args.registrationId, revision: args.revision,
        remove: terminal || status !== 200,
      });
    } else if ((status === 0 || status === 429 || status >= 500) && args.attempt < 3
      && await ctx.runQuery(internal.agentActivities.isCurrentDelivery, { registrationId, revision })) {
      await ctx.scheduler.runAfter(1000 * 2 ** args.attempt, internal.agentActivityPush.send, {
        ...args, attempt: args.attempt + 1,
      });
    } else {
      console.error(`Live Activity APNs delivery stopped after HTTP status ${status}.`);
    }
    return null;
  },
});
