import { NextResponse } from 'next/server';
import {
  NOTION_MCP_ENDPOINTS,
  NOTION_COOKIES,
  getCallbackUrl,
  registerNotionClient,
} from '@/lib/notion-oauth';

export async function GET() {
  try {
    const redirectUri = getCallbackUrl();
    const client = await registerNotionClient(redirectUri);

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: client.client_id,
      redirect_uri: redirectUri,
    });

    const authUrl = `${NOTION_MCP_ENDPOINTS.authorize}?${params.toString()}`;
    const response = NextResponse.redirect(authUrl);

    const cookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax' as const,
      maxAge: 600,
      path: '/',
    };

    response.cookies.set(NOTION_COOKIES.clientId, client.client_id, cookieOptions);
    if (client.client_secret) {
      response.cookies.set(NOTION_COOKIES.clientSecret, client.client_secret, cookieOptions);
    }

    return response;
  } catch (error) {
    console.error('Notion OAuth initialization failed:', error);
    return NextResponse.json(
      { error: 'Failed to initiate Notion connection' },
      { status: 500 }
    );
  }
}
