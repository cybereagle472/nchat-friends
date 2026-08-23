import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

/**
 * Send a message in a conversation. The sender must be a participant.
 * clientMessageId lets the client retry safely without double-sending.
 * Rate-limited: max 20 messages per minute per user per conversation.
 */
export const send = mutation({
  args: {
    conversationId: v.id("conversations"),
    body: v.string(),
    clientMessageId: v.optional(v.string()),
  },
  handler: async (ctx, { conversationId, body, clientMessageId }) => {
    const me = await getAuthUserId(ctx);
    if (me === null) throw new Error("Not signed in");

    const trimmed = body.trim();
    if (!trimmed) throw new Error("Message can't be empty");
    if (trimmed.length > 4000) throw new Error("Message is too long");

    const conversation = await ctx.db.get(conversationId);
    if (!conversation) throw new Error("Conversation not found");
    if (!conversation.memberIds.includes(me)) {
      throw new Error("You're not a member of this conversation");
    }

    // Rate limit: max 20 messages per minute per user per conversation.
    const oneMinuteAgo = Date.now() - 60_000;
    const recentMessages = await ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", conversationId),
      )
      .filter((q) => q.gt(q.field("createdAt"), oneMinuteAgo))
      .collect();
    const myRecentCount = recentMessages.filter(
      (m) => m.senderId === me,
    ).length;
    if (myRecentCount >= 20) {
      throw new Error("Slow down — you're sending messages too fast");
    }

    // Deduplicate retries from the same client.
    if (clientMessageId) {
      const duplicate = await ctx.db
        .query("messages")
        .withIndex("by_conversation_clientId", (q) =>
          q.eq("conversationId", conversationId).eq("clientMessageId", clientMessageId),
        )
        .first();
      if (duplicate) return duplicate._id;
    }

    const now = Date.now();
    const messageId = await ctx.db.insert("messages", {
      conversationId,
      senderId: me,
      body: trimmed,
      createdAt: now,
      clientMessageId,
    });

    // Update the conversation summary and bump every other member's unread
    // count (works for both one-to-one chats and groups).
    const unreadBy = { ...conversation.unreadBy };
    for (const memberId of conversation.memberIds) {
      if (memberId !== me) unreadBy[memberId] = (unreadBy[memberId] ?? 0) + 1;
    }

    await ctx.db.patch(conversationId, {
      lastMessageAt: now,
      lastMessagePreview: trimmed,
      lastMessageSenderId: me,
      unreadBy,
    });

    return messageId;
  },
});

/**
 * Send a message with a file attachment.
 * The file must already be uploaded to Convex storage via the uploadFile
 * action. clientMessageId provides optimistic dedup like the text-only send.
 * Rate-limited: max 20 messages per minute per user per conversation.
 */
export const sendWithAttachment = mutation({
  args: {
    conversationId: v.id("conversations"),
    body: v.string(),
    clientMessageId: v.optional(v.string()),
    attachmentFileId: v.string(),
    attachmentName: v.string(),
    attachmentType: v.string(),
  },
  handler: async (
    ctx,
    { conversationId, body, clientMessageId, attachmentFileId, attachmentName, attachmentType },
  ) => {
    const me = await getAuthUserId(ctx);
    if (me === null) throw new Error("Not signed in");

    const conversation = await ctx.db.get(conversationId);
    if (!conversation) throw new Error("Conversation not found");
    if (!conversation.memberIds.includes(me)) {
      throw new Error("You're not a member of this conversation");
    }

    // Rate limit.
    const oneMinuteAgo = Date.now() - 60_000;
    const recentMessages = await ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", conversationId),
      )
      .filter((q) => q.gt(q.field("createdAt"), oneMinuteAgo))
      .collect();
    const myRecentCount = recentMessages.filter(
      (m) => m.senderId === me,
    ).length;
    if (myRecentCount >= 20) {
      throw new Error("Slow down — you're sending messages too fast");
    }

    // Deduplicate retries.
    if (clientMessageId) {
      const duplicate = await ctx.db
        .query("messages")
        .withIndex("by_conversation_clientId", (q) =>
          q.eq("conversationId", conversationId).eq("clientMessageId", clientMessageId),
        )
        .first();
      if (duplicate) return duplicate._id;
    }

    const trimmed = body.trim();
    const now = Date.now();
    const messageId = await ctx.db.insert("messages", {
      conversationId,
      senderId: me,
      body: trimmed || attachmentName,
      createdAt: now,
      clientMessageId,
      attachmentFileId,
      attachmentName,
      attachmentType,
    });

    const unreadBy = { ...conversation.unreadBy };
    for (const memberId of conversation.memberIds) {
      if (memberId !== me) unreadBy[memberId] = (unreadBy[memberId] ?? 0) + 1;
    }

    await ctx.db.patch(conversationId, {
      lastMessageAt: now,
      lastMessagePreview: trimmed
        ? trimmed
        : `📎 ${attachmentName}`,
      lastMessageSenderId: me,
      unreadBy,
    });

    return messageId;
  },
});

/**
 * Toggle a reaction (emoji) on a message. If the current user already
 * reacted with this emoji, remove it; otherwise add it.
 */
export const toggleReaction = mutation({
  args: {
    messageId: v.id("messages"),
    emoji: v.string(),
  },
  handler: async (ctx, { messageId, emoji }) => {
    const me = await getAuthUserId(ctx);
    if (me === null) throw new Error("Not signed in");

    const message = await ctx.db.get(messageId);
    if (!message) throw new Error("Message not found");

    const conversation = await ctx.db.get(message.conversationId);
    if (!conversation || !conversation.memberIds.includes(me)) {
      throw new Error("You're not a member of this conversation");
    }

    const reactions = { ...(message.reactions ?? {}) };
    const users = reactions[emoji] ?? [];

    if (users.includes(me)) {
      // Remove reaction.
      reactions[emoji] = users.filter((uid) => uid !== me);
      if (reactions[emoji].length === 0) delete reactions[emoji];
    } else {
      // Add reaction.
      reactions[emoji] = [...users, me];
    }

    await ctx.db.patch(messageId, { reactions });
  },
});

/**
 * Edit a message. Only the original sender may edit, within 24 hours.
 * Sets `editedAt` timestamp for the UI to display "edited".
 */
export const editMessage = mutation({
  args: {
    messageId: v.id("messages"),
    body: v.string(),
  },
  handler: async (ctx, { messageId, body }) => {
    const me = await getAuthUserId(ctx);
    if (me === null) throw new Error("Not signed in");

    const trimmed = body.trim();
    if (!trimmed) throw new Error("Message can't be empty");
    if (trimmed.length > 4000) throw new Error("Message is too long");

    const message = await ctx.db.get(messageId);
    if (!message) throw new Error("Message not found");
    if (message.isDeleted) throw new Error("Can't edit a deleted message");
    if (message.senderId !== me) throw new Error("You can only edit your own messages");

    // Allow edits within 24 hours of sending.
    const twentyFourHours = 24 * 60 * 60 * 1000;
    if (Date.now() - message.createdAt > twentyFourHours) {
      throw new Error("Messages can only be edited within 24 hours");
    }

    await ctx.db.patch(messageId, {
      body: trimmed,
      editedAt: Date.now(),
    });
  },
});

/**
 * Soft-delete a message. Only the original sender may delete.
 * The message renders as "[message deleted]" in the chat.
 */
export const deleteMessage = mutation({
  args: { messageId: v.id("messages") },
  handler: async (ctx, { messageId }) => {
    const me = await getAuthUserId(ctx);
    if (me === null) throw new Error("Not signed in");

    const message = await ctx.db.get(messageId);
    if (!message) throw new Error("Message not found");
    if (message.isDeleted) return; // already deleted
    if (message.senderId !== me) throw new Error("You can only delete your own messages");

    await ctx.db.patch(messageId, {
      isDeleted: true,
      body: "",
      reactions: undefined,
    });
  },
});

/**
 * Search messages in a conversation by text content.
 * Returns matching messages with their createdAt for scrolling to them.
 */
export const searchMessages = query({
  args: {
    conversationId: v.id("conversations"),
    searchTerm: v.string(),
  },
  handler: async (ctx, { conversationId, searchTerm }) => {
    const me = await getAuthUserId(ctx);
    if (me === null) return [];

    const conversation = await ctx.db.get(conversationId);
    if (!conversation || !conversation.memberIds.includes(me)) return [];

    const term = searchTerm.trim().toLowerCase();
    if (term.length < 2) return [];

    const all = await ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", conversationId),
      )
      .collect();

    const matches = all
      .filter(
        (m) =>
          !m.isDeleted &&
          m.body.toLowerCase().includes(term),
      )
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 50);

    return matches.map((m) => ({
      _id: m._id,
      senderId: m.senderId,
      body: m.body,
      createdAt: m.createdAt,
    }));
  },
});
