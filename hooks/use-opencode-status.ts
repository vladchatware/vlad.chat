'use client';

import { useState, useEffect, useCallback } from 'react';

/**
 * Hook to check OpenCode server connection status.
 * Polls the health endpoint every 30 seconds.
 */
export function useOpenCodeStatus() {
  const [connectionStatus, setConnectionStatus] = useState<'checking' | 'connected' | 'disconnected'>('checking');
  
  const checkStatus = useCallback(async () => {
    try {
      const response = await fetch('/api/opencode/health');
      const data = await response.json();
      setConnectionStatus(data.available ? 'connected' : 'disconnected');
    } catch {
      setConnectionStatus('disconnected');
    }
  }, []);

  useEffect(() => {
    checkStatus();
    // Check every 30 seconds
    const interval = setInterval(checkStatus, 30000);
    return () => clearInterval(interval);
  }, [checkStatus]);

  return { connectionStatus };
}
