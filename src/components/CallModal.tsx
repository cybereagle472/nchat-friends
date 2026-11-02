import { useState, useEffect, useRef, useCallback } from 'react';
import { Phone, PhoneOff, Mic, MicOff, Video, VideoOff, Volume2, RotateCcw, X } from 'lucide-react';
import { callService } from '../services/callService';
import { profileService } from '../services/profileService';
import { UserProfile, Call } from '../types';

interface CallModalProps {
  currentUser: UserProfile;
  calleeId?: string;
  callType: 'audio' | 'video';
  incomingCall?: Call;
  onClose: () => void;
}

// No one answers within this long → treat it as a missed call rather than
// ringing forever.
const RING_TIMEOUT_MS = 45_000;

// Both sides exchanged their SDP answer and are now trying to actually
// establish the WebRTC connection (ICE + DTLS). If that hasn't finished
// within this long, something's genuinely stuck (most commonly both ends
// are behind NAT/firewalls that need a TURN relay to talk, and no relay
// managed to work) — rather than leaving "Connecting..." on screen forever
// with no way to tell it's never going to finish, give up and say so.
const CONNECTING_TIMEOUT_MS = 20_000;

// `iceConnectionState`/`connectionState` dipping to 'disconnected' is often
// just a brief blip (a missed STUN keepalive, a momentary network switch)
// that recovers on its own a second later — ending the call the instant
// that happens is more aggressive than necessary. Give it a short grace
// window to self-heal before actually treating it as a real failure.
const DISCONNECT_GRACE_MS = 6_000;

export function CallModal({ calleeId, callType, incomingCall, onClose }: CallModalProps) {
  const [callState, setCallState] = useState<'initiating' | 'ringing' | 'connecting' | 'connected' | 'ended' | 'declined' | 'missed' | 'failed'>('initiating');
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(callType === 'audio');
  const [isSpeakerOn, setIsSpeakerOn] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [error, setError] = useState('');
  const [remoteUser, setRemoteUser] = useState<UserProfile | null>(null);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const callIdRef = useRef<string | null>(null);
  const durationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const ringTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const disconnectGraceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const eventSubRef = useRef<{ unsubscribe: () => void } | null>(null);
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const pendingRemoteCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const remoteDescriptionSetRef = useRef(false);
  const endedRef = useRef(false);
  // Whether the call ever actually reached 'connected' at least once —
  // distinguishes "never managed to connect at all" (show the explicit
  // failure message) from "was connected and then the network dropped"
  // (just end the call normally, like any other hangup mid-call).
  const everConnectedRef = useRef(false);

  const clearRingTimeout = useCallback(() => {
    if (ringTimeoutRef.current) {
      clearTimeout(ringTimeoutRef.current);
      ringTimeoutRef.current = null;
    }
  }, []);

  const clearConnectingTimeout = useCallback(() => {
    if (connectingTimeoutRef.current) {
      clearTimeout(connectingTimeoutRef.current);
      connectingTimeoutRef.current = null;
    }
  }, []);

  const clearDisconnectGrace = useCallback(() => {
    if (disconnectGraceRef.current) {
      clearTimeout(disconnectGraceRef.current);
      disconnectGraceRef.current = null;
    }
  }, []);

  const cleanupCall = useCallback(() => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }

    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }

    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }

    clearRingTimeout();
    clearConnectingTimeout();
    clearDisconnectGrace();

    if (eventSubRef.current) {
      eventSubRef.current.unsubscribe();
      eventSubRef.current = null;
    }

    pendingCandidatesRef.current = [];
    pendingRemoteCandidatesRef.current = [];
    remoteDescriptionSetRef.current = false;
  }, [clearRingTimeout, clearConnectingTimeout, clearDisconnectGrace]);

  // status defaults to 'ended' (a normal hangup); pass 'missed' for an
  // unanswered outgoing call or 'declined' when actively rejecting one.
  const endCall = useCallback(async (status: 'ended' | 'missed' | 'declined' = 'ended') => {
    if (endedRef.current) return;
    endedRef.current = true;
    if (callIdRef.current) {
      await callService.endCall(callIdRef.current, status, callDuration);
    }
    cleanupCall();
    setCallState(status);
    setTimeout(onClose, 1500);
  }, [callDuration, cleanupCall, onClose]);

  // Both sides answered but the actual media connection never came
  // together (see CONNECTING_TIMEOUT_MS) — tell the backend it's over
  // (recorded as a normal 'ended' call, same as any other hangup) but show
  // a clear "couldn't connect" message locally instead of silently closing
  // or leaving "Connecting..." on screen with no explanation.
  const failConnection = useCallback(async () => {
    if (endedRef.current) return;
    endedRef.current = true;
    if (callIdRef.current) {
      await callService.endCall(callIdRef.current, 'ended', callDuration);
    }
    cleanupCall();
    setCallState('failed');
    setTimeout(onClose, 2500);
  }, [callDuration, cleanupCall, onClose]);

  const initializeMedia = useCallback(async () => {
    const result = await callService.getUserMedia(callType);
    if (!result.success || !result.data) {
      setError(result.error || 'Could not access camera/microphone');
      throw new Error(result.error);
    }

    localStreamRef.current = result.data;
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = result.data;
    }

    return result.data;
  }, [callType]);

  const createPeerConnection = useCallback(() => {
    const pc = callService.createPeerConnection(
      (candidate) => {
        const json = candidate.toJSON();
        if (callIdRef.current) {
          callService.sendIceCandidate(callIdRef.current, json);
        } else {
          // The offer/answer round trip hasn't finished yet (we don't have
          // a call id back from the server), so queue it instead of
          // silently dropping it — connectivity can otherwise fail
          // intermittently depending on how fast ICE gathering runs.
          pendingCandidatesRef.current.push(json);
        }
      },
      (stream) => {
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = stream;
        }
      },
      (state) => {
        if (state === 'connected') {
          everConnectedRef.current = true;
          clearRingTimeout();
          clearConnectingTimeout();
          clearDisconnectGrace();
          setCallState('connected');
          if (!durationIntervalRef.current) {
            durationIntervalRef.current = setInterval(() => {
              setCallDuration((prev) => prev + 1);
            }, 1000);
          }
        } else if (state === 'failed') {
          clearDisconnectGrace();
          if (everConnectedRef.current) {
            endCall('ended');
          } else {
            failConnection();
          }
        } else if (state === 'disconnected') {
          // Don't react to the very first blip — a missed keepalive or a
          // brief network switch is common and usually recovers on its
          // own within a second or two. Only treat it as a real failure
          // if it's still disconnected once the grace window elapses (the
          // 'connected' branch above cancels this if it recovers first).
          if (!disconnectGraceRef.current) {
            disconnectGraceRef.current = setTimeout(() => {
              disconnectGraceRef.current = null;
              if (everConnectedRef.current) {
                endCall('ended');
              } else {
                failConnection();
              }
            }, DISCONNECT_GRACE_MS);
          }
        }
      }
    );

    // Add local tracks
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        pc.addTrack(track, localStreamRef.current!);
      });
    }

    peerConnectionRef.current = pc;
    return pc;
  }, [clearRingTimeout, clearConnectingTimeout, clearDisconnectGrace, endCall, failConnection]);

  // Arms (or re-arms) the "give up if this never actually connects" timer
  // — called the moment both sides have exchanged SDP and are waiting on
  // ICE/DTLS to finish, from both the caller's and callee's code paths.
  const startConnectingTimeout = useCallback(() => {
    clearConnectingTimeout();
    connectingTimeoutRef.current = setTimeout(() => {
      connectingTimeoutRef.current = null;
      if (!everConnectedRef.current) failConnection();
    }, CONNECTING_TIMEOUT_MS);
  }, [clearConnectingTimeout, failConnection]);

  // Apply any ICE candidates that arrived before we had a peer connection
  // (or before its remote description was set) ready to accept them.
  const flushPendingRemoteCandidates = useCallback(async (pc: RTCPeerConnection) => {
    const queued = pendingRemoteCandidatesRef.current;
    pendingRemoteCandidatesRef.current = [];
    for (const candidate of queued) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch {
        // Stale/invalid by the time it's applied; safe to ignore.
      }
    }
  }, []);

  // Subscribed once per call id. Reads peerConnectionRef live (instead of
  // closing over a `pc`) because for an incoming call this has to start
  // listening the moment the phone starts ringing — well before the user
  // taps Accept and a peer connection actually exists. That matters: the
  // caller's ICE candidates start being broadcast immediately after the
  // offer is sent, they don't wait for an answer, so if the callee only
  // subscribed once answering (which can be several seconds into the ring,
  // however long someone takes to notice and respond), every one of those
  // early candidates would already be gone — leaving nothing for ICE to
  // connect with, which is exactly why calls were stuck on "Connecting..."
  // forever on both ends even after being picked up.
  const subscribeToSignaling = useCallback((callId: string) => {
    eventSubRef.current?.unsubscribe();
    eventSubRef.current = callService.subscribeToCallEvents({
      onCallAnswered: async (id, answerSdp) => {
        if (id !== callId) return;
        const pc = peerConnectionRef.current;
        if (!pc) return;
        await pc.setRemoteDescription(new RTCSessionDescription(answerSdp));
        remoteDescriptionSetRef.current = true;
        await flushPendingRemoteCandidates(pc);
        setCallState('connecting');
        startConnectingTimeout();
      },
      onCallEnded: (id, status) => {
        if (id !== callId || endedRef.current) return;
        endedRef.current = true;
        cleanupCall();
        setCallState(status === 'declined' || status === 'missed' ? status : 'ended');
        setTimeout(onClose, 1500);
      },
      onIceCandidate: async (id, candidate) => {
        if (id !== callId) return;
        const pc = peerConnectionRef.current;
        if (!pc || !remoteDescriptionSetRef.current) {
          // No peer connection yet (still ringing) or its remote
          // description isn't set yet — hold onto it instead of dropping
          // it; it gets applied as soon as both are ready.
          pendingRemoteCandidatesRef.current.push(candidate);
          return;
        }
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch {
          // A candidate can legitimately arrive right as the connection is
          // closing; safe to ignore.
        }
      },
    });
  }, [cleanupCall, flushPendingRemoteCandidates, onClose, startConnectingTimeout]);

  const initiateCall = useCallback(async () => {
    if (!calleeId) return;

    try {
      const profile = await profileService.getProfile(calleeId);
      setRemoteUser(profile);

      await initializeMedia();
      const pc = createPeerConnection();

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const result = await callService.initiateCall(calleeId, callType, offer);
      if (!result.success || !result.data) {
        setError(result.error || 'Failed to initiate call');
        cleanupCall();
        setTimeout(onClose, 2000);
        return;
      }

      // The user may have already hit "cancel" while that request was in
      // flight (closing the local UI and the peer connection along with
      // it) — in that case the call row that just got created server-side,
      // and the person we were calling, both need to be told it's over
      // too, instead of ringing with no way to stop it.
      if (endedRef.current) {
        await callService.endCall(result.data.id, 'ended');
        return;
      }

      callIdRef.current = result.data.id;
      // Flush any ICE candidates that were gathered before we had a call id.
      if (pendingCandidatesRef.current.length > 0) {
        pendingCandidatesRef.current.forEach((c) => callService.sendIceCandidate(result.data!.id, c));
        pendingCandidatesRef.current = [];
      }

      setCallState('ringing');
      subscribeToSignaling(result.data.id);

      // No call-waiting / voicemail — if nobody answers in time, give up
      // and record it as missed rather than ringing forever.
      ringTimeoutRef.current = setTimeout(() => endCall('missed'), RING_TIMEOUT_MS);
    } catch (err: any) {
      console.error('Error initiating call:', err);
      setError('Failed to initiate call');
      // We may or may not have created the call row yet — either way, make
      // sure the callee isn't left ringing with no way to know we gave up.
      if (callIdRef.current) await callService.endCall(callIdRef.current, 'ended');
      cleanupCall();
      setTimeout(onClose, 2000);
    }
  }, [calleeId, callType, cleanupCall, createPeerConnection, endCall, initializeMedia, onClose, subscribeToSignaling]);

  const answerCall = useCallback(async () => {
    if (!incomingCall) return;

    try {
      callIdRef.current = incomingCall.id;

      // remoteUser was already set from the incoming-call event (or a
      // fallback fetch) as soon as the ringing screen appeared.
      if (!remoteUser) {
        const profile = await profileService.getProfile(incomingCall.caller_id);
        setRemoteUser(profile);
      }

      await initializeMedia();

      const pc = createPeerConnection();

      if (incomingCall.offer_sdp) {
        await pc.setRemoteDescription(new RTCSessionDescription(incomingCall.offer_sdp));
        remoteDescriptionSetRef.current = true;
        // We've been subscribed to signaling (and possibly collecting the
        // caller's ICE candidates) since the phone started ringing, well
        // before this peer connection existed — apply whatever came in
        // during that wait now that there's somewhere to put it.
        await flushPendingRemoteCandidates(pc);
      }

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await callService.answerCall(incomingCall.id, answer);

      setCallState('connecting');
      startConnectingTimeout();
      // Already subscribed to signaling since the ringing screen appeared
      // (see the mount effect below) — no need to subscribe again here.
    } catch (err: any) {
      console.error('Error answering call:', err);
      setError('Failed to answer call');
      // Let the caller know we couldn't actually pick up, instead of
      // leaving them stuck on "ringing" indefinitely.
      await callService.endCall(incomingCall.id, 'declined');
      cleanupCall();
      setTimeout(onClose, 2000);
    }
  }, [cleanupCall, createPeerConnection, flushPendingRemoteCandidates, incomingCall, initializeMedia, onClose, remoteUser, startConnectingTimeout]);

  const declineCall = useCallback(async () => {
    if (incomingCall) {
      endedRef.current = true;
      await callService.endCall(incomingCall.id, 'declined');
    }
    cleanupCall();
    onClose();
  }, [cleanupCall, incomingCall, onClose]);

  // The X / close button means different things depending on where we are
  // in the call lifecycle — always treat it as *some* explicit hangup
  // action instead of just closing the local modal and leaving the other
  // side hanging.
  const handleCloseButton = useCallback(() => {
    if (incomingCall && callState === 'ringing') {
      declineCall();
    } else {
      endCall('ended');
    }
  }, [callState, declineCall, endCall, incomingCall]);

  useEffect(() => {
    if (incomingCall) {
      setCallState('ringing');
      // Show the embedded caller profile immediately (no network round
      // trip needed for the ringing screen to have a name/avatar); only
      // fall back to fetching it if it wasn't included for some reason.
      if (incomingCall.caller_profile) {
        setRemoteUser(incomingCall.caller_profile);
      } else {
        profileService.getProfile(incomingCall.caller_id).then(setRemoteUser);
      }
      // Start listening for the caller's ICE candidates right away, not
      // only once Accept is tapped — see subscribeToSignaling's comment
      // for why that gap was silently breaking every call's connection.
      callIdRef.current = incomingCall.id;
      subscribeToSignaling(incomingCall.id);
    } else if (calleeId) {
      initiateCall();
    }

    return () => {
      cleanupCall();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calleeId, incomingCall]);

  const toggleMute = () => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMuted(!audioTrack.enabled);
      }
    }
  };

  const toggleVideo = () => {
    if (localStreamRef.current) {
      const videoTrack = localStreamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsVideoOff(!videoTrack.enabled);
      }
    }
  };

  const toggleSpeaker = () => {
    setIsSpeakerOn(!isSpeakerOn);
    // In a real implementation, you'd switch audio output here
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const getCallStatusText = () => {
    if (error) return error;
    switch (callState) {
      case 'initiating': return 'Calling...';
      case 'ringing': return incomingCall ? 'Incoming call' : 'Ringing...';
      case 'connecting': return 'Connecting...';
      case 'connected': return formatDuration(callDuration);
      case 'ended': return 'Call ended';
      case 'declined': return incomingCall ? 'Call declined' : `${remoteUser?.full_name || 'They'} declined`;
      case 'missed': return 'No answer';
      case 'failed': return 'Couldn\u2019t connect \u2014 check your connection';
      default: return '';
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-gradient-to-b from-slate-900 via-purple-950 to-slate-900">
      {/* Video Call View */}
      {callType === 'video' ? (
        <div className="relative w-full h-full">
          {/* Remote Video (Full Screen) */}
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className="w-full h-full object-cover"
          />

          {/* Gradient Overlay for UI visibility */}
          <div className="absolute inset-0 bg-gradient-to-b from-black/50 via-transparent to-black/70 pointer-events-none" />

          {/* Local Video (Picture-in-Picture) */}
          <div className="absolute top-16 right-4 w-28 h-40 rounded-2xl overflow-hidden shadow-2xl border-2 border-white/20 bg-slate-800">
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
            />
            {isVideoOff && (
              <div className="absolute inset-0 bg-slate-800 flex items-center justify-center">
                <VideoOff className="w-8 h-8 text-white/50" />
              </div>
            )}
          </div>

          {/* Top Bar */}
          <div className="absolute top-0 left-0 right-0 p-4 safe-area-inset-top">
            <div className="flex items-center justify-between">
              <button
                onClick={handleCloseButton}
                className="w-10 h-10 rounded-full bg-white/10 backdrop-blur-sm flex items-center justify-center text-white"
              >
                <X className="w-5 h-5" />
              </button>
              <div className="text-center">
                <p className="text-white font-semibold">{remoteUser?.full_name || 'Unknown'}</p>
                <p className="text-white/70 text-sm">{getCallStatusText()}</p>
              </div>
              <div className="w-10" /> {/* Spacer */}
            </div>
          </div>

          {/* Bottom Controls */}
          <div className="absolute bottom-0 left-0 right-0 p-6 pb-10 safe-area-inset-bottom">
            {incomingCall && callState === 'ringing' ? (
              <IncomingCallControls onDecline={declineCall} onAnswer={answerCall} />
            ) : callState === 'ended' || callState === 'declined' || callState === 'missed' || callState === 'failed' ? null : (
              <VideoCallControls
                isMuted={isMuted}
                isVideoOff={isVideoOff}
                onToggleMute={toggleMute}
                onToggleVideo={toggleVideo}
                onEndCall={() => endCall('ended')}
                onFlipCamera={() => {}}
              />
            )}
          </div>
        </div>
      ) : (
        /* Audio Call View */
        <div className="relative w-full h-full flex flex-col">
          {/* Background Pattern */}
          <div className="absolute inset-0 overflow-hidden">
            <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[600px] rounded-full bg-gradient-to-br from-violet-500/20 to-purple-600/20 blur-3xl" />
            <div className="absolute bottom-1/4 left-1/4 w-[400px] h-[400px] rounded-full bg-gradient-to-br from-fuchsia-500/10 to-pink-500/10 blur-3xl" />
          </div>

          {/* Close Button */}
          <div className="absolute top-4 left-4 z-10 safe-area-inset-top">
            <button
              onClick={handleCloseButton}
              className="w-10 h-10 rounded-full bg-white/10 backdrop-blur-sm flex items-center justify-center text-white hover:bg-white/20 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Main Content */}
          <div className="flex-1 flex flex-col items-center justify-center px-8 relative z-10">
            {/* Avatar with Pulse Animation */}
            <div className="relative mb-8">
              {/* Pulse rings for ringing/connecting states */}
              {(callState === 'ringing' || callState === 'connecting') && (
                <>
                  <div className="absolute inset-0 rounded-full bg-violet-500/30 animate-ping" style={{ animationDuration: '2s' }} />
                  <div className="absolute -inset-4 rounded-full border-2 border-violet-400/30 animate-pulse" />
                  <div className="absolute -inset-8 rounded-full border border-violet-400/20 animate-pulse" style={{ animationDelay: '0.5s' }} />
                </>
              )}

              {/* Connected wave animation */}
              {callState === 'connected' && (
                <div className="absolute -inset-4 rounded-full border-2 border-green-400/40 animate-pulse" />
              )}

              {/* Avatar */}
              <div className="w-36 h-36 rounded-full bg-gradient-to-br from-violet-500 via-purple-500 to-fuchsia-500 flex items-center justify-center shadow-2xl shadow-purple-500/30 overflow-hidden relative">
                {remoteUser?.avatar_url ? (
                  <img
                    src={remoteUser.avatar_url}
                    alt={remoteUser.full_name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span className="text-6xl text-white font-bold">
                    {remoteUser?.full_name?.charAt(0).toUpperCase() || '?'}
                  </span>
                )}
              </div>
            </div>

            {/* Name */}
            <h1 className="text-2xl font-bold text-white mb-2">
              {remoteUser?.full_name || 'Unknown'}
            </h1>

            {/* Call Status */}
            <div className="flex items-center gap-2 mb-8">
              {(callState === 'initiating' || callState === 'connecting') && (
                <div className="w-2 h-2 bg-white/70 rounded-full animate-pulse" />
              )}
              <p className={`text-lg ${
                callState === 'connected'
                  ? 'text-green-400 font-semibold tabular-nums'
                  : error || callState === 'failed'
                    ? 'text-red-400'
                    : 'text-white/70'
              }`}>
                {getCallStatusText()}
              </p>
            </div>
          </div>

          {/* Bottom Controls */}
          <div className="px-6 pb-12 safe-area-inset-bottom relative z-10">
            {incomingCall && callState === 'ringing' ? (
              <IncomingCallControls onDecline={declineCall} onAnswer={answerCall} />
            ) : callState === 'ended' || callState === 'declined' || callState === 'missed' || callState === 'failed' ? null : (
              <AudioCallControls
                isMuted={isMuted}
                isSpeakerOn={isSpeakerOn}
                onToggleMute={toggleMute}
                onToggleSpeaker={toggleSpeaker}
                onEndCall={() => endCall('ended')}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Incoming Call Controls Component
function IncomingCallControls({
  onDecline,
  onAnswer
}: {
  onDecline: () => void;
  onAnswer: () => void;
}) {
  return (
    <div className="flex items-center justify-center gap-16">
      {/* Decline Button */}
      <div className="flex flex-col items-center gap-2">
        <button
          onClick={onDecline}
          className="w-16 h-16 rounded-full bg-red-500 flex items-center justify-center text-white shadow-lg shadow-red-500/40 hover:bg-red-600 active:scale-95 transition-all"
        >
          <PhoneOff className="w-7 h-7" />
        </button>
        <span className="text-white/70 text-sm">Decline</span>
      </div>

      {/* Answer Button */}
      <div className="flex flex-col items-center gap-2">
        <button
          onClick={onAnswer}
          className="w-16 h-16 rounded-full bg-green-500 flex items-center justify-center text-white shadow-lg shadow-green-500/40 hover:bg-green-600 active:scale-95 transition-all animate-pulse"
        >
          <Phone className="w-7 h-7" />
        </button>
        <span className="text-white/70 text-sm">Accept</span>
      </div>
    </div>
  );
}

// Audio Call Controls Component
function AudioCallControls({
  isMuted,
  isSpeakerOn,
  onToggleMute,
  onToggleSpeaker,
  onEndCall
}: {
  isMuted: boolean;
  isSpeakerOn: boolean;
  onToggleMute: () => void;
  onToggleSpeaker: () => void;
  onEndCall: () => void;
}) {
  return (
    <div className="flex items-center justify-center gap-6">
      {/* Mute Button */}
      <div className="flex flex-col items-center gap-2">
        <button
          onClick={onToggleMute}
          className={`w-14 h-14 rounded-full flex items-center justify-center transition-all active:scale-95 ${
            isMuted
              ? 'bg-white text-slate-900'
              : 'bg-white/15 backdrop-blur-sm text-white hover:bg-white/25'
          }`}
        >
          {isMuted ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
        </button>
        <span className="text-white/60 text-xs">Mute</span>
      </div>

      {/* End Call Button */}
      <div className="flex flex-col items-center gap-2">
        <button
          onClick={onEndCall}
          className="w-16 h-16 rounded-full bg-red-500 flex items-center justify-center text-white shadow-lg shadow-red-500/40 hover:bg-red-600 active:scale-95 transition-all"
        >
          <PhoneOff className="w-7 h-7" />
        </button>
        <span className="text-white/60 text-xs">End</span>
      </div>

      {/* Speaker Button */}
      <div className="flex flex-col items-center gap-2">
        <button
          onClick={onToggleSpeaker}
          className={`w-14 h-14 rounded-full flex items-center justify-center transition-all active:scale-95 ${
            isSpeakerOn
              ? 'bg-white text-slate-900'
              : 'bg-white/15 backdrop-blur-sm text-white hover:bg-white/25'
          }`}
        >
          <Volume2 className="w-6 h-6" />
        </button>
        <span className="text-white/60 text-xs">Speaker</span>
      </div>
    </div>
  );
}

// Video Call Controls Component
function VideoCallControls({
  isMuted,
  isVideoOff,
  onToggleMute,
  onToggleVideo,
  onEndCall,
  onFlipCamera
}: {
  isMuted: boolean;
  isVideoOff: boolean;
  onToggleMute: () => void;
  onToggleVideo: () => void;
  onEndCall: () => void;
  onFlipCamera: () => void;
}) {
  return (
    <div className="flex items-center justify-center gap-5">
      {/* Flip Camera */}
      <button
        onClick={onFlipCamera}
        className="w-12 h-12 rounded-full bg-white/15 backdrop-blur-sm flex items-center justify-center text-white hover:bg-white/25 active:scale-95 transition-all"
      >
        <RotateCcw className="w-5 h-5" />
      </button>

      {/* Toggle Video */}
      <button
        onClick={onToggleVideo}
        className={`w-12 h-12 rounded-full flex items-center justify-center transition-all active:scale-95 ${
          isVideoOff
            ? 'bg-white text-slate-900'
            : 'bg-white/15 backdrop-blur-sm text-white hover:bg-white/25'
        }`}
      >
        {isVideoOff ? <VideoOff className="w-5 h-5" /> : <Video className="w-5 h-5" />}
      </button>

      {/* Toggle Mute */}
      <button
        onClick={onToggleMute}
        className={`w-12 h-12 rounded-full flex items-center justify-center transition-all active:scale-95 ${
          isMuted
            ? 'bg-white text-slate-900'
            : 'bg-white/15 backdrop-blur-sm text-white hover:bg-white/25'
        }`}
      >
        {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
      </button>

      {/* End Call */}
      <button
        onClick={onEndCall}
        className="w-14 h-14 rounded-full bg-red-500 flex items-center justify-center text-white shadow-lg shadow-red-500/40 hover:bg-red-600 active:scale-95 transition-all"
      >
        <PhoneOff className="w-6 h-6" />
      </button>
    </div>
  );
}
