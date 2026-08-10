import {
  ConversationList,
  type ConversationSummary,
} from "@/components/chat/ConversationList";
import { NChatWordmark } from "@/components/chat/NChatLogo";
import { ProfileMenu } from "@/components/chat/ProfileMenu";
import { RequestsList } from "@/components/chat/RequestsList";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { useQuery } from "convex/react";
import { MessageSquarePlus, Search, UserRoundPlus } from "lucide-react";
import { useMemo, useState } from "react";

export function ChatSidebar({
  selectedId,
  onSelect,
  onNewChat,
  hidden,
}: {
  selectedId: Id<"conversations"> | null;
  onSelect: (id: Id<"conversations">) => void;
  onNewChat: () => void;
  hidden: boolean;
}) {
  const { user } = useAuth();
  const [tab, setTab] = useState<"chats" | "requests">("chats");
  const [search, setSearch] = useState("");

  const chats = useQuery(api.conversations.list);
  const requests = useQuery(api.friends.listRequests);

  const conversations: ConversationSummary[] = chats?.conversations ?? [];
  const totalUnread = chats?.totalUnread ?? 0;
  const requestCount = requests?.length ?? 0;

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return conversations;
    return conversations.filter((c) => {
      const title = c.isGroup
        ? (c.name ?? "").toLowerCase()
        : (c.other?.name ?? c.other?.email ?? "").toLowerCase();
      return title.includes(term);
    });
  }, [conversations, search]);

  return (
    <aside
      className={cn(
        "glass-panel flex w-full shrink-0 flex-col rounded-none border-y-0 border-l-0 md:w-[350px] md:rounded-l-3xl",
        hidden ? "hidden md:flex" : "flex",
      )}
    >
      {/* Brand + actions */}
      <div className="flex items-center justify-between px-5 pb-3 pt-5">
        <NChatWordmark markClassName="size-8" />
        <Button
          variant="ghost"
          size="icon"
          className="glass-soft rounded-full"
          onClick={onNewChat}
          aria-label="Start a new chat"
          title="New chat"
        >
          <MessageSquarePlus className="size-4 text-primary" />
        </Button>
      </div>

      {/* Search */}
      <div className="px-4 pb-2">
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search chats…"
            className="glass-soft h-9 rounded-full border-transparent pl-9"
          />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1.5 px-4 pb-2">
        <TabButton
          active={tab === "chats"}
          onClick={() => setTab("chats")}
          badge={totalUnread > 0 ? totalUnread : null}
        >
          Chats
        </TabButton>
        <TabButton
          active={tab === "requests"}
          onClick={() => setTab("requests")}
          badge={requestCount > 0 ? requestCount : null}
        >
          <UserRoundPlus className="size-3.5" />
          Requests
        </TabButton>
      </div>

      {/* Lists */}
      <div className="chat-scroll flex-1 overflow-y-auto px-2 pb-2">
        {tab === "chats" ? (
          <ConversationList
            conversations={filtered}
            selectedId={selectedId}
            myUserId={user?._id}
            onSelect={onSelect}
          />
        ) : (
          <RequestsList />
        )}
      </div>

      {/* Profile */}
      <div className="px-3 pb-3 pt-1">
        <ProfileMenu />
      </div>
    </aside>
  );
}

function TabButton({
  active,
  onClick,
  badge,
  children,
}: {
  active: boolean;
  onClick: () => void;
  badge: number | null;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex flex-1 items-center justify-center gap-1.5 rounded-full py-1.5 text-xs font-semibold transition",
        active
          ? "bg-gradient-nchat text-white shadow-sm"
          : "text-muted-foreground hover:bg-white/50 hover:text-foreground",
      )}
    >
      {children}
      {badge !== null && badge > 0 && (
        <span
          className={cn(
            "flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold",
            active ? "bg-white/25 text-white" : "bg-primary text-white",
          )}
        >
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </button>
  );
}
