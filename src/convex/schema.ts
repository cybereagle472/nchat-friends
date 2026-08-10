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
      status: v.union(
        v.literal("pending"),
        v.literal("accepted"),
      ),
      createdAt: v.number(),
    }).index("by_userIds", ["userIds"]),

    // NChat: one-to-one conversation between two users. Created when a friend
    // request is accepted. unreadBy maps a userId to the number of unread
    // messages the other member sent since their last read.
    conversations: defineTable({
      memberIds: v.array(v.id("users")), // exactly two, sorted
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
  },
  {
    schemaValidation: false,
  },
);

export default schema;
