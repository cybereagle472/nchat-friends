import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useAuth } from "@/hooks/use-auth";
import { useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useRef, useState } from "react";

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

type Signal = {
  _id: string;
  fromId: string;
  kind: string;
  payload: string;
  createdAt: number;
};

function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((t) => t.stop());
}

/**
 * Manages a WebRTC call session: local media, a mesh of peer connections
 * (one per other participant), and signaling through Convex. The parent
 * `CallOverlay` renders the UI driven by this hook.
 */
export function useCallSession() {
  const { user } = useAuth();
  const myId = user?._id;

  const current = useQuery(api.calls.current);
  const call = current?.call ?? null;

  const join = useMutation(api.calls.join);
  const decline = useMutation(api.calls.decline);
  const end = useMutation(api.calls.end);
  const sendSignal = useMutation(api.calls.signal);

  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<
    Record<string, MediaStream>
  >({});
  const [audioMuted, setAudioMuted] = useState(false);
  const [videoOff, setVideoOff] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);

  const localStreamRef = useRef<MediaStream | null>(null);
  const pcsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const pendingCandidatesRef = useRef<Map<string, RTCIceCandidateInit[]>>(
    new Map(),
  );
  const mediaAttemptedRef = useRef(false);
  const lastProcessedSignalRef = useRef(0);

  // We're in the call once we've joined (or we're the initiator).
  const inCall = Boolean(call && (current?.hasJoined || current?.isInitiator));

  const signals = useQuery(
    api.calls.signals,
    call && inCall ? { callId: call._id, since: 0 } : "skip",
  );

  const ensureMedia = useCallback(async (type: "audio" | "video") => {
    if (localStreamRef.current) return localStreamRef.current;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: type === "video",
    });
    localStreamRef.current = stream;
    setLocalStream(stream);
    return stream;
  }, []);

  const cleanup = useCallback(() => {
    stopStream(localStreamRef.current);
    localStreamRef.current = null;
    setLocalStream(null);
    for (const pc of pcsRef.current.values()) pc.close();
    pcsRef.current.clear();
    pendingCandidatesRef.current.clear();
    setRemoteStreams({});
    setAudioMuted(false);
    setVideoOff(false);
    setMediaError(null);
    mediaAttemptedRef.current = false;
    lastProcessedSignalRef.current = 0;
  }, []);

  // Acquire local media as soon as we're part of the call.
  useEffect(() => {
    if (!call || !inCall) return;
    if (localStreamRef.current || mediaAttemptedRef.current) return;
    mediaAttemptedRef.current = true;
    ensureMedia(call.type).catch((e) =>
      setMediaError(
        e instanceof Error ? e.message : "Couldn't access camera or microphone",
      ),
    );
  }, [call, inCall, ensureMedia]);

  // Tear everything down when the call is over.
  useEffect(() => {
    if (call) return;
    cleanup();
  }, [call, cleanup]);

  // Unmount cleanup.
  useEffect(() => cleanup, [cleanup]);

  const getOrCreatePeer = useCallback(
    (peerId: string, stream: MediaStream) => {
      const existing = pcsRef.current.get(peerId);
      if (existing) return existing;

      const pc = new RTCPeerConnection(RTC_CONFIG);
      for (const track of stream.getTracks()) {
        pc.addTrack(track, stream);
      }
      pc.onicecandidate = (event) => {
        if (!event.candidate || !call) return;
        void sendSignal({
          callId: call._id,
          toId: peerId as Id<"users">,
          kind: "ice",
          payload: JSON.stringify(event.candidate.toJSON()),
        });
      };
      pc.ontrack = (event) => {
        const stream = event.streams[0];
        if (stream) {
          setRemoteStreams((prev) => ({ ...prev, [peerId]: stream }));
        }
      };
      pcsRef.current.set(peerId, pc);
      return pc;
    },
    [call, sendSignal],
  );

  const flushCandidates = useCallback(async (peerId: string) => {
    const pc = pcsRef.current.get(peerId);
    const queued = pendingCandidatesRef.current.get(peerId) ?? [];
    pendingCandidatesRef.current.delete(peerId);
    if (!pc) return;
    for (const c of queued) {
      try {
        await pc.addIceCandidate(c);
      } catch {
        // ignore raced candidates
      }
    }
  }, []);

  const handleSignal = useCallback(
    async (s: Signal) => {
      if (!call || !myId) return;
      const peerId = s.fromId;
      const stream = localStreamRef.current;
      if (!stream) return; // media arrives before any peer connects

      const pc = getOrCreatePeer(peerId, stream);
      let payload: unknown;
      try {
        payload = JSON.parse(s.payload);
      } catch {
        return;
      }

      if (s.kind === "offer") {
        await pc.setRemoteDescription(payload as RTCSessionDescriptionInit);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await sendSignal({
          callId: call._id,
          toId: peerId as Id<"users">,
          kind: "answer",
          payload: JSON.stringify(answer),
        });
        await flushCandidates(peerId);
      } else if (s.kind === "answer") {
        await pc.setRemoteDescription(payload as RTCSessionDescriptionInit);
        await flushCandidates(peerId);
      } else if (s.kind === "ice") {
        const candidate = payload as RTCIceCandidateInit;
        if (pc.remoteDescription) {
          try {
            await pc.addIceCandidate(candidate);
          } catch {
            // ignore raced candidates
          }
        } else {
          const queued = pendingCandidatesRef.current.get(peerId) ?? [];
          queued.push(candidate);
          pendingCandidatesRef.current.set(peerId, queued);
        }
      }
    },
    [call, myId, getOrCreatePeer, sendSignal],
  );

  // Process incoming signaling messages.
  useEffect(() => {
    if (!call || !signals) return;
    for (const s of signals) {
      if (s.createdAt <= lastProcessedSignalRef.current) continue;
      lastProcessedSignalRef.current = s.createdAt;
      if (s.fromId === myId) continue;
      void handleSignal(s);
    }
  }, [signals, call, myId, handleSignal]);

  // Mesh: keep one peer connection per other participant.
  useEffect(() => {
    if (!call || !localStream || !myId) return;
    const peers = call.participantIds.filter((id) => id !== myId);
    for (const peerId of peers) {
      const pc = getOrCreatePeer(peerId, localStream);
      // The lower-id participant proposes to avoid glare; the other answers.
      const shouldPropose =
        myId < peerId && pc.signalingState === "stable" && !pc.remoteDescription;
      if (!shouldPropose) continue;
      void (async () => {
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          await sendSignal({
            callId: call._id,
            toId: peerId as Id<"users">,
            kind: "offer",
            payload: JSON.stringify(offer),
          });
        } catch {
          // negotiation failures are transient; ignore
        }
      })();
    }
  }, [call, localStream, myId, getOrCreatePeer, sendSignal]);

  // Drop peers that left the call.
  useEffect(() => {
    if (!call) return;
    for (const peerId of Array.from(pcsRef.current.keys())) {
      if (call.participantIds.includes(peerId as Id<"users">)) continue;
      pcsRef.current.get(peerId)?.close();
      pcsRef.current.delete(peerId);
      pendingCandidatesRef.current.delete(peerId);
      setRemoteStreams((prev) => {
        if (!(peerId in prev)) return prev;
        const next = { ...prev };
        delete next[peerId];
        return next;
      });
    }
  }, [call]);

  const toggleMute = useCallback(() => {
    const next = !audioMuted;
    setAudioMuted(next);
    localStreamRef.current?.getAudioTracks().forEach((t) => (t.enabled = !next));
  }, [audioMuted]);

  const toggleCamera = useCallback(() => {
    const next = !videoOff;
    setVideoOff(next);
    localStreamRef.current?.getVideoTracks().forEach((t) => (t.enabled = !next));
  }, [videoOff]);

  const acceptCall = useCallback(async () => {
    if (!call) return;
    try {
      await ensureMedia(call.type);
      await join({ callId: call._id });
    } catch (e) {
      setMediaError(
        e instanceof Error ? e.message : "Couldn't join the call",
      );
    }
  }, [call, ensureMedia, join]);

  const declineCall = useCallback(async () => {
    if (!call) return;
    await decline({ callId: call._id });
  }, [call, decline]);

  const endCall = useCallback(async () => {
    if (!call) return;
    await end({ callId: call._id });
  }, [call, end]);

  const retryMedia = useCallback(async () => {
    setMediaError(null);
    if (!call) return;
    mediaAttemptedRef.current = false;
    try {
      await ensureMedia(call.type);
    } catch (e) {
      setMediaError(e instanceof Error ? e.message : "Media unavailable");
    }
  }, [call, ensureMedia]);

  return {
    current,
    call,
    inCall,
    myId,
    localStream,
    remoteStreams,
    audioMuted,
    videoOff,
    mediaError,
    acceptCall,
    declineCall,
    endCall,
    toggleMute,
    toggleCamera,
    retryMedia,
  };
}

export type CallSession = ReturnType<typeof useCallSession>;
