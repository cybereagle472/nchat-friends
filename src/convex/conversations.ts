import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { areFriends, sortUserIds } from "./friends";

const MESSAGE_PAGE_SIZE = 60;

/**
 * All conversations the current user is part of, newest activity first.
 * Each entry includes the other member's profile and the unread count.
 */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const me = await getAuthUserId(ctx);
    if (me === null) return { conversations: [], totalUnread: 0 };

    const conversations = await ctx.db
      .query("conversations")
      .withIndex("by_memberIds", (q) => q.eq("memberIds", me))
      .collect();

    const items = [];
    for (const conversation of conversations) {
      const otherId = conversation.memberIds.find((id) => id !== me);
      if (!otherId) continue;
      const other = await ctx.db.get(otherId);
      if (!other) continue;
      items.push({
        _id: conversation._id,
        _creationTime: conversation._creationTime,
        lastMessageAt: conversation.lastMessageAt,
        lastMessagePreview: conversation.lastMessagePreview ?? null,
        lastMessageSenderId: conversation.lastMessageSenderId ?? null,
        unreadCount: conversation.unreadBy[me] ?? 0,
        other: {
          _id: other._id,
          _creationTime: other._creationTime,
          name: other.name,
          image: other.image,
          email: other.email,
          isAnonymous: other.isAnonymous,
        },
      });
    }

    items.sort((a, b) => b.lastMessageAt - a.lastMessageAt);
    const totalUnread = items.reduce((sum, c) => sum + c.unreadCount, 0);
    return { conversations: items, totalUnread };
  },
});

/**
 * Fetch one conversation plus the other member, for the chat header.
 * Only participants may fetch it.
 */
export const get = query({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, { conversationId }) => {
    const me = await getAuthUserId(ctx);
    if (me === null) return null;

    const conversation = await ctx.db.get(conversationId);
    if (!conversation) return null;
    if (!conversation.memberIds.includes(me)) return null;

    const otherId = conversation.memberIds.find((id) => id !== me);
    const other = otherId ? await ctx.db.get(otherId) : null;
    if (!other) return null;

    return {
      _id: conversation._id,
      _creationTime: conversation._creationTime,
      lastMessageAt: conversation.lastMessageAt,
      other: {
        _id: other._id,
        _creationTime: other._creationTime,
        name: other.name,
        image: other.image,
        email: other.email,
        isAnonymous: other.isAnonymous,
      },
    };
  },
});

/**
 * Get the conversation between the current user and another user,
 * creating it on first use — but only if they're friends.
 */
export const getOrCreate = mutation({
  args: { otherUserId: v.id("users") },
  handler: async (ctx, { otherUserId }) => {
    const me = await getAuthUserId(ctx);
    if (me === null) throw new Error("Not signed in");
    if (otherUserId === me) throw new Error("You can't chat with yourself");

    const other = await ctx.db.get(otherUserId);
    if (!other) throw new Error("User not found");
    if (!(await areFriends(ctx, me, otherUserId))) {
      throw new Error("Add them as a friend first");
    }

    const [userA, userB] = sortUserIds(me, otherUserId);
    const existing = await ctx.db
      .query("conversations")
      .withIndex("by_memberIds", (q) => q.eq("memberIds", [userA, userB]))
      .first();
    if (existing) return existing._id;

    const now = Date.now();
    const id = await ctx.db.insert("conversations", {
      memberIds: [userA, userB],
      createdAt: now,
      lastMessageAt: now,
      lastReadBy: {},
      unreadBy: {},
    });
    return id;
  },
});

/**
 * Messages in a conversation, newest last, paginated backwards with a
 * cursor. Pass the createdAt of the oldest loaded message to fetch the
 * page before it.
 */
export const messages = query({
  args: {
    conversationId: v.id("conversations"),
    cursor: v.optional(v.number()),
  },
  handler: async (ctx, { conversationId, cursor }) => {
    const me = await getAuthUserId(ctx);
    if (me === null) return { messages: [], cursor: null };

    const conversation = await ctx.db.get(conversationId);
    if (!conversation || !conversation.memberIds.includes(me)) {
      return { messages: [], cursor: null };
    }

    const base = ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) => q.eq("conversationId", conversationId));

    // If a cursor is given, only messages older than it.
    const all = cursor
      ? await base.filter((m) => m.createdAt < cursor).collect()
      : await base.collect();

    all.sort((a, b) => a.createdAt - b.createdAt);
    const page = all.slice(Math.max(0, all.length - MESSAGE_PAGE_SIZE));
    const hasMore = all.length > page.length;

    return {
      messages: page.map((m) => ({
        _id: m._id,
        _creationTime: m._creationTime,
        senderId: m.senderId,
        body: m.body,
        createdAt: m.createdAt,
        clientMessageId: m.clientMessageId ?? null,
      })),
      cursor: hasMore ? page[0]?.createdAt ?? null : null,
    };
  },
});

/**
 * Mark a conversation as read by the current user.
 */
export const markRead = mutation({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, { conversationId }) => {
    const me = await getAuthUserId(ctx);
    if (me === null) return;

    const conversation = await ctx.db.get(conversationId);
    if (!conversation || !conversation.memberIds.includes(me)) return;

    const now = Date.now();
    const unreadBy = { ...conversation.unreadBy, [me]: 0 };
    const lastReadBy = { ...conversation.lastReadBy, [me]: now };
    await ctx.db.patch(conversationId, { unreadBy, lastReadBy });
  },
});
