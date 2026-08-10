import { UserAvatar } from "@/components/chat/UserAvatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { displayName } from "@/lib/chat-utils";
import { cn } from "@/lib/utils";
import { useMutation, useQuery } from "convex/react";
import { Check, Loader2, MessageSquarePlus, Search, Users } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export function NewChatDialog({
  open,
  onOpenChange,
  onOpenConversation,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenConversation: (conversationId: Id<"conversations">) => void;
}) {
  const [tab, setTab] = useState("message");
  const [search, setSearch] = useState("");

  const friends = useQuery(api.friends.listFriends);
  const searchResults = useQuery(
    api.friends.searchUsers,
    search.trim().length >= 2 ? { query: search.trim() } : "skip",
  );
  const sendRequest = useMutation(api.friends.sendFriendRequest);
  const getOrCreate = useMutation(api.conversations.getOrCreate);
  const createGroup = useMutation(api.groups.create);

  const [groupName, setGroupName] = useState("");
  const [selected, setSelected] = useState<Set<Id<"users">>>(new Set());
  const [busy, setBusy] = useState(false);

  const openChatWith = async (userId: Id<"users">) => {
    try {
      const id = await getOrCreate({ otherUserId: userId });
      onOpenConversation(id);
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't open a chat");
    }
  };

  const addFriend = async (userId: Id<"users">, name: string) => {
    try {
      await sendRequest({ addresseeId: userId });
      toast.success(`Friend request sent to ${name}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't send request");
    }
  };

  const createGroupChat = async () => {
    const name = groupName.trim();
    if (!name) {
      toast.error("Give your group a name");
      return;
    }
    if (selected.size === 0) {
      toast.error("Pick at least one friend");
      return;
    }
    setBusy(true);
    try {
      const id = await createGroup({
        name,
        memberIds: Array.from(selected),
      });
      onOpenConversation(id);
      setGroupName("");
      setSelected(new Set());
      setTab("message");
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't create the group");
    } finally {
      setBusy(false);
    }
  };

  const toggleMember = (id: Id<"users">) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const friendList = friends ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass-strong max-w-md border-white/70">
        <DialogHeader>
          <DialogTitle>Start something new</DialogTitle>
          <DialogDescription>
            Message a friend one-to-one, or gather your people into a group.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="message">
              <MessageSquarePlus className="size-4" />
              New message
            </TabsTrigger>
            <TabsTrigger value="group">
              <Users className="size-4" />
              New group
            </TabsTrigger>
          </TabsList>

          <TabsContent value="message" className="mt-3">
            <div className="relative mb-3">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                autoFocus
                placeholder="Search by name or email…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="glass-soft rounded-full border-transparent pl-9"
              />
            </div>

            <div className="chat-scroll max-h-72 space-y-1 overflow-y-auto pr-1">
              {search.trim().length >= 2 ? (
                searchResults === undefined ? (
                  <LoadingRow />
                ) : searchResults.length === 0 ? (
                  <p className="px-2 py-6 text-center text-sm text-muted-foreground">
                    No one found. Try their email address.
                  </p>
                ) : (
                  searchResults.map((u) => (
                    <UserRow
                      key={u._id}
                      name={displayName(u)}
                      email={u.email}
                      status={u.connectionStatus}
                      onAction={() =>
                        u.connectionStatus === "accepted"
                          ? void openChatWith(u._id)
                          : void addFriend(u._id, displayName(u))
                      }
                    />
                  ))
                )
              ) : friendList.length === 0 ? (
                <p className="px-2 py-6 text-center text-sm text-muted-foreground">
                  Search for people to add as friends.
                </p>
              ) : (
                friendList.map((f) => (
                  <UserRow
                    key={f._id}
                    name={displayName(f)}
                    email={f.email}
                    status="accepted"
                    onAction={() => void openChatWith(f._id)}
                  />
                ))
              )}
            </div>
          </TabsContent>

          <TabsContent value="group" className="mt-3">
            <Input
              placeholder="Group name, e.g. Family"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              maxLength={60}
              className="glass-soft mb-3 border-transparent"
            />
            <p className="mb-1.5 px-1 text-xs font-medium text-muted-foreground">
              Pick your friends — {selected.size} selected
            </p>
            <div className="chat-scroll max-h-56 space-y-1 overflow-y-auto pr-1">
              {friendList.length === 0 ? (
                <p className="px-2 py-6 text-center text-sm text-muted-foreground">
                  You need at least one friend first.
                </p>
              ) : (
                friendList.map((f) => {
                  const checked = selected.has(f._id);
                  return (
                    <button
                      key={f._id}
                      onClick={() => toggleMember(f._id)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-2xl p-2 text-left transition",
                        checked ? "bg-primary/10" : "hover:bg-white/60",
                      )}
                    >
                      <UserAvatar user={f} className="size-9 text-xs" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">
                          {displayName(f)}
                        </p>
                        {f.email && (
                          <p className="truncate text-xs text-muted-foreground">
                            {f.email}
                          </p>
                        )}
                      </div>
                      <span
                        className={cn(
                          "flex size-5 shrink-0 items-center justify-center rounded-full border transition",
                          checked
                            ? "border-primary bg-primary text-white"
                            : "border-input bg-white/60",
                        )}
                      >
                        {checked && <Check className="size-3.5" />}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
            <Button
              className="mt-4 w-full bg-gradient-nchat text-white"
              disabled={busy}
              onClick={() => void createGroupChat()}
            >
              {busy && <Loader2 className="size-4 animate-spin" />}
              Create group
            </Button>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function UserRow({
  name,
  email,
  status,
  onAction,
}: {
  name: string;
  email?: string | null;
  status: "none" | "pending" | "accepted";
  onAction: () => void;
}) {
  return (
    <div className="glass-soft flex items-center gap-3 rounded-2xl p-2">
      <UserAvatar
        user={{ _id: name, name, email }}
        className="size-9 text-xs"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{name}</p>
        {email && (
          <p className="truncate text-xs text-muted-foreground">{email}</p>
        )}
      </div>
      {status === "pending" ? (
        <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
          Requested
        </span>
      ) : (
        <Button
          size="sm"
          variant={status === "accepted" ? "default" : "outline"}
          className="h-7 shrink-0 rounded-full px-3 text-xs"
          onClick={onAction}
        >
          {status === "accepted" ? "Message" : "Add friend"}
        </Button>
      )}
    </div>
  );
}

function LoadingRow() {
  return (
    <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" />
      Searching…
    </div>
  );
}
