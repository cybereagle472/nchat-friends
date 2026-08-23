/**
 * useTyping Hook - Typing indicator management
 *
 * Provides easy-to-use typing indicator functionality for chat components
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { typingService, TypingSubscription } from '../services/typingService';

export interface UseTypingOptions {
  currentUserId: string | null;
  chatPartnerId?: string | null; // For direct chats
  groupId?: string | null; // For group chats
}

export interface UseTypingReturn {
  /** List of user IDs currently typing */
  typingUsers: string[];
  /** Whether the partner is typing (for direct chats) */
  isPartnerTyping: boolean;
  /** Call this when user types in the input */
  handleTyping: () => void;
  /** Call this when user stops typing (blur, send, etc.) */
  handleStopTyping: () => void;
}

// Auto-stop typing after this duration of no keystrokes
const STOP_TYPING_DELAY = 2000;

export function useTyping(options: UseTypingOptions): UseTypingReturn {
  const { currentUserId, chatPartnerId, groupId } = options;

  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const subscriptionRef = useRef<TypingSubscription | null>(null);
  const stopTypingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isTypingRef = useRef(false);

  // Handle typing change callback
  const handleTypingChange = useCallback((userId: string, isTyping: boolean) => {
    setTypingUsers((prev) => {
      if (isTyping) {
        if (!prev.includes(userId)) {
          return [...prev, userId];
        }
        return prev;
      } else {
        return prev.filter((id) => id !== userId);
      }
    });
  }, []);

  // Subscribe to typing events
  useEffect(() => {
    if (!currentUserId) return;

    // Clean up previous subscription
    if (subscriptionRef.current) {
      subscriptionRef.current.unsubscribe();
      subscriptionRef.current = null;
    }

    // Reset typing users
    setTypingUsers([]);

    if (chatPartnerId) {
      // Direct chat subscription
      subscriptionRef.current = typingService.subscribeToTyping(
        currentUserId,
        chatPartnerId,
        handleTypingChange
      );
    } else if (groupId) {
      // Group chat subscription
      subscriptionRef.current = typingService.subscribeToGroupTyping(
        currentUserId,
        groupId,
        handleTypingChange
      );
    }

    return () => {
      if (subscriptionRef.current) {
        subscriptionRef.current.unsubscribe();
        subscriptionRef.current = null;
      }
    };
  }, [currentUserId, chatPartnerId, groupId, handleTypingChange]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (stopTypingTimeoutRef.current) {
        clearTimeout(stopTypingTimeoutRef.current);
      }
    };
  }, []);

  // Handle user typing
  const handleTyping = useCallback(() => {
    if (!currentUserId) return;

    // Clear existing stop-typing timeout
    if (stopTypingTimeoutRef.current) {
      clearTimeout(stopTypingTimeoutRef.current);
    }

    // Send typing event (debounced inside service)
    if (chatPartnerId) {
      typingService.sendTyping(currentUserId, chatPartnerId);
    } else if (groupId) {
      typingService.sendGroupTyping(currentUserId, groupId);
    }

    isTypingRef.current = true;

    // Set timeout to auto-stop typing
    stopTypingTimeoutRef.current = setTimeout(() => {
      if (isTypingRef.current) {
        handleStopTyping();
      }
    }, STOP_TYPING_DELAY);
  }, [currentUserId, chatPartnerId, groupId]);

  // Handle stop typing
  const handleStopTyping = useCallback(() => {
    if (!currentUserId) return;

    // Clear timeout
    if (stopTypingTimeoutRef.current) {
      clearTimeout(stopTypingTimeoutRef.current);
      stopTypingTimeoutRef.current = null;
    }

    if (!isTypingRef.current) return;

    isTypingRef.current = false;

    // Send stop typing event
    if (chatPartnerId) {
      typingService.sendStoppedTyping(currentUserId, chatPartnerId);
    } else if (groupId) {
      typingService.sendGroupStoppedTyping(currentUserId, groupId);
    }
  }, [currentUserId, chatPartnerId, groupId]);

  return {
    typingUsers,
    isPartnerTyping: chatPartnerId ? typingUsers.includes(chatPartnerId) : false,
    handleTyping,
    handleStopTyping
  };
}

export default useTyping;
