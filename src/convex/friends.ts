import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Id } from "./_generated/dataModel";

/**
 * Sort two user ids so a pair is always stored in a canonical order.
 */
export function sortUserIds<T extends string>(a: T, b: T): [T, T] {
  return a < b ? [a, b] : [b, a];
}

/**
 * Runtime-supported query for an index on an array field: passing a single
 * element matches documents whose array contains it (see Convex docs,
 * "Indexes on arrays"). The generated types only accept the full array
 * type, so this cast makes the intent explicit in one place.
 */
export const arrayContains = <T extends string>(value: T): T[] =>
  value as unknown as T[];

export type PublicUser = {
  _id: Id<"users">;
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
      .withIndex("by_userIds", (q) => q.eq("userIds", arrayContains(me)))
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
      .withIndex("by_userIds", (q) => q.eq("userIds", arrayContains(me)))
      .collect();

    const incoming: Array<{
      _id: Id<"connections">;
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
      .withIndex("by_userIds", (q) => q.eq("userIds", arrayContains(me)))
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

// ── Extra friend operations for the zip frontend bridge ───────────────

/**
 * All pending requests involving me: received (others → me) and sent
 * (me → others), with the other user's public profile.
 */
export const listAllRequests = query({
  args: {},
  handler: async (ctx) => {
    const me = await getAuthUserId(ctx);
    if (me === null) return { received: [], sent: [] };

    const connections = await ctx.db
      .query("connections")
      .withIndex("by_userIds", (q) => q.eq("userIds", arrayContains(me)))
      .collect();

    const toProfile = async (id: Id<"users">) => {
      const u = await ctx.db.get(id);
      if (!u) return null;
      return {
        id: u._id,
        full_name: u.full_name ?? u.name ?? "",
        username: u.username,
        email: u.email ?? "",
        avatar_url: u.avatar_url ?? u.image,
        bio: u.bio,
      };
    };

    type Req = { id: Id<"connections">; created_at: string; sender_id?: string; receiver_id?: string; sender_profile?: unknown; receiver_profile?: unknown };
    const received: Req[] = [];
    const sent: Req[] = [];
    for (const c of connections) {
      if (c.status !== "pending") continue;
      const createdAt = new Date(c.createdAt).toISOString();
      if (c.requesterId === me) {
        const otherId = c.userIds.find((id) => id !== me);
        if (!otherId) continue;
        sent.push({
          id: c._id,
          created_at: createdAt,
          receiver_id: otherId,
          receiver_profile: await toProfile(otherId),
        });
      } else {
        received.push({
          id: c._id,
          created_at: createdAt,
          sender_id: c.requesterId,
          sender_profile: await toProfile(c.requesterId),
        });
      }
    }
    return { received, sent };
  },
});

/** Cancel a pending request I previously sent. */
export const cancelRequest = mutation({
  args: { addresseeId: v.id("users") },
  handler: async (ctx, { addresseeId }) => {
    const me = await getAuthUserId(ctx);
    if (me === null) throw new Error("Not signed in");
    const [a, b] = sortUserIds(me, addresseeId);
    const conn = await ctx.db
      .query("connections")
      .withIndex("by_userIds", (q) => q.eq("userIds", [a, b]))
      .first();
    if (!conn) return;
    if (conn.status === "accepted") throw new Error("Already friends — unfriend instead");
    if (conn.requesterId !== me) throw new Error("Not your request");
    await ctx.db.delete(conn._id);
  },
});

/** Remove an accepted friendship. */
export const removeFriend = mutation({
  args: { friendId: v.id("users") },
  handler: async (ctx, { friendId }) => {
    const me = await getAuthUserId(ctx);
    if (me === null) throw new Error("Not signed in");
    const [a, b] = sortUserIds(me, friendId);
    const conn = await ctx.db
      .query("connections")
      .withIndex("by_userIds", (q) => q.eq("userIds", [a, b]))
      .first();
    if (conn && conn.status === "accepted") {
      await ctx.db.delete(conn._id);
    }
  },
});

/** Block a user. Also removes any friendship/connection between you. */
export const blockUser = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const me = await getAuthUserId(ctx);
    if (me === null) throw new Error("Not signed in");
    if (userId === me) throw new Error("You can't block yourself");

    // Remove connection entirely.
    const [a, b] = sortUserIds(me, userId);
    const conn = await ctx.db
      .query("connections")
      .withIndex("by_userIds", (q) => q.eq("userIds", [a, b]))
      .first();
    if (conn) await ctx.db.delete(conn._id);

    const existing = await ctx.db
      .query("blocks")
      .withIndex("by_blocker", (q) => q.eq("blockerId", me))
      .collect()
      .then((rows) => rows.find((r) => r.blockedId === userId));
    if (!existing) {
      await ctx.db.insert("blocks", {
        blockerId: me,
        blockedId: userId,
        createdAt: Date.now(),
      });
    }
  },
});

/** Unblock a user. */
export const unblockUser = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const me = await getAuthUserId(ctx);
    if (me === null) throw new Error("Not signed in");
    const rows = await ctx.db
      .query("blocks")
      .withIndex("by_blocker", (q) => q.eq("blockerId", me))
      .collect();
    for (const row of rows) {
      if (row.blockedId === userId) await ctx.db.delete(row._id);
    }
  },
});

/** Users I have blocked, with profiles. */
export const listBlocked = query({
  args: {},
  handler: async (ctx) => {
    const me = await getAuthUserId(ctx);
    if (me === null) return [];
    const rows = await ctx.db
      .query("blocks")
      .withIndex("by_blocker", (q) => q.eq("blockerId", me))
      .collect();
    const out: Array<{ id: string; full_name: string; username?: string; email: string; avatar_url?: string }> = [];
    for (const row of rows) {
      const u = await ctx.db.get(row.blockedId);
      if (!u) continue;
      out.push({
        id: u._id,
        full_name: u.full_name ?? u.name ?? "",
        username: u.username,
        email: u.email ?? "",
        avatar_url: u.avatar_url ?? u.image,
      });
    }
    return out;
  },
});

/**
 * Are two users friends? Used before opening a direct conversation.
 */
export async function areFriends(
  ctx: QueryCtx,
  me: Id<"users">,
  otherId: Id<"users">,
) {
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
  userA: Id<"users">,
  userB: Id<"users">,
  now: number,
) {
  const existing = await ctx.db
    .query("conversations")
    .withIndex("by_memberIds", (q) => q.eq("memberIds", [userA, userB]))
    .first();
  if (existing) return existing;

  const id = await ctx.db.insert("conversations", {
    memberIds: [userA, userB],
    isGroup: false,
    createdAt: now,
    lastMessageAt: now,
    lastReadBy: {},
    unreadBy: {},
  });
  const conversation = await ctx.db.get(id);
  if (!conversation) throw new Error("Failed to create conversation");
  return conversation;
}
