/**
 * Data Cache Utility
 *
 * Provides fast localStorage-based caching for tab data
 * to eliminate loading delays when switching tabs.
 */

const CACHE_PREFIX = 'nchat_cache_';
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

export const dataCache = {
  /**
   * Get cached data if available and not expired
   */
  get<T>(key: string): T | null {
    try {
      const cached = localStorage.getItem(CACHE_PREFIX + key);
      if (!cached) return null;

      const entry: CacheEntry<T> = JSON.parse(cached);
      const now = Date.now();

      // Return cached data even if slightly stale - will be refreshed in background
      if (now - entry.timestamp < CACHE_DURATION * 2) {
        return entry.data;
      }

      // Remove very stale data
      localStorage.removeItem(CACHE_PREFIX + key);
      return null;
    } catch {
      return null;
    }
  },

  /**
   * Store data in cache
   */
  set<T>(key: string, data: T): void {
    try {
      const entry: CacheEntry<T> = {
        data,
        timestamp: Date.now()
      };
      localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(entry));
    } catch {
      // Storage might be full, clear old entries
      this.cleanup();
    }
  },

  /**
   * Check if cache is fresh (less than cache duration)
   */
  isFresh(key: string): boolean {
    try {
      const cached = localStorage.getItem(CACHE_PREFIX + key);
      if (!cached) return false;

      const entry = JSON.parse(cached);
      return Date.now() - entry.timestamp < CACHE_DURATION;
    } catch {
      return false;
    }
  },

  /**
   * Remove specific cache entry
   */
  remove(key: string): void {
    localStorage.removeItem(CACHE_PREFIX + key);
  },

  /**
   * Clear all cache entries
   */
  clear(): void {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(CACHE_PREFIX)) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(key => localStorage.removeItem(key));
  },

  /**
   * Remove old cache entries
   */
  cleanup(): void {
    const now = Date.now();
    const keysToRemove: string[] = [];

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(CACHE_PREFIX)) {
        try {
          const cached = localStorage.getItem(key);
          if (cached) {
            const entry = JSON.parse(cached);
            if (now - entry.timestamp > CACHE_DURATION * 2) {
              keysToRemove.push(key);
            }
          }
        } catch {
          keysToRemove.push(key);
        }
      }
    }

    keysToRemove.forEach(key => localStorage.removeItem(key));
  }
};

// Cache key generators
export const cacheKeys = {
  chatList: (userId: string) => `chats_${userId}`,
  groups: (userId: string) => `groups_${userId}`,
  friends: (userId: string) => `friends_${userId}`,
  friendRequests: (userId: string) => `friend_requests_${userId}`,
  discover: (userId: string) => `discover_${userId}`,
  callHistory: (userId: string) => `call_history_${userId}`
};
