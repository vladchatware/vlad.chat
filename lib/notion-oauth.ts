/**
 * Notion MCP OAuth Configuration
 * 
 * This module handles OAuth integration with Notion's MCP server,
 * enabling users to connect their Notion workspace to Vlad Chat.
 */

// Notion MCP OAuth endpoints
export const NOTION_MCP_ENDPOINTS = {
  register: 'https://mcp.notion.com/register',
  authorize: 'https://mcp.notion.com/authorize',
  token: 'https://mcp.notion.com/token',
  sse: 'https://mcp.notion.com/sse',
} as const;

// Cookie names for OAuth state
export const NOTION_COOKIES = {
  clientId: 'notion_client_id',
  clientSecret: 'notion_client_secret',
} as const;

// LocalStorage keys for client-side state
export const NOTION_STORAGE_KEYS = {
  token: 'notion_token',
  workspace: 'notion_workspace',
} as const;

/**
 * Get the base URL for OAuth redirects.
 * Uses NEXT_PUBLIC_SITE_URL or falls back to localhost in development.
 */
export function getBaseUrl(): string {
  if (process.env.NODE_ENV === 'development') {
    return process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
  }
  return process.env.NEXT_PUBLIC_SITE_URL!;
}

/**
 * Get the OAuth callback URL
 */
export function getCallbackUrl(): string {
  return `${getBaseUrl()}/api/auth/notion/callback`;
}

/**
 * Escape a string for safe inclusion in HTML.
 * Prevents XSS attacks when embedding dynamic content.
 */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Escape a string for safe inclusion in JavaScript string literals.
 * Prevents XSS attacks when embedding in <script> tags.
 */
export function escapeJs(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/</g, '\\x3c')
    .replace(/>/g, '\\x3e');
}

export interface NotionDCRResponse {
  client_id: string;
  client_secret?: string;
  redirect_uris: string[];
  client_name: string;
  client_uri: string;
  grant_types: string[];
  response_types: string[];
  token_endpoint_auth_method: string;
  registration_client_uri: string;
  client_id_issued_at: number;
}

/**
 * Register a new OAuth client with Notion MCP via Dynamic Client Registration.
 */
export async function registerNotionClient(redirectUri: string): Promise<NotionDCRResponse> {
  const res = await fetch(NOTION_MCP_ENDPOINTS.register, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      client_name: 'Vlad Chat',
      client_uri: getBaseUrl(),
    }),
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Notion DCR failed: ${error}`);
  }

  return res.json();
}

export interface NotionTokenResponse {
  access_token: string;
  token_type: string;
  workspace_name?: string;
  refresh_token?: string;
  error?: string;
  error_description?: string;
}

/**
 * Exchange an authorization code for access tokens.
 */
export async function exchangeNotionCode(
  code: string,
  clientId: string,
  clientSecret: string | undefined,
  redirectUri: string
): Promise<NotionTokenResponse> {
  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
  });

  if (clientSecret) {
    params.set('client_secret', clientSecret);
  }

  const res = await fetch(NOTION_MCP_ENDPOINTS.token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  return res.json();
}
