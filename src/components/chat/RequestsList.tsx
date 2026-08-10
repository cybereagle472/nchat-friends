import { UserAvatar } from "@/components/chat/UserAvatar";
import { Button } from "@/components/ui/button";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { displayName } from "@/lib/chat-utils";
import { useMutation, useQuery } from "convex/react";
import { UserPlus } from "lucide-react";
import { toast } from "sonner";

export function RequestsList() {
  const requests = useQuery(api.friends.listRequests);
  const respond = useMutation(api.friends.respondToFriendRequest);

  if (!requests) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="size-5 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
      </div>
    );
  }

  if (requests.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <div className="glass-soft flex size-14 items-center justify-center rounded-2xl">
          <UserPlus className="size-6 text-primary" />
        </div>
        <p className="text-sm font-semibold">You're all caught up</p>
        <p className="text-xs leading-5 text-muted-foreground">
          Friend requests from people who want to chat will appear here.
        </p>
      </div>
    );
  }

  const handle = async (id: Id<"connections">, accept: boolean) => {
    try {
      await respond({ connectionId: id, accept });
      if (accept) toast.success("You're now friends — say hi!");
      else toast.info("Request declined");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    }
  };

  return (
    <ul className="flex flex-col gap-2">
      {requests.map((request) => (
        <li
          key={request._id}
          className="glass-soft flex items-center gap-3 rounded-2xl p-3"
        >
          <UserAvatar user={request.requester} className="size-11 text-sm" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">
              {displayName(request.requester)}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              wants to chat with you
            </p>
          </div>
          <div className="flex shrink-0 gap-1.5">
            <Button
              size="icon-sm"
              variant="outline"
              className="rounded-full"
              onClick={() => void handle(request._id, false)}
              aria-label="Decline request"
            >
              ✕
            </Button>
            <Button
              size="icon-sm"
              className="rounded-full bg-primary"
              onClick={() => void handle(request._id, true)}
              aria-label="Accept request"
            >
              <span className="text-white">✓</span>
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}
