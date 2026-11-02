/**
 * Typing Service — Real-time typing & voice-recording indicators
 *
 * Purely ephemeral: nothing is persisted to a database. A "typing" event is
 * sent as a tiny POST to the Worker (see worker/src/routes/messages.ts
 * POST /messages/typing), which immediately fans it out into the other
 * user's personal realtime room over the shared WebSocket
 * (src/lib/realtimeClient.ts) — no Supabase Realtime channel needed.
 *
 * The "recording a voice message" indicator (POST /messages/recording)
 * works identically — same debounce/auto-expire/subscribe shape, just a
 * distinct event type — so a chat can show "recording audio..." instead of
 * plain typing dots while the other person is holding the mic button, the
 * same way WhatsApp distinguishes the two.
 *
 * Group typing/recording (POST /groups/:id/typing, POST /groups/:id/recording,
 * see worker/src/routes/groups.ts) work the same way, fanned out to every
 * *other* member's personal realtime room as `group-typing`/`group-recording`
 * events. The one structural difference from the 1:1 case is that more than
 * one group member can be typing/recording at once, so timeouts here are
 * keyed per `groupId:userId` pair (not just per group) and the subscribe
 * callback can fire for any member — the caller (GroupChatView, Groups list)
 * is responsible for tracking the resulting set of active user ids.
 */
import { apiFetch } from '../lib/apiClient';
import { realtimeClient } from '../lib/realtimeClient';
import { log } from '../utils/logger';

// Typing/recording state expires after this duration (ms) if no further
// event arrives (e.g. the other tab/app closed mid-keystroke or mid-hold).
const TYPING_TIMEOUT = 3000;

// Debounce outgoing "is typing" events (ms) — "stopped typing" always sends immediately
const TYPING_DEBOUNCE = 500;

export interface TypingState {
  senderId: string;
  isTyping: boolean;
  timestamp: number;
}

export interface TypingSubscription {
  unsubscribe: () => void;
}

class TypingService {
  private typingTimeouts: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private lastTypingEvent: Map<string, number> = new Map();
  private recordingTimeouts: Map<string, ReturnType<typeof setTimeout>> = new Map();

  // Group variants of the three maps above, kept entirely separate so a bug
  // in one can never affect the other (same reasoning as the 1:1 maps).
  private groupTypingTimeouts: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private lastGroupTypingEvent: Map<string, number> = new Map();
  private groupRecordingTimeouts: Map<string, ReturnType<typeof setTimeout>> = new Map();

  private async sendTypingEvent(receiverId: string, isTyping: boolean): Promise<void> {
    try {
      await apiFetch('/messages/typing', {
        method: 'POST',
        body: JSON.stringify({ receiver_id: receiverId, is_typing: isTyping })
      });
    } catch (error) {
      log.error('Failed to send typing indicator', error, 'typingService');
    }
  }

  private async sendRecordingEvent(receiverId: string, isRecording: boolean): Promise<void> {
    try {
      await apiFetch('/messages/recording', {
        method: 'POST',
        body: JSON.stringify({ receiver_id: receiverId, is_recording: isRecording })
      });
    } catch (error) {
      log.error('Failed to send recording indicator', error, 'typingService');
    }
  }

  private async sendGroupTypingEvent(groupId: string, isTyping: boolean): Promise<void> {
    try {
      await apiFetch(`/groups/${groupId}/typing`, {
        method: 'POST',
        body: JSON.stringify({ is_typing: isTyping })
      });
    } catch (error) {
      log.error('Failed to send group typing indicator', error, 'typingService');
    }
  }

  private async sendGroupRecordingEvent(groupId: string, isRecording: boolean): Promise<void> {
    try {
      await apiFetch(`/groups/${groupId}/recording`, {
        method: 'POST',
        body: JSON.stringify({ is_recording: isRecording })
      });
    } catch (error) {
      log.error('Failed to send group recording indicator', error, 'typingService');
    }
  }

  /**
   * Tell a contact "I'm recording a voice message" / "I stopped". Unlike
   * sendTyping, this isn't debounced on the way out — holding the mic button
   * is a single discrete start/stop, not a stream of keystrokes, so there's
   * no flood of calls to coalesce.
   */
  async sendRecording(_senderId: string, receiverId: string): Promise<void> {
    await this.sendRecordingEvent(receiverId, true);
  }

  /** Send "stopped recording" (release, send, cancel, or unmount — always sent immediately) */
  async sendStoppedRecording(_senderId: string, receiverId: string): Promise<void> {
    await this.sendRecordingEvent(receiverId, false);
  }

  /**
   * Subscribe to "recording a voice message" indicators from one specific
   * contact. Same shape as subscribeToTyping (see below) — one handler per
   * friend, all sharing the single underlying WebSocket.
   */
  subscribeToRecording(
    currentUserId: string,
    otherUserId: string,
    onRecordingChange: (userId: string, isRecording: boolean) => void
  ): TypingSubscription {
    const timeoutKey = `${currentUserId}:${otherUserId}`;

    const sub = realtimeClient.on('recording', (payload) => {
      if (payload?.sender_id !== otherUserId) return;

      const existingTimeout = this.recordingTimeouts.get(timeoutKey);
      if (existingTimeout) {
        clearTimeout(existingTimeout);
        this.recordingTimeouts.delete(timeoutKey);
      }

      if (payload.is_recording) {
        onRecordingChange(otherUserId, true);

        // Auto-expire in case a "stopped recording" event never arrives
        // (e.g. the other device lost its connection mid-hold).
        const timeout = setTimeout(() => {
          onRecordingChange(otherUserId, false);
          this.recordingTimeouts.delete(timeoutKey);
        }, TYPING_TIMEOUT);
        this.recordingTimeouts.set(timeoutKey, timeout);
      } else {
        onRecordingChange(otherUserId, false);
      }
    });

    return {
      unsubscribe: () => {
        sub.unsubscribe();
        const existingTimeout = this.recordingTimeouts.get(timeoutKey);
        if (existingTimeout) {
          clearTimeout(existingTimeout);
          this.recordingTimeouts.delete(timeoutKey);
        }
      }
    };
  }

  /** Send typing indicator for a direct chat (debounced) */
  async sendTyping(_senderId: string, receiverId: string): Promise<void> {
    const now = Date.now();
    const lastEvent = this.lastTypingEvent.get(receiverId) || 0;
    if (now - lastEvent < TYPING_DEBOUNCE) return;
    this.lastTypingEvent.set(receiverId, now);

    await this.sendTypingEvent(receiverId, true);
  }

  /** Send "stopped typing" for a direct chat (always sent immediately) */
  async sendStoppedTyping(_senderId: string, receiverId: string): Promise<void> {
    this.lastTypingEvent.delete(receiverId);
    await this.sendTypingEvent(receiverId, false);
  }

  /** Send typing indicator for a group chat (debounced, same as 1:1). */
  async sendGroupTyping(_senderId: string, groupId: string): Promise<void> {
    const now = Date.now();
    const lastEvent = this.lastGroupTypingEvent.get(groupId) || 0;
    if (now - lastEvent < TYPING_DEBOUNCE) return;
    this.lastGroupTypingEvent.set(groupId, now);

    await this.sendGroupTypingEvent(groupId, true);
  }

  /** Send "stopped typing" for a group chat (always sent immediately). */
  async sendGroupStoppedTyping(_senderId: string, groupId: string): Promise<void> {
    this.lastGroupTypingEvent.delete(groupId);
    await this.sendGroupTypingEvent(groupId, false);
  }

  /**
   * Tell a group "I'm recording a voice message" / "I stopped". Same shape
   * as sendRecording — not debounced, a single discrete start/stop.
   */
  async sendGroupRecording(_senderId: string, groupId: string): Promise<void> {
    await this.sendGroupRecordingEvent(groupId, true);
  }

  /** Send "stopped recording" for a group (release, send, cancel, or unmount). */
  async sendGroupStoppedRecording(_senderId: string, groupId: string): Promise<void> {
    await this.sendGroupRecordingEvent(groupId, false);
  }

  /**
   * Subscribe to typing indicators from one specific contact. Many of these
   * can be active at once (e.g. the Chats list subscribes per-friend to show
   * "typing..." previews), all sharing the single underlying WebSocket.
   */
  subscribeToTyping(
    currentUserId: string,
    otherUserId: string,
    onTypingChange: (userId: string, isTyping: boolean) => void
  ): TypingSubscription {
    const timeoutKey = `${currentUserId}:${otherUserId}`;

    const sub = realtimeClient.on('typing', (payload) => {
      if (payload?.sender_id !== otherUserId) return;

      const existingTimeout = this.typingTimeouts.get(timeoutKey);
      if (existingTimeout) {
        clearTimeout(existingTimeout);
        this.typingTimeouts.delete(timeoutKey);
      }

      if (payload.is_typing) {
        onTypingChange(otherUserId, true);

        // Auto-expire in case a "stopped typing" event never arrives
        // (e.g. the other tab/app closed mid-keystroke).
        const timeout = setTimeout(() => {
          onTypingChange(otherUserId, false);
          this.typingTimeouts.delete(timeoutKey);
        }, TYPING_TIMEOUT);
        this.typingTimeouts.set(timeoutKey, timeout);
      } else {
        onTypingChange(otherUserId, false);
      }
    });

    return {
      unsubscribe: () => {
        sub.unsubscribe();
        const existingTimeout = this.typingTimeouts.get(timeoutKey);
        if (existingTimeout) {
          clearTimeout(existingTimeout);
          this.typingTimeouts.delete(timeoutKey);
        }
      }
    };
  }

  /**
   * Subscribe to typing indicators for a group. Unlike the 1:1 version,
   * more than one member can be typing at once — the handler fires once
   * per member whose state changes (identified by `userId`), and each
   * member gets its own independent auto-expire timeout, keyed by
   * `groupId:userId`. The caller (GroupChatView, the Groups list) is
   * responsible for keeping a Set of currently-typing member ids.
   */
  subscribeToGroupTyping(
    currentUserId: string,
    groupId: string,
    onTypingChange: (userId: string, isTyping: boolean) => void
  ): TypingSubscription {
    const sub = realtimeClient.on('group-typing', (payload) => {
      if (payload?.group_id !== groupId) return;
      if (payload.sender_id === currentUserId) return; // never our own echo
      const senderId = payload.sender_id as string;
      const timeoutKey = `${groupId}:${senderId}`;

      const existingTimeout = this.groupTypingTimeouts.get(timeoutKey);
      if (existingTimeout) {
        clearTimeout(existingTimeout);
        this.groupTypingTimeouts.delete(timeoutKey);
      }

      if (payload.is_typing) {
        onTypingChange(senderId, true);

        // Auto-expire in case a "stopped typing" event never arrives.
        const timeout = setTimeout(() => {
          onTypingChange(senderId, false);
          this.groupTypingTimeouts.delete(timeoutKey);
        }, TYPING_TIMEOUT);
        this.groupTypingTimeouts.set(timeoutKey, timeout);
      } else {
        onTypingChange(senderId, false);
      }
    });

    return {
      unsubscribe: () => {
        sub.unsubscribe();
        // Clear every pending timeout for this group (we don't know which
        // member ids were ever seen, so sweep by key prefix).
        this.groupTypingTimeouts.forEach((timeout, key) => {
          if (key.startsWith(`${groupId}:`)) {
            clearTimeout(timeout);
            this.groupTypingTimeouts.delete(key);
          }
        });
      }
    };
  }

  /**
   * Subscribe to "recording a voice message" indicators for a group. Same
   * multi-member shape as subscribeToGroupTyping above.
   */
  subscribeToGroupRecording(
    currentUserId: string,
    groupId: string,
    onRecordingChange: (userId: string, isRecording: boolean) => void
  ): TypingSubscription {
    const sub = realtimeClient.on('group-recording', (payload) => {
      if (payload?.group_id !== groupId) return;
      if (payload.sender_id === currentUserId) return;
      const senderId = payload.sender_id as string;
      const timeoutKey = `${groupId}:${senderId}`;

      const existingTimeout = this.groupRecordingTimeouts.get(timeoutKey);
      if (existingTimeout) {
        clearTimeout(existingTimeout);
        this.groupRecordingTimeouts.delete(timeoutKey);
      }

      if (payload.is_recording) {
        onRecordingChange(senderId, true);

        const timeout = setTimeout(() => {
          onRecordingChange(senderId, false);
          this.groupRecordingTimeouts.delete(timeoutKey);
        }, TYPING_TIMEOUT);
        this.groupRecordingTimeouts.set(timeoutKey, timeout);
      } else {
        onRecordingChange(senderId, false);
      }
    });

    return {
      unsubscribe: () => {
        sub.unsubscribe();
        this.groupRecordingTimeouts.forEach((timeout, key) => {
          if (key.startsWith(`${groupId}:`)) {
            clearTimeout(timeout);
            this.groupRecordingTimeouts.delete(key);
          }
        });
      }
    };
  }

  /** Cleanup all pending timeouts (call on logout) */
  cleanup(): void {
    this.typingTimeouts.forEach((timeout) => clearTimeout(timeout));
    this.typingTimeouts.clear();
    this.lastTypingEvent.clear();
    this.recordingTimeouts.forEach((timeout) => clearTimeout(timeout));
    this.recordingTimeouts.clear();
    this.groupTypingTimeouts.forEach((timeout) => clearTimeout(timeout));
    this.groupTypingTimeouts.clear();
    this.lastGroupTypingEvent.clear();
    this.groupRecordingTimeouts.forEach((timeout) => clearTimeout(timeout));
    this.groupRecordingTimeouts.clear();
  }
}

export const typingService = new TypingService();
