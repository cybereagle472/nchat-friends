import { UserAvatar } from "@/components/chat/UserAvatar";
import { Button } from "@/components/ui/button";
import { displayName, formatCallDuration } from "@/lib/chat-utils";
import { cn } from "@/lib/utils";
import { Camera, CameraOff, Mic, MicOff, Phone, PhoneOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useCallSession } from "./useCall";

function VideoTile({
  stream,
  label,
  muted,
  mirror,
  className,
}: {
  stream: MediaStream | null;
  label: string;
  muted?: boolean;
  mirror?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (!ref.current || !stream) return;
    ref.current.srcObject = stream;
    void ref.current.play().catch(() => {});
  }, [stream]);
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border border-white/50 bg-slate-200/70 shadow-inner",
        className,
      )}
    >
      {stream ? (
        <video
          ref={ref}
          autoPlay
          playsInline
          muted={muted}
          className={cn(
            "h-full w-full object-cover",
            mirror && "-scale-x-100",
          )}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-sm font-medium text-muted-foreground">
          {label}
        </div>
      )}
    </div>
  );
}

function RingTone({ active }: { active: boolean }) {
  useEffect(() => {
    if (!active) return;
    let ctx: AudioContext | null = null;
    let interval: number | undefined;
    try {
      const AC =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      ctx = new AC();
      const tone = () => {
        if (!ctx) return;
        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = 740;
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.07, now + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.4);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.45);
      };
      tone();
      interval = window.setInterval(tone, 1400);
    } catch {
      // Ringtone is a nice-to-have; ignore autoplay restrictions.
    }
    return () => {
      if (interval) window.clearInterval(interval);
      void ctx?.close();
    };
  }, [active]);
  return null;
}

export function CallOverlay() {
  const session = useCallSession();
  const { current, call, inCall } = session;
  const [now, setNow] = useState(Date.now());

  const ringing = Boolean(call && call.status === "ringing");
  const isIncoming = Boolean(
    call && call.status === "ringing" && !current?.isInitiator && !current?.hasJoined,
  );
  const isCalling = Boolean(call && call.status === "ringing" && current?.isInitiator);

  useEffect(() => {
    if (!inCall || !call) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [inCall, call]);

  if (!call) return null;

  const title = current?.title ?? "Call";
  const typeLabel = call.type === "video" ? "video" : "voice";
  const participants = (current?.participants ?? []).filter(
    (p): p is NonNullable<typeof p> => p !== null,
  );

  // ---- Incoming call -----------------------------------------------------
  if (isIncoming) {
    return (
      <div className="fixed inset-0 z-[80] flex items-center justify-center bg-white/40 p-4 backdrop-blur-md">
        <RingTone active={ringing} />
        <div className="glass-strong flex w-full max-w-sm flex-col items-center gap-6 rounded-3xl px-8 py-10">
          <div className="animate-ring-pulse rounded-full p-1">
            <UserAvatar user={current?.initiator ?? null} className="size-24 text-2xl" />
          </div>
          <div className="text-center">
            <p className="text-xl font-bold tracking-tight">{title}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Incoming {typeLabel} call
            </p>
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={() => void session.declineCall()}
              className="flex size-14 flex-col items-center justify-center gap-1 rounded-full bg-destructive text-white shadow-lg transition-transform hover:scale-105 active:scale-95"
              aria-label="Decline call"
            >
              <PhoneOff className="size-5" />
            </button>
            <button
              onClick={() => void session.acceptCall()}
              className="flex size-14 flex-col items-center justify-center gap-1 rounded-full bg-emerald-500 text-white shadow-lg transition-transform hover:scale-105 active:scale-95"
              aria-label="Accept call"
            >
              {call.type === "video" ? (
                <Camera className="size-5" />
              ) : (
                <Phone className="size-5" />
              )}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---- Outgoing (calling) -------------------------------------------------
  if (isCalling) {
    return (
      <div className="fixed inset-0 z-[80] flex items-center justify-center bg-white/40 p-4 backdrop-blur-md">
        <RingTone active={ringing} />
        <div className="glass-strong flex w-full max-w-sm flex-col items-center gap-6 rounded-3xl px-8 py-10">
          <div className="animate-ring-pulse rounded-full p-1">
            <UserAvatar user={current?.initiator ?? null} className="size-24 text-2xl" />
          </div>
          <div className="text-center">
            <p className="text-xl font-bold tracking-tight">{title}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Calling… {typeLabel} call
            </p>
          </div>
          {session.mediaError && (
            <div className="flex items-center gap-2 rounded-full bg-amber-100/80 px-4 py-2 text-xs font-medium text-amber-800 backdrop-blur">
              {session.mediaError}
              <button
                onClick={() => void session.retryMedia()}
                className="font-bold underline underline-offset-2"
              >
                Try again
              </button>
            </div>
          )}
          <Button
            variant="destructive"
            size="icon-lg"
            className="size-14 rounded-full"
            onClick={() => void session.endCall()}
            aria-label="Cancel call"
          >
            <PhoneOff className="size-5" />
          </Button>
        </div>
      </div>
    );
  }

  // ---- In-call -------------------------------------------------------------
  const remoteParticipants = participants.filter((p) => p._id !== session.myId);

  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-white/35 backdrop-blur-lg">
      <div className="glass-soft mx-auto mt-4 flex items-center gap-3 rounded-full px-5 py-2">
        <UserAvatar user={current?.initiator ?? null} className="size-8" />
        <div>
          <p className="text-sm font-semibold leading-tight">{title}</p>
          <p className="text-xs text-muted-foreground">
            {formatCallDuration(call.startedAt, now)} · {call.type === "video" ? "Video" : "Voice"} call
          </p>
        </div>
      </div>

      {session.mediaError && (
        <div className="mx-auto mt-4 flex items-center gap-3 rounded-full bg-amber-100/80 px-4 py-2 text-sm font-medium text-amber-800 backdrop-blur">
          {session.mediaError}
          <Button size="sm" variant="outline" onClick={() => void session.retryMedia()}>
            Try again
          </Button>
        </div>
      )}

      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6">
        {call.type === "video" ? (
          <div className="grid w-full max-w-4xl gap-4 sm:grid-cols-2">
            {remoteParticipants.map((p) => (
              <VideoTile
                key={p._id}
                stream={session.remoteStreams[p._id] ?? null}
                label={`${displayName(p)} is connecting…`}
                className="aspect-video"
              />
            ))}
            {remoteParticipants.length === 0 && (
              <div className="aspect-video w-full max-w-md">
                <VideoTile
                  stream={null}
                  label="Waiting for people to join…"
                  className="h-full w-full"
                />
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-center gap-6">
            {remoteParticipants.map((p) => (
              <div key={p._id} className="flex flex-col items-center gap-2">
                <UserAvatar user={p} className="size-24 text-2xl" />
                <span className="text-sm font-medium">{displayName(p)}</span>
              </div>
            ))}
            {remoteParticipants.length === 0 && (
              <p className="text-muted-foreground">Waiting for people to join…</p>
            )}
          </div>
        )}
      </div>

      {/* Local preview (video calls) */}
      {call.type === "video" && session.localStream && (
        <div className="pointer-events-none fixed bottom-28 right-6 z-10 hidden w-40 sm:block">
          <VideoTile
            stream={session.localStream}
            label="You"
            muted
            mirror
            className="aspect-video shadow-xl"
          />
          <span className="absolute bottom-2 left-2 rounded-full bg-black/30 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur">
            You
          </span>
        </div>
      )}

      {/* Controls */}
      <div className="flex items-center justify-center gap-5 pb-10 pt-4">
        <button
          onClick={session.toggleMute}
          className={cn(
            "flex size-14 items-center justify-center rounded-full shadow-lg transition-transform hover:scale-105 active:scale-95",
            session.audioMuted
              ? "bg-rose-500 text-white"
              : "glass-strong text-foreground",
          )}
          aria-label={session.audioMuted ? "Unmute" : "Mute"}
        >
          {session.audioMuted ? <MicOff className="size-5" /> : <Mic className="size-5" />}
        </button>
        {call.type === "video" && (
          <button
            onClick={session.toggleCamera}
            className={cn(
              "flex size-14 items-center justify-center rounded-full shadow-lg transition-transform hover:scale-105 active:scale-95",
              session.videoOff
                ? "bg-rose-500 text-white"
                : "glass-strong text-foreground",
            )}
            aria-label={session.videoOff ? "Turn camera on" : "Turn camera off"}
          >
            {session.videoOff ? <CameraOff className="size-5" /> : <Camera className="size-5" />}
          </button>
        )}
        <button
          onClick={() => void session.endCall()}
          className="flex size-14 items-center justify-center rounded-full bg-destructive text-white shadow-lg transition-transform hover:scale-105 active:scale-95"
          aria-label="End call"
        >
          <PhoneOff className="size-5" />
        </button>
      </div>
    </div>
  );
}
