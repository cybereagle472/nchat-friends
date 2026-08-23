/**
 * useNotifications Hook - In-App Notification Management
 *
 * React hook for managing WhatsApp-style in-app notifications.
 * Connects to Supabase Realtime for instant notifications.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { notificationService, InAppNotification, NotificationSettings } from '../services/notificationService';

export interface UseNotificationsOptions {
  userId: string | null;
  onNotification?: (notification: InAppNotification) => void;
  onMessageNotification?: (notification: InAppNotification) => void;
  onCallNotification?: (notification: InAppNotification) => void;
  onFriendNotification?: (notification: InAppNotification) => void;
  maxToasts?: number;
  toastDuration?: number;
}

export interface UseNotificationsReturn {
  notifications: InAppNotification[];
  toasts: InAppNotification[];
  unreadCount: number;
  settings: NotificationSettings | null;
  isInitialized: boolean;
  dismissToast: (id: string) => void;
  dismissAllToasts: () => void;
  markAsRead: (id: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  clearAll: () => Promise<void>;
  updateSettings: (settings: Partial<NotificationSettings>) => Promise<void>;
  muteChat: (chatId: string) => Promise<void>;
  unmuteChat: (chatId: string) => Promise<void>;
  muteGroup: (groupId: string) => Promise<void>;
  unmuteGroup: (groupId: string) => Promise<void>;
  isChatMuted: (chatId: string) => boolean;
  isGroupMuted: (groupId: string) => boolean;
  refresh: () => Promise<void>;
}

export function useNotifications(options: UseNotificationsOptions): UseNotificationsReturn {
  const {
    userId,
    onNotification,
    onMessageNotification,
    onCallNotification,
    onFriendNotification,
    maxToasts = 3,
    toastDuration = 4000
  } = options;

  const [notifications, setNotifications] = useState<InAppNotification[]>([]);
  const [toasts, setToasts] = useState<InAppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);

  const toastTimers = useRef<Map<string, NodeJS.Timeout>>(new Map());

  // Initialize notification service
  useEffect(() => {
    if (!userId) {
      setIsInitialized(false);
      return;
    }

    const init = async () => {
      const result = await notificationService.initialize(userId);
      if (result.success) {
        setIsInitialized(true);
        setSettings(notificationService.getSettings());

        // Load existing notifications
        const notifResult = await notificationService.getNotifications(50);
        if (notifResult.success && notifResult.data) {
          setNotifications(notifResult.data);
        }

        // Get unread count
        const count = await notificationService.getUnreadCount();
        setUnreadCount(count);
      }
    };

    init();

    return () => {
      notificationService.cleanup();
    };
  }, [userId]);

  // Show toast notification
  const showToast = useCallback((notification: InAppNotification) => {
    setToasts(prev => {
      // Remove oldest if at max
      const updated = prev.length >= maxToasts ? prev.slice(1) : prev;
      return [...updated, notification];
    });

    // Auto-dismiss after duration
    const timer = setTimeout(() => {
      dismissToast(notification.id);
    }, toastDuration);

    toastTimers.current.set(notification.id, timer);
  }, [maxToasts, toastDuration]);

  // Listen for new notifications
  useEffect(() => {
    if (!isInitialized) return;

    const unsubscribe = notificationService.addListener((notification) => {
      // Add to notifications list
      setNotifications(prev => [notification, ...prev]);

      // Update unread count
      setUnreadCount(prev => prev + 1);

      // Show toast
      showToast(notification);

      // Call appropriate callback
      onNotification?.(notification);

      switch (notification.type) {
        case 'message':
        case 'group_message':
          onMessageNotification?.(notification);
          break;
        case 'call':
          onCallNotification?.(notification);
          break;
        case 'friend_request':
        case 'friend_accept':
          onFriendNotification?.(notification);
          break;
      }
    });

    return () => {
      unsubscribe();
      // Cleanup all toast timers on unmount
      toastTimers.current.forEach(timer => clearTimeout(timer));
      toastTimers.current.clear();
    };
  }, [isInitialized, onNotification, onMessageNotification, onCallNotification, onFriendNotification, showToast]);

  // Dismiss single toast
  const dismissToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));

    const timer = toastTimers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      toastTimers.current.delete(id);
    }
  }, []);

  // Dismiss all toasts
  const dismissAllToasts = useCallback(() => {
    setToasts([]);

    toastTimers.current.forEach(timer => clearTimeout(timer));
    toastTimers.current.clear();
  }, []);

  // Mark notification as read
  const markAsRead = useCallback(async (id: string) => {
    await notificationService.markAsRead(id);

    setNotifications(prev =>
      prev.map(n => n.id === id ? { ...n, read: true } : n)
    );

    setUnreadCount(prev => Math.max(0, prev - 1));
  }, []);

  // Mark all as read
  const markAllAsRead = useCallback(async () => {
    await notificationService.markAllAsRead();

    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    setUnreadCount(0);
  }, []);

  // Clear all notifications
  const clearAll = useCallback(async () => {
    await notificationService.clearAll();
    setNotifications([]);
    setUnreadCount(0);
  }, []);

  // Update settings
  const updateSettings = useCallback(async (newSettings: Partial<NotificationSettings>) => {
    const result = await notificationService.updateSettings(newSettings);
    if (result.success) {
      setSettings(notificationService.getSettings());
    }
  }, []);

  // Mute/unmute chat
  const muteChat = useCallback(async (chatId: string) => {
    await notificationService.muteChat(chatId);
    setSettings(notificationService.getSettings());
  }, []);

  const unmuteChat = useCallback(async (chatId: string) => {
    await notificationService.unmuteChat(chatId);
    setSettings(notificationService.getSettings());
  }, []);

  // Mute/unmute group
  const muteGroup = useCallback(async (groupId: string) => {
    await notificationService.muteGroup(groupId);
    setSettings(notificationService.getSettings());
  }, []);

  const unmuteGroup = useCallback(async (groupId: string) => {
    await notificationService.unmuteGroup(groupId);
    setSettings(notificationService.getSettings());
  }, []);

  // Check muted status
  const isChatMuted = useCallback((chatId: string) => {
    return notificationService.isChatMuted(chatId);
  }, []);

  const isGroupMuted = useCallback((groupId: string) => {
    return notificationService.isGroupMuted(groupId);
  }, []);

  // Refresh notifications
  const refresh = useCallback(async () => {
    const notifResult = await notificationService.getNotifications(50);
    if (notifResult.success && notifResult.data) {
      setNotifications(notifResult.data);
    }

    const count = await notificationService.getUnreadCount();
    setUnreadCount(count);
  }, []);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      toastTimers.current.forEach(timer => clearTimeout(timer));
    };
  }, []);

  return {
    notifications,
    toasts,
    unreadCount,
    settings,
    isInitialized,
    dismissToast,
    dismissAllToasts,
    markAsRead,
    markAllAsRead,
    clearAll,
    updateSettings,
    muteChat,
    unmuteChat,
    muteGroup,
    unmuteGroup,
    isChatMuted,
    isGroupMuted,
    refresh
  };
}

export default useNotifications;
