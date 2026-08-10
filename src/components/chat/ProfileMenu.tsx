import { UserAvatar } from "@/components/chat/UserAvatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import { displayName } from "@/lib/chat-utils";
import { useMutation } from "convex/react";
import { Check, Loader2, LogOut } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

export function ProfileMenu() {
  const { user, signOut } = useAuth();
  const updateName = useMutation(api.users.updateName);
  const [draft, setDraft] = useState(user?.name ?? "");
  const [saving, setSaving] = useState(false);
  const navigate = useNavigate();

  const saveName = async () => {
    const name = draft.trim();
    if (!name || name === (user?.name ?? "")) return;
    setSaving(true);
    try {
      await updateName({ name });
      toast.success("Name updated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't update your name");
    } finally {
      setSaving(false);
    }
  };

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  if (!user) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="glass-soft flex w-full items-center gap-3 rounded-2xl p-2.5 text-left transition hover:bg-white/60">
          <UserAvatar user={user} className="size-9 text-xs" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">
              {displayName(user)}
            </p>
            <p className="truncate text-[11px] text-muted-foreground">
              {user.email ?? "Guest"}
            </p>
          </div>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel>Your profile</DropdownMenuLabel>
        <div className="px-2 pb-2 pt-1">
          <div className="mb-1.5 flex items-center gap-2 px-1">
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void saveName();
              }}
              placeholder="Display name"
              className="h-8 text-sm"
              maxLength={40}
            />
            <Button
              size="icon-sm"
              variant="secondary"
              disabled={saving || !draft.trim()}
              onClick={() => void saveName()}
              aria-label="Save name"
            >
              {saving ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Check className="size-4" />
              )}
            </Button>
          </div>
          <p className="px-1 text-[11px] text-muted-foreground">
            This is the name your friends will see.
          </p>
        </div>
        <DropdownMenuSeparator />
        <button
          onClick={() => void handleSignOut()}
          className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-destructive hover:bg-destructive/10"
        >
          <LogOut className="size-4" />
          Sign out
        </button>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
