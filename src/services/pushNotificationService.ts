/**
 * Push Notification Service
 * Uses Web Push API (FREE, built into browsers)
 * For mobile: Uses Firebase Cloud Messaging (FREE tier: unlimited)
 *
 * EXTERNAL REQUIREMENT:
 * For mobile push notifications, you'll need Firebase (FREE):
 * 1. Create Firebase project at https://console.firebase.google.com
 * 2. Get your VAPID key and Firebase config
 * 3. Add to .env: VITE_FIREBASE_VAPID_KEY, VITE_FIREBASE_CONFIG
 */

import { supabase } from '../supabaseClient';

// VAPID key for Web Push (generate your own at https://web-push-codelab.glitch.me/)
const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY || '';

export interface PushSubscription {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

export interface NotificationPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  image?: string;
  tag?: string;
  data?: {
    type: 'message' | 'call' | 'friend_request' | 'group_invite';
    senderId?: string;
    chatId?: string;
    groupId?: string;
    url?: string;
  };
  actions?: {
    action: string;
    title: string;
    icon?: string;
  }[];
}

class PushNotificationService {
  private registration: ServiceWorkerRegistration | null = null;
  private subscription: PushSubscription | null = null;

  /**
   * Initialize push notifications
   */
  async initialize(userId: string): Promise<{
    success: boolean;
    permission: NotificationPermission;
    error?: string;
  }> {
    try {
      // Check if push notifications are supported
      if (!('PushManager' in window)) {
        return {
          success: false,
          permission: 'denied',
          error: 'Push notifications are not supported in this browser'
        };
      }

      // Check if service workers are supported
      if (!('serviceWorker' in navigator)) {
        return {
          success: false,
          permission: 'denied',
          error: 'Service workers are not supported'
        };
      }

      // Request permission
      const permission = await Notification.requestPermission();

      if (permission !== 'granted') {
        return { success: false, permission };
      }

      // Register service worker
      this.registration = await navigator.serviceWorker.register('/sw.js');

      // Wait for service worker to be ready
      await navigator.serviceWorker.ready;

      // Subscribe to push notifications
      const subscription = await this.subscribeToPush();

      if (subscription) {
        // Save subscription to database
        await this.saveSubscription(userId, subscription);
        return { success: true, permission };
      }

      return {
        success: false,
        permission,
        error: 'Failed to subscribe to push notifications'
      };
    } catch (error: any) {
      console.error('Push notification initialization failed:', error);
      return {
        success: false,
        permission: 'default',
        error: error.message
      };
    }
  }

  /**
   * Subscribe to push notifications
   */
  private async subscribeToPush(): Promise<PushSubscription | null> {
    if (!this.registration) return null;

    try {
      // Check for existing subscription
      let subscription = await this.registration.pushManager.getSubscription();

      if (!subscription && VAPID_PUBLIC_KEY) {
        // Create new subscription
        subscription = await this.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: this.urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
        });
      }

      if (subscription) {
        const json = subscription.toJSON();
        this.subscription = {
          endpoint: json.endpoint!,
          keys: {
            p256dh: json.keys!.p256dh,
            auth: json.keys!.auth
          }
        };
        return this.subscription;
      }

      return null;
    } catch (error) {
      console.error('Failed to subscribe to push:', error);
      return null;
    }
  }

  /**
   * Save subscription to database
   */
  private async saveSubscription(userId: string, subscription: PushSubscription): Promise<void> {
    await supabase.from('push_subscriptions').upsert({
      user_id: userId,
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
      user_agent: navigator.userAgent,
      created_at: new Date().toISOString()
    }, {
      onConflict: 'user_id,endpoint'
    });
  }

  /**
   * Remove subscription
   */
  async unsubscribe(userId: string): Promise<boolean> {
    try {
      if (this.registration) {
        const subscription = await this.registration.pushManager.getSubscription();
        if (subscription) {
          await subscription.unsubscribe();

          // Remove from database
          await supabase
            .from('push_subscriptions')
            .delete()
            .eq('user_id', userId)
            .eq('endpoint', subscription.endpoint);
        }
      }
      return true;
    } catch (error) {
      console.error('Failed to unsubscribe:', error);
      return false;
    }
  }

  /**
   * Show local notification (when app is in foreground)
   */
  async showLocalNotification(payload: NotificationPayload): Promise<void> {
    if (Notification.permission !== 'granted') return;

    const options: NotificationOptions & { image?: string; vibrate?: number[] } = {
      body: payload.body,
      icon: payload.icon || '/icon-192.png',
      badge: payload.badge || '/badge-72.png',
      tag: payload.tag,
      data: payload.data,
      requireInteraction: false,
      silent: false,
      vibrate: [200, 100, 200]
    };

    // Image is a non-standard but widely supported property
    if (payload.image) {
      options.image = payload.image;
    }

    if (payload.actions) {
      (options as any).actions = payload.actions;
    }

    if (this.registration) {
      await this.registration.showNotification(payload.title, options);
    } else {
      new Notification(payload.title, options);
    }
  }

  /**
   * Send push notification to a user (via Supabase Edge Function)
   * Note: This should be called from backend/edge function for security
   */
  async sendToUser(targetUserId: string, payload: NotificationPayload): Promise<boolean> {
    try {
      // Call Supabase Edge Function to send push
      const { error } = await supabase.functions.invoke('send-push-notification', {
        body: {
          userId: targetUserId,
          notification: payload
        }
      });

      return !error;
    } catch (error) {
      console.error('Failed to send push notification:', error);
      return false;
    }
  }

  /**
   * Send push to multiple users
   */
  async sendToUsers(userIds: string[], payload: NotificationPayload): Promise<void> {
    await Promise.all(userIds.map(id => this.sendToUser(id, payload)));
  }

  /**
   * Create notification for new message
   */
  createMessageNotification(
    senderName: string,
    message: string,
    senderAvatar?: string,
    chatId?: string
  ): NotificationPayload {
    return {
      title: senderName,
      body: message.length > 100 ? message.substring(0, 100) + '...' : message,
      icon: senderAvatar || '/icon-192.png',
      tag: `message-${chatId}`,
      data: {
        type: 'message',
        chatId,
        url: `/chat/${chatId}`
      },
      actions: [
        { action: 'reply', title: 'Reply' },
        { action: 'mark-read', title: 'Mark as Read' }
      ]
    };
  }

  /**
   * Create notification for incoming call
   */
  createCallNotification(
    callerName: string,
    callType: 'audio' | 'video',
    callerAvatar?: string,
    callId?: string
  ): NotificationPayload {
    return {
      title: `Incoming ${callType} call`,
      body: `${callerName} is calling you`,
      icon: callerAvatar || '/icon-192.png',
      tag: `call-${callId}`,
      data: {
        type: 'call',
        url: `/call/${callId}`
      },
      actions: [
        { action: 'answer', title: 'Answer' },
        { action: 'decline', title: 'Decline' }
      ]
    };
  }

  /**
   * Create notification for friend request
   */
  createFriendRequestNotification(
    senderName: string,
    senderAvatar?: string,
    senderId?: string
  ): NotificationPayload {
    return {
      title: 'New Friend Request',
      body: `${senderName} wants to be your friend`,
      icon: senderAvatar || '/icon-192.png',
      tag: `friend-request-${senderId}`,
      data: {
        type: 'friend_request',
        senderId,
        url: '/friends'
      },
      actions: [
        { action: 'accept', title: 'Accept' },
        { action: 'decline', title: 'Decline' }
      ]
    };
  }

  /**
   * Check if notifications are supported and permitted
   */
  isSupported(): boolean {
    return 'Notification' in window && 'PushManager' in window;
  }

  /**
   * Get current permission status
   */
  getPermission(): NotificationPermission {
    return Notification.permission;
  }

  /**
   * Convert VAPID key to Uint8Array
   */
  private urlBase64ToUint8Array(base64String: string): Uint8Array {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding)
      .replace(/-/g, '+')
      .replace(/_/g, '/');

    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }
}

export const pushNotificationService = new PushNotificationService();
export default pushNotificationService;
