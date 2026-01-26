import { NextRequest, NextResponse } from 'next/server';

// These must match the callback route
const TOKEN_COOKIE = 'notion_token_pending';
const WORKSPACE_COOKIE = 'notion_workspace_pending';

/**
 * Consume the pending Notion token from cookies.
 * Returns the token and workspace, then clears the cookies.
 * This ensures the token is only exposed once and not stored in URLs or logs.
 */
export async function POST(request: NextRequest) {
  const token = request.cookies.get(TOKEN_COOKIE)?.value;
  const workspace = request.cookies.get(WORKSPACE_COOKIE)?.value;

  if (!token) {
    return NextResponse.json(
      { error: 'No pending token found' },
      { status: 404 }
    );
  }

  // Return token data and clear the cookies
  const response = NextResponse.json({ token, workspace });
  response.cookies.delete(TOKEN_COOKIE);
  response.cookies.delete(WORKSPACE_COOKIE);

  return response;
}
