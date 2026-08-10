import { UserAvatar } from "@/components/chat/UserAvatar";
import type { Id } from "@/convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import {
  displayName,
  formatConversationTime,
  truncate,
} from "@/lib/chat-utils";
import { cn } from "@/lib/utils";
import { MessageSquareText, Users } from "lucide-react";

export type ConversationSummary = {
  _id: Id<"conversations">;
  isGroup: boolean;
  name: string | null;
  memberCount: number;
  lastMessageAt: number;
  lastMessagePreview: string | null;
  lastMessageSenderId: string | null;
  unreadCount: number;
  other: {
    _id: Id<"users">;
    name?: string | null;
    image?: string | null;
    email?: string | null;
  } | null;
  members: Array<{
    _id: Id<"users">;
    name?: string | null;
    image?: string | null;
    email?: string | null;
  }>;
};

export function GroupAvatar({
  members,
  className,
}: {
  members: ConversationSummary["members"];
  className?: string;
}) {
  const shown = members.slice(0, 3);
  if (shown.length === 0) {
    return (
      <div
        className={cn(
          "flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-slate-300 to-slate-400 text-white",
          className ?? "size-12",
        )}
      >
        <Users className="size-5" />
      </div>
    );
  }
  return (
    <div className={cn("flex shrink-0 items-center", className ?? "size-12")}>
      {shown.map((m, i) => (
        <UserAvatar
          key={m._id}
          user={m}
          className={cn(
            "size-7 ring-2 ring-white/80",
            i > 0 && "-ml-2.5",
            shown.length === 1 && "size-11",
          )}
        />
      ))}
    </div>
  );
}

export function ConversationList({
  conversations,
  selectedId,
  myUserId,
  onSelect,
}: {
  conversations: ConversationSummary[];
  selectedId: Id<"conversations"> | null;
  myUserId: Id<"users"> | undefined;
  onSelect: (id: Id<"conversations">) => void;
}) {
  if (conversations.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <div className="glass-soft flex size-14 items-center justify-center rounded-2xl">
          <MessageSquareText className="size-6 text-primary" />
        </div>
        <p className="text-sm font-semibold">No chats yet</p>
        <p className="text-xs leading-5 text-muted-foreground">
          Add a friend and say hi — your conversations will show up here.
        </p>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-1">
      {conversations.map((conversation) => {
        const isSelected = conversation._id === selectedId;
        const isGroup = conversation.isGroup;
        const title = isGroup
          ? (conversation.name ?? "Group")
          : displayName(conversation.other);
        const senderName = isGroup
          ? conversation.lastMessageSenderId === myUserId
            ? "You"
            : conversation.members.find(
                (m) => m._id === conversation.lastMessageSenderId,
              )
            ? displayName(
                conversation.members.find(
                  (m) => m._id === conversation.lastMessageSenderId,
                ),
              )
            : ""
          : "";
        const preview = conversation.lastMessagePreview
          ? (senderName ? `${senderName}: ` : "") +
            truncate(conversation.lastMessagePreview, 42)
          : isGroup
            ? `${conversation.memberCount} members`
            : "Say hello!";

        return (
          <li key={conversation._id}>
            <button
              onClick={() => onSelect(conversation._id)}
              className={cn(
                "group flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-all",
                isSelected
                  ? "glass-soft bg-white/70 shadow-sm"
                  : "hover:bg-white/50",
              )}
            >
              {isGroup ? (
                <GroupAvatar members={conversation.members} className="size-12" />
              ) : (
                <UserAvatar user={conversation.other} className="size-12 text-sm" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <p
                    className={cn(
                      "truncate text-sm font-semibold",
                      conversation.unreadCount > 0 && "text-foreground",
                    )}
                  >
                    {title}
                  </p>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {formatConversationTime(conversation.lastMessageAt)}
                  </span>
                </div>
                <div className="mt-0.5 flex items-center justify-between gap-2">
                  <p
                    className={cn(
                      "truncate text-xs",
                      conversation.unreadCount > 0
                        ? "font-medium text-foreground/80"
                        : "text-muted-foreground",
                    )}
                  >
                    {preview}
                  </p>
                  {conversation.unreadCount > 0 && (
                    <Badge className="size-5 shrink-0 justify-center rounded-full bg-primary px-0 text-[10px]">
                      {conversation.unreadCount > 99
                        ? "99+"
                        : conversation.unreadCount}
                    </Badge>
                  )}
                </div>
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
