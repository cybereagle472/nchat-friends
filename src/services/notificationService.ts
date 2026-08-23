/**
 * In-App Notification Service - Supabase Realtime Push Notifications
 *
 * WhatsApp-style in-app notifications for Android using Supabase Realtime.
 * No browser push API - all notifications happen within the app.
 */

import { supabase } from '../supabaseClient';
import { NotificationType, Message, GroupMessage } from '../types';

export interface ServiceResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface InAppNotification {
  id: string;
  type: 'message' | 'group_message' | 'call' | 'friend_request' | 'friend_accept' | 'system';
  title: string;
  body: string;
  avatar?: string;
  timestamp: string;
  data?: Record<string, any>;
  read: boolean;
}

export interface NotificationSettings {
  userId: string;
  messageNotifications: boolean;
  groupNotifications: boolean;
  callNotifications: boolean;
  friendRequestNotifications: boolean;
  soundEnabled: boolean;
  vibrationEnabled: boolean;
  showPreview: boolean;
  mutedChats: string[];
  mutedGroups: string[];
}

type NotificationCallback = (notification: InAppNotification) => void;

class NotificationService {
  private listeners: Set<NotificationCallback> = new Set();
  private messageChannel: any = null;
  private groupMessageChannel: any = null;
  private callChannel: any = null;
  private friendChannel: any = null;
  private currentUserId: string | null = null;
  private settings: NotificationSettings | null = null;
  private notificationQueue: InAppNotification[] = [];
  private isInitialized = false;

  /**
   * Initialize realtime notification listeners
   */
  async initialize(userId: string): Promise<ServiceResult<void>> {
    if (this.isInitialized && this.currentUserId === userId) {
      return { success: true };
    }

    try {
      // Cleanup existing subscriptions
      await this.cleanup();

      this.currentUserId = userId;

      // Load notification settings
      await this.loadSettings(userId);

      // Subscribe to direct messages
      this.messageChannel = supabase.channel(`notif:messages:${userId}`)
        .on('postgres_changes', {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `receiver_id=eq.${userId}`
        }, async (payload) => {
          const message = payload.new as Message;
          await this.handleNewMessage(message);
        })
        .subscribe();

      // Subscribe to group messages
      this.groupMessageChannel = supabase.channel(`notif:group_messages:${userId}`)
        .on('postgres_changes', {
          event: 'INSERT',
          schema: 'public',
          table: 'group_messages'
        }, async (payload) => {
          const groupMessage = payload.new as GroupMessage;
          // Check if user is member of this group
          if (groupMessage.sender_id !== userId) {
            await this.handleNewGroupMessage(groupMessage);
          }
        })
        .subscribe();

      // Subscribe to incoming calls
      this.callChannel = supabase.channel(`notif:calls:${userId}`)
        .on('postgres_changes', {
          event: 'INSERT',
          schema: 'public',
          table: 'calls',
          filter: `receiver_id=eq.${userId}`
        }, async (payload) => {
          const call = payload.new;
          await this.handleIncomingCall(call);
        })
        .on('postgres_changes', {
          event: 'UPDATE',
          schema: 'public',
          table: 'calls',
          filter: `receiver_id=eq.${userId}`
        }, async (payload) => {
          const call = payload.new;
          if (call.status === 'missed') {
            await this.handleMissedCall(call);
          }
        })
        .subscribe();

      // Subscribe to friend requests
      this.friendChannel = supabase.channel(`notif:friends:${userId}`)
        .on('postgres_changes', {
          event: 'INSERT',
          schema: 'public',
          table: 'friend_requests',
          filter: `receiver_id=eq.${userId}`
        }, async (payload) => {
          const request = payload.new;
          await this.handleFriendRequest(request);
        })
        .on('postgres_changes', {
          event: 'UPDATE',
          schema: 'public',
          table: 'friend_requests',
          filter: `sender_id=eq.${userId}`
        }, async (payload) => {
          const request = payload.new;
          if (request.status === 'accepted') {
            await this.handleFriendAccepted(request);
          }
        })
        .subscribe();

      this.isInitialized = true;
      return { success: true };
    } catch (err: any) {
      console.error('[NotificationService] initialize error:', err);
      return { success: false, error: err.message };
    }
  }

  /**
   * Cleanup all subscriptions
   */
  async cleanup(): Promise<void> {
    if (this.messageChannel) {
      await supabase.removeChannel(this.messageChannel);
      this.messageChannel = null;
    }
    if (this.groupMessageChannel) {
      await supabase.removeChannel(this.groupMessageChannel);
      this.groupMessageChannel = null;
    }
    if (this.callChannel) {
      await supabase.removeChannel(this.callChannel);
      this.callChannel = null;
    }
    if (this.friendChannel) {
      await supabase.removeChannel(this.friendChannel);
      this.friendChannel = null;
    }
    this.isInitialized = false;
  }

  /**
   * Add notification listener
   */
  addListener(callback: NotificationCallback): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  /**
   * Emit notification to all listeners
   */
  private emit(notification: InAppNotification): void {
    this.notificationQueue.push(notification);
    this.listeners.forEach(callback => {
      try {
        callback(notification);
      } catch (err) {
        console.error('[NotificationService] listener error:', err);
      }
    });

    // Play sound/vibration if enabled
    this.playNotificationFeedback(notification.type);
  }

  /**
   * Handle new direct message
   */
  private async handleNewMessage(message: Message): Promise<void> {
    if (!this.settings?.messageNotifications) return;
    if (this.settings.mutedChats.includes(message.sender_id)) return;

    // Get sender profile
    const { data: sender } = await supabase
      .from('profiles')
      .select('id, full_name, username, avatar_url')
      .eq('id', message.sender_id)
      .single();

    const senderName = sender?.full_name || sender?.username || 'Someone';
    let body = message.content;

    // Format body based on message type
    switch (message.type) {
      case 'image':
        body = '📷 Photo';
        break;
      case 'video':
        body = '🎥 Video';
        break;
      case 'voice':
        body = '🎤 Voice message';
        break;
      case 'file':
        body = `📎 ${message.fileName || 'File'}`;
        break;
      default:
        body = this.settings.showPreview
          ? (message.content.length > 100 ? message.content.substring(0, 97) + '...' : message.content)
          : 'New message';
    }

    const notification: InAppNotification = {
      id: `msg-${message.id}`,
      type: 'message',
      title: senderName,
      body,
      avatar: sender?.avatar_url,
      timestamp: message.created_at,
      data: {
        messageId: message.id,
        senderId: message.sender_id,
        chatId: message.sender_id
      },
      read: false
    };

    this.emit(notification);
    await this.saveNotification(notification);
  }

  /**
   * Handle new group message
   */
  private async handleNewGroupMessage(message: GroupMessage): Promise<void> {
    if (!this.settings?.groupNotifications) return;
    if (this.settings.mutedGroups.includes(message.group_id)) return;

    // Check if user is member of this group
    const { data: membership } = await supabase
      .from('group_members')
      .select('user_id')
      .eq('group_id', message.group_id)
      .eq('user_id', this.currentUserId)
      .single();

    if (!membership) return;

    // Get sender and group info
    const [senderResult, groupResult] = await Promise.all([
      supabase.from('profiles').select('full_name, username, avatar_url').eq('id', message.sender_id).single(),
      supabase.from('groups').select('name, avatar_url').eq('id', message.group_id).single()
    ]);

    const senderName = senderResult.data?.full_name || senderResult.data?.username || 'Someone';
    const groupName = groupResult.data?.name || 'Group';

    let body = `${senderName}: ${message.content}`;
    if (!this.settings.showPreview) {
      body = `${senderName}: New message`;
    } else if (body.length > 100) {
      body = body.substring(0, 97) + '...';
    }

    const notification: InAppNotification = {
      id: `grp-${message.id}`,
      type: 'group_message',
      title: groupName,
      body,
      avatar: groupResult.data?.avatar_url,
      timestamp: message.created_at,
      data: {
        messageId: message.id,
        senderId: message.sender_id,
        groupId: message.group_id
      },
      read: false
    };

    this.emit(notification);
    await this.saveNotification(notification);
  }

  /**
   * Handle incoming call
   */
  private async handleIncomingCall(call: any): Promise<void> {
    if (!this.settings?.callNotifications) return;

    const { data: caller } = await supabase
      .from('profiles')
      .select('full_name, username, avatar_url')
      .eq('id', call.caller_id)
      .single();

    const callerName = caller?.full_name || caller?.username || 'Someone';
    const callType = call.call_type === 'video' ? 'Video' : 'Voice';

    const notification: InAppNotification = {
      id: `call-${call.id}`,
      type: 'call',
      title: `Incoming ${callType} Call`,
      body: `${callerName} is calling...`,
      avatar: caller?.avatar_url,
      timestamp: call.created_at,
      data: {
        callId: call.id,
        callerId: call.caller_id,
        callType: call.call_type
      },
      read: false
    };

    this.emit(notification);
  }

  /**
   * Handle missed call
   */
  private async handleMissedCall(call: any): Promise<void> {
    if (!this.settings?.callNotifications) return;

    const { data: caller } = await supabase
      .from('profiles')
      .select('full_name, username, avatar_url')
      .eq('id', call.caller_id)
      .single();

    const callerName = caller?.full_name || caller?.username || 'Someone';
    const callType = call.call_type === 'video' ? 'video' : 'voice';

    const notification: InAppNotification = {
      id: `missed-${call.id}`,
      type: 'call',
      title: 'Missed Call',
      body: `Missed ${callType} call from ${callerName}`,
      avatar: caller?.avatar_url,
      timestamp: new Date().toISOString(),
      data: {
        callId: call.id,
        callerId: call.caller_id,
        callType: call.call_type,
        missed: true
      },
      read: false
    };

    this.emit(notification);
    await this.saveNotification(notification);
  }

  /**
   * Handle friend request
   */
  private async handleFriendRequest(request: any): Promise<void> {
    if (!this.settings?.friendRequestNotifications) return;

    const { data: sender } = await supabase
      .from('profiles')
      .select('full_name, username, avatar_url')
      .eq('id', request.sender_id)
      .single();

    const senderName = sender?.full_name || sender?.username || 'Someone';

    const notification: InAppNotification = {
      id: `friend-req-${request.id}`,
      type: 'friend_request',
      title: 'Friend Request',
      body: `${senderName} wants to be your friend`,
      avatar: sender?.avatar_url,
      timestamp: request.created_at,
      data: {
        requestId: request.id,
        senderId: request.sender_id
      },
      read: false
    };

    this.emit(notification);
    await this.saveNotification(notification);
  }

  /**
   * Handle friend accepted
   */
  private async handleFriendAccepted(request: any): Promise<void> {
    const { data: receiver } = await supabase
      .from('profiles')
      .select('full_name, username, avatar_url')
      .eq('id', request.receiver_id)
      .single();

    const receiverName = receiver?.full_name || receiver?.username || 'Someone';

    const notification: InAppNotification = {
      id: `friend-acc-${request.id}`,
      type: 'friend_accept',
      title: 'Friend Request Accepted',
      body: `${receiverName} accepted your friend request`,
      avatar: receiver?.avatar_url,
      timestamp: new Date().toISOString(),
      data: {
        requestId: request.id,
        friendId: request.receiver_id
      },
      read: false
    };

    this.emit(notification);
    await this.saveNotification(notification);
  }

  /**
   * Play notification sound/vibration
   */
  private playNotificationFeedback(type: string): void {
    if (!this.settings) return;

    // Vibration for Android
    if (this.settings.vibrationEnabled && 'vibrate' in navigator) {
      switch (type) {
        case 'call':
          // Long vibration pattern for calls
          navigator.vibrate([200, 100, 200, 100, 200]);
          break;
        default:
          // Short vibration for messages
          navigator.vibrate(100);
      }
    }

    // Sound (using Audio API)
    if (this.settings.soundEnabled) {
      try {
        const soundFile = type === 'call' ? '/sounds/ringtone.mp3' : '/sounds/notification.mp3';
        const audio = new Audio(soundFile);
        audio.volume = 0.5;
        audio.play().catch(() => {
          // Ignore audio play errors (user interaction required)
        });
      } catch {
        // Ignore audio errors
      }
    }
  }

  /**
   * Save notification to database
   */
  private async saveNotification(notification: InAppNotification): Promise<void> {
    if (!this.currentUserId) return;

    try {
      await supabase.from('notifications').insert({
        user_id: this.currentUserId,
        actor_id: notification.data?.senderId || notification.data?.callerId,
        type: notification.type as NotificationType,
        payload: {
          title: notification.title,
          body: notification.body,
          avatar: notification.avatar,
          ...notification.data
        },
        is_read: false,
        created_at: notification.timestamp
      });
    } catch (err) {
      console.error('[NotificationService] saveNotification error:', err);
    }
  }

  /**
   * Load notification settings
   */
  async loadSettings(userId: string): Promise<void> {
    try {
      const { data } = await supabase
        .from('notification_settings')
        .select('*')
        .eq('user_id', userId)
        .single();

      this.settings = {
        userId,
        messageNotifications: data?.message_notifications ?? true,
        groupNotifications: data?.group_notifications ?? true,
        callNotifications: data?.call_notifications ?? true,
        friendRequestNotifications: data?.friend_request_notifications ?? true,
        soundEnabled: data?.sound_enabled ?? true,
        vibrationEnabled: data?.vibration_enabled ?? true,
        showPreview: data?.show_preview ?? true,
        mutedChats: data?.muted_chats || [],
        mutedGroups: data?.muted_groups || []
      };
    } catch {
      // Use defaults
      this.settings = {
        userId,
        messageNotifications: true,
        groupNotifications: true,
        callNotifications: true,
        friendRequestNotifications: true,
        soundEnabled: true,
        vibrationEnabled: true,
        showPreview: true,
        mutedChats: [],
        mutedGroups: []
      };
    }
  }

  /**
   * Update notification settings
   */
  async updateSettings(settings: Partial<NotificationSettings>): Promise<ServiceResult<void>> {
    if (!this.currentUserId) {
      return { success: false, error: 'Not initialized' };
    }

    try {
      const dbSettings: Record<string, any> = {};

      if (settings.messageNotifications !== undefined) {
        dbSettings.message_notifications = settings.messageNotifications;
      }
      if (settings.groupNotifications !== undefined) {
        dbSettings.group_notifications = settings.groupNotifications;
      }
      if (settings.callNotifications !== undefined) {
        dbSettings.call_notifications = settings.callNotifications;
      }
      if (settings.friendRequestNotifications !== undefined) {
        dbSettings.friend_request_notifications = settings.friendRequestNotifications;
      }
      if (settings.soundEnabled !== undefined) {
        dbSettings.sound_enabled = settings.soundEnabled;
      }
      if (settings.vibrationEnabled !== undefined) {
        dbSettings.vibration_enabled = settings.vibrationEnabled;
      }
      if (settings.showPreview !== undefined) {
        dbSettings.show_preview = settings.showPreview;
      }
      if (settings.mutedChats !== undefined) {
        dbSettings.muted_chats = settings.mutedChats;
      }
      if (settings.mutedGroups !== undefined) {
        dbSettings.muted_groups = settings.mutedGroups;
      }

      await supabase
        .from('notification_settings')
        .upsert({
          user_id: this.currentUserId,
          ...dbSettings
        }, { onConflict: 'user_id' });

      // Update local settings
      this.settings = { ...this.settings!, ...settings };

      return { success: true };
    } catch (err: any) {
      console.error('[NotificationService] updateSettings error:', err);
      return { success: false, error: err.message };
    }
  }

  /**
   * Mute chat
   */
  async muteChat(chatId: string): Promise<ServiceResult<void>> {
    if (!this.settings) return { success: false, error: 'Not initialized' };

    const mutedChats = [...this.settings.mutedChats, chatId];
    return this.updateSettings({ mutedChats });
  }

  /**
   * Unmute chat
   */
  async unmuteChat(chatId: string): Promise<ServiceResult<void>> {
    if (!this.settings) return { success: false, error: 'Not initialized' };

    const mutedChats = this.settings.mutedChats.filter(id => id !== chatId);
    return this.updateSettings({ mutedChats });
  }

  /**
   * Mute group
   */
  async muteGroup(groupId: string): Promise<ServiceResult<void>> {
    if (!this.settings) return { success: false, error: 'Not initialized' };

    const mutedGroups = [...this.settings.mutedGroups, groupId];
    return this.updateSettings({ mutedGroups });
  }

  /**
   * Unmute group
   */
  async unmuteGroup(groupId: string): Promise<ServiceResult<void>> {
    if (!this.settings) return { success: false, error: 'Not initialized' };

    const mutedGroups = this.settings.mutedGroups.filter(id => id !== groupId);
    return this.updateSettings({ mutedGroups });
  }

  /**
   * Check if chat is muted
   */
  isChatMuted(chatId: string): boolean {
    return this.settings?.mutedChats.includes(chatId) ?? false;
  }

  /**
   * Check if group is muted
   */
  isGroupMuted(groupId: string): boolean {
    return this.settings?.mutedGroups.includes(groupId) ?? false;
  }

  /**
   * Get recent notifications
   */
  async getNotifications(limit = 50): Promise<ServiceResult<InAppNotification[]>> {
    if (!this.currentUserId) {
      return { success: false, error: 'Not initialized' };
    }

    try {
      const { data, error } = await supabase
        .from('notifications')
        .select(`
          id,
          type,
          payload,
          is_read,
          created_at,
          actor:actor_id(full_name, username, avatar_url)
        `)
        .eq('user_id', this.currentUserId)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) throw error;

      const notifications: InAppNotification[] = (data || []).map(n => {
        // Handle actor which could be an object or array from Supabase join
        const actor = Array.isArray(n.actor) ? n.actor[0] : n.actor;
        return {
          id: n.id,
          type: n.type as InAppNotification['type'],
          title: n.payload?.title || '',
          body: n.payload?.body || '',
          avatar: actor?.avatar_url || n.payload?.avatar,
          timestamp: n.created_at,
          data: n.payload,
          read: n.is_read
        };
      });

      return { success: true, data: notifications };
    } catch (err: any) {
      console.error('[NotificationService] getNotifications error:', err);
      return { success: false, error: err.message };
    }
  }

  /**
   * Get unread count
   */
  async getUnreadCount(): Promise<number> {
    if (!this.currentUserId) return 0;

    try {
      const { count } = await supabase
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', this.currentUserId)
        .eq('is_read', false);

      return count || 0;
    } catch {
      return 0;
    }
  }

  /**
   * Mark notification as read
   */
  async markAsRead(notificationId: string): Promise<void> {
    try {
      await supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('id', notificationId);
    } catch (err) {
      console.error('[NotificationService] markAsRead error:', err);
    }
  }

  /**
   * Mark all as read
   */
  async markAllAsRead(): Promise<void> {
    if (!this.currentUserId) return;

    try {
      await supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('user_id', this.currentUserId)
        .eq('is_read', false);
    } catch (err) {
      console.error('[NotificationService] markAllAsRead error:', err);
    }
  }

  /**
   * Clear all notifications
   */
  async clearAll(): Promise<void> {
    if (!this.currentUserId) return;

    try {
      await supabase
        .from('notifications')
        .delete()
        .eq('user_id', this.currentUserId);
    } catch (err) {
      console.error('[NotificationService] clearAll error:', err);
    }
  }

  /**
   * Get current settings
   */
  getSettings(): NotificationSettings | null {
    return this.settings;
  }
}

export const notificationService = new NotificationService();
export default notificationService;
