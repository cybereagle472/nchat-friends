import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { avatarGradient, displayName, initials } from "@/lib/chat-utils";
import { cn } from "@/lib/utils";

type UserAvatarProps = {
  user: {
    _id: string;
    name?: string | null;
    image?: string | null;
    email?: string | null;
  } | null;
  className?: string;
};

export function UserAvatar({ user, className }: UserAvatarProps) {
  const name = displayName(user);
  const gradient = avatarGradient(user?._id ?? "nchat");
  return (
    <Avatar className={cn("ring-2 ring-white/70 shadow-sm", className)}>
      {user?.image ? (
        <AvatarImage src={user.image} alt={name} />
      ) : null}
      <AvatarFallback
        className="text-xs font-bold text-white"
        style={{ background: gradient }}
      >
        {initials(name)}
      </AvatarFallback>
    </Avatar>
  );
}
