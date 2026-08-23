/**
 * Sync Manager Hook - React integration for offline-first messaging
 *
 * Features:
 * - Automatic reconnection handling
 * - Pending queue processing
 * - Connectivity status tracking
 * - Message sync status updates
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { chatService } from '../services/chatService';
import {
  setupConnectivityListeners,
  isOnline as checkIsOnline,
  getPendingMessages,
  getOfflineStats
} from '../utils/offlineStorage';
import { log } from '../utils/logger';

export interface SyncStatus {
  isOnline: boolean;
  isSyncing: boolean;
  pendingCount: number;
  lastSyncedAt: string | null;
  syncError: string | null;
}

export interface UseSyncManagerOptions {
  userId: string | null;
  onSyncComplete?: (result: { processed: number; failed: number }) => void;
  onSyncProgress?: (clientMessageId: string, status: 'sending' | 'sent' | 'failed') => void;
  onConnectivityChange?: (isOnline: boolean) => void;
}

export function useSyncManager(options: UseSyncManagerOptions) {
  const { userId, onSyncComplete, onSyncProgress, onConnectivityChange } = options;

  const [syncStatus, setSyncStatus] = useState<SyncStatus>({
    isOnline: checkIsOnline(),
    isSyncing: false,
    pendingCount: 0,
    lastSyncedAt: null,
    syncError: null
  });

  const syncInProgressRef = useRef(false);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const updatePendingCount = useCallback(async () => {
    try {
      const pending = await getPendingMessages();
      setSyncStatus(prev => ({ ...prev, pendingCount: pending.length }));
    } catch (error) {
      log.error('Error getting pending count', error, 'useSyncManager');
    }
  }, []);

  const syncPendingMessages = useCallback(async () => {
    if (!userId || syncInProgressRef.current || !checkIsOnline()) {
      return;
    }

    syncInProgressRef.current = true;
    setSyncStatus(prev => ({ ...prev, isSyncing: true, syncError: null }));

    try {
      const result = await chatService.processPendingQueue((clientMessageId, status) => {
        onSyncProgress?.(clientMessageId, status);
        if (status === 'sent') {
          setSyncStatus(prev => ({
            ...prev,
            pendingCount: Math.max(0, prev.pendingCount - 1)
          }));
        }
      });

      setSyncStatus(prev => ({
        ...prev,
        isSyncing: false,
        lastSyncedAt: new Date().toISOString(),
        syncError: result.failed > 0 ? `${result.failed} message(s) failed to send` : null
      }));

      onSyncComplete?.(result);
      await updatePendingCount();
    } catch (error) {
      log.error('Sync error', error, 'useSyncManager');
      setSyncStatus(prev => ({
        ...prev,
        isSyncing: false,
        syncError: 'Sync failed. Will retry when online.'
      }));
    } finally {
      syncInProgressRef.current = false;
    }
  }, [userId, onSyncComplete, onSyncProgress, updatePendingCount]);

  const handleOnline = useCallback(() => {
    setSyncStatus(prev => ({ ...prev, isOnline: true }));
    onConnectivityChange?.(true);

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }

    reconnectTimeoutRef.current = setTimeout(() => {
      syncPendingMessages();
    }, 1000);
  }, [syncPendingMessages, onConnectivityChange]);

  const handleOffline = useCallback(() => {
    setSyncStatus(prev => ({ ...prev, isOnline: false }));
    onConnectivityChange?.(false);

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  }, [onConnectivityChange]);

  useEffect(() => {
    const cleanup = setupConnectivityListeners(handleOnline, handleOffline);

    setSyncStatus(prev => ({ ...prev, isOnline: checkIsOnline() }));

    return () => {
      cleanup();
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [handleOnline, handleOffline]);

  useEffect(() => {
    if (userId) {
      updatePendingCount();

      if (checkIsOnline()) {
        syncPendingMessages();
      }
    }
  }, [userId, updatePendingCount, syncPendingMessages]);

  const forceSync = useCallback(async () => {
    if (!checkIsOnline()) {
      setSyncStatus(prev => ({
        ...prev,
        syncError: 'Cannot sync while offline'
      }));
      return;
    }

    await syncPendingMessages();
  }, [syncPendingMessages]);

  const getStats = useCallback(async () => {
    return await getOfflineStats();
  }, []);

  return {
    ...syncStatus,
    forceSync,
    getStats,
    updatePendingCount
  };
}

export default useSyncManager;
