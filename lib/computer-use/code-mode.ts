import { SignJWT, jwtVerify } from "jose";

const GRANT_ISSUER = "vlad.chat/computer-use";
const GRANT_AUDIENCE = "vlad.chat/run-code";
const GRANT_TTL_SECONDS = 5 * 60;

export type CodeModeGrant = {
  userId: string;
  sessionKey: string;
  threadId: string;
};

function grantKey(): Uint8Array {
  const secret = process.env.COMPUTER_USE_AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("Computer-use grants require COMPUTER_USE_AUTH_SECRET (32+ characters).");
  }
  return new TextEncoder().encode(secret);
}

export async function signCodeModeGrant(
  grant: CodeModeGrant,
): Promise<string> {
  return new SignJWT({ sessionKey: grant.sessionKey, threadId: grant.threadId })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(GRANT_ISSUER)
    .setAudience(GRANT_AUDIENCE)
    .setSubject(grant.userId)
    .setIssuedAt()
    .setExpirationTime(`${GRANT_TTL_SECONDS}s`)
    .sign(grantKey());
}

export async function verifyCodeModeGrant(
  token: string,
): Promise<CodeModeGrant | null> {
  try {
    const { payload } = await jwtVerify(token, grantKey(), {
      issuer: GRANT_ISSUER,
      audience: GRANT_AUDIENCE,
      algorithms: ["HS256"],
    });
    if (
      typeof payload.sub !== "string" ||
      typeof payload.sessionKey !== "string" ||
      typeof payload.threadId !== "string"
    ) {
      return null;
    }
    return {
      userId: payload.sub,
      sessionKey: payload.sessionKey,
      threadId: payload.threadId,
    };
  } catch {
    return null;
  }
}
