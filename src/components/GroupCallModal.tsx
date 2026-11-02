import { useState, useEffect, useRef, useCallback } from 'react';
import { Phone, PhoneOff, Mic, MicOff, Video, VideoOff, Volume2, X, Users } from 'lucide-react';
import { callService } from '../services/callService';
import { groupCallService, GroupCallSession, GroupCallParticipantBrief } from '../services/groupCallService';
import { profileService } from '../services/profileService';
import { playSafely, applyAudioOutput } from '../lib/webrtcMedia';
import { UserProfile } from '../types';
import { GroupWithMembers } from '../services/groupService';

interface GroupCallModalProps {
  currentUser: UserProfile;
  callType: 'audio' | 'video';
  /** Present when the local user is the one starting the call. */
  group?: GroupWithMembers;
  /** Present when this is a ring screen for a call someone else started. */
  incomingCall?: GroupCallSession;
  onClose: () => void;
}

// No 'declined' or 'failed' terminal states here the way 1:1 calling has:
// one participant declining a group call doesn't end it for anyone else
// (onParticipantDeclined just quietly drops that one tile), and a
// connection that never comes together is likewise handled per-peer
// (getOrCreatePeerConnection's connecting timeout / handlePeerConnectionState's
// 'failed' branch both just drop that one tile via dropPeer) rather than
// failing the whole call — the one case that actually can't join at all
// (couldn't start/join the call, e.g. a network/server error) is reported
// through `error` and closes the modal, same as 1:1 handles that same
// class of failure in initiateCall/answerCall's catch blocks.
type ModalState = 'initiating' | 'ringing' | 'in-call' | 'ended';
type PeerStatus = 'connecting' | 'connected' | 'disconnected';

// Same timing this app's 1:1 calling already settled on through real-device
// testing (see CallModal.tsx) — reused as-is rather than re-derived, except
// RING_TIMEOUT only ever applies to *us* deciding whether to accept, since
// unlike a 1:1 call there's no single other side whose answer we're
// waiting on.
const RING_TIMEOUT_MS = 45_000;
const CONNECTING_TIMEOUT_MS = 20_000;
const DISCONNECT_GRACE_MS = 6_000;

interface Signal {
  offer_sdp?: RTCSessionDescriptionInit;
  answer_sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
  request_offer?: boolean;
}

export function GroupCallModal({ currentUser, callType, group, incomingCall, onClose }: GroupCallModalProps) {
  const [modalState, setModalState] = useState<ModalState>(incomingCall ? 'ringing' : 'initiating');
  const [error, setError] = useState('');
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(callType !== 'video');
  const [isSpeakerOn, setIsSpeakerOn] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  // Every peer we currently believe is (or was) joined, for rendering a
  // tile even before their media actually arrives — keyed by user id.
  const [roster, setRoster] = useState<Map<string, UserProfile>>(new Map());
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map());
  const [peerStatus, setPeerStatus] = useState<Map<string, PeerStatus>>(new Map());

  const callIdRef = useRef<string | null>(incomingCall?.id ?? null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const remoteDescriptionSetRef = useRef<Map<string, boolean>>(new Map());
  const pendingRemoteCandidatesRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const everConnectedRef = useRef<Map<string, boolean>>(new Map());
  const connectingTimeoutRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const disconnectGraceRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const remoteMediaElsRef = useRef<Map<string, HTMLMediaElement>>(new Map());
  const eventSubRef = useRef<{ unsubscribe: () => void } | null>(null);
  const ringTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const durationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const endedRef = useRef(false);
  const isSpeakerOnRef = useRef(false);
  const profileCacheRef = useRef<Map<string, UserProfile>>(new Map());

  // Seed the profile cache from the group's own member list when we have
  // it (starting the call ourselves) — avoids a network round trip per
  // tile for people we already know about.
  useEffect(() => {
    group?.members.forEach((m) => {
      if (m.profile) profileCacheRef.current.set(m.user_id, m.profile);
    });
    if (incomingCall?.callerProfile) {
      profileCacheRef.current.set(incomingCall.callerId, incomingCall.callerProfile);
    }
  }, [group, incomingCall]);

  const resolveProfile = useCallback(async (userId: string): Promise<UserProfile | null> => {
    const cached = profileCacheRef.current.get(userId);
    if (cached) return cached;
    const profile = await profileService.getProfile(userId);
    if (profile) profileCacheRef.current.set(userId, profile);
    return profile;
  }, []);

  const addToRoster = useCallback(
    async (userId: string) => {
      const profile = await resolveProfile(userId);
      setRoster((prev) => {
        const next = new Map(prev);
        next.set(userId, profile ?? ({ id: userId, email: '', full_name: 'Unknown' } as UserProfile));
        return next;
      });
    },
    [resolveProfile]
  );

  const removeFromRoster = useCallback((userId: string) => {
    setRoster((prev) => {
      if (!prev.has(userId)) return prev;
      const next = new Map(prev);
      next.delete(userId);
      return next;
    });
    setRemoteStreams((prev) => {
      if (!prev.has(userId)) return prev;
      const next = new Map(prev);
      next.delete(userId);
      return next;
    });
    setPeerStatus((prev) => {
      if (!prev.has(userId)) return prev;
      const next = new Map(prev);
      next.delete(userId);
      return next;
    });
  }, []);

  const clearPeerTimers = useCallback((peerId: string) => {
    const ct = connectingTimeoutRef.current.get(peerId);
    if (ct) {
      clearTimeout(ct);
      connectingTimeoutRef.current.delete(peerId);
    }
    const dt = disconnectGraceRef.current.get(peerId);
    if (dt) {
      clearTimeout(dt);
      disconnectGraceRef.current.delete(peerId);
    }
  }, []);

  // Closes and forgets one peer — used both when they deliberately leave
  // (participant-left/declined) and when their own connection degrades
  // beyond recovery. A single bad connection only ever drops that one
  // tile; it never tears down the whole call for everyone else still in
  // it, which is the right failure mode for a mesh group call (the
  // opposite of 1:1, where a lost connection *is* the whole call).
  const dropPeer = useCallback(
    (peerId: string) => {
      clearPeerTimers(peerId);
      const pc = peerConnectionsRef.current.get(peerId);
      if (pc) {
        pc.close();
        peerConnectionsRef.current.delete(peerId);
      }
      remoteDescriptionSetRef.current.delete(peerId);
      pendingRemoteCandidatesRef.current.delete(peerId);
      everConnectedRef.current.delete(peerId);
      remoteMediaElsRef.current.delete(peerId);
      removeFromRoster(peerId);
    },
    [clearPeerTimers, removeFromRoster]
  );

  const cleanupAll = useCallback(() => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    peerConnectionsRef.current.forEach((pc) => pc.close());
    peerConnectionsRef.current.clear();
    connectingTimeoutRef.current.forEach((t) => clearTimeout(t));
    connectingTimeoutRef.current.clear();
    disconnectGraceRef.current.forEach((t) => clearTimeout(t));
    disconnectGraceRef.current.clear();
    remoteDescriptionSetRef.current.clear();
    pendingRemoteCandidatesRef.current.clear();
    everConnectedRef.current.clear();
    remoteMediaElsRef.current.clear();
    if (ringTimeoutRef.current) {
      clearTimeout(ringTimeoutRef.current);
      ringTimeoutRef.current = null;
    }
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }
    if (eventSubRef.current) {
      eventSubRef.current.unsubscribe();
      eventSubRef.current = null;
    }
  }, []);

  const handlePeerConnectionState = useCallback(
    (peerId: string, state: RTCPeerConnectionState) => {
      setPeerStatus((prev) => {
        const next = new Map(prev);
        if (state === 'connected') next.set(peerId, 'connected');
        else if (state === 'disconnected' || state === 'failed') next.set(peerId, 'disconnected');
        else next.set(peerId, 'connecting');
        return next;
      });

      if (state === 'connected') {
        everConnectedRef.current.set(peerId, true);
        clearPeerTimers(peerId);
      } else if (state === 'failed') {
        // Whether this peer ever connected or not, a failed connection
        // means there's nothing left to do but drop just this one tile —
        // the rest of the call carries on for everyone else.
        clearPeerTimers(peerId);
        dropPeer(peerId);
      } else if (state === 'disconnected') {
        if (!disconnectGraceRef.current.has(peerId)) {
          const t = setTimeout(() => {
            disconnectGraceRef.current.delete(peerId);
            dropPeer(peerId);
          }, DISCONNECT_GRACE_MS);
          disconnectGraceRef.current.set(peerId, t);
        }
      }
    },
    [clearPeerTimers, dropPeer]
  );

  const flushPendingRemoteCandidates = useCallback(async (peerId: string, pc: RTCPeerConnection) => {
    const queued = pendingRemoteCandidatesRef.current.get(peerId) ?? [];
    pendingRemoteCandidatesRef.current.delete(peerId);
    for (const candidate of queued) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch {
        // Stale/invalid by the time it's applied; safe to ignore.
      }
    }
  }, []);

  const attachRemoteMedia = useCallback((peerId: string, stream: MediaStream) => {
    setRemoteStreams((prev) => {
      const next = new Map(prev);
      next.set(peerId, stream);
      return next;
    });
    // The actual <video>/<audio> element for this peer attaches the
    // stream itself via a ref callback once it renders (see the tile
    // below) — this just registers the data; isSpeakerOnRef-aware output
    // routing happens there too, once the element exists.
  }, []);

  const getOrCreatePeerConnection = useCallback(
    async (peerId: string): Promise<RTCPeerConnection> => {
      const existing = peerConnectionsRef.current.get(peerId);
      if (existing) return existing;

      const pc = await callService.createPeerConnection(
        (candidate) => {
          if (callIdRef.current) {
            groupCallService.sendSignal(callIdRef.current, peerId, { candidate: candidate.toJSON() });
          }
        },
        (stream) => attachRemoteMedia(peerId, stream),
        (state) => handlePeerConnectionState(peerId, state)
      );

      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => pc.addTrack(track, localStreamRef.current!));
        callService.prioritizeAudioQuality(pc);
      }

      peerConnectionsRef.current.set(peerId, pc);
      setPeerStatus((prev) => {
        const next = new Map(prev);
        next.set(peerId, 'connecting');
        return next;
      });

      const t = setTimeout(() => {
        connectingTimeoutRef.current.delete(peerId);
        if (!everConnectedRef.current.get(peerId)) dropPeer(peerId);
      }, CONNECTING_TIMEOUT_MS);
      connectingTimeoutRef.current.set(peerId, t);

      return pc;
    },
    [attachRemoteMedia, dropPeer, handlePeerConnectionState]
  );

  // Fixed, deterministic offer direction so two participants never both
  // try to offer each other at once (glare): only someone who was
  // *already* joined ever creates an offer, and only toward a brand new
  // joiner. A newcomer never offers — it only ever answers. This relies
  // entirely on both sides reacting the same way to the same
  // participant-joined event; see groupCallService.ts / groupCalls.ts.
  const offerTo = useCallback(
    async (peerId: string) => {
      await addToRoster(peerId);
      const pc = await getOrCreatePeerConnection(peerId);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      if (callIdRef.current) await groupCallService.sendSignal(callIdRef.current, peerId, { offer_sdp: offer });
    },
    [addToRoster, getOrCreatePeerConnection]
  );

  // Idempotent wrapper around offerTo — safe to call from two independent
  // triggers (the server's opportunistic participant-joined notification,
  // and the new joiner's own guaranteed request_offer nudge below)
  // without risking two separate RTCPeerConnections getting created for
  // the same peer. peerConnectionsRef alone isn't enough to guard that:
  // getOrCreatePeerConnection only populates it after an await (the ICE
  // server fetch), so both triggers can pass the "not in the map yet"
  // check before either has actually finished creating one. Reserving
  // the peer id here, synchronously, before any await runs, closes that
  // gap the same way a mutex would.
  const offerInFlightRef = useRef<Set<string>>(new Set());
  const ensureOfferTo = useCallback(
    (peerId: string) => {
      if (peerConnectionsRef.current.has(peerId) || offerInFlightRef.current.has(peerId)) return;
      offerInFlightRef.current.add(peerId);
      offerTo(peerId).finally(() => offerInFlightRef.current.delete(peerId));
    },
    [offerTo]
  );

  const handleIncomingSignal = useCallback(
    async (from: string, signal: Signal) => {
      if (signal.request_offer) {
        await addToRoster(from);
        ensureOfferTo(from);
      } else if (signal.offer_sdp) {
        await addToRoster(from);
        const pc = await getOrCreatePeerConnection(from);
        await pc.setRemoteDescription(new RTCSessionDescription(signal.offer_sdp));
        remoteDescriptionSetRef.current.set(from, true);
        await flushPendingRemoteCandidates(from, pc);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        if (callIdRef.current) await groupCallService.sendSignal(callIdRef.current, from, { answer_sdp: answer });
      } else if (signal.answer_sdp) {
        const pc = peerConnectionsRef.current.get(from);
        if (!pc) return;
        await pc.setRemoteDescription(new RTCSessionDescription(signal.answer_sdp));
        remoteDescriptionSetRef.current.set(from, true);
        await flushPendingRemoteCandidates(from, pc);
      } else if (signal.candidate) {
        const pc = peerConnectionsRef.current.get(from);
        if (!pc || !remoteDescriptionSetRef.current.get(from)) {
          const queue = pendingRemoteCandidatesRef.current.get(from) ?? [];
          queue.push(signal.candidate);
          pendingRemoteCandidatesRef.current.set(from, queue);
          return;
        }
        try {
          await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
        } catch {
          // A candidate can legitimately arrive right as that peer's
          // connection is closing; safe to ignore.
        }
      }
    },
    [addToRoster, ensureOfferTo, flushPendingRemoteCandidates, getOrCreatePeerConnection]
  );

  const subscribeFullEvents = useCallback(
    (callId: string) => {
      eventSubRef.current?.unsubscribe();
      eventSubRef.current = groupCallService.subscribeToGroupCallEvents(callId, {
        onParticipantJoined: (userId) => {
          if (userId === currentUser.id) return;
          // Opportunistic fast path — ensureOfferTo also covers the
          // guaranteed request_offer nudge below, so whichever of the two
          // actually arrives (this one has a real race; see sendSignal's
          // request_offer doc) ends up doing the work exactly once.
          ensureOfferTo(userId);
        },
        onSignal: (from, signal) => {
          if (from === currentUser.id) return;
          handleIncomingSignal(from, signal);
        },
        onParticipantLeft: (userId) => dropPeer(userId),
        onParticipantDeclined: (userId) => dropPeer(userId),
        onCallEnded: () => {
          if (endedRef.current) return;
          endedRef.current = true;
          cleanupAll();
          setModalState('ended');
          setTimeout(onClose, 1500);
        },
      });
    },
    [cleanupAll, currentUser.id, dropPeer, ensureOfferTo, handleIncomingSignal, onClose]
  );

  const initializeMedia = useCallback(async () => {
    const result = await callService.getUserMedia(callType);
    if (!result.success || !result.data) {
      setError(result.error || 'Could not access camera/microphone');
      throw new Error(result.error);
    }
    localStreamRef.current = result.data;
    // The local preview <video> only exists once modalState flips to
    // 'in-call' (it's part of the tile grid, not the ringing/initiating
    // screens) — this runs well before that, so localVideoRef.current is
    // still null here. The effect below attaches it for real once that
    // element actually mounts; this is just the fast path for the rare
    // case the ref is already there (e.g. a future caller of this that
    // doesn't gate the tile grid the same way).
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = result.data;
      playSafely(localVideoRef.current);
    }
    return result.data;
  }, [callType]);

  // Attaches the already-captured local stream to the preview tile once it
  // actually mounts (see initializeMedia's comment above for why it can't
  // just be done there) — without this, your own camera preview stayed
  // blank for the entire call even though everyone else could see you fine
  // (the MediaStream itself was always captured and sent correctly; only
  // the local on-screen preview element was missing it).
  useEffect(() => {
    if (modalState === 'in-call' && localVideoRef.current && localStreamRef.current) {
      localVideoRef.current.srcObject = localStreamRef.current;
      playSafely(localVideoRef.current);
    }
  }, [modalState]);

  const startDurationTimer = useCallback(() => {
    if (!durationIntervalRef.current) {
      durationIntervalRef.current = setInterval(() => setCallDuration((p) => p + 1), 1000);
    }
  }, []);

  // Runs the instant we know our own call id, for both starting a call and
  // joining one — and in that exact order: subscribe to events FIRST,
  // before anything else (including the roster bookkeeping below, which
  // involves awaited profile lookups and would otherwise widen the
  // window). Then nudge every already-joined participant with
  // request_offer as a guaranteed fallback alongside the server's own
  // opportunistic participant-joined notification to them — see
  // sendSignal's request_offer doc for exactly why that notification
  // alone isn't reliable enough on its own to be the only path.
  const connectToExistingParticipants = useCallback(
    async (callId: string, participants: GroupCallParticipantBrief[]) => {
      subscribeFullEvents(callId);
      for (const p of participants) {
        profileCacheRef.current.set(p.userId, { id: p.userId, email: '', full_name: p.fullName, avatar_url: p.avatarUrl } as UserProfile);
        await addToRoster(p.userId);
      }
      await Promise.all(participants.map((p) => groupCallService.sendSignal(callId, p.userId, { request_offer: true })));
    },
    [addToRoster, subscribeFullEvents]
  );

  const startOutgoingCall = useCallback(async () => {
    if (!group) return;
    try {
      await initializeMedia();
      const result = await groupCallService.startOrJoinCall(group.id, callType);
      if (!result.success || !result.data) {
        setError(result.error || 'Failed to start group call');
        cleanupAll();
        setTimeout(onClose, 2000);
        return;
      }
      if (endedRef.current) {
        await groupCallService.leaveCall(result.data.call.id);
        return;
      }
      callIdRef.current = result.data.call.id;
      await connectToExistingParticipants(result.data.call.id, result.data.participants);
      setModalState('in-call');
      startDurationTimer();
    } catch (err) {
      console.error('Error starting group call:', err);
      setError('Failed to start group call');
      if (callIdRef.current) await groupCallService.leaveCall(callIdRef.current);
      cleanupAll();
      setTimeout(onClose, 2000);
    }
  }, [callType, cleanupAll, connectToExistingParticipants, group, initializeMedia, onClose, startDurationTimer]);

  const acceptIncomingCall = useCallback(async () => {
    if (!incomingCall) return;
    try {
      if (ringTimeoutRef.current) {
        clearTimeout(ringTimeoutRef.current);
        ringTimeoutRef.current = null;
      }
      await initializeMedia();
      const result = await groupCallService.joinCall(incomingCall.id);
      if (!result.success || !result.data) {
        setError(result.error || 'Failed to join group call');
        cleanupAll();
        setTimeout(onClose, 2000);
        return;
      }
      callIdRef.current = incomingCall.id;
      await connectToExistingParticipants(incomingCall.id, result.data.participants);
      setModalState('in-call');
      startDurationTimer();
    } catch (err) {
      console.error('Error joining group call:', err);
      setError('Failed to join group call');
      cleanupAll();
      setTimeout(onClose, 2000);
    }
  }, [cleanupAll, connectToExistingParticipants, incomingCall, initializeMedia, onClose, startDurationTimer]);

  const declineIncomingCall = useCallback(async () => {
    if (incomingCall) {
      endedRef.current = true;
      await groupCallService.declineCall(incomingCall.id);
    }
    cleanupAll();
    onClose();
  }, [cleanupAll, incomingCall, onClose]);

  const leaveCall = useCallback(async () => {
    if (endedRef.current) return;
    endedRef.current = true;
    if (callIdRef.current) await groupCallService.leaveCall(callIdRef.current);
    cleanupAll();
    setModalState('ended');
    setTimeout(onClose, 1000);
  }, [cleanupAll, onClose]);

  const handleCloseButton = useCallback(() => {
    if (modalState === 'ringing') declineIncomingCall();
    else leaveCall();
  }, [declineIncomingCall, leaveCall, modalState]);

  // Initial mount: ring, or start/join immediately.
  useEffect(() => {
    if (incomingCall) {
      setModalState('ringing');
      // Listen for the call ending while we're still deciding — e.g. the
      // caller and everyone else already hung up before we answered.
      eventSubRef.current = groupCallService.subscribeToGroupCallEvents(incomingCall.id, {
        onCallEnded: () => {
          if (endedRef.current) return;
          endedRef.current = true;
          cleanupAll();
          setModalState('ended');
          setTimeout(onClose, 1500);
        },
      });
      ringTimeoutRef.current = setTimeout(() => {
        declineIncomingCall();
      }, RING_TIMEOUT_MS);
    } else if (group) {
      startOutgoingCall();
    }

    return () => {
      cleanupAll();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleMute = () => {
    const nextMuted = !isMuted;
    const tracks = new Set<MediaStreamTrack>();
    localStreamRef.current?.getAudioTracks().forEach((t) => tracks.add(t));
    peerConnectionsRef.current.forEach((pc) => {
      pc.getSenders().forEach((sender) => {
        if (sender.track?.kind === 'audio') tracks.add(sender.track);
      });
    });
    tracks.forEach((t) => {
      t.enabled = !nextMuted;
    });
    setIsMuted(nextMuted);
  };

  const toggleVideo = () => {
    const nextOff = !isVideoOff;
    const tracks = new Set<MediaStreamTrack>();
    localStreamRef.current?.getVideoTracks().forEach((t) => tracks.add(t));
    peerConnectionsRef.current.forEach((pc) => {
      pc.getSenders().forEach((sender) => {
        if (sender.track?.kind === 'video') tracks.add(sender.track);
      });
    });
    tracks.forEach((t) => {
      t.enabled = !nextOff;
    });
    setIsVideoOff(nextOff);
  };

  const toggleSpeaker = () => {
    const next = !isSpeakerOn;
    isSpeakerOnRef.current = next;
    setIsSpeakerOn(next);
    remoteMediaElsRef.current.forEach((el) => applyAudioOutput(el, next));
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const participantCount = roster.size + 1; // +1 for ourselves
  const headerTitle = incomingCall?.groupName || group?.name || 'Group call';
  const headerSubtitle =
    modalState === 'ringing'
      ? `${incomingCall?.callerProfile?.full_name || 'Someone'} is calling the group`
      : modalState === 'ended'
      ? 'Call ended'
      : error
      ? error
      : `${formatDuration(callDuration)} \u00b7 ${participantCount} in call`;

  const rosterEntries = Array.from(roster.entries());

  return (
    <div className="fixed inset-0 z-50 bg-gradient-to-b from-slate-900 via-purple-950 to-slate-900 flex flex-col">
      {/* Top Bar */}
      <div className="flex items-center justify-between p-4 safe-area-inset-top">
        <button
          onClick={handleCloseButton}
          className="w-10 h-10 rounded-full bg-white/10 backdrop-blur-sm flex items-center justify-center text-white"
        >
          <X className="w-5 h-5" />
        </button>
        <div className="text-center">
          <p className="text-white font-semibold">{headerTitle}</p>
          <p className="text-white/70 text-sm">{headerSubtitle}</p>
        </div>
        <div className="w-10" />
      </div>

      {modalState === 'ringing' ? (
        <div className="flex-1 flex flex-col items-center justify-center px-8 gap-8">
          <div className="relative">
            <div className="absolute inset-0 rounded-full bg-violet-500/30 animate-ping" style={{ animationDuration: '2s' }} />
            <div className="w-28 h-28 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center relative z-10">
              <Users className="w-12 h-12 text-white" />
            </div>
          </div>
          <div className="flex items-center gap-10">
            <div className="flex flex-col items-center gap-2">
              <button
                onClick={declineIncomingCall}
                className="w-16 h-16 rounded-full bg-red-500 flex items-center justify-center text-white shadow-lg shadow-red-500/40 hover:bg-red-600 hover:scale-105 active:scale-90 transition-all duration-150"
              >
                <PhoneOff className="w-7 h-7" />
              </button>
              <span className="text-white/70 text-sm">Decline</span>
            </div>
            <div className="flex flex-col items-center gap-2">
              <button
                onClick={acceptIncomingCall}
                className="w-16 h-16 rounded-full bg-green-500 flex items-center justify-center text-white shadow-lg shadow-green-500/40 hover:bg-green-600 hover:scale-105 active:scale-90 transition-all duration-150"
              >
                <Phone className="w-7 h-7" />
              </button>
              <span className="text-white/70 text-sm">Join</span>
            </div>
          </div>
        </div>
      ) : modalState === 'ended' || modalState === 'initiating' ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 px-8">
          {modalState === 'initiating' && (
            <div className="w-20 h-20 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center animate-pulse">
              <Users className="w-9 h-9 text-white" />
            </div>
          )}
          <p className="text-white/70 text-sm">{modalState === 'initiating' ? error || 'Starting call\u2026' : headerSubtitle}</p>
        </div>
      ) : (
        <>
          {/* Tile grid: our own tile + one per participant currently in the call. */}
          <div className="flex-1 overflow-y-auto p-3">
            <div className="grid grid-cols-2 gap-2 auto-rows-fr h-full">
              <CallTile
                label={`${currentUser.full_name} (You)`}
                avatarUrl={currentUser.avatar_url}
                videoRef={localVideoRef}
                muted
                isVideoOff={callType !== 'video' || isVideoOff}
                status="connected"
              />
              {rosterEntries.map(([userId, profile]) => (
                <RemoteCallTile
                  key={userId}
                  userId={userId}
                  profile={profile}
                  stream={remoteStreams.get(userId)}
                  status={peerStatus.get(userId) ?? 'connecting'}
                  isVideo={callType === 'video'}
                  isSpeakerOn={isSpeakerOnRef.current}
                  mediaElsRef={remoteMediaElsRef}
                />
              ))}
            </div>
          </div>

          {/* Bottom Controls */}
          <div className="p-6 pb-10 safe-area-inset-bottom">
            <div className="flex items-center justify-center gap-5">
              {callType === 'video' && (
                <button
                  onClick={toggleVideo}
                  className={`w-12 h-12 rounded-full flex items-center justify-center transition-all duration-150 hover:scale-105 active:scale-90 ${
                    isVideoOff ? 'bg-white text-slate-900' : 'bg-white/15 backdrop-blur-sm text-white hover:bg-white/25'
                  }`}
                >
                  {isVideoOff ? <VideoOff className="w-5 h-5" /> : <Video className="w-5 h-5" />}
                </button>
              )}
              <button
                onClick={toggleMute}
                className={`w-12 h-12 rounded-full flex items-center justify-center transition-all duration-150 hover:scale-105 active:scale-90 ${
                  isMuted ? 'bg-white text-slate-900' : 'bg-white/15 backdrop-blur-sm text-white hover:bg-white/25'
                }`}
              >
                {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
              </button>
              <button
                onClick={leaveCall}
                className="w-14 h-14 rounded-full bg-red-500 flex items-center justify-center text-white shadow-lg shadow-red-500/40 hover:bg-red-600 hover:scale-105 active:scale-90 transition-all duration-150"
              >
                <PhoneOff className="w-6 h-6" />
              </button>
              <button
                onClick={toggleSpeaker}
                className={`w-12 h-12 rounded-full flex items-center justify-center transition-all duration-150 hover:scale-105 active:scale-90 ${
                  isSpeakerOn ? 'bg-white text-slate-900' : 'bg-white/15 backdrop-blur-sm text-white hover:bg-white/25'
                }`}
              >
                <Volume2 className="w-5 h-5" />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function AvatarPlaceholder({ name, avatarUrl }: { name: string; avatarUrl?: string }) {
  return avatarUrl ? (
    <img src={avatarUrl} alt={name} className="w-16 h-16 rounded-full object-cover" />
  ) : (
    <div className="w-16 h-16 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-white text-xl font-semibold">
      {name.charAt(0).toUpperCase()}
    </div>
  );
}

function CallTile({
  label,
  avatarUrl,
  videoRef,
  muted,
  isVideoOff,
  status,
}: {
  label: string;
  avatarUrl?: string;
  videoRef: React.RefObject<HTMLVideoElement>;
  muted: boolean;
  isVideoOff: boolean;
  status: PeerStatus;
}) {
  return (
    <div className="relative rounded-xl overflow-hidden bg-slate-800/60 flex items-center justify-center min-h-[140px]">
      <video ref={videoRef} autoPlay playsInline muted={muted} className={`w-full h-full object-cover ${isVideoOff ? 'hidden' : ''}`} />
      {isVideoOff && <AvatarPlaceholder name={label} avatarUrl={avatarUrl} />}
      <div className="absolute bottom-1.5 left-1.5 right-1.5 flex items-center justify-between">
        <span className="text-white text-xs font-medium bg-black/40 backdrop-blur-sm px-2 py-0.5 rounded-full truncate">{label}</span>
        {status === 'disconnected' && (
          <span className="text-white/80 text-[10px] bg-black/40 backdrop-blur-sm px-1.5 py-0.5 rounded-full">reconnecting</span>
        )}
      </div>
    </div>
  );
}

function RemoteCallTile({
  userId,
  profile,
  stream,
  status,
  isVideo,
  isSpeakerOn,
  mediaElsRef,
}: {
  userId: string;
  profile: UserProfile;
  stream?: MediaStream;
  status: PeerStatus;
  isVideo: boolean;
  isSpeakerOn: boolean;
  mediaElsRef: React.RefObject<Map<string, HTMLMediaElement>>;
}) {
  const hasVideoTrack = isVideo && !!stream?.getVideoTracks().some((t) => t.enabled);

  const setEl = (el: HTMLMediaElement | null) => {
    if (!el) {
      mediaElsRef.current?.delete(userId);
      return;
    }
    mediaElsRef.current?.set(userId, el);
    if (stream && el.srcObject !== stream) {
      el.srcObject = stream;
      playSafely(el);
      applyAudioOutput(el, isSpeakerOn);
    }
  };

  return (
    <div className="relative rounded-xl overflow-hidden bg-slate-800/60 flex items-center justify-center min-h-[140px]">
      {isVideo ? (
        <video ref={setEl} autoPlay playsInline className={`w-full h-full object-cover ${hasVideoTrack ? '' : 'hidden'}`} />
      ) : (
        <audio ref={setEl} autoPlay playsInline />
      )}
      {!hasVideoTrack && <AvatarPlaceholder name={profile.full_name} avatarUrl={profile.avatar_url} />}
      <div className="absolute bottom-1.5 left-1.5 right-1.5 flex items-center justify-between">
        <span className="text-white text-xs font-medium bg-black/40 backdrop-blur-sm px-2 py-0.5 rounded-full truncate">
          {profile.full_name}
        </span>
        {status !== 'connected' && (
          <span className="text-white/80 text-[10px] bg-black/40 backdrop-blur-sm px-1.5 py-0.5 rounded-full">
            {status === 'disconnected' ? 'reconnecting' : 'connecting'}
          </span>
        )}
      </div>
    </div>
  );
}
