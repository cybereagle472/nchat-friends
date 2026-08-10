import { UserAvatar } from "@/components/chat/UserAvatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { displayName } from "@/lib/chat-utils";
import { cn } from "@/lib/utils";
import { useMutation, useQuery } from "convex/react";
import { Check, Crown, Loader2, LogOut, Plus, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export function GroupSettingsPanel({
  conversationId,
  conversationName,
  createdById,
  myUserId,
  onLeave,
}: {
  conversationId: Id<"conversations">;
  conversationName: string;
  createdById: string | null;
  myUserId: Id<"users"> | undefined;
  onLeave: () => void;
}) {
  const members = useQuery(api.groups.members, { conversationId });
  const friends = useQuery(api.friends.listFriends);

  const rename = useMutation(api.groups.rename);
  const addMembers = useMutation(api.groups.addMembers);
  const removeMember = useMutation(api.groups.removeMember);
  const leave = useMutation(api.groups.leave);

  const [nameDraft, setNameDraft] = useState(conversationName);
  const [savingName, setSavingName] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [picked, setPicked] = useState<Set<Id<"users">>>(new Set());
  const [busy, setBusy] = useState(false);

  const amAdmin = createdById === myUserId;
  const memberList = members ?? [];
  const friendList = friends ?? [];
  const memberIds = new Set(memberList.map((m) => m._id));
  const addableFriends = friendList.filter((f) => !memberIds.has(f._id));

  const saveName = async () => {
    const name = nameDraft.trim();
    if (!name || name === conversationName) return;
    setSavingName(true);
    try {
      await rename({ conversationId, name });
      toast.success("Group renamed");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't rename the group");
    } finally {
      setSavingName(false);
    }
  };

  const addPicked = async () => {
    if (picked.size === 0) return;
    setBusy(true);
    try {
      await addMembers({ conversationId, userIds: Array.from(picked) });
      toast.success("Friends added");
      setPicked(new Set());
      setShowAdd(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't add members");
    } finally {
      setBusy(false);
    }
  };

  const kickMember = async (memberId: Id<"users">, name: string) => {
    try {
      await removeMember({ conversationId, memberId });
      toast.success(`${name} removed`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't remove them");
    }
  };

  const leaveGroup = async () => {
    try {
      await leave({ conversationId });
      toast.info("You left the group");
      onLeave();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't leave the group");
    }
  };

  return (
    <div className="w-72 space-y-4 p-1">
      <div>
        <p className="mb-1.5 text-xs font-medium text-muted-foreground">
          Group name
        </p>
        <div className="flex items-center gap-2">
          <Input
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void saveName();
            }}
            maxLength={60}
            className="h-8 text-sm"
          />
          <Button
            size="icon-sm"
            variant="secondary"
            disabled={savingName || !nameDraft.trim()}
            onClick={() => void saveName()}
            aria-label="Save group name"
          >
            {savingName ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Check className="size-4" />
            )}
          </Button>
        </div>
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <p className="text-xs font-medium text-muted-foreground">
            Members ({memberList.length})
          </p>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 gap-1 px-2 text-xs"
            onClick={() => setShowAdd((s) => !s)}
          >
            <Plus className="size-3.5" />
            Add
          </Button>
        </div>

        {showAdd && (
          <div className="glass-soft mb-2 rounded-xl p-2">
            {addableFriends.length === 0 ? (
              <p className="px-1 py-2 text-xs text-muted-foreground">
                No more friends to add.
              </p>
            ) : (
              <div className="chat-scroll max-h-40 space-y-0.5 overflow-y-auto">
                {addableFriends.map((f) => {
                  const checked = picked.has(f._id);
                  return (
                    <button
                      key={f._id}
                      onClick={() =>
                        setPicked((prev) => {
                          const next = new Set(prev);
                          if (next.has(f._id)) next.delete(f._id);
                          else next.add(f._id);
                          return next;
                        })
                      }
                      className={cn(
                        "flex w-full items-center gap-2 rounded-lg p-1.5 text-left text-sm transition",
                        checked ? "bg-primary/10" : "hover:bg-white/60",
                      )}
                    >
                      <UserAvatar user={f} className="size-7 text-[10px]" />
                      <span className="min-w-0 flex-1 truncate font-medium">
                        {displayName(f)}
                      </span>
                      <span
                        className={cn(
                          "flex size-4 shrink-0 items-center justify-center rounded-full border",
                          checked
                            ? "border-primary bg-primary text-white"
                            : "border-input bg-white/60",
                        )}
                      >
                        {checked && <Check className="size-3" />}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
            <Button
              size="sm"
              className="mt-2 w-full"
              disabled={busy || picked.size === 0}
              onClick={() => void addPicked()}
            >
              {busy && <Loader2 className="size-3.5 animate-spin" />}
              Add selected
            </Button>
          </div>
        )}

        <ul className="space-y-0.5">
          {memberList.map((m) => (
            <li
              key={m._id}
              className="flex items-center gap-2.5 rounded-xl p-1.5 hover:bg-white/60"
            >
              <UserAvatar user={m} className="size-8 text-[10px]" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {displayName(m)}
                  {m._id === myUserId && (
                    <span className="ml-1.5 text-xs text-muted-foreground">
                      (you)
                    </span>
                  )}
                </p>
                {m.isAdmin && (
                  <p className="flex items-center gap-1 text-[11px] text-amber-600">
                    <Crown className="size-3" /> Group owner
                  </p>
                )}
              </div>
              {amAdmin && m._id !== myUserId && (
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="size-7 text-muted-foreground hover:text-destructive"
                  onClick={() => void kickMember(m._id, displayName(m))}
                  aria-label={`Remove ${displayName(m)}`}
                >
                  <X className="size-3.5" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      </div>

      <Button
        variant="outline"
        className="w-full gap-2 text-destructive hover:text-destructive"
        onClick={() => void leaveGroup()}
      >
        <LogOut className="size-4" />
        Leave group
      </Button>
    </div>
  );
}
