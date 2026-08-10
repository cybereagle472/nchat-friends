import { MessageCircle } from "lucide-react";
import { cn } from "@/lib/utils";

/** The NChat mark: a bold gradient tile with a chat bubble. */
export function NChatLogo({
  className,
  iconClassName = "size-[55%]",
}: {
  className?: string;
  iconClassName?: string;
}) {
  return (
    <div
      className={cn(
        "bg-gradient-nchat relative flex shrink-0 items-center justify-center rounded-[30%] text-white shadow-[0_8px_24px_-6px_rgb(59_130_246_/_0.5)]",
        className,
      )}
    >
      <MessageCircle className={cn("fill-white/10", iconClassName)} />
      <span className="absolute inset-0 rounded-[30%] ring-1 ring-inset ring-white/30" />
    </div>
  );
}

/** Logo mark + wordmark for headers and footers. */
export function NChatWordmark({
  className,
  markClassName = "size-9",
  light = false,
}: {
  className?: string;
  markClassName?: string;
  light?: boolean;
}) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <NChatLogo className={markClassName} />
      <span
        className={cn(
          "text-xl font-bold tracking-tight",
          light ? "text-white" : "text-foreground",
        )}
      >
        NChat
        <span className={cn("font-semibold", light ? "text-white/70" : "text-muted-foreground")}>
          {" "}
          App
        </span>
      </span>
    </div>
  );
}
