import { GroupAvatar } from "@/components/chat/ConversationList";
import { GroupSettingsPanel } from "@/components/chat/GroupSettingsPanel";
import { NChatLogo } from "@/components/chat/NChatLogo";
import { UserAvatar } from "@/components/chat/UserAvatar";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useAuth } from "@/hooks/use-auth";
import {
  displayName,
  formatDayLabel,
  formatMessageTime,
} from "@/lib/chat-utils";
import { cn } from "@/lib/utils";
import { useMutation, useQuery } from "convex/react";
import {
  ArrowLeft,
  Check,
  CheckCheck,
  Loader2,
  MessageSquarePlus,
  MoreVertical,
  Phone,
  Send,
  Video,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

type Message = {
  _id: string;
  senderId: string;
  body: string;
  createdAt: number;
  clientMessageId: string | null;
};

type PendingMessage = {
  clientMessageId: string;
  body: string;
  createdAt: number;
};

export function ChatWindow({
  conversationId,
  onBack,
  onNewChat,
}: {
  conversationId: Id<"conversations"> | null;
  onBack: () => void;
  onNewChat: () => void;
}) {
  const { user } = useAuth();
  const myUserId = user?._id;

  const conversation = useQuery(
    api.conversations.get,
    conversationId ? { conversationId } : "skip",
  );
  const [olderCursor, setOlderCursor] = useState<number | null>(null);
  const latestPage = useQuery(
    api.conversations.messages,
    conversationId ? { conversationId, cursor: undefined } : "skip",
  );
  const olderPage = useQuery(
    api.conversations.messages,
    conversationId && olderCursor !== null
      ? { conversationId, cursor: olderCursor }
      : "skip",
  );

  const sendMessage = useMutation(api.messages.send);
  const markRead = useMutation(api.conversations.markRead);
  const startCall = useMutation(api.calls.start);

  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const [sending, setSending] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const preserveScrollRef = useRef<number | null>(null);

  // Reset pagination when switching conversations.
  useEffect(() => {
    setOlderCursor(null);
    setPending([]);
  }, [conversationId]);

  const cursorSource = olderCursor !== null ? olderPage : latestPage;
  const hasMoreOlder = Boolean(cursorSource?.cursor);

  const mergedMessages = useMemo(() => {
    const map = new Map<string, Message>();
    for (const m of olderPage?.messages ?? []) map.set(m._id, m);
    for (const m of latestPage?.messages ?? []) map.set(m._id, m);
    return Array.from(map.values()).sort((a, b) => a.createdAt - b.createdAt);
  }, [olderPage, latestPage]);

  // Remove pending entries once the server confirms them.
  useEffect(() => {
    if (pending.length === 0) return;
    const confirmed = new Set(
      (latestPage?.messages ?? [])
        .map((m) => m.clientMessageId)
        .filter((id): id is string => Boolean(id)),
    );
    setPending((prev) =>
      prev.filter((p) => !confirmed.has(p.clientMessageId)),
    );
  }, [latestPage, pending.length]);

  const pendingIds = useMemo(
    () => new Set(pending.map((p) => p.clientMessageId)),
    [pending],
  );
  const serverMessages = mergedMessages.filter(
    (m) => !(m.clientMessageId && pendingIds.has(m.clientMessageId)),
  );
  const displayed = useMemo(
    () =>
      [...serverMessages, ...pending]
        .sort((a, b) => a.createdAt - b.createdAt),
    [serverMessages, pending],
  );

  // Mark as read while the conversation is open.
  useEffect(() => {
    if (!conversationId) return;
    void markRead({ conversationId });
  }, [conversationId, markRead, displayed.length]);

  // Scroll handling.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (preserveScrollRef.current !== null) {
      el.scrollTop = el.scrollHeight - preserveScrollRef.current;
      preserveScrollRef.current = null;
      return;
    }
    if (stickToBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [displayed.length, conversationId]);

  useEffect(() => {
    stickToBottomRef.current = true;
  }, [conversationId]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };

  const loadOlder = () => {
    const cursor = cursorSource?.cursor;
    if (!cursor) return;
    const el = scrollRef.current;
    if (el) preserveScrollRef.current = el.scrollHeight - el.scrollTop;
    setOlderCursor(cursor);
  };

  const doSend = async () => {
    const body = draft.trim();
    if (!body || !conversationId || sending) return;
    const clientMessageId = crypto.randomUUID();
    setPending((prev) => [...prev, { clientMessageId, body, createdAt: Date.now() }]);
    setDraft("");
    setSending(true);
    try {
      await sendMessage({ conversationId, body, clientMessageId });
      stickToBottomRef.current = true;
    } catch (e) {
      setPending((prev) => prev.filter((p) => p.clientMessageId !== clientMessageId));
      toast.error(e instanceof Error ? e.message : "Couldn't send your message");
    } finally {
      setSending(false);
    }
  };

  const handleCall = async (type: "audio" | "video") => {
    if (!conversationId) return;
    try {
      await startCall({ conversationId, type });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't start the call");
    }
  };

  // ---- Empty / unavailable states -----------------------------------------
  if (!conversationId) {
    return (
      <section className="hidden flex-1 flex-col items-center justify-center gap-4 p-8 text-center md:flex">
        <NChatLogo className="size-20" />
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Your messages</h2>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
            Pick a conversation, or start a fresh one with a friend or your
            whole crew.
          </p>
        </div>
        <Button onClick={onNewChat} className="gap-2 rounded-full bg-gradient-nchat text-white">
          <MessageSquarePlus className="size-4" />
          Start a conversation
        </Button>
      </section>
    );
  }

  if (conversation === null) {
    return (
      <section className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-sm font-semibold">This conversation is gone</p>
        <p className="text-xs text-muted-foreground">
          It may have been deleted or you may have left the group.
        </p>
        <Button variant="outline" size="sm" onClick={onBack}>
          <ArrowLeft className="size-4" />
          Back to chats
        </Button>
      </section>
    );
  }

  const isGroup = conversation?.isGroup ?? false;
  const title = isGroup
    ? (conversation?.name ?? "Group")
    : displayName(conversation?.other);
  const subtitle = isGroup
    ? `${conversation?.memberCount ?? 0} members`
    : (conversation?.other?.email ?? "Friend");
  const senderName = (senderId: string) => {
    const m = conversation?.members.find((mm) => mm._id === senderId);
    return m ? displayName(m) : "Member";
  };
  const lastReadBy = conversation?.lastReadBy ?? {};

  // Build day-separated groups.
  const rows = useMemo(() => {
    const out: Array<
      | { kind: "day"; label: string; ts: number }
      | { kind: "msg"; msg: Message | PendingMessage }
    > = [];
    let lastDay: string | null = null;
    for (const msg of displayed) {
      const day = formatDayLabel(msg.createdAt);
      if (day !== lastDay) {
        out.push({ kind: "day", label: day, ts: msg.createdAt });
        lastDay = day;
      }
      out.push({ kind: "msg", msg });
    }
    return out;
  }, [displayed]);

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      {/* Header */}
      <header className="glass-soft flex items-center gap-3 rounded-none border-x-0 border-t-0 px-4 py-3 md:rounded-t-2xl">
        <Button
          variant="ghost"
          size="icon-sm"
          className="md:hidden"
          onClick={onBack}
          aria-label="Back to chats"
        >
          <ArrowLeft className="size-5" />
        </Button>
        {isGroup ? (
          <GroupAvatar members={conversation?.members ?? []} className="size-10" />
        ) : (
          <UserAvatar user={conversation?.other ?? null} className="size-10 text-sm" />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold">{title}</p>
          <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
        </div>

        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => void handleCall("audio")}
                aria-label="Start a voice call"
              >
                <Phone className="size-4 text-primary" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Voice call</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => void handleCall("video")}
                aria-label="Start a video call"
              >
                <Video className="size-4 text-primary" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Video call</TooltipContent>
          </Tooltip>
          {isGroup && (
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Group settings"
                >
                  <MoreVertical className="size-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="glass-strong border-white/70">
                <GroupSettingsPanel
                  conversationId={conversationId}
                  conversationName={conversation?.name ?? "Group"}
                  createdById={conversation?.createdById ?? null}
                  myUserId={myUserId}
                  onLeave={onBack}
                />
              </PopoverContent>
            </Popover>
          )}
        </div>
      </header>

      {/* Messages */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="chat-scroll flex-1 overflow-y-auto px-4 py-4 md:px-6"
      >
        {hasMoreOlder && (
          <div className="mb-3 flex justify-center">
            <Button
              variant="ghost"
              size="sm"
              className="glass-soft h-7 rounded-full text-xs text-muted-foreground"
              onClick={loadOlder}
            >
              <Loader2 className="size-3.5" />
              Load earlier messages
            </Button>
          </div>
        )}

        {rows.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <NChatLogo className="size-14 opacity-80" />
            <p className="text-sm font-semibold">
              {isGroup ? `Welcome to ${title}` : `You and ${title} are connected`}
            </p>
            <p className="max-w-xs text-xs leading-5 text-muted-foreground">
              Send the first message — this is where your conversation begins.
            </p>
          </div>
        )}

        <div className="mx-auto flex max-w-2xl flex-col gap-1.5">
          {rows.map((row, i) => {
            if (row.kind === "day") {
              return (
                <div key={`day-${i}`} className="my-3 flex justify-center">
                  <span className="glass-soft rounded-full px-3 py-1 text-[11px] font-medium text-muted-foreground">
                    {row.label}
                  </span>
                </div>
              );
            }
            const msg = row.msg;
            const isPending = !("_id" in msg);
            const isOwn = "senderId" in msg ? msg.senderId === myUserId : true;
            const showSender = isGroup && !isOwn;
            const read =
              !isGroup &&
              isOwn &&
              "senderId" in msg &&
              (lastReadBy[conversation?.other?._id ?? ""] ?? 0) >= msg.createdAt;
            return (
              <div
                key={"_id" in msg ? msg._id : msg.clientMessageId}
                className={cn(
                  "flex flex-col",
                  isOwn ? "items-end" : "items-start",
                )}
              >
                {showSender && (
                  <span className="mb-0.5 ml-2 text-[11px] font-medium text-muted-foreground">
                    {senderName((msg as Message).senderId)}
                  </span>
                )}
                <div
                  className={cn(
                    "max-w-[82%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed shadow-sm md:max-w-[70%]",
                    isOwn
                      ? "bg-gradient-nchat rounded-br-md text-white"
                      : "glass-soft rounded-bl-md text-foreground",
                    isPending && "opacity-70",
                  )}
                >
                  <p className="whitespace-pre-wrap break-words">{msg.body}</p>
                  <p
                    className={cn(
                      "mt-1 flex items-center justify-end gap-1 text-[10px]",
                      isOwn ? "text-white/75" : "text-muted-foreground",
                    )}
                  >
                    {formatMessageTime(msg.createdAt)}
                    {isOwn &&
                      (isPending ? (
                        <span className="font-medium">Sending…</span>
                      ) : read ? (
                        <span className="flex items-center gap-0.5 font-medium">
                          <CheckCheck className="size-3" /> Read
                        </span>
                      ) : (
                        <span className="flex items-center gap-0.5">
                          <Check className="size-3" /> Sent
                        </span>
                      ))}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Composer */}
      <footer className="glass-soft border-x-0 border-b-0 px-3 py-3 md:rounded-b-2xl md:px-4">
        <div className="mx-auto flex max-w-2xl items-end gap-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void doSend();
              }
            }}
            placeholder={
              isGroup ? `Message ${title}` : `Message ${title.split(" ")[0]}`
            }
            rows={1}
            maxLength={4000}
            className="glass-soft max-h-32 min-h-10 resize-none rounded-2xl border-transparent px-4 py-2.5"
          />
          <Button
            size="icon-lg"
            className="rounded-full bg-gradient-nchat text-white shadow-md transition-transform hover:scale-105 active:scale-95 disabled:opacity-40"
            disabled={!draft.trim() || sending}
            onClick={() => void doSend()}
            aria-label="Send message"
          >
            <Send className="size-4" />
          </Button>
        </div>
      </footer>
    </section>
  );
}
