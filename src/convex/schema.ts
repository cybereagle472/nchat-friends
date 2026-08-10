import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { Infer, v } from "convex/values";

// default user roles. can add / remove based on the project as needed
export const ROLES = {
  ADMIN: "admin",
  USER: "user",
  MEMBER: "member",
} as const;

export const roleValidator = v.union(
  v.literal(ROLES.ADMIN),
  v.literal(ROLES.USER),
  v.literal(ROLES.MEMBER),
);
export type Role = Infer<typeof roleValidator>;

const schema = defineSchema(
  {
    // default auth tables using convex auth.
    ...authTables, // do not remove or modify

    // the users table is the default users table that is brought in by the authTables
    users: defineTable({
      name: v.optional(v.string()), // name of the user. do not remove
      image: v.optional(v.string()), // image of the user. do not remove
      email: v.optional(v.string()), // email of the user. do not remove
      emailVerificationTime: v.optional(v.number()), // email verification time. do not remove
      isAnonymous: v.optional(v.boolean()), // is the user anonymous. do not remove

      role: v.optional(roleValidator), // role of the user. do not remove
    }).index("email", ["email"]), // index for the email. do not remove or modify

    // NChat: one-to-one friendships between users.
    // userIds holds the two sorted user ids (userA < userB). status is
    // "pending" while a request is open and "accepted" once both are friends.
    connections: defineTable({
      userIds: v.array(v.id("users")), // sorted [userA, userB]
      requesterId: v.id("users"), // who initiated the request
      status: v.union(v.literal("pending"), v.literal("accepted")),
      createdAt: v.number(),
    }).index("by_userIds", ["userIds"]),

    // NChat: a conversation. memberIds holds every participant — exactly two
    // for a one-to-one chat, or more for a group. unreadBy maps a userId to
    // the number of messages they haven't seen yet.
    conversations: defineTable({
      memberIds: v.array(v.id("users")),
      isGroup: v.boolean(),
      name: v.optional(v.string()), // group display name
      createdById: v.optional(v.id("users")), // group creator
      createdAt: v.number(),
      lastMessageAt: v.number(),
      lastMessagePreview: v.optional(v.string()),
      lastMessageSenderId: v.optional(v.id("users")),
      lastReadBy: v.record(v.string(), v.number()),
      unreadBy: v.record(v.string(), v.number()),
    })
      .index("by_memberIds", ["memberIds"])
      .index("by_lastMessageAt", ["lastMessageAt"]),

    // NChat: messages inside a conversation.
    messages: defineTable({
      conversationId: v.id("conversations"),
      senderId: v.id("users"),
      body: v.string(),
      createdAt: v.number(),
      clientMessageId: v.optional(v.string()),
    })
      .index("by_conversation", ["conversationId", "createdAt"])
      .index("by_conversation_clientId", [
        "conversationId",
        "clientMessageId",
      ]),

    // NChat: audio/video calls. memberIds is a snapshot of the conversation
    // members at call start so every invitee can discover the call.
    calls: defineTable({
      conversationId: v.id("conversations"),
      type: v.union(v.literal("audio"), v.literal("video")),
      status: v.union(
        v.literal("ringing"),
        v.literal("active"),
        v.literal("ended"),
      ),
      initiatorId: v.id("users"),
      participantIds: v.array(v.id("users")),
      memberIds: v.array(v.id("users")),
      startedAt: v.number(),
      endedAt: v.optional(v.number()),
    })
      .index("by_memberIds", ["memberIds"])
      .index("by_conversation_status", ["conversationId", "status"]),

    // NChat: WebRTC signaling (offers, answers, ICE candidates).
    callSignals: defineTable({
      callId: v.id("calls"),
      fromId: v.id("users"),
      toId: v.optional(v.id("users")),
      kind: v.string(),
      payload: v.string(),
      createdAt: v.number(),
    }).index("by_call", ["callId", "createdAt"]),
  },
  {
    schemaValidation: false,
  },
);

export default schema;
