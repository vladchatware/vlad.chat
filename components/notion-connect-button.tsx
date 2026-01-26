'use client';

import { useCallback, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface NotionConnectButtonProps {
  connected: boolean;
  workspaceName?: string;
  onConnect: (token: string, workspace: string) => void;
  onDisconnect: () => void;
  className?: string;
}

function NotionLogo({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 100 100"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M20.0391 18.4536C23.0967 20.9117 24.3159 20.6815 29.5023 20.3322L77.2319 17.0628C78.4493 17.0628 77.4629 15.8462 77.0024 15.6177L68.5932 9.52292C66.6944 8.0762 64.1006 6.39771 59.1436 6.85818L13.109 10.3586C11.1999 10.5873 10.7395 11.5039 11.6584 12.4212L20.0391 18.4536ZM23.3277 28.7915V81.0016C23.3277 84.0493 24.7768 85.1961 28.2966 84.9679L80.7513 81.6978C84.2724 81.4693 84.7323 79.5594 84.7323 77.1024V25.1253C84.7323 22.6681 83.7463 21.2906 81.4423 21.5201L26.3878 25.0198C24.0857 25.2495 23.3277 26.334 23.3277 28.7915ZM75.0551 32.5231C75.5158 34.6628 75.0551 36.8024 72.9817 37.0309L70.3888 37.4893V73.8442C67.7963 75.2917 65.4341 76.0787 63.3017 76.0787C59.7823 76.0787 58.7947 74.9808 56.2028 71.6996L40.114 46.2099V70.5413L45.7624 71.7798C45.7624 71.7798 45.7624 76.0787 39.6533 76.0787L23.1017 77.0318C22.6413 75.9795 23.1017 73.3838 24.7768 72.9284L28.9872 71.6996V39.399L23.1017 38.8585C22.6413 36.719 23.7926 33.6723 27.3131 33.4422L45.3012 32.2914L61.9285 57.9996V35.5738L57.3594 35.0339C56.8993 32.523 58.5651 30.617 60.8692 30.3882L75.0551 32.5231ZM8.50555 4.71853L56.6607 0.989349C64.0997 0.3003 65.8968 0.762267 70.853 4.26062L89.2306 17.0628C92.7501 19.7509 93.8915 20.4499 93.8915 23.138V82.1487C93.8915 86.9078 92.2928 89.8259 87.1017 90.2844L31.816 94.0164C28.0676 94.2461 26.3878 93.788 24.5485 91.4094L11.1999 74.2876C9.13038 71.4506 8.27478 69.3135 8.27478 66.8569V10.3586C8.27478 7.20974 9.85815 4.94798 8.50555 4.71853Z"
      />
    </svg>
  );
}

export function NotionConnectButton({
  connected,
  workspaceName,
  onConnect,
  onDisconnect,
  className,
}: NotionConnectButtonProps) {
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Listen for message from popup
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      
      if (event.data?.type === 'notion_connected' && event.data?.token) {
        onConnect(event.data.token, event.data.workspace || 'Notion');
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => {
      window.removeEventListener('message', handleMessage);
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, [onConnect]);

  const handleClick = useCallback(() => {
    if (connected) {
      onDisconnect();
    } else {
      // Open OAuth popup
      const width = 600;
      const height = 700;
      const left = window.screenX + (window.outerWidth - width) / 2;
      const top = window.screenY + (window.outerHeight - height) / 2;
      
      const popup = window.open(
        '/api/auth/notion',
        'notion-oauth',
        `width=${width},height=${height},left=${left},top=${top},popup=1`
      );

      // Poll for token as fallback
      if (popup) {
        pollIntervalRef.current = setInterval(() => {
          const token = localStorage.getItem('notion_token');
          const workspace = localStorage.getItem('notion_workspace');
          if (token && workspace) {
            onConnect(token, workspace);
            clearInterval(pollIntervalRef.current!);
            pollIntervalRef.current = null;
          }
          if (popup.closed) {
            clearInterval(pollIntervalRef.current!);
            pollIntervalRef.current = null;
          }
        }, 500);
      }
    }
  }, [connected, onConnect, onDisconnect]);

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleClick}
      className={cn(
        'gap-1.5 font-medium text-muted-foreground transition-colors',
        'hover:bg-accent hover:text-foreground',
        connected && 'text-foreground',
        className
      )}
      title={connected ? `Disconnect ${workspaceName || 'Notion'}` : 'Connect your Notion workspace'}
    >
      <NotionLogo className={cn('size-4', connected && 'text-foreground')} />
      <span className="hidden sm:inline">
        {connected ? workspaceName || 'Notion' : 'Connect Notion'}
      </span>
    </Button>
  );
}
