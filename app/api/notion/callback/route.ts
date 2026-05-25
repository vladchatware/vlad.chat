import { cookies } from "next/headers";
import { jwtVerify } from "jose";
import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import { fetchMutation } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { auth, type OAuthClientProvider, type OAuthClientMetadata, type OAuthClientInformation, type OAuthTokens } from "@ai-sdk/mcp";

const NOTION_MCP_URL = "https://mcp.notion.com/mcp";
const OAUTH_SESSION_COOKIE = "notion_oauth_session";

type SessionData = {
  codeVerifier: string;
  clientInfo?: OAuthClientInformation;
  state?: string;
};

type NotionTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  workspace_name?: string;
  workspace_icon?: string;
  workspace_id?: string;
  bot_id?: string;
  scope?: string;
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
    ["sign", "verify"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(secret));
  return new Uint8Array(sig);
}

function closePopupHtml(message: string): Response {
  return new Response(
    `<!DOCTYPE html><html><body>
<script>
  document.title = "Notion Connected";
  document.body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;color:#333"><p>${message}</p></div>';
  setTimeout(() => window.close(), 1500);
</script>
</body></html>`,
    { headers: { "content-type": "text/html" } },
  );
}

function buildProvider(
  siteUrl: string,
  session: SessionData,
  userToken: string,
  notionMeta: { tokenEndpoint: string; clientId: string },
  onTokensSaved?: () => void,
): OAuthClientProvider {
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

    async saveTokens(tokens: OAuthTokens): Promise<void> {
      const expiresAt = tokens.expires_in
        ? Math.floor(Date.now() / 1000) + tokens.expires_in
        : undefined;

      const notionTokens = tokens as unknown as NotionTokenResponse;

      await fetchMutation(
        api.notion.saveConnection,
        {
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token || "",
          expiresAt,
          tokenEndpoint: notionMeta.tokenEndpoint,
          clientId: notionMeta.clientId,
          workspaceName: notionTokens.workspace_name,
          workspaceIcon: notionTokens.workspace_icon,
          workspaceId: notionTokens.workspace_id || "",
          botId: notionTokens.bot_id || "",
          scope: tokens.scope,
        },
        { token: userToken },
      );

      onTokensSaved?.();
    },

    async redirectToAuthorization(_authorizationUrl: URL): Promise<void> {},

    async saveCodeVerifier(_codeVerifier: string): Promise<void> {},

    async codeVerifier(): Promise<string> {
      return session.codeVerifier;
    },

    async clientInformation(): Promise<OAuthClientInformation | undefined> {
      return session.clientInfo;
    },

    async saveClientInformation(_clientInformation: OAuthClientInformation): Promise<void> {},

    async invalidateCredentials(_scope: "all" | "client" | "tokens" | "verifier"): Promise<void> {
      session.codeVerifier = "";
      session.clientInfo = undefined;
      session.state = undefined;
    },
  };
}

export async function GET(req: Request) {
  try {
    const fullUrl = req.url;
    const { searchParams } = new URL(fullUrl);
    const code = searchParams.get("code");
    const error = searchParams.get("error");
    const state = searchParams.get("state");

    console.log("Notion callback received:", {
      url: fullUrl,
      hasCode: !!code,
      hasState: !!state,
      error,
    });

    if (error) {
      return closePopupHtml("Authorization denied. You may close this window.");
    }

    if (!code || !state) {
      return closePopupHtml("Invalid callback. You may close this window.");
    }

    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get(OAUTH_SESSION_COOKIE);

    if (!sessionCookie) {
      return closePopupHtml("Session expired. Please try connecting again.");
    }

    const jwtSecret = await getJwtSecret();
    let session: SessionData;
    try {
      const { payload } = await jwtVerify(sessionCookie.value, jwtSecret);
      session = payload as unknown as SessionData;
    } catch {
      cookieStore.delete(OAUTH_SESSION_COOKIE);
      return closePopupHtml("Session invalid. Please try connecting again.");
    }

    if (session.state && session.state !== state) {
      cookieStore.delete(OAUTH_SESSION_COOKIE);
      return closePopupHtml("Security check failed. Please try connecting again.");
    }

    const userToken = await convexAuthNextjsToken();
    if (!userToken) {
      cookieStore.delete(OAUTH_SESSION_COOKIE);
      return closePopupHtml("Not authenticated. Please sign in first.");
    }

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
    if (!siteUrl) {
      cookieStore.delete(OAUTH_SESSION_COOKIE);
      return closePopupHtml("Configuration error.");
    }

    const notionMeta = {
      tokenEndpoint: `${NOTION_MCP_URL}/token`,
      clientId: session.clientInfo?.client_id || "",
    };

    let savedConnection = false;
    const provider = buildProvider(
      siteUrl,
      session,
      userToken,
      {
        tokenEndpoint: `${NOTION_MCP_URL}/token`,
        clientId: session.clientInfo?.client_id || "",
      },
      () => { savedConnection = true; },
    );

    const result = await auth(provider, {
      serverUrl: NOTION_MCP_URL,
      authorizationCode: code,
    });

    cookieStore.delete(OAUTH_SESSION_COOKIE);

    if (result === "AUTHORIZED" && savedConnection) {
      return closePopupHtml("Connected to Notion!");
    }

    return closePopupHtml("Failed to complete Notion connection.");
  } catch (error) {
    console.error("Notion OAuth callback error:", error);
    return closePopupHtml("Something went wrong. Please try again.");
  }
}
