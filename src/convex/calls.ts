import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { arrayContains } from "./friends";
import type { Id } from "./_generated/dataModel";

function toPublicUser(
  user: {
    _id: Id<"users">;
    _creationTime: number;
    name?: string;
    image?: string;
    email?: string;
    isAnonymous?: boolean;
  } | null,
) {
  if (!user) return null;
  return {
    _id: user._id,
    _creationTime: user._creationTime,
    name: user.name,
    image: user.image,
    email: user.email,
    isAnonymous: user.isAnonymous,
  };
}

/**
 * Start a call in a conversation. Rings every other member. Only one
 * call can be active in a conversation at a time.
 */
export const start = mutation({
  args: {
    conversationId: v.id("conversations"),
    type: v.union(v.literal("audio"), v.literal("video")),
  },
  handler: async (ctx, { conversationId, type }) => {
    const me = await getAuthUserId(ctx);
    if (me === null) throw new Error("Not signed in");

    const conversation = await ctx.db.get(conversationId);
    if (!conversation) throw new Error("Conversation not found");
    if (!conversation.memberIds.includes(me)) {
      throw new Error("You're not in this conversation");
    }

    const activeCall = await ctx.db
      .query("calls")
      .withIndex("by_conversation_status", (q) =>
        q.eq("conversationId", conversationId).eq("status", "ringing"),
      )
      .first();
    const active = await ctx.db
      .query("calls")
      .withIndex("by_conversation_status", (q) =>
        q.eq("conversationId", conversationId).eq("status", "active"),
      )
      .first();
    if (activeCall || active) throw new Error("A call is already in progress");

    const now = Date.now();
    const callId = await ctx.db.insert("calls", {
      conversationId,
      type,
      status: "ringing",
      initiatorId: me,
      participantIds: [me],
      memberIds: conversation.memberIds,
      startedAt: now,
    });
    return callId;
  },
});

/**
 * The current call involving the signed-in user, if any — ringing or
 * active, newest first. Drives the incoming-call and in-call UI.
 */
export const current = query({
  args: {},
  handler: async (ctx) => {
    const me = await getAuthUserId(ctx);
    if (me === null) return null;

    const calls = await ctx.db
      .query("calls")
      .withIndex("by_memberIds", (q) => q.eq("memberIds", arrayContains(me)))
      .collect();
    const live = calls
      .filter((c) => c.status !== "ended")
      .sort((a, b) => b.startedAt - a.startedAt);
    const call = live[0];
    if (!call) return null;

    const conversation = await ctx.db.get(call.conversationId);
    if (!conversation) return null;

    const isGroup = conversation.isGroup === true;
    let title = "Conversation";
    if (isGroup) {
      title = conversation.name ?? "Group";
    } else {
      const otherId = conversation.memberIds.find((id) => id !== me);
      const other = otherId ? await ctx.db.get(otherId) : null;
      title = other?.name ?? "Friend";
    }

    const initiator = await ctx.db.get(call.initiatorId);
    const participants = (
      await Promise.all(call.participantIds.map((id) => ctx.db.get(id)))
    ).filter((u): u is NonNullable<typeof u> => u !== null);

    return {
      call: {
        _id: call._id,
        type: call.type,
        status: call.status,
        initiatorId: call.initiatorId,
        participantIds: call.participantIds,
        startedAt: call.startedAt,
        conversationId: call.conversationId,
      },
      isInitiator: call.initiatorId === me,
      hasJoined: call.participantIds.includes(me),
      title,
      conversationIsGroup: isGroup,
      initiator: toPublicUser(initiator),
      participants: participants.map(toPublicUser),
    };
  },
});

/**
 * Join a call (answer an incoming call). Marks it active once a second
 * person is in.
 */
export const join = mutation({
  args: { callId: v.id("calls") },
  handler: async (ctx, { callId }) => {
    const me = await getAuthUserId(ctx);
    if (me === null) throw new Error("Not signed in");

    const call = await ctx.db.get(callId);
    if (!call) throw new Error("Call not found");
    if (call.status === "ended") throw new Error("Call already ended");
    if (!call.memberIds.includes(me)) throw new Error("You're not invited");

    if (!call.participantIds.includes(me)) {
      await ctx.db.patch(callId, {
        participantIds: [...call.participantIds, me],
        status: "active",
      });
    } else if (call.status === "ringing") {
      await ctx.db.patch(callId, { status: "active" });
    }
    return callId;
  },
});

/**
 * Decline an incoming call. If nobody else is in the call, it ends.
 */
export const decline = mutation({
  args: { callId: v.id("calls") },
  handler: async (ctx, { callId }) => {
    const me = await getAuthUserId(ctx);
    if (me === null) throw new Error("Not signed in");

    const call = await ctx.db.get(callId);
    if (!call || call.status === "ended") return;
    if (!call.memberIds.includes(me)) throw new Error("You're not invited");
    if (call.initiatorId === me) throw new Error("Callers can't decline");

    const participants = call.participantIds.filter((id) => id !== me);
    const onlyInitiatorLeft =
      participants.length === 0 || participants.every((id) => id === call.initiatorId);

    if (onlyInitiatorLeft) {
      await ctx.db.patch(callId, {
        status: "ended",
        endedAt: Date.now(),
        participantIds: participants,
      });
    } else {
      await ctx.db.patch(callId, { participantIds: participants });
    }
  },
});

/**
 * End a call (hang up).
 */
export const end = mutation({
  args: { callId: v.id("calls") },
  handler: async (ctx, { callId }) => {
    const me = await getAuthUserId(ctx);
    if (me === null) throw new Error("Not signed in");

    const call = await ctx.db.get(callId);
    if (!call || call.status === "ended") return;
    if (!call.memberIds.includes(me)) throw new Error("You're not in this call");

    await ctx.db.patch(callId, { status: "ended", endedAt: Date.now() });
  },
});

/**
 * Send a WebRTC signaling message (offer / answer / ICE candidate) inside
 * a call. Must be a participant.
 */
export const signal = mutation({
  args: {
    callId: v.id("calls"),
    toId: v.optional(v.id("users")),
    kind: v.string(),
    payload: v.string(),
  },
  handler: async (ctx, { callId, toId, kind, payload }) => {
    const me = await getAuthUserId(ctx);
    if (me === null) throw new Error("Not signed in");

    const call = await ctx.db.get(callId);
    if (!call || call.status === "ended") return;
    if (!call.participantIds.includes(me)) {
      throw new Error("You're not in this call");
    }

    await ctx.db.insert("callSignals", {
      callId,
      fromId: me,
      toId,
      kind,
      payload,
      createdAt: Date.now(),
    });
  },
});

/**
 * Signals for a call created after `since`, for the signed-in user. The
 * client filters to messages addressed to it (or broadcast).
 */
export const signals = query({
  args: { callId: v.id("calls"), since: v.number() },
  handler: async (ctx, { callId, since }) => {
    const me = await getAuthUserId(ctx);
    if (me === null) return [];

    const call = await ctx.db.get(callId);
    if (!call || !call.participantIds.includes(me)) return [];

    const raw = await ctx.db
      .query("callSignals")
      .withIndex("by_call", (q) => q.eq("callId", callId))
      .filter((q) => q.gt(q.field("createdAt"), since))
      .collect();
    return raw
      .filter((s) => s.toId === undefined || s.toId === me)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((s) => ({
        _id: s._id,
        fromId: s.fromId,
        kind: s.kind,
        payload: s.payload,
        createdAt: s.createdAt,
      }));
  },
});

/**
 * Ended calls involving the signed-in user, newest first — for the
 * call history tab. Includes both participants' profiles.
 */
export const history = query({
  args: {},
  handler: async (ctx) => {
    const me = await getAuthUserId(ctx);
    if (me === null) return [];

    const calls = await ctx.db
      .query("calls")
      .withIndex("by_memberIds", (q) => q.eq("memberIds", arrayContains(me)))
      .collect();
    const ended = calls
      .filter((c) => c.status === "ended")
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, 50);

    const out: Array<{
      id: string;
      caller_id: string;
      callee_id: string;
      call_type: "voice" | "video";
      status: "missed" | "answered" | "declined";
      duration?: number;
      started_at: string;
      ended_at?: string;
    }> = [];
    for (const c of ended) {
      const isCaller = c.initiatorId === me;
      const otherId = c.memberIds.find((id) => id !== me) ?? me;
      const duration = c.endedAt ? Math.round((c.endedAt - c.startedAt) / 1000) : 0;
      out.push({
        id: c._id,
        caller_id: c.initiatorId,
        callee_id: otherId,
        call_type: c.type === "video" ? "video" : "voice",
        // If nobody besides the caller ever joined, treat as missed for them
        // and declined for the callee side when applicable.
        status:
          duration > 0
            ? "answered"
            : isCaller
              ? "missed"
              : "declined",
        duration: duration > 0 ? duration : undefined,
        started_at: new Date(c.startedAt).toISOString(),
        ended_at: c.endedAt ? new Date(c.endedAt).toISOString() : undefined,
      });
    }
    return out;
  },
});

/**
 * A specific call, for polling participant state inside the call UI.
 */
export const get = query({
  args: { callId: v.id("calls") },
  handler: async (ctx, { callId }) => {
    const me = await getAuthUserId(ctx);
    if (me === null) return null;

    const call = await ctx.db.get(callId);
    if (!call || !call.memberIds.includes(me)) return null;
    if (!call.participantIds.includes(me)) return null;

    const participants = (
      await Promise.all(call.participantIds.map((id) => ctx.db.get(id)))
    ).filter((u): u is NonNullable<typeof u> => u !== null);

    return {
      _id: call._id,
      type: call.type,
      status: call.status,
      initiatorId: call.initiatorId,
      participantIds: call.participantIds,
      startedAt: call.startedAt,
      participants: participants.map(toPublicUser),
    };
  },
});
