import { NextRequest } from 'next/server';
import {
  NOTION_COOKIES,
  NOTION_STORAGE_KEYS,
  getCallbackUrl,
  exchangeNotionCode,
  escapeHtml,
} from '@/lib/notion-oauth';

function htmlResponse(body: string, status: number = 200) {
  return new Response(
    `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Notion Connection</title>
  <style>
    body {
      font-family: system-ui, -apple-system, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      background: #0a0a0a;
      color: #fafafa;
    }
    .container { text-align: center; padding: 2rem; max-width: 400px; }
    h1 { margin-bottom: 1rem; }
    h1.success { color: #22c55e; }
    h1.error { color: #ef4444; }
    p { color: #a1a1aa; line-height: 1.5; }
    .workspace { color: #fafafa; font-weight: 500; }
  </style>
</head>
<body>
  <div class="container">${body}</div>
</body>
</html>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}

function errorPage(title: string, message: string) {
  return htmlResponse(`
    <h1 class="error">${escapeHtml(title)}</h1>
    <p>${escapeHtml(message)}</p>
    <script>setTimeout(function(){window.location.href='/';},2000);</script>
  `, 400);
}

function successPage(workspace: string, token: string) {
  const tokenJson = JSON.stringify(token);
  const workspaceJson = JSON.stringify(workspace);

  return htmlResponse(`
    <h1 class="success">Connected!</h1>
    <p class="workspace">${escapeHtml(workspace)}</p>
    <script>
      localStorage.setItem('${NOTION_STORAGE_KEYS.token}', ${tokenJson});
      localStorage.setItem('${NOTION_STORAGE_KEYS.workspace}', ${workspaceJson});
      window.opener?.postMessage({ type: 'notion_connected', token: ${tokenJson}, workspace: ${workspaceJson} }, '*');
      setTimeout(function(){ window.close(); }, 1000);
    </script>
  `);
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get('code');
  const error = searchParams.get('error');
  const errorDescription = searchParams.get('error_description');

  if (error) {
    console.error('Notion OAuth error:', error, errorDescription);
    return errorPage('Connection Failed', errorDescription || error);
  }

  if (!code) {
    return errorPage('Connection Failed', 'No authorization code received from Notion.');
  }

  const clientId = request.cookies.get(NOTION_COOKIES.clientId)?.value;
  const clientSecret = request.cookies.get(NOTION_COOKIES.clientSecret)?.value;

  if (!clientId) {
    return errorPage('Session Expired', 'Please try connecting again.');
  }

  try {
    const tokenData = await exchangeNotionCode(
      code,
      clientId,
      clientSecret,
      getCallbackUrl()
    );

    if (tokenData.error) {
      console.error('Notion token exchange failed:', tokenData);
      return errorPage('Connection Failed', tokenData.error_description || 'Failed to complete authorization.');
    }

    const { access_token, workspace_name = 'Notion Workspace' } = tokenData;
    const response = successPage(workspace_name, access_token);
    
    // Clear OAuth cookies
    const headers = new Headers(response.headers);
    headers.append('Set-Cookie', `${NOTION_COOKIES.clientId}=; Path=/; Max-Age=0`);
    headers.append('Set-Cookie', `${NOTION_COOKIES.clientSecret}=; Path=/; Max-Age=0`);
    
    return new Response(response.body, {
      status: response.status,
      headers,
    });
  } catch (err) {
    console.error('Notion OAuth callback error:', err);
    return errorPage('Connection Failed', 'An unexpected error occurred.');
  }
}
