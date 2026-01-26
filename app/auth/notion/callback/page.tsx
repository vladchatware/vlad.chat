'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { NOTION_STORAGE_KEYS } from '@/lib/notion-oauth';

function CallbackContent() {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const [workspace, setWorkspace] = useState('');

  useEffect(() => {
    const error = searchParams.get('error');
    const success = searchParams.get('success');

    if (error) {
      setStatus('error');
      setMessage(error);
      // Close popup after showing error
      setTimeout(() => window.close(), 2500);
      return;
    }

    if (success) {
      // Consume the token from the secure cookie via API
      fetch('/api/auth/notion/token', { method: 'POST' })
        .then((res) => {
          if (!res.ok) throw new Error('Failed to retrieve token');
          return res.json();
        })
        .then(({ token, workspace: workspaceName }) => {
          // Store in localStorage (for polling fallback)
          localStorage.setItem(NOTION_STORAGE_KEYS.token, token);
          localStorage.setItem(NOTION_STORAGE_KEYS.workspace, workspaceName);

          // Notify opener window
          if (window.opener) {
            window.opener.postMessage(
              { type: 'notion_connected', token, workspace: workspaceName },
              window.location.origin
            );
          }

          setStatus('success');
          setWorkspace(workspaceName);
          
          // Close popup
          setTimeout(() => window.close(), 1500);
        })
        .catch((err) => {
          console.error('Failed to consume token:', err);
          setStatus('error');
          setMessage('Failed to complete connection. Please try again.');
          setTimeout(() => window.close(), 2500);
        });
      return;
    }

    // No params - close popup
    window.close();
  }, [searchParams]);

  return (
    <div className="text-center p-8 max-w-md">
      {status === 'loading' && (
        <>
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-foreground mx-auto mb-4" />
          <p className="text-muted-foreground">Connecting to Notion...</p>
        </>
      )}

      {status === 'success' && (
        <>
          <div className="text-4xl mb-4">✓</div>
          <h1 className="text-xl font-semibold text-foreground mb-2">Connected!</h1>
          <p className="text-muted-foreground mb-1">Successfully connected to Notion.</p>
          <p className="font-medium text-foreground">{workspace}</p>
          <p className="text-sm text-muted-foreground mt-4">This window will close...</p>
        </>
      )}

      {status === 'error' && (
        <>
          <div className="text-4xl mb-4">✕</div>
          <h1 className="text-xl font-semibold text-destructive mb-2">Connection Failed</h1>
          <p className="text-muted-foreground">{message}</p>
          <p className="text-sm text-muted-foreground mt-4">This window will close...</p>
        </>
      )}
    </div>
  );
}

function LoadingFallback() {
  return (
    <div className="text-center p-8 max-w-md">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-foreground mx-auto mb-4" />
      <p className="text-muted-foreground">Connecting to Notion...</p>
    </div>
  );
}

export default function NotionCallbackPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Suspense fallback={<LoadingFallback />}>
        <CallbackContent />
      </Suspense>
    </div>
  );
}
