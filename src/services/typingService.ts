import { api, convex } from '../lib/convexClient';

export interface TypingSubscription {
  unsubscribe: () => void;
}

export type TypingState = {
  userId: string;
  isTyping: boolean;
};

type TypingCallback = (userId: string, isTyping: boolean) => void;

// Cache conversation ids between user pairs to avoid repeated lookups.
const conversationCache = new Map<string, string>();

async function getConversationId(
  userId: string,
  otherId: string
): Promise<string | null> {
  const key = [userId, otherId].sort().join(':');
  const cached = conversationCache.get(key);
  if (cached) return cached;
  try {
    const id = await convex.query(api.conversations.getByMembers, {
      userA: userId as never,
      userB: otherId as never,
    });
    if (id) conversationCache.set(key, id);
    return id ?? null;
  } catch {
    return null;
  }
}

export const typingService = {
  /** Signal that `senderId` is typing to `receiverId`. */
  async sendTyping(senderId: string, receiverId: string): Promise<void> {
    try {
      const conversationId = await getConversationId(senderId, receiverId);
      if (!conversationId) return;
      await convex.mutation(api.typing.startTyping, {
        conversationId: conversationId as never,
      });
    } catch {
      /* ignore */
    }
  },

  /** Clear the typing signal when input stops or a message is sent. */
  async sendStoppedTyping(senderId: string, receiverId: string): Promise<void> {
    try {
      const conversationId = await getConversationId(senderId, receiverId);
      if (!conversationId) return;
      await convex.mutation(api.typing.stopTyping, {
        conversationId: conversationId as never,
      });
    } catch {
      /* ignore */
    }
  },

  /**
   * Polling-based subscription for typing indicators (replaces Supabase
   * realtime channel). Calls callback(contactId, true/false) on changes.
   */
  subscribeToTyping(
    userId: string,
    contactId: string,
    callback: TypingCallback
  ): { unsubscribe: () => void } {
    let wasTyping = false;
    let stopped = false;

    const poll = async () => {
      if (stopped) return;
      try {
        const conversationId = await getConversationId(userId, contactId);
        if (!conversationId) return;
        const typingIds = await convex.query(api.typing.whoTyping, {
          conversationId: conversationId as never,
        });
        const isTyping = (typingIds as unknown as string[]).includes(contactId);
        if (isTyping !== wasTyping) {
          wasTyping = isTyping;
          callback(contactId, isTyping);
        }
      } catch {
        /* ignore polling errors */
      }
    };

    poll();
    const interval = setInterval(poll, 1500);
    return {
      unsubscribe: () => {
        stopped = true;
        clearInterval(interval);
      },
    };
  },

  /** Group variant — the group id is a Convex conversation id. */
  async sendGroupTyping(senderId: string, groupId: string): Promise<void> {
    try {
      await convex.mutation(api.typing.startTyping, {
        conversationId: groupId as never,
      });
      void senderId;
    } catch {
      /* ignore */
    }
  },

  async sendGroupStoppedTyping(
    senderId: string,
    groupId: string
  ): Promise<void> {
    try {
      await convex.mutation(api.typing.stopTyping, {
        conversationId: groupId as never,
      });
      void senderId;
    } catch {
      /* ignore */
    }
  },

  /** Polling subscription for typing indicators inside a group. */
  subscribeToGroupTyping(
    _userId: string,
    groupId: string,
    callback: (userId: string, isTyping: boolean) => void
  ): TypingSubscription {
    const known = new Set<string>();
    let firstRun = true;

    const poll = async () => {
      try {
        const ids = (await convex.query(api.typing.whoTyping, {
          conversationId: groupId as never,
        })) as unknown as string[];
        if (!firstRun) {
          for (const id of ids) {
            if (!known.has(id)) callback(id, true);
          }
          for (const id of known) {
            if (!ids.includes(id)) callback(id, false);
          }
        }
        firstRun = false;
        known.clear();
        ids.forEach((id) => known.add(id));
      } catch {
        /* ignore */
      }
    };

    poll();
    const interval = setInterval(poll, 1500);
    return {
      unsubscribe: () => clearInterval(interval),
    };
  },
};
