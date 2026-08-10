import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";

/**
 * Sort two user ids so a pair is always stored in a canonical order.
 */
export function sortUserIds(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

export type PublicUser = {
  _id: string;
  _creationTime: number;
  name?: string;
  image?: string;
  email?: string;
  isAnonymous?: boolean;
};

export type ConnectionStatus = "none" | "pending" | "accepted";

/**
 * Search other users by name or email so the signed-in user can find
 * friends. Returns the connection status between the current user and each
 * match ("none" | "pending" | "accepted").
 */
export const searchUsers = query({
  args: { query: v.string() },
  handler: async (ctx, { query: raw }) => {
    const me = await getAuthUserId(ctx);
    if (me === null) return [];

    const term = raw.trim().toLowerCase();
    if (term.length < 2) return [];

    const users = await ctx.db.query("users").collect();
    const matches = users.filter(
      (u) =>
        u._id !== me &&
        ((u.name ?? "").toLowerCase().includes(term) ||
          (u.email ?? "").toLowerCase().includes(term)),
    );

    // Resolve connection status for each match in one pass.
    const connections = await ctx.db
      .query("connections")
      .withIndex("by_userIds", (q) => q.eq("userIds", me))
      .collect();
    const statusByOther: Record<string, ConnectionStatus> = {};
    for (const c of connections) {
      const other = c.userIds.find((id) => id !== me);
      if (other) statusByOther[other] = c.status;
    }

    return matches.slice(0, 12).map((u) => ({
      _id: u._id,
      _creationTime: u._creationTime,
      name: u.name,
      image: u.image,
      email: u.email,
      isAnonymous: u.isAnonymous,
      connectionStatus: statusByOther[u._id] ?? ("none" as ConnectionStatus),
    }));
  },
});

/**
 * Send a friend request. If the other user already sent us one, this
 * auto-accepts it so the two of you become friends instantly.
 */
export const sendFriendRequest = mutation({
  args: { addresseeId: v.id("users") },
  handler: async (ctx, { addresseeId }) => {
    const me = await getAuthUserId(ctx);
    if (me === null) throw new Error("Not signed in");
    if (addresseeId === me) throw new Error("You can't add yourself");

    const addressee = await ctx.db.get(addresseeId);
    if (!addressee) throw new Error("User not found");

    const [userA, userB] = sortUserIds(me, addresseeId);
    const existing = await ctx.db
      .query("connections")
      .withIndex("by_userIds", (q) => q.eq("userIds", [userA, userB]))
      .first();

    if (existing) {
      if (existing.status === "accepted") {
        throw new Error("You're already friends");
      }
      if (existing.requesterId === me) {
        throw new Error("Friend request already sent");
      }
      // They requested us first — accept and become friends instantly.
      await ctx.db.patch(existing._id, { status: "accepted" });
      await ensureConversation(ctx, userA, userB, Date.now());
      return { created: false, accepted: true };
    }

    await ctx.db.insert("connections", {
      userIds: [userA, userB],
      requesterId: me,
      status: "pending",
      createdAt: Date.now(),
    });
    return { created: true, accepted: false };
  },
});

/**
 * Accept or decline an incoming friend request. Accepting creates the
 * one-to-one conversation so you can start chatting right away.
 */
export const respondToFriendRequest = mutation({
  args: { connectionId: v.id("connections"), accept: v.boolean() },
  handler: async (ctx, { connectionId, accept }) => {
    const me = await getAuthUserId(ctx);
    if (me === null) throw new Error("Not signed in");

    const connection = await ctx.db.get(connectionId);
    if (!connection) throw new Error("Request not found");
    if (connection.requesterId === me) {
      throw new Error("You can't respond to your own request");
    }
    if (!connection.userIds.includes(me)) {
      throw new Error("This request isn't for you");
    }
    if (connection.status !== "pending") {
      throw new Error("Request already handled");
    }

    if (accept) {
      await ctx.db.patch(connectionId, { status: "accepted" });
      const [userA, userB] = connection.userIds;
      await ensureConversation(ctx, userA, userB, Date.now());
    } else {
      await ctx.db.delete(connectionId);
    }
    return { accepted: accept };
  },
});

/**
 * Incoming pending friend requests (other people who want to add me).
 */
export const listRequests = query({
  args: {},
  handler: async (ctx) => {
    const me = await getAuthUserId(ctx);
    if (me === null) return [];

    const connections = await ctx.db
      .query("connections")
      .withIndex("by_userIds", (q) => q.eq("userIds", me))
      .collect();

    const incoming: Array<{
      _id: string;
      requester: PublicUser;
      createdAt: number;
    }> = [];
    for (const c of connections) {
      if (c.status !== "pending" || c.requesterId === me) continue;
      const requester = await ctx.db.get(c.requesterId);
      if (!requester) continue;
      incoming.push({
        _id: c._id,
        createdAt: c.createdAt,
        requester: {
          _id: requester._id,
          _creationTime: requester._creationTime,
          name: requester.name,
          image: requester.image,
          email: requester.email,
          isAnonymous: requester.isAnonymous,
        },
      });
    }
    return incoming.sort((a, b) => b.createdAt - a.createdAt);
  },
});

/**
 * Accepted friends, used by the "New chat" flow so you can jump straight
 * into a conversation with someone you're already friends with.
 */
export const listFriends = query({
  args: {},
  handler: async (ctx) => {
    const me = await getAuthUserId(ctx);
    if (me === null) return [];

    const connections = await ctx.db
      .query("connections")
      .withIndex("by_userIds", (q) => q.eq("userIds", me))
      .collect();

    const friends: PublicUser[] = [];
    for (const c of connections) {
      if (c.status !== "accepted") continue;
      const otherId = c.userIds.find((id) => id !== me);
      if (!otherId) continue;
      const other = await ctx.db.get(otherId);
      if (!other) continue;
      friends.push({
        _id: other._id,
        _creationTime: other._creationTime,
        name: other.name,
        image: other.image,
        email: other.email,
        isAnonymous: other.isAnonymous,
      });
    }
    return friends;
  },
});

/**
 * Are two users friends? Used before opening a direct conversation.
 */
export async function areFriends(ctx: QueryCtx, me: string, otherId: string) {
  const [userA, userB] = sortUserIds(me, otherId);
  const connection = await ctx.db
    .query("connections")
    .withIndex("by_userIds", (q) => q.eq("userIds", [userA, userB]))
    .first();
  return connection?.status === "accepted";
}

/**
 * Create a conversation between two (sorted) user ids if one doesn't
 * already exist. Returns the conversation.
 */
export async function ensureConversation(
  ctx: MutationCtx,
  userA: string,
  userB: string,
  now: number,
) {
  const existing = await ctx.db
    .query("conversations")
    .withIndex("by_memberIds", (q) => q.eq("memberIds", [userA, userB]))
    .first();
  if (existing) return existing;

  const id = await ctx.db.insert("conversations", {
    memberIds: [userA, userB],
    createdAt: now,
    lastMessageAt: now,
    lastReadBy: {},
    unreadBy: {},
  });
  const conversation = await ctx.db.get(id);
  if (!conversation) throw new Error("Failed to create conversation");
  return conversation;
}
