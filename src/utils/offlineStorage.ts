/**
 * Offline-First Storage Engine for NChat
 *
 * Features:
 * - IndexedDB for local message persistence
 * - Pending message queue with retry logic
 * - Sync status tracking (pending, sent, delivered, read)
 * - Profile caching for instant app load
 * - Conflict resolution with server timestamps
 */

import { Message, UserProfile } from '../types';
import { log } from './logger';

const DB_NAME = 'NChat_Offline_v2';
const DB_VERSION = 2;

const STORES = {
  MESSAGES: 'messages',
  PENDING_QUEUE: 'pending_queue',
  PROFILES: 'profiles',
  CHAT_META: 'chat_meta',
  SYNC_STATE: 'sync_state'
} as const;

export type MessageSyncStatus = 'pending' | 'sending' | 'sent' | 'delivered' | 'read' | 'failed';

export interface LocalMessage extends Message {
  chatId: string;
  syncStatus: MessageSyncStatus;
  clientMessageId: string;
  localCreatedAt: string;
  serverCreatedAt?: string;
  retryCount: number;
  lastRetryAt?: string;
}

export interface PendingMessage {
  clientMessageId: string;
  senderId: string;
  receiverId?: string;  // Optional for group messages
  groupId?: string;     // For group messages
  content: string;
  type: string;
  messageType?: 'direct' | 'group';  // To distinguish message types
  duration?: number;
  waveform?: string;
  replyToId?: string;
  createdAt: string;
  retryCount: number;
  lastRetryAt?: string;
  status: 'queued' | 'sending' | 'failed';
}

export interface ChatMeta {
  chatId: string;
  lastMessageId?: string;
  lastSyncedAt: string;
  unreadCount: number;
}

export interface SyncState {
  key: string;
  lastSyncedAt: string;
  cursor?: string;
}

let dbInstance: IDBDatabase | null = null;

const openDB = (): Promise<IDBDatabase> => {
  if (dbInstance) {
    return Promise.resolve(dbInstance);
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);

    request.onsuccess = () => {
      dbInstance = request.result;
      resolve(dbInstance);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      if (!db.objectStoreNames.contains(STORES.MESSAGES)) {
        const messagesStore = db.createObjectStore(STORES.MESSAGES, { keyPath: 'id' });
        messagesStore.createIndex('chatId', 'chatId', { unique: false });
        messagesStore.createIndex('clientMessageId', 'clientMessageId', { unique: true });
        messagesStore.createIndex('syncStatus', 'syncStatus', { unique: false });
        messagesStore.createIndex('created_at', 'created_at', { unique: false });
        messagesStore.createIndex('chatId_created', ['chatId', 'created_at'], { unique: false });
      }

      if (!db.objectStoreNames.contains(STORES.PENDING_QUEUE)) {
        const pendingStore = db.createObjectStore(STORES.PENDING_QUEUE, { keyPath: 'clientMessageId' });
        pendingStore.createIndex('status', 'status', { unique: false });
        pendingStore.createIndex('createdAt', 'createdAt', { unique: false });
      }

      if (!db.objectStoreNames.contains(STORES.PROFILES)) {
        db.createObjectStore(STORES.PROFILES, { keyPath: 'id' });
      }

      if (!db.objectStoreNames.contains(STORES.CHAT_META)) {
        db.createObjectStore(STORES.CHAT_META, { keyPath: 'chatId' });
      }

      if (!db.objectStoreNames.contains(STORES.SYNC_STATE)) {
        db.createObjectStore(STORES.SYNC_STATE, { keyPath: 'key' });
      }
    };
  });
};

export const generateClientMessageId = (): string => {
  return crypto.randomUUID ? crypto.randomUUID() :
    `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
};

export const getChatId = (userId1: string, userId2: string): string => {
  return [userId1, userId2].sort().join('_');
};

export const saveMessage = async (message: LocalMessage): Promise<void> => {
  const db = await openDB();
  const transaction = db.transaction(STORES.MESSAGES, 'readwrite');
  const store = transaction.objectStore(STORES.MESSAGES);
  store.put(message);

  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
};

export const saveMessages = async (messages: LocalMessage[]): Promise<void> => {
  if (messages.length === 0) return;

  const db = await openDB();
  const transaction = db.transaction(STORES.MESSAGES, 'readwrite');
  const store = transaction.objectStore(STORES.MESSAGES);

  for (const message of messages) {
    const request = store.put(message);
    // Never let one bad/colliding record (e.g. a duplicate unique-index
    // value from a stale local row) abort the whole batch — that would
    // silently drop every other message in this sync, including ones that
    // have nothing wrong with them. Log it and let the rest of the batch
    // continue to commit.
    request.onerror = (event) => {
      log.warn('Failed to save one message to local cache, skipping it', request.error, 'offlineStorage');
      event.preventDefault();
    };
  }

  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
};

export const getMessage = async (messageId: string): Promise<LocalMessage | null> => {
  const db = await openDB();
  const transaction = db.transaction(STORES.MESSAGES, 'readonly');
  const store = transaction.objectStore(STORES.MESSAGES);

  return new Promise((resolve, reject) => {
    const request = store.get(messageId);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
};

export const getMessageByClientId = async (clientMessageId: string): Promise<LocalMessage | null> => {
  const db = await openDB();
  const transaction = db.transaction(STORES.MESSAGES, 'readonly');
  const store = transaction.objectStore(STORES.MESSAGES);
  const index = store.index('clientMessageId');

  return new Promise((resolve, reject) => {
    const request = index.get(clientMessageId);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
};

export const getChatMessages = async (
  chatId: string,
  limit = 50,
  beforeTimestamp?: string
): Promise<LocalMessage[]> => {
  const db = await openDB();
  const transaction = db.transaction(STORES.MESSAGES, 'readonly');
  const store = transaction.objectStore(STORES.MESSAGES);
  // Use the compound [chatId, created_at] index, not the plain `chatId` one.
  // A plain-index cursor over records that all share the same chatId value
  // (i.e. every message in a real conversation) secondarily sorts by
  // *primary key* — here a random UUID — not by time. Walking it 'prev'
  // therefore returned an arbitrary ~`limit` messages ordered by UUID, not
  // the most recent ones: whichever side's message ids happened to sort
  // later would dominate the result, and the other person's messages could
  // be entirely squeezed out once a chat had more than `limit` messages.
  const index = store.index('chatId_created');
  const upper = beforeTimestamp ?? '\uffff';
  const range = IDBKeyRange.bound([chatId, ''], [chatId, upper], false, !!beforeTimestamp);

  return new Promise((resolve, reject) => {
    const messages: LocalMessage[] = [];
    const request = index.openCursor(range, 'prev');

    request.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;

      if (cursor && messages.length < limit) {
        messages.push(cursor.value as LocalMessage);
        cursor.continue();
      } else {
        resolve(messages.reverse());
      }
    };

    request.onerror = () => reject(request.error);
  });
};

export const updateMessageSyncStatus = async (
  messageId: string,
  syncStatus: MessageSyncStatus,
  serverId?: string,
  serverCreatedAt?: string
): Promise<void> => {
  const db = await openDB();
  const transaction = db.transaction(STORES.MESSAGES, 'readwrite');
  const store = transaction.objectStore(STORES.MESSAGES);

  return new Promise((resolve, reject) => {
    const getRequest = store.get(messageId);

    getRequest.onsuccess = () => {
      const message = getRequest.result;
      if (message) {
        message.syncStatus = syncStatus;
        if (serverCreatedAt) message.serverCreatedAt = serverCreatedAt;

        if (serverId && serverId !== messageId) {
          // The record's primary key (`id`, the object store's keyPath) is
          // changing from a local optimistic id to the server-assigned one.
          // `store.put()` would otherwise INSERT a new row under the new key
          // while leaving the old one behind — a leftover duplicate that
          // still carries the same `clientMessageId`. Since that field has
          // a unique index, every future sync batch that re-saves this same
          // message (now fetched from the server) collides with that
          // leftover row and throws, silently aborting the ENTIRE batch
          // transaction — which can make a whole chat's messages vanish
          // from local storage even though nothing is wrong with them.
          // Deleting the old key first turns this into a clean rename.
          message.id = serverId;
          const deleteRequest = store.delete(messageId);
          deleteRequest.onsuccess = () => {
            store.put(message);
          };
        } else {
          store.put(message);
        }
      }
    };

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
};

export const deleteMessage = async (messageId: string): Promise<void> => {
  const db = await openDB();
  const transaction = db.transaction(STORES.MESSAGES, 'readwrite');
  const store = transaction.objectStore(STORES.MESSAGES);
  store.delete(messageId);

  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
};

/**
 * One-time self-heal for a bug (now fixed in updateMessageSyncStatus) that
 * could leave a leftover row behind when a locally-sent message's temporary
 * id was swapped for the real server id: instead of being renamed, a
 * duplicate row stuck around under the old temp id, still claiming the same
 * (unique-indexed) clientMessageId as the new, correctly-keyed row. Every
 * future sync that tried to re-save that message then hit a constraint
 * violation and silently aborted its *entire* batch — which could wipe out
 * someone else's messages from local storage even though nothing was wrong
 * with them. This repairs any such leftover rows already sitting in a
 * user's browser from before the fix, since shipping the fix alone doesn't
 * touch data that's already on their device. Safe to run repeatedly.
 */
export const repairDuplicateClientMessageIds = async (): Promise<number> => {
  const db = await openDB();
  const transaction = db.transaction(STORES.MESSAGES, 'readwrite');
  const store = transaction.objectStore(STORES.MESSAGES);

  return new Promise((resolve) => {
    const groups = new Map<string, LocalMessage[]>();
    const request = store.openCursor();
    let removed = 0;

    request.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
      if (cursor) {
        const msg = cursor.value as LocalMessage;
        const key = msg.clientMessageId || msg.id;
        const existing = groups.get(key);
        if (existing) existing.push(msg);
        else groups.set(key, [msg]);
        cursor.continue();
        return;
      }

      // Cursor done — resolve which duplicates to drop.
      for (const rows of groups.values()) {
        if (rows.length < 2) continue;

        // Prefer a row that looks like it has a real server id and isn't
        // stuck pending/failed; fall back to the most recently synced one.
        const isTempId = (id: string) => id.startsWith('temp_');
        const best = rows.reduce((a, b) => {
          const aGood = !isTempId(a.id) && a.syncStatus !== 'pending' && a.syncStatus !== 'failed';
          const bGood = !isTempId(b.id) && b.syncStatus !== 'pending' && b.syncStatus !== 'failed';
          if (aGood !== bGood) return aGood ? a : b;
          return (b.serverCreatedAt || b.localCreatedAt) > (a.serverCreatedAt || a.localCreatedAt) ? b : a;
        });

        for (const row of rows) {
          if (row.id !== best.id) {
            store.delete(row.id);
            removed++;
          }
        }
      }
    };

    request.onerror = () => resolve(0);
    transaction.oncomplete = () => resolve(removed);
    transaction.onerror = () => resolve(removed);
  });
};

export const queuePendingMessage = async (message: PendingMessage): Promise<void> => {
  const db = await openDB();
  const transaction = db.transaction(STORES.PENDING_QUEUE, 'readwrite');
  const store = transaction.objectStore(STORES.PENDING_QUEUE);
  store.put(message);

  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
};

export const getPendingMessages = async (): Promise<PendingMessage[]> => {
  const db = await openDB();
  const transaction = db.transaction(STORES.PENDING_QUEUE, 'readonly');
  const store = transaction.objectStore(STORES.PENDING_QUEUE);

  return new Promise((resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
};

export const updatePendingMessageStatus = async (
  clientMessageId: string,
  status: PendingMessage['status'],
  retryCount?: number
): Promise<void> => {
  const db = await openDB();
  const transaction = db.transaction(STORES.PENDING_QUEUE, 'readwrite');
  const store = transaction.objectStore(STORES.PENDING_QUEUE);

  return new Promise((resolve, reject) => {
    const getRequest = store.get(clientMessageId);

    getRequest.onsuccess = () => {
      const message = getRequest.result;
      if (message) {
        message.status = status;
        if (retryCount !== undefined) {
          message.retryCount = retryCount;
          message.lastRetryAt = new Date().toISOString();
        }
        store.put(message);
      }
    };

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
};

export const removePendingMessage = async (clientMessageId: string): Promise<void> => {
  const db = await openDB();
  const transaction = db.transaction(STORES.PENDING_QUEUE, 'readwrite');
  const store = transaction.objectStore(STORES.PENDING_QUEUE);
  store.delete(clientMessageId);

  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
};

export const cacheProfile = async (profile: UserProfile): Promise<void> => {
  const db = await openDB();
  const transaction = db.transaction(STORES.PROFILES, 'readwrite');
  const store = transaction.objectStore(STORES.PROFILES);
  store.put({ ...profile, cachedAt: new Date().toISOString() });

  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
};

export const cacheProfiles = async (profiles: UserProfile[]): Promise<void> => {
  if (profiles.length === 0) return;

  const db = await openDB();
  const transaction = db.transaction(STORES.PROFILES, 'readwrite');
  const store = transaction.objectStore(STORES.PROFILES);
  const cachedAt = new Date().toISOString();

  for (const profile of profiles) {
    store.put({ ...profile, cachedAt });
  }

  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
};

export const getCachedProfile = async (userId: string): Promise<UserProfile | null> => {
  const db = await openDB();
  const transaction = db.transaction(STORES.PROFILES, 'readonly');
  const store = transaction.objectStore(STORES.PROFILES);

  return new Promise((resolve, reject) => {
    const request = store.get(userId);
    request.onsuccess = () => {
      const result = request.result;
      if (result) {
        const { cachedAt, ...profile } = result;
        resolve(profile as UserProfile);
      } else {
        resolve(null);
      }
    };
    request.onerror = () => reject(request.error);
  });
};

export const getAllCachedProfiles = async (): Promise<UserProfile[]> => {
  const db = await openDB();
  const transaction = db.transaction(STORES.PROFILES, 'readonly');
  const store = transaction.objectStore(STORES.PROFILES);

  return new Promise((resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => {
      const results = request.result || [];
      resolve(results.map(({ cachedAt, ...profile }) => profile as UserProfile));
    };
    request.onerror = () => reject(request.error);
  });
};

export const saveChatMeta = async (meta: ChatMeta): Promise<void> => {
  const db = await openDB();
  const transaction = db.transaction(STORES.CHAT_META, 'readwrite');
  const store = transaction.objectStore(STORES.CHAT_META);
  store.put(meta);

  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
};

export const getChatMeta = async (chatId: string): Promise<ChatMeta | null> => {
  const db = await openDB();
  const transaction = db.transaction(STORES.CHAT_META, 'readonly');
  const store = transaction.objectStore(STORES.CHAT_META);

  return new Promise((resolve, reject) => {
    const request = store.get(chatId);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
};

export const saveSyncState = async (state: SyncState): Promise<void> => {
  const db = await openDB();
  const transaction = db.transaction(STORES.SYNC_STATE, 'readwrite');
  const store = transaction.objectStore(STORES.SYNC_STATE);
  store.put(state);

  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
};

export const getSyncState = async (key: string): Promise<SyncState | null> => {
  const db = await openDB();
  const transaction = db.transaction(STORES.SYNC_STATE, 'readonly');
  const store = transaction.objectStore(STORES.SYNC_STATE);

  return new Promise((resolve, reject) => {
    const request = store.get(key);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
};

export const clearAllData = async (): Promise<void> => {
  const db = await openDB();
  const storeNames = Object.values(STORES);
  const transaction = db.transaction(storeNames, 'readwrite');

  for (const storeName of storeNames) {
    transaction.objectStore(storeName).clear();
  }

  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
};

export const isOnline = (): boolean => {
  return navigator.onLine;
};

export const setupConnectivityListeners = (
  onOnline: () => void,
  onOffline: () => void
): (() => void) => {
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);

  return () => {
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
  };
};

export const getOfflineStats = async (): Promise<{
  pendingCount: number;
  cachedMessagesCount: number;
  cachedProfilesCount: number;
}> => {
  const db = await openDB();

  const pendingTx = db.transaction(STORES.PENDING_QUEUE, 'readonly');
  const messagesTx = db.transaction(STORES.MESSAGES, 'readonly');
  const profilesTx = db.transaction(STORES.PROFILES, 'readonly');

  const [pendingCount, messagesCount, profilesCount] = await Promise.all([
    new Promise<number>((resolve) => {
      const req = pendingTx.objectStore(STORES.PENDING_QUEUE).count();
      req.onsuccess = () => resolve(req.result);
    }),
    new Promise<number>((resolve) => {
      const req = messagesTx.objectStore(STORES.MESSAGES).count();
      req.onsuccess = () => resolve(req.result);
    }),
    new Promise<number>((resolve) => {
      const req = profilesTx.objectStore(STORES.PROFILES).count();
      req.onsuccess = () => resolve(req.result);
    })
  ]);

  return {
    pendingCount,
    cachedMessagesCount: messagesCount,
    cachedProfilesCount: profilesCount
  };
};
