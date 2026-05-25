import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SignJWT } from "jose";
import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import { auth, type OAuthClientProvider, type OAuthClientMetadata, type OAuthClientInformation, type OAuthTokens } from "@ai-sdk/mcp";
import { randomBytes } from "crypto";

const NOTION_MCP_URL = "https://mcp.notion.com/mcp";
const OAUTH_SESSION_COOKIE = "notion_oauth_session";
const COOKIE_MAX_AGE = 600;

type SessionData = {
  codeVerifier: string;
  clientInfo?: OAuthClientInformation;
  state?: string;
};

async function getJwtSecret(): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const secret =
    process.env.NOTION_OAUTH_JWT_SECRET ||
    (process.env.CONVEX_DEPLOYMENT
      ? `notion-oauth-${process.env.CONVEX_DEPLOYMENT}`
      : "notion-oauth-default-secret-change-in-production");
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret.padEnd(32).slice(0, 32)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(secret));
  return new Uint8Array(sig);
}

async function encryptSession(data: SessionData): Promise<string> {
  const secret = await getJwtSecret();
  return await new SignJWT(data as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("10m")
    .sign(secret);
}

function buildProvider(siteUrl: string, session: SessionData, captureUrl: (url: URL) => void): OAuthClientProvider {
  return {
    get redirectUrl(): string {
      return `${siteUrl}/api/notion/callback`;
    },

    get clientMetadata(): OAuthClientMetadata {
      return {
        redirect_uris: [`${siteUrl}/api/notion/callback`],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
        client_name: "Vlad.chat",
      };
    },

    async tokens(): Promise<OAuthTokens | undefined> {
      return undefined;
    },

    async saveTokens(_tokens: OAuthTokens): Promise<void> {
      // Tokens will be stored by the callback route
    },

    async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
      captureUrl(authorizationUrl);
    },

    async saveCodeVerifier(codeVerifier: string): Promise<void> {
      session.codeVerifier = codeVerifier;
    },

    async codeVerifier(): Promise<string> {
      return session.codeVerifier;
    },

    async clientInformation(): Promise<OAuthClientInformation | undefined> {
      return session.clientInfo;
    },

    async saveClientInformation(clientInformation: OAuthClientInformation): Promise<void> {
      session.clientInfo = clientInformation;
    },

    async state(): Promise<string> {
      const s = randomBytes(16).toString("hex");
      session.state = s;
      return s;
    },

    async invalidateCredentials(_scope: "all" | "client" | "tokens" | "verifier"): Promise<void> {
      session.codeVerifier = "";
      session.clientInfo = undefined;
      session.state = undefined;
    },
  };
}

export async function GET() {
  try {
    const userToken = await convexAuthNextjsToken();
    if (!userToken) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
    if (!siteUrl) {
      return NextResponse.json({ error: "SITE_URL not configured" }, { status: 500 });
    }

    const session: SessionData = { codeVerifier: "" };
    let authUrl: URL | null = null;

    const provider = buildProvider(siteUrl, session, (url) => {
      authUrl = url;
    });

    const result = await auth(provider, {
      serverUrl: NOTION_MCP_URL,
    });

    if (result !== "REDIRECT" || !authUrl) {
      throw new Error("Failed to initiate Notion OAuth flow");
    }

    const encrypted = await encryptSession(session);
    const cookieStore = await cookies();
    cookieStore.set(OAUTH_SESSION_COOKIE, encrypted, {
      httpOnly: true,
      secure: siteUrl.startsWith("https://"),
      sameSite: "lax",
      maxAge: COOKIE_MAX_AGE,
      path: "/",
    });

    return NextResponse.json({ authUrl: authUrl.toString() });
  } catch (error) {
    console.error("Notion OAuth connect error:", error);
    const message =
      error instanceof Error ? error.message : "Failed to connect Notion";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
