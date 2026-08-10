import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { areFriends } from "./friends";
import type { Id } from "./_generated/dataModel";

/**
 * Create a group conversation with the current user plus the chosen
 * friends. Group chats are for friends, so every member must already be
 * a friend of the creator.
 */
export const create = mutation({
  args: {
    name: v.string(),
    memberIds: v.array(v.id("users")),
  },
  handler: async (ctx, { name, memberIds }) => {
    const me = await getAuthUserId(ctx);
    if (me === null) throw new Error("Not signed in");

    const trimmedName = name.trim().slice(0, 60);
    if (!trimmedName) throw new Error("Give your group a name");
    if (memberIds.length === 0) throw new Error("Add at least one member");
    if (memberIds.length > 49) throw new Error("Groups are capped at 50 people");

    const uniqueMembers = Array.from(new Set(memberIds)).filter(
      (id) => id !== me,
    );
    if (uniqueMembers.length === 0) throw new Error("Add at least one member");

    for (const id of uniqueMembers) {
      const user = await ctx.db.get(id);
      if (!user) throw new Error("A selected member doesn't exist");
      if (!(await areFriends(ctx, me, id))) {
        throw new Error("You can only add friends to a group");
      }
    }

    const now = Date.now();
    const id = await ctx.db.insert("conversations", {
      memberIds: [me, ...uniqueMembers],
      isGroup: true,
      name: trimmedName,
      createdById: me,
      createdAt: now,
      lastMessageAt: now,
      lastReadBy: {},
      unreadBy: {},
    });
    return id;
  },
});

/**
 * Add friends to an existing group. Any member can add their friends.
 */
export const addMembers = mutation({
  args: {
    conversationId: v.id("conversations"),
    userIds: v.array(v.id("users")),
  },
  handler: async (ctx, { conversationId, userIds }) => {
    const me = await getAuthUserId(ctx);
    if (me === null) throw new Error("Not signed in");

    const conversation = await ctx.db.get(conversationId);
    if (!conversation) throw new Error("Conversation not found");
    if (conversation.isGroup !== true) throw new Error("Not a group");
    if (!conversation.memberIds.includes(me)) {
      throw new Error("You're not in this group");
    }

    const toAdd = Array.from(new Set(userIds)).filter(
      (id) => !conversation.memberIds.includes(id),
    );
    for (const id of toAdd) {
      const user = await ctx.db.get(id);
      if (!user) throw new Error("A selected member doesn't exist");
      if (!(await areFriends(ctx, me, id))) {
        throw new Error("You can only add friends to a group");
      }
    }
    if (toAdd.length === 0) return conversation._id;

    await ctx.db.patch(conversationId, {
      memberIds: [...conversation.memberIds, ...toAdd],
    });
    return conversation._id;
  },
});

/**
 * Rename a group. Any member can rename it.
 */
export const rename = mutation({
  args: { conversationId: v.id("conversations"), name: v.string() },
  handler: async (ctx, { conversationId, name }) => {
    const me = await getAuthUserId(ctx);
    if (me === null) throw new Error("Not signed in");

    const trimmedName = name.trim().slice(0, 60);
    if (!trimmedName) throw new Error("Group name can't be empty");

    const conversation = await ctx.db.get(conversationId);
    if (!conversation) throw new Error("Conversation not found");
    if (conversation.isGroup !== true) throw new Error("Not a group");
    if (!conversation.memberIds.includes(me)) {
      throw new Error("You're not in this group");
    }

    await ctx.db.patch(conversationId, { name: trimmedName });
  },
});

/**
 * Remove a member from a group. Only the group creator can remove others.
 */
export const removeMember = mutation({
  args: {
    conversationId: v.id("conversations"),
    memberId: v.id("users"),
  },
  handler: async (ctx, { conversationId, memberId }) => {
    const me = await getAuthUserId(ctx);
    if (me === null) throw new Error("Not signed in");

    const conversation = await ctx.db.get(conversationId);
    if (!conversation) throw new Error("Conversation not found");
    if (conversation.isGroup !== true) throw new Error("Not a group");
    if (!conversation.memberIds.includes(me)) {
      throw new Error("You're not in this group");
    }
    if (me === memberId) throw new Error("Use 'Leave group' to remove yourself");
    if (conversation.createdById !== me) {
      throw new Error("Only the group creator can remove members");
    }
    if (!conversation.memberIds.includes(memberId)) {
      throw new Error("They're not in this group");
    }

    await ctx.db.patch(conversationId, {
      memberIds: conversation.memberIds.filter((id) => id !== memberId),
    });
  },
});

/**
 * Leave a group. If fewer than two people remain, the group (and its
 * messages) is deleted.
 */
export const leave = mutation({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, { conversationId }) => {
    const me = await getAuthUserId(ctx);
    if (me === null) throw new Error("Not signed in");

    const conversation = await ctx.db.get(conversationId);
    if (!conversation) throw new Error("Conversation not found");
    if (conversation.isGroup !== true) throw new Error("Not a group");
    if (!conversation.memberIds.includes(me)) {
      throw new Error("You're not in this group");
    }

    const remaining = conversation.memberIds.filter((id) => id !== me);
    if (remaining.length < 2) {
      // Clean up the whole group.
      const messages = await ctx.db
        .query("messages")
        .withIndex("by_conversation", (q) =>
          q.eq("conversationId", conversationId),
        )
        .collect();
      for (const m of messages) await ctx.db.delete(m._id);
      await ctx.db.delete(conversationId);
      return;
    }

    await ctx.db.patch(conversationId, { memberIds: remaining });
  },
});

/**
 * Group members with their roles, for the group settings panel.
 */
export const members = query({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, { conversationId }) => {
    const me = await getAuthUserId(ctx);
    if (me === null) return [];

    const conversation = await ctx.db.get(conversationId);
    if (!conversation) throw new Error("Conversation not found");
    if (conversation.isGroup !== true) return [];
    if (!conversation.memberIds.includes(me)) return [];

    const result: Array<{
      _id: Id<"users">;
      _creationTime: number;
      name?: string;
      image?: string;
      email?: string;
      isAnonymous?: boolean;
      isAdmin: boolean;
    }> = [];
    for (const id of conversation.memberIds) {
      const user = await ctx.db.get(id);
      if (!user) continue;
      result.push({
        _id: user._id,
        _creationTime: user._creationTime,
        name: user.name,
        image: user.image,
        email: user.email,
        isAnonymous: user.isAnonymous,
        isAdmin: conversation.createdById === user._id,
      });
    }
    return result;
  },
});
