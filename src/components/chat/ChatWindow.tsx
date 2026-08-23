import { GroupAvatar } from "@/components/chat/ConversationList";
import { GroupSettingsPanel } from "@/components/chat/GroupSettingsPanel";
import { NChatLogo } from "@/components/chat/NChatLogo";
import { UserAvatar } from "@/components/chat/UserAvatar";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { api } from "@/convex/_generated/api";
import { useAction, useMutation, useQuery } from "convex/react";
import type { Id } from "@/convex/_generated/dataModel";
import { useAuth } from "@/hooks/use-auth";
import {
  displayName,
  formatDayLabel,
  formatMessageTime,
  initials,
} from "@/lib/chat-utils";
import { cn } from "@/lib/utils";
import {
  ArrowLeft,
  Check,
  CheckCheck,
  Edit3,
  FileText,
  Image as ImageIcon,
  Loader2,
  MessageSquarePlus,
  MoreHorizontal,
  Paperclip,
  Phone,
  Search,
  Send,
  SmilePlus,
  Trash2,
  Video,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { toast } from "sonner";

type Message = {
  _id: string;
  senderId: string;
  body: string;
  createdAt: number;
  clientMessageId: string | null;
  editedAt?: number;
  isDeleted?: boolean;
  reactions?: Record<string, string[]>;
  attachmentFileId?: string;
  attachmentName?: string;
  attachmentType?: string;
};

type PendingMessage = {
  clientMessageId: string;
  body: string;
  createdAt: number;
  attachmentFileId?: string;
  attachmentName?: string;
  attachmentType?: string;
};

const REACTION_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🔥", "🎉", "👏"];

function TypingDots() {
  return (
    <span className="ml-1 inline-flex gap-[3px]">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="inline-block size-[5px] rounded-full bg-muted-foreground animate-pulse"
          style={{ animationDelay: `${i * 0.15}s` }}
        />
      ))}
    </span>
  );
}

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
  const sendWithAttachment = useMutation(api.messages.sendWithAttachment);
  const markRead = useMutation(api.conversations.markRead);
  const startCall = useMutation(api.calls.start);
  const startTyping = useMutation(api.typing.startTyping);
  const stopTyping = useMutation(api.typing.stopTyping);
  const toggleReaction = useMutation(api.messages.toggleReaction);
  const editMessage = useMutation(api.messages.editMessage);
  const deleteMessage = useMutation(api.messages.deleteMessage);
  const uploadFile = useAction(api.actions.uploadFile);

  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchJumpTo, setSearchJumpTo] = useState<number | null>(null);
  const [pendingAttachment, setPendingAttachment] = useState<{
    fileId: string;
    name: string;
    type: string;
    url: string;
    uploading: boolean;
  } | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [ctxMenu, setCtxMenu] = useState<{
    msgId: string;
    isOwn: boolean;
    x: number;
    y: number;
  } | null>(null);
  const [reactionPickerFor, setReactionPickerFor] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const preserveScrollRef = useRef<number | null>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const lastTypingRef = useRef(0);

  // Reset on conversation switch.
  useEffect(() => {
    setOlderCursor(null);
    setPending([]);
    setSearchOpen(false);
    setSearchJumpTo(null);
    setPendingAttachment(null);
    setCtxMenu(null);
    setReactionPickerFor(null);
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

  // Typing indicator logic.
  useEffect(() => {
    if (!conversationId) return;
    if (draft.trim().length > 0) {
      const now = Date.now();
      if (now - lastTypingRef.current > 2500) {
        lastTypingRef.current = now;
        void startTyping({ conversationId });
      }
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = setTimeout(() => {
        void stopTyping({ conversationId });
      }, 3000);
    } else {
      clearTimeout(typingTimeoutRef.current);
      void stopTyping({ conversationId });
    }
    return () => {
      clearTimeout(typingTimeoutRef.current);
      void stopTyping({ conversationId });
    };
  }, [draft, conversationId, startTyping, stopTyping]);

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
    stickToBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };

  const loadOlder = () => {
    const cursor = cursorSource?.cursor;
    if (!cursor) return;
    const el = scrollRef.current;
    if (el) preserveScrollRef.current = el.scrollHeight - el.scrollTop;
    setOlderCursor(cursor);
  };

  // Scroll to a specific message when search selects it.
  useEffect(() => {
    if (searchJumpTo === null) return;
    const el = scrollRef.current;
    if (!el) return;
    // Use a small delay to let React render the row.
    requestAnimationFrame(() => {
      const row = el.querySelector(`[data-msg-ts="${searchJumpTo}"]`);
      if (row) {
        row.scrollIntoView({ behavior: "smooth", block: "center" });
        // Flash highlight.
        row.classList.add("ring-2", "ring-primary/50", "rounded-2xl");
        setTimeout(() => {
          row.classList.remove("ring-2", "ring-primary/50", "rounded-2xl");
        }, 1800);
      }
      setSearchJumpTo(null);
    });
  }, [searchJumpTo]);

  const doSend = useCallback(async () => {
    const body = draft.trim();
    if ((!body && !pendingAttachment) || !conversationId || sending) return;
    const clientMessageId = crypto.randomUUID();

    // Optimistic pending message.
    setPending((prev) => [
      ...prev,
      {
        clientMessageId,
        body: body || (pendingAttachment?.name ?? ""),
        createdAt: Date.now(),
        attachmentFileId: pendingAttachment?.fileId,
        attachmentName: pendingAttachment?.name,
        attachmentType: pendingAttachment?.type,
      },
    ]);
    const sentAttachment = pendingAttachment;
    setDraft("");
    setPendingAttachment(null);
    setSending(true);
    void stopTyping({ conversationId });

    try {
      if (sentAttachment && !sentAttachment.uploading) {
        await sendWithAttachment({
          conversationId,
          body,
          clientMessageId,
          attachmentFileId: sentAttachment.fileId,
          attachmentName: sentAttachment.name,
          attachmentType: sentAttachment.type,
        });
      } else {
        await sendMessage({ conversationId, body, clientMessageId });
      }
      stickToBottomRef.current = true;
    } catch (e) {
      setPending((prev) =>
        prev.filter((p) => p.clientMessageId !== clientMessageId),
      );
      toast.error(e instanceof Error ? e.message : "Couldn't send your message");
    } finally {
      setSending(false);
    }
  }, [draft, pendingAttachment, conversationId, sending, sendMessage, sendWithAttachment, stopTyping]);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 50 * 1024 * 1024) {
      toast.error("File is too large (max 50 MB)");
      return;
    }
    const isImage = file.type.startsWith("image/");
    const isPdf = file.type === "application/pdf";
    if (!isImage && !isPdf) {
      toast.error("Only images and PDFs are supported");
      return;
    }

    // Show preview immediately.
    const url = URL.createObjectURL(file);
    setPendingAttachment({
      fileId: "",
      name: file.name,
      type: file.type,
      url,
      uploading: true,
    });

    // Read file and upload to Convex storage.
    try {
      const reader = new FileReader();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const result = await uploadFile({
        dataUrl,
        filename: file.name,
        mimeType: file.type,
      });
      setPendingAttachment({
        fileId: result.storageId,
        name: file.name,
        type: file.type,
        url: result.url ?? url,
        uploading: false,
      });
    } catch (err) {
      toast.error("Upload failed — try again");
      setPendingAttachment(null);
    }

    // Reset the input.
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleCall = async (type: "audio" | "video") => {
    if (!conversationId) return;
    try {
      await startCall({ conversationId, type });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't start the call");
    }
  };

  const handleToggleReaction = (messageId: string, emoji: string) => {
    void toggleReaction({ messageId: messageId as Id<"messages">, emoji });
  };

  const handleEdit = (msg: Message) => {
    setEditDraft(msg.body);
    setCtxMenu(null);
  };

  const handleSaveEdit = async (messageId: string) => {
    const body = editDraft.trim();
    if (!body) return;
    try {
      await editMessage({
        messageId: messageId as Id<"messages">,
        body,
      });
      setCtxMenu(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't edit message");
    }
  };

  const handleDelete = async (messageId: string) => {
    if (!window.confirm("Delete this message?")) {
      setCtxMenu(null);
      return;
    }
    try {
      await deleteMessage({ messageId: messageId as Id<"messages"> });
      setCtxMenu(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't delete message");
    }
  };

  // Context menu on right-click.
  const handleMsgContextMenu = (e: React.MouseEvent, msg: Message) => {
    e.preventDefault();
    const isOwn = msg.senderId === myUserId;
    if (!isOwn) return;
    setCtxMenu({
      msgId: msg._id,
      isOwn,
      x: e.clientX,
      y: e.clientY,
    });
  };

  useEffect(() => {
    if (ctxMenu) {
      const close = () => setCtxMenu(null);
      window.addEventListener("click", close);
      window.addEventListener("scroll", close, true);
      return () => {
        window.removeEventListener("click", close);
        window.removeEventListener("scroll", close, true);
      };
    }
  }, [ctxMenu]);

  // ── Empty / unavailable states ──────────────────────────────────────────
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
        <Button
          onClick={onNewChat}
          className="gap-2 rounded-full bg-gradient-nchat text-white"
        >
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
          <GroupAvatar
            members={conversation?.members ?? []}
            className="size-10"
          />
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
                onClick={() => setSearchOpen((s) => !s)}
                aria-label="Search messages"
                className={cn(searchOpen && "bg-primary/10 text-primary")}
              >
                <Search className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Search messages</TooltipContent>
          </Tooltip>
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
                <Button variant="ghost" size="icon" aria-label="Group settings">
                  <MoreHorizontal className="size-4" />
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

      {/* Search bar */}
      {searchOpen && conversationId && (
        <SearchPanel
          conversationId={conversationId}
          onJumpTo={(ts) => {
            setSearchJumpTo(ts);
            setSearchOpen(false);
          }}
          onClose={() => setSearchOpen(false)}
        />
      )}

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
              {isGroup
                ? `Welcome to ${title}`
                : `You and ${title} are connected`}
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
            const msgId = "_id" in msg ? msg._id : null;
            const isOwn = "senderId" in msg ? msg.senderId === myUserId : true;
            const showSender = isGroup && !isOwn;
            const read =
              !isGroup &&
              isOwn &&
              "senderId" in msg &&
              (lastReadBy[conversation?.other?._id ?? ""] ?? 0) >= msg.createdAt;
            const reactions = "_id" in msg ? (msg.reactions ?? {}) : {};
            const reactionEntries = Object.entries(reactions);
            const hasAttachment =
              ("attachmentFileId" in msg && msg.attachmentFileId) ||
              ("attachmentFileId" in msg && msg.attachmentFileId === undefined && false);
            const attachmentFileId = "_attachmentFileId" in msg ? (msg as Message).attachmentFileId : undefined;
            const attachmentName = "_attachmentName" in msg ? (msg as Message).attachmentName : undefined;
            const attachmentType = "_attachmentType" in msg ? (msg as Message).attachmentType : undefined;
            const isDeleted = "_isDeleted" in msg ? (msg as Message).isDeleted : false;
            const editedAt = "_editedAt" in msg ? (msg as Message).editedAt : undefined;
            const msgBody = isDeleted ? "" : msg.body;
            const showBody = !isDeleted || attachmentFileId;

            const key = msgId
              ? `${msgId}-${editedAt ?? 0}-${reactionEntries.length}`
              : `pending-${(msg as PendingMessage).clientMessageId}`;

            return (
              <div
                key={key}
                data-msg-ts={msg.createdAt}
                className={cn(
                  "group/msg relative flex flex-col",
                  isOwn ? "items-end" : "items-start",
                )}
                onContextMenu={(e) => {
                  if ("_id" in msg) handleMsgContextMenu(e, msg as Message);
                }}
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
                  {/* Attachment preview */}
                  {attachmentFileId && (
                    <div className="mb-2">
                      {attachmentType?.startsWith("image/") ? (
                        <img
                          src={(() => {
                            // For pending messages, use the URL from state.
                            // For server messages, construct from storage ID.
                            if ("_id" in msg && attachmentFileId) {
                              return `https://getfile.convex.cloud/${attachmentFileId}`;
                            }
                            return "";
                          })()}
                          alt={attachmentName ?? "Image"}
                          className="max-h-60 rounded-xl object-cover"
                          onError={(e) => {
                            // Fallback: try the Convex storage URL pattern.
                            const img = e.currentTarget;
                            if (!img.dataset.retried) {
                              img.dataset.retried = "1";
                              img.src = `https://coordinated-lobster-212.convex.site/api/storage/${attachmentFileId}`;
                            }
                          }}
                        />
                      ) : (
                        <a
                          href={(() => {
                            if ("_id" in msg && attachmentFileId) {
                              return `https://getfile.convex.cloud/${attachmentFileId}`;
                            }
                            return "#";
                          })()}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={cn(
                            "flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium transition",
                            isOwn
                              ? "bg-white/20 text-white hover:bg-white/30"
                              : "bg-primary/10 text-primary hover:bg-primary/20",
                          )}
                        >
                          <FileText className="size-4 shrink-0" />
                          <span className="truncate">{attachmentName ?? "File"}</span>
                        </a>
                      )}
                    </div>
                  )}

                  {showBody && (
                    <p className="whitespace-pre-wrap break-words">{msgBody}</p>
                  )}

                  {/* Edited indicator + timestamp + read receipts */}
                  <p
                    className={cn(
                      "mt-1 flex items-center justify-end gap-1 text-[10px]",
                      isOwn ? "text-white/75" : "text-muted-foreground",
                    )}
                  >
                    {editedAt && !isDeleted && (
                      <span className="italic">edited</span>
                    )}
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

                {/* Deleted overlay */}
                {isDeleted && (
                  <p className="mt-0.5 text-xs italic text-muted-foreground/70">
                    Message deleted
                  </p>
                )}

                {/* Reactions display */}
                {reactionEntries.length > 0 && !isDeleted && (
                  <div className="mt-0.5 flex flex-wrap gap-1">
                    {reactionEntries.map(([emoji, users]) => {
                      const hasReacted = users.includes(myUserId as string);
                      return (
                        <button
                          key={emoji}
                          onClick={() =>
                            msgId && handleToggleReaction(msgId, emoji)
                          }
                          className={cn(
                            "flex items-center gap-1 rounded-full px-2 py-0.5 text-xs transition",
                            hasReacted
                              ? "bg-primary/20 ring-1 ring-primary/30"
                              : "glass-soft hover:bg-white/60",
                          )}
                        >
                          <span>{emoji}</span>
                          <span
                            className={cn(
                              "font-medium",
                              hasReacted
                                ? "text-primary"
                                : "text-muted-foreground",
                            )}
                          >
                            {users.length}
                          </span>
                        </button>
                      );
                    })}
                    {/* Add reaction button */}
                    {msgId && (
                      <button
                        onClick={() =>
                          setReactionPickerFor(
                            reactionPickerFor === msgId ? null : msgId,
                          )
                        }
                        className="flex size-6 items-center justify-center rounded-full glass-soft text-muted-foreground hover:bg-white/60 hover:text-foreground transition"
                      >
                        <SmilePlus className="size-3" />
                      </button>
                    )}
                  </div>
                )}

                {/* Reaction picker (shown on new messages without reactions or on explicit add) */}
                {msgId && reactionPickerFor === msgId && (
                  <div className="mt-1 flex gap-0.5 rounded-full glass-strong px-2 py-1 shadow-lg">
                    {REACTION_EMOJIS.map((emoji) => (
                      <button
                        key={emoji}
                        onClick={() => {
                          handleToggleReaction(msgId, emoji);
                          setReactionPickerFor(null);
                        }}
                        className="flex size-7 items-center justify-center rounded-full text-sm transition hover:bg-white/60 hover:scale-125"
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                )}

                {/* Hover reaction button for messages without reactions */}
                {msgId && reactionEntries.length === 0 && reactionPickerFor !== msgId && (
                  <button
                    onClick={() => setReactionPickerFor(msgId)}
                    className="absolute -right-1 top-0 flex size-6 items-center justify-center rounded-full glass-soft text-muted-foreground opacity-0 transition-opacity group-hover/msg:opacity-100 hover:bg-white/60 hover:text-foreground"
                  >
                    <SmilePlus className="size-3" />
                  </button>
                )}

                {/* Hover context menu button (edit/delete) for own messages */}
                {msgId && isOwn && !isDeleted && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setCtxMenu({
                        msgId,
                        isOwn,
                        x: e.currentTarget.getBoundingClientRect().right,
                        y: e.currentTarget.getBoundingClientRect().bottom,
                      });
                    }}
                    className="absolute -left-1 top-0 flex size-6 items-center justify-center rounded-full glass-soft text-muted-foreground opacity-0 transition-opacity group-hover/msg:opacity-100 hover:bg-white/60 hover:text-foreground"
                  >
                    <MoreHorizontal className="size-3" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Context menu popover */}
      {ctxMenu && (
        <div
          className="fixed z-[90]"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
        >
          <div
            className="glass-strong mt-1 min-w-[140px] rounded-xl border border-white/70 p-1 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => {
                const msg = displayed.find(
                  (m) => "_id" in m && m._id === ctxMenu.msgId,
                ) as Message | undefined;
                if (msg) handleEdit(msg);
              }}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition hover:bg-white/60"
            >
              <Edit3 className="size-4 text-muted-foreground" />
              Edit
            </button>
            <button
              onClick={() => void handleDelete(ctxMenu.msgId)}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-destructive transition hover:bg-destructive/10"
            >
              <Trash2 className="size-4" />
              Delete
            </button>
          </div>
        </div>
      )}

      {/* Edit draft overlay */}
      {ctxMenu && editDraft !== "" && !ctxMenu.isOwn && false && null}

      {/* Inline edit mode: replace composer with edit bar */}
      {ctxMenu && editDraft !== "" && (
        <div className="glass-soft border-x-0 border-b-0 px-3 py-2 md:rounded-b-2xl md:px-4">
          <div className="mx-auto flex max-w-2xl items-center gap-2">
            <Edit3 className="size-4 shrink-0 text-muted-foreground" />
            <input
              autoFocus
              value={editDraft}
              onChange={(e) => setEditDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void handleSaveEdit(ctxMenu.msgId);
                }
                if (e.key === "Escape") {
                  setEditDraft("");
                  setCtxMenu(null);
                }
              }}
              className="flex-1 rounded-xl border border-white/60 bg-white/50 px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary/30"
              placeholder="Edit message…"
            />
            <Button
              size="sm"
              className="rounded-full bg-gradient-nchat text-white"
              onClick={() => void handleSaveEdit(ctxMenu.msgId)}
            >
              Save
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={() => {
                setEditDraft("");
                setCtxMenu(null);
              }}
            >
              <X className="size-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Composer (only show when NOT editing) */}
      {!ctxMenu?.isOwn && (
        <footer className="glass-soft border-x-0 border-b-0 px-3 py-3 md:rounded-b-2xl md:px-4">
          {/* Pending attachment preview */}
          {pendingAttachment && (
            <div className="mb-2 flex items-center gap-2 rounded-xl bg-white/60 p-2">
              {pendingAttachment.type.startsWith("image/") ? (
                <img
                  src={pendingAttachment.url}
                  alt="Attachment"
                  className="size-16 rounded-lg object-cover"
                />
              ) : (
                <div className="flex size-16 items-center justify-center rounded-lg bg-primary/10">
                  <FileText className="size-6 text-primary" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium">{pendingAttachment.name}</p>
                {pendingAttachment.uploading && (
                  <p className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground">
                    <Loader2 className="size-3 animate-spin" />
                    Uploading…
                  </p>
                )}
              </div>
              <button
                onClick={() => setPendingAttachment(null)}
                className="flex size-6 items-center justify-center rounded-full text-muted-foreground hover:bg-white/60"
              >
                <X className="size-3.5" />
              </button>
            </div>
          )}

          <div className="mx-auto flex max-w-2xl items-end gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,.pdf"
              className="hidden"
              onChange={handleFileSelect}
            />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => fileInputRef.current?.click()}
                  aria-label="Attach file"
                  className="shrink-0 text-muted-foreground hover:text-primary"
                >
                  <Paperclip className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Attach image or PDF</TooltipContent>
            </Tooltip>
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
              disabled={(!draft.trim() && !pendingAttachment) || sending || (pendingAttachment?.uploading ?? false)}
              onClick={() => void doSend()}
              aria-label="Send message"
            >
              {sending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Send className="size-4" />
              )}
            </Button>
          </div>
        </footer>
      )}

      {/* Typing indicator in messages area */}
      {conversationId && <TypingBadge conversationId={conversationId} />}
    </section>
  );
}

// ── Typing badge shown at the bottom of the message area ────────────────

function TypingBadge({ conversationId }: { conversationId: Id<"conversations"> }) {
  const typingUserIds = useQuery(api.typing.whoTyping, { conversationId });
  const members = useQuery(
    api.conversations.get,
    conversationId ? { conversationId } : "skip",
  );

  if (!typingUserIds || typingUserIds.length === 0) return null;

  const names = typingUserIds
    .map((uid) => {
      const member = members?.members?.find((m) => m._id === uid);
      return member ? displayName(member) : "Someone";
    })
    .slice(0, 3);

  let label = "";
  if (names.length === 1) label = `${names[0]} is typing`;
  else if (names.length === 2) label = `${names[0]} and ${names[1]} are typing`;
  else label = "Several people are typing";

  return (
    <div className="absolute bottom-2 left-4 z-10">
      <span className="glass-soft inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium text-muted-foreground shadow-sm">
        <TypingDots />
        {label}
      </span>
    </div>
  );
}

// ── In-conversation search panel ────────────────────────────────────────

function SearchPanel({
  conversationId,
  onJumpTo,
  onClose,
}: {
  conversationId: Id<"conversations">;
  onJumpTo: (createdAt: number) => void;
  onClose: () => void;
}) {
  const [term, setTerm] = useState("");
  const results = useQuery(
    api.messages.searchMessages,
    term.trim().length >= 2
      ? { conversationId, searchTerm: term.trim() }
      : "skip",
  );

  return (
    <div className="glass-soft border-x-0 px-4 py-3">
      <div className="mx-auto flex max-w-2xl items-center gap-2">
        <Search className="size-4 shrink-0 text-muted-foreground" />
        <input
          autoFocus
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Search in conversation…"
          className="flex-1 rounded-xl border border-white/60 bg-white/50 px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary/30"
        />
        <Button size="icon-sm" variant="ghost" onClick={onClose}>
          <X className="size-4" />
        </Button>
      </div>
      {results && results.length > 0 && (
        <div className="chat-scroll mx-auto mt-2 max-h-48 max-w-2xl space-y-1 overflow-y-auto">
          {results.map((r) => (
            <button
              key={r._id}
              onClick={() => onJumpTo(r.createdAt)}
              className="flex w-full items-start gap-2 rounded-xl px-3 py-2 text-left transition hover:bg-white/60"
            >
              <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                {r.body}
              </p>
              <span className="shrink-0 text-[10px] text-muted-foreground">
                {formatMessageTime(r.createdAt)}
              </span>
            </button>
          ))}
        </div>
      )}
      {results && results.length === 0 && term.trim().length >= 2 && (
        <p className="mt-2 text-center text-xs text-muted-foreground">
          No messages found
        </p>
      )}
    </div>
  );
}
