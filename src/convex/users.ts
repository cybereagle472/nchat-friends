import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query, QueryCtx } from "./_generated/server";

/**
 * Get the current signed in user. Returns null if the user is not signed in.
 * Usage: const signedInUser = await ctx.runQuery(api.authHelpers.currentUser);
 * THIS FUNCTION IS READ-ONLY. DO NOT MODIFY.
 */
export const currentUser = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);

    if (user === null) {
      return null;
    }

    return user;
  },
});

/**
 * Use this function internally to get the current user data. Remember to handle the null user case.
 * @param ctx
 * @returns
 */
export const getCurrentUser = async (ctx: QueryCtx) => {
  const userId = await getAuthUserId(ctx);
  if (userId === null) {
    return null;
  }
  return await ctx.db.get(userId);
};

/**
 * Update the signed-in user's display name.
 */
export const updateName = mutation({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    const me = await getAuthUserId(ctx);
    if (me === null) throw new Error("Not signed in");

    const trimmed = name.trim().slice(0, 40);
    if (!trimmed) throw new Error("Name can't be empty");

    await ctx.db.patch(me, { name: trimmed });
    return trimmed;
  },
});

// ── NChat profile bridging (zip frontend) ────────────────────────────────

/**
 * Create or complete the signed-in user's NChat profile.
 * Maps the zip frontend's createProfile onto the users table.
 */
export const updateProfile = mutation({
  args: {
    full_name: v.optional(v.string()),
    username: v.optional(v.string()),
    avatar_url: v.optional(v.string()),
    bio: v.optional(v.string()),
  },
  handler: async (ctx, updates) => {
    const me = await getAuthUserId(ctx);
    if (me === null) throw new Error("Not signed in");

    const patch: Record<string, string | undefined> = {};
    if (updates.full_name !== undefined) {
      const trimmed = updates.full_name.trim().slice(0, 60);
      if (!trimmed) throw new Error("Name can't be empty");
      patch.full_name = trimmed;
      patch.name = trimmed;
    }
    if (updates.username !== undefined) {
      const uname = updates.username.toLowerCase().trim();
      if (uname.length < 3) throw new Error("Username must be at least 3 characters");
      // Enforce uniqueness.
      const taken = await ctx.db
        .query("users")
        .withIndex("by_username", (q) => q.eq("username", uname))
        .first();
      if (taken && taken._id !== me) {
        throw new Error("Username already taken");
      }
      patch.username = uname;
    }
    if (updates.avatar_url !== undefined) patch.avatar_url = updates.avatar_url;
    if (updates.bio !== undefined) patch.bio = updates.bio.slice(0, 150);

    await ctx.db.patch(me, patch);
    return { success: true };
  },
});

/**
 * Is this username available? Used by the live username checker.
 */
export const isUsernameAvailable = query({
  args: { username: v.string(), excludeUserId: v.optional(v.id("users")) },
  handler: async (ctx, { username, excludeUserId }) => {
    const uname = username.toLowerCase().trim();
    if (uname.length < 3) return false;
    const taken = await ctx.db
      .query("users")
      .withIndex("by_username", (q) => q.eq("username", uname))
      .first();
    if (!taken) return true;
    return excludeUserId !== undefined && taken._id === excludeUserId;
  },
});

/**
 * Public profile lookup by user id — returns the zip-shaped UserProfile.
 */
export const getUserById = query({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const u = await ctx.db.get(userId);
    if (!u) return null;
    return {
      id: u._id,
      full_name: u.full_name ?? u.name ?? "",
      username: u.username,
      email: u.email ?? "",
      avatar_url: u.avatar_url ?? u.image,
      bio: u.bio,
    };
  },
});

/**
 * All users with completed profiles (Discover → All Users list).
 */
export const getAllProfiles = query({
  args: {},
  handler: async (ctx) => {
    const me = await getAuthUserId(ctx);
    if (me === null) return [];

    const users = await ctx.db.query("users").collect();
    return users
      .filter((u) => u._id !== me && (u.full_name || u.name))
      .map((u) => ({
        id: u._id,
        full_name: u.full_name ?? u.name ?? "",
        username: u.username,
        email: u.email ?? "",
        avatar_url: u.avatar_url ?? u.image,
        bio: u.bio,
      }));
  },
});
