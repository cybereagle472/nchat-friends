import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation } from "./_generated/server";

/**
 * Send a message in a conversation. The sender must be a participant.
 * clientMessageId lets the client retry safely without double-sending.
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

    // Update the conversation summary and bump the other member's unread count.
    const otherId = conversation.memberIds.find((id) => id !== me);
    const unreadBy = { ...conversation.unreadBy };
    if (otherId) unreadBy[otherId] = (unreadBy[otherId] ?? 0) + 1;

    await ctx.db.patch(conversationId, {
      lastMessageAt: now,
      lastMessagePreview: trimmed,
      lastMessageSenderId: me,
      unreadBy,
    });

    return messageId;
  },
});
