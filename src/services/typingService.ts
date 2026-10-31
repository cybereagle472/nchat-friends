/**
 * Typing Service - Real-time typing indicators
 *
 * Uses Supabase Realtime Broadcast for low-latency typing updates
 * No database storage needed - purely ephemeral
 */

import { supabase } from '../supabaseClient';
import { log } from '../utils/logger';

// Typing state expires after this duration (ms)
const TYPING_TIMEOUT = 3000;

// Debounce typing events (ms)
const TYPING_DEBOUNCE = 500;

export interface TypingState {
  odingerId: string;
  isTyping: boolean;
  timestamp: number;
}

export interface TypingSubscription {
  unsubscribe: () => void;
}

class TypingService {
  private typingTimeouts: Map<string, NodeJS.Timeout> = new Map();
  private lastTypingEvent: Map<string, number> = new Map();
  private channels: Map<string, any> = new Map();

  /**
   * Get channel name for a chat between two users
   */
  private getChatChannelName(userId1: string, userId2: string): string {
    // Sort IDs to ensure both users use the same channel
    const sorted = [userId1, userId2].sort();
    return `typing:${sorted[0]}:${sorted[1]}`;
  }

  /**
   * Get channel name for a group
   */
  private getGroupChannelName(groupId: string): string {
    return `typing:group:${groupId}`;
  }

  /**
   * Send typing indicator for direct chat
   */
  async sendTyping(senderId: string, receiverId: string): Promise<void> {
    const channelName = this.getChatChannelName(senderId, receiverId);
    const now = Date.now();

    // Debounce - don't send if we just sent one
    const lastEvent = this.lastTypingEvent.get(channelName) || 0;
    if (now - lastEvent < TYPING_DEBOUNCE) {
      return;
    }
    this.lastTypingEvent.set(channelName, now);

    try {
      let channel = this.channels.get(channelName);

      if (!channel) {
        channel = supabase.channel(channelName);
        await channel.subscribe();
        this.channels.set(channelName, channel);
      }

      await channel.send({
        type: 'broadcast',
        event: 'typing',
        payload: {
          userId: senderId,
          isTyping: true,
          timestamp: now
        }
      });
    } catch (error) {
      log.error('Failed to send typing indicator', error, 'typingService');
    }
  }

  /**
   * Send typing stopped indicator
   */
  async sendStoppedTyping(senderId: string, receiverId: string): Promise<void> {
    const channelName = this.getChatChannelName(senderId, receiverId);

    try {
      const channel = this.channels.get(channelName);
      if (channel) {
        await channel.send({
          type: 'broadcast',
          event: 'typing',
          payload: {
            userId: senderId,
            isTyping: false,
            timestamp: Date.now()
          }
        });
      }
    } catch (error) {
      log.error('Failed to send stopped typing', error, 'typingService');
    }
  }

  /**
   * Send typing indicator for group chat
   */
  async sendGroupTyping(senderId: string, groupId: string): Promise<void> {
    const channelName = this.getGroupChannelName(groupId);
    const now = Date.now();

    // Debounce
    const lastEvent = this.lastTypingEvent.get(channelName) || 0;
    if (now - lastEvent < TYPING_DEBOUNCE) {
      return;
    }
    this.lastTypingEvent.set(channelName, now);

    try {
      let channel = this.channels.get(channelName);

      if (!channel) {
        channel = supabase.channel(channelName);
        await channel.subscribe();
        this.channels.set(channelName, channel);
      }

      await channel.send({
        type: 'broadcast',
        event: 'typing',
        payload: {
          userId: senderId,
          isTyping: true,
          timestamp: now
        }
      });
    } catch (error) {
      log.error('Failed to send group typing indicator', error, 'typingService');
    }
  }

  /**
   * Send stopped typing for group
   */
  async sendGroupStoppedTyping(senderId: string, groupId: string): Promise<void> {
    const channelName = this.getGroupChannelName(groupId);

    try {
      const channel = this.channels.get(channelName);
      if (channel) {
        await channel.send({
          type: 'broadcast',
          event: 'typing',
          payload: {
            userId: senderId,
            isTyping: false,
            timestamp: Date.now()
          }
        });
      }
    } catch (error) {
      log.error('Failed to send group stopped typing', error, 'typingService');
    }
  }

  /**
   * Subscribe to typing indicators for a direct chat
   */
  subscribeToTyping(
    currentUserId: string,
    otherUserId: string,
    onTypingChange: (userId: string, isTyping: boolean) => void
  ): TypingSubscription {
    const channelName = this.getChatChannelName(currentUserId, otherUserId);

    const channel = supabase.channel(channelName);

    channel.on('broadcast', { event: 'typing' }, (payload) => {
      const { userId, isTyping } = payload.payload;

      // Ignore our own typing events
      if (userId === currentUserId) return;

      // Clear existing timeout for this user
      const timeoutKey = `${channelName}:${userId}`;
      const existingTimeout = this.typingTimeouts.get(timeoutKey);
      if (existingTimeout) {
        clearTimeout(existingTimeout);
      }

      if (isTyping) {
        onTypingChange(userId, true);

        // Auto-expire typing state after timeout
        const timeout = setTimeout(() => {
          onTypingChange(userId, false);
          this.typingTimeouts.delete(timeoutKey);
        }, TYPING_TIMEOUT);

        this.typingTimeouts.set(timeoutKey, timeout);
      } else {
        onTypingChange(userId, false);
        this.typingTimeouts.delete(timeoutKey);
      }
    });

    channel.subscribe();
    this.channels.set(channelName, channel);

    return {
      unsubscribe: () => {
        channel.unsubscribe();
        this.channels.delete(channelName);

        // Clear all timeouts for this channel
        this.typingTimeouts.forEach((timeout, key) => {
          if (key.startsWith(channelName)) {
            clearTimeout(timeout);
            this.typingTimeouts.delete(key);
          }
        });
      }
    };
  }

  /**
   * Subscribe to typing indicators for a group chat
   */
  subscribeToGroupTyping(
    currentUserId: string,
    groupId: string,
    onTypingChange: (userId: string, isTyping: boolean) => void
  ): TypingSubscription {
    const channelName = this.getGroupChannelName(groupId);

    const channel = supabase.channel(channelName);

    channel.on('broadcast', { event: 'typing' }, (payload) => {
      const { userId, isTyping } = payload.payload;

      // Ignore our own typing events
      if (userId === currentUserId) return;

      // Clear existing timeout for this user
      const timeoutKey = `${channelName}:${userId}`;
      const existingTimeout = this.typingTimeouts.get(timeoutKey);
      if (existingTimeout) {
        clearTimeout(existingTimeout);
      }

      if (isTyping) {
        onTypingChange(userId, true);

        // Auto-expire typing state
        const timeout = setTimeout(() => {
          onTypingChange(userId, false);
          this.typingTimeouts.delete(timeoutKey);
        }, TYPING_TIMEOUT);

        this.typingTimeouts.set(timeoutKey, timeout);
      } else {
        onTypingChange(userId, false);
        this.typingTimeouts.delete(timeoutKey);
      }
    });

    channel.subscribe();
    this.channels.set(channelName, channel);

    return {
      unsubscribe: () => {
        channel.unsubscribe();
        this.channels.delete(channelName);

        // Clear all timeouts for this channel
        this.typingTimeouts.forEach((timeout, key) => {
          if (key.startsWith(channelName)) {
            clearTimeout(timeout);
            this.typingTimeouts.delete(key);
          }
        });
      }
    };
  }

  /**
   * Cleanup all subscriptions
   */
  cleanup(): void {
    this.channels.forEach((channel) => {
      channel.unsubscribe();
    });
    this.channels.clear();

    this.typingTimeouts.forEach((timeout) => {
      clearTimeout(timeout);
    });
    this.typingTimeouts.clear();

    this.lastTypingEvent.clear();
  }
}

export const typingService = new TypingService();
