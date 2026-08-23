import { CallOverlay } from "@/components/calls/CallOverlay";
import { AppBackdrop } from "@/components/chat/AppBackdrop";
import { ChatSidebar } from "@/components/chat/ChatSidebar";
import { ChatWindow } from "@/components/chat/ChatWindow";
import { NewChatDialog } from "@/components/chat/NewChatDialog";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useQuery, useMutation } from "convex/react";
import { useEffect, useState } from "react";

const PRESENCE_INTERVAL_MS = 25_000;

export default function Chat() {
  const [selectedId, setSelectedId] = useState<Id<"conversations"> | null>(null);
  const [newChatOpen, setNewChatOpen] = useState(false);

  const upsertPresence = useMutation(api.typing.upsertPresence);
  const chats = useQuery(api.conversations.list);

  // Heartbeat: update presence every ~25 s so other users see us as online.
  useEffect(() => {
    void upsertPresence();
    const id = window.setInterval(() => {
      void upsertPresence();
    }, PRESENCE_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [upsertPresence]);

  // Tab title: show unread count badge.
  const totalUnread = chats?.totalUnread ?? 0;
  useEffect(() => {
    document.title = totalUnread > 0 ? `(${totalUnread}) NChat` : "NChat";
    return () => {
      document.title = "NChat";
    };
  }, [totalUnread]);

  return (
    <main className="relative flex h-dvh overflow-hidden p-0 md:p-4">
      <AppBackdrop />
      <div className="mx-auto flex h-full w-full max-w-[1440px] overflow-hidden rounded-none md:rounded-3xl">
        <ChatSidebar
          selectedId={selectedId}
          onSelect={setSelectedId}
          onNewChat={() => setNewChatOpen(true)}
          hidden={selectedId !== null}
        />
        <div
          className={
            selectedId !== null
              ? "flex min-w-0 flex-1 flex-col"
              : "hidden min-w-0 flex-1 flex-col md:flex"
          }
        >
          <ChatWindow
            conversationId={selectedId}
            onBack={() => setSelectedId(null)}
            onNewChat={() => setNewChatOpen(true)}
          />
        </div>
      </div>

      <NewChatDialog
        open={newChatOpen}
        onOpenChange={setNewChatOpen}
        onOpenConversation={(id) => setSelectedId(id)}
      />

      <CallOverlay />
    </main>
  );
}
