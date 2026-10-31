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
 * Group typing isn't wired up yet (group conversations don't have a
 * realtime room the client subscribes to at all currently), so those
 * methods are safe no-ops kept only so existing call sites keep compiling.
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

  /** Group typing isn't wired up yet — safe no-op. */
  async sendGroupTyping(_senderId: string, _groupId: string): Promise<void> {
    /* not yet supported */
  }

  /** Group typing isn't wired up yet — safe no-op. */
  async sendGroupStoppedTyping(_senderId: string, _groupId: string): Promise<void> {
    /* not yet supported */
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

  /** Group typing isn't wired up yet — safe no-op subscription. */
  subscribeToGroupTyping(
    _currentUserId: string,
    _groupId: string,
    _onTypingChange: (userId: string, isTyping: boolean) => void
  ): TypingSubscription {
    return { unsubscribe: () => {} };
  }

  /** Cleanup all pending timeouts (call on logout) */
  cleanup(): void {
    this.typingTimeouts.forEach((timeout) => clearTimeout(timeout));
    this.typingTimeouts.clear();
    this.lastTypingEvent.clear();
    this.recordingTimeouts.forEach((timeout) => clearTimeout(timeout));
    this.recordingTimeouts.clear();
  }
}

export const typingService = new TypingService();
