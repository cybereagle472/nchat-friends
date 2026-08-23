/**
 * Message Utilities
 * Helper functions for message processing and normalization
 */

import { Message } from '../types';

/**
 * Normalizes a raw message object from the database to ensure
 * consistent field names regardless of database column naming
 */
export function normalizeMessage(rawMsg: any): Message {
  if (!rawMsg) return rawMsg;

  return {
    ...rawMsg,
    // Handle both 'type' and 'message_type' columns
    type: rawMsg.type || rawMsg.message_type || 'text',
    // Map database column names to frontend field names
    fileName: rawMsg.file_name || rawMsg.fileName,
    fileSize: rawMsg.file_size || rawMsg.fileSize,
    reply_to: rawMsg.replied_to_id || rawMsg.reply_to,
    // Ensure arrays are initialized
    deleted_for: rawMsg.deleted_for || [],
    reactions: rawMsg.reactions || {},
  };
}

/**
 * Normalizes an array of messages
 */
export function normalizeMessages(rawMessages: any[]): Message[] {
  return rawMessages.map(normalizeMessage);
}

/**
 * System message types that should be filtered out from chat views
 */
export const SYSTEM_MESSAGE_TYPES = [
  'friend_request',
  'friend_accept',
  'friend_cancel',
  'friend_decline',
  'system',
];

/**
 * Checks if a message is a system message
 */
export function isSystemMessage(msg: Message): boolean {
  return SYSTEM_MESSAGE_TYPES.includes(msg.type);
}

/**
 * Filters messages for chat display
 * Removes system messages and messages deleted for the user
 */
export function filterMessagesForUser(
  messages: Message[],
  userId: string
): Message[] {
  return messages.filter(
    (m) =>
      !m.deleted_for?.includes(userId) &&
      !isSystemMessage(m)
  );
}

/**
 * Gets the "other" user ID in a message (the one that isn't the current user)
 */
export function getOtherUserId(msg: Message, currentUserId: string): string {
  return msg.sender_id === currentUserId ? msg.receiver_id : msg.sender_id;
}

/**
 * Checks if the current user is the sender of a message
 */
export function isOwnMessage(msg: Message, userId: string): boolean {
  return msg.sender_id === userId;
}

/**
 * Deduplicates messages by ID, preferring later messages
 */
export function deduplicateMessages(messages: Message[]): Message[] {
  const messageMap = new Map<string, Message>();

  for (const msg of messages) {
    const existing = messageMap.get(msg.id);
    if (!existing || new Date(msg.created_at) > new Date(existing.created_at)) {
      messageMap.set(msg.id, msg);
    }
  }

  return Array.from(messageMap.values()).sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
}

/**
 * Sorts messages by created_at in ascending order (oldest first)
 */
export function sortMessagesByDate(messages: Message[]): Message[] {
  return [...messages].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
}

/**
 * Groups messages by date for date headers
 */
export function groupMessagesByDate(messages: Message[]): Map<string, Message[]> {
  const groups = new Map<string, Message[]>();

  for (const msg of messages) {
    const dateKey = new Date(msg.created_at).toDateString();
    const existing = groups.get(dateKey) || [];
    groups.set(dateKey, [...existing, msg]);
  }

  return groups;
}

/**
 * Finds a message by client_message_id
 */
export function findMessageByClientId(
  messages: Message[],
  clientMessageId: string
): Message | undefined {
  return messages.find((m) => m.client_message_id === clientMessageId);
}

/**
 * Updates a message in an array by ID
 */
export function updateMessageInArray(
  messages: Message[],
  messageId: string,
  updates: Partial<Message>
): Message[] {
  return messages.map((m) =>
    m.id === messageId ? { ...m, ...updates } : m
  );
}

/**
 * Removes a message from an array by ID
 */
export function removeMessageFromArray(
  messages: Message[],
  messageId: string
): Message[] {
  return messages.filter((m) => m.id !== messageId);
}

/**
 * Calculates unread count for a chat
 */
export function calculateUnreadCount(
  messages: Message[],
  userId: string,
  otherUserId: string
): number {
  return messages.filter(
    (m) => m.sender_id === otherUserId && m.receiver_id === userId && !m.is_read
  ).length;
}

/**
 * Gets the last message in a conversation
 */
export function getLastMessage(
  messages: Message[],
  userId: string,
  otherUserId: string
): Message | undefined {
  const conversationMessages = messages.filter(
    (m) =>
      (m.sender_id === userId && m.receiver_id === otherUserId) ||
      (m.sender_id === otherUserId && m.receiver_id === userId)
  );

  if (conversationMessages.length === 0) return undefined;

  return conversationMessages.reduce((latest, current) =>
    new Date(current.created_at) > new Date(latest.created_at) ? current : latest
  );
}

/**
 * Generates a preview text for a message (for chat list)
 */
export function getMessagePreviewText(msg: Message): string {
  if (msg.is_deleted) return 'This message was deleted';

  const msgType = msg.type as string;

  switch (msgType) {
    case 'image':
      return '📷 Photo';
    case 'video':
      return '🎥 Video';
    case 'voice':
      return '🎤 Voice message';
    case 'file':
      return `📎 ${msg.fileName || 'Document'}`;
    case 'voice_call':
      return '📞 Voice call';
    case 'video_call':
      return '📹 Video call';
    case 'location':
      return '📍 Location';
    default:
      return msg.content?.slice(0, 50) + (msg.content?.length > 50 ? '...' : '') || '';
  }
}
