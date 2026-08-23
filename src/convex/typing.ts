import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

/**
 * Mark the current user as typing in a conversation.
 * Creates or refreshes a short-lived indicator document (TTL ≈ 5 s).
 * The client should call this on each keystroke (throttled).
 */
export const startTyping = mutation({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, { conversationId }) => {
    const me = await getAuthUserId(ctx);
    if (me === null) return;

    const conversation = await ctx.db.get(conversationId);
    if (!conversation || !conversation.memberIds.includes(me)) return;

    // Upsert: delete any existing indicator for this user in this
    // conversation, then insert a fresh one with the new expiry.
    const existing = await ctx.db
      .query("typingIndicators")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", conversationId),
      )
      .collect();
    for (const doc of existing) {
      if (doc.userId === me) await ctx.db.delete(doc._id);
    }

    await ctx.db.insert("typingIndicators", {
      conversationId,
      userId: me,
      expiresAt: Date.now() + 5_500,
    });
  },
});

/**
 * Stop typing: delete the indicator immediately when the user sends
 * a message or the client wants to cancel.
 */
export const stopTyping = mutation({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, { conversationId }) => {
    const me = await getAuthUserId(ctx);
    if (me === null) return;

    const existing = await ctx.db
      .query("typingIndicators")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", conversationId),
      )
      .collect();
    for (const doc of existing) {
      if (doc.userId === me) await ctx.db.delete(doc._id);
    }
  },
});

/**
 * Who is currently typing in a conversation? Returns the userIds of
 * active indicators (not expired). The client reactively re-renders
 * as Convex pushes new query results.
 */
export const whoTyping = query({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, { conversationId }) => {
    const now = Date.now();
    const me = await getAuthUserId(ctx);

    const indicators = await ctx.db
      .query("typingIndicators")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", conversationId),
      )
      .collect();

    // Filter out expired indicators and the current user.
    const typingUserIds = indicators
      .filter((doc) => doc.expiresAt > now && doc.userId !== me)
      .map((doc) => doc.userId);

    return typingUserIds;
  },
});

// ── Presence ──────────────────────────────────────────────────────────────

/**
 * Upsert the current user's last-active timestamp.
 * Call from a top-level effect on the Chat page (or anywhere authenticated).
 */
export const upsertPresence = mutation({
  args: {},
  handler: async (ctx) => {
    const me = await getAuthUserId(ctx);
    if (me === null) return;

    const existing = await ctx.db
      .query("presence")
      .withIndex("by_userId", (q) => q.eq("userId", me))
      .first();

    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, { lastActiveAt: now });
    } else {
      await ctx.db.insert("presence", { userId: me, lastActiveAt: now });
    }
  },
});

/**
 * Batch presence lookup: given a list of user IDs, return a map of
 * { userId → lastActiveAt }. Clients derive "online" as
 * lastActiveAt > Date.now() - 120_000.
 */
export const getPresence = query({
  args: { userIds: v.array(v.id("users")) },
  handler: async (ctx, { userIds }) => {
    const result: Record<string, number> = {};
    for (const uid of userIds) {
      const doc = await ctx.db
        .query("presence")
        .withIndex("by_userId", (q) => q.eq("userId", uid))
        .first();
      if (doc) result[uid] = doc.lastActiveAt;
    }
    return result;
  },
});
