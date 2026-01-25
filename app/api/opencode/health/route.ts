import { NextResponse } from 'next/server';

export async function GET() {
  try {
    // Check if OpenCode server is responding
    const response = await fetch(process.env.OPENCODE_URL!, {
      method: 'GET',
      signal: AbortSignal.timeout(3000),
    });
    
    return NextResponse.json({
      status: response.ok ? 'connected' : 'error',
      available: response.ok,
    });
  } catch {
    return NextResponse.json({
      status: 'disconnected',
      available: false,
    });
  }
}
