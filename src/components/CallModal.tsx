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

export function CallModal({ currentUser, calleeId, callType, incomingCall, onClose }: CallModalProps) {
  const [callState, setCallState] = useState<'initiating' | 'ringing' | 'connecting' | 'connected' | 'ended'>('initiating');
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
  }, []);

  const endCall = useCallback(async () => {
    if (callIdRef.current) {
      await callService.updateCallStatus(callIdRef.current, 'ended', callDuration);
    }
    cleanupCall();
    setCallState('ended');
    setTimeout(onClose, 1500);
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
      async (candidate) => {
        if (callIdRef.current) {
          await callService.storeIceCandidate(callIdRef.current, currentUser.id, candidate.toJSON());
        }
      },
      (stream) => {
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = stream;
        }
      },
      (state) => {
        if (state === 'connected') {
          setCallState('connected');
          durationIntervalRef.current = setInterval(() => {
            setCallDuration((prev) => prev + 1);
          }, 1000);
        } else if (state === 'failed' || state === 'disconnected') {
          endCall();
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
  }, [currentUser.id, endCall]);

  const initiateCall = useCallback(async () => {
    if (!calleeId) return;

    try {
      const profile = await profileService.getProfile(calleeId);
      setRemoteUser(profile);

      await initializeMedia();

      const result = await callService.initiateCall(currentUser.id, calleeId, callType);
      if (!result.success || !result.data) {
        setError(result.error || 'Failed to initiate call');
        return;
      }

      callIdRef.current = result.data.id;
      const pc = createPeerConnection();

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await callService.storeOffer(result.data.id, offer);

      setCallState('ringing');

      // Subscribe to call events
      callService.subscribeToCallEvents(currentUser.id, {
        onCallAnswered: async (callId, answerSdp) => {
          if (callId === callIdRef.current) {
            await pc.setRemoteDescription(new RTCSessionDescription(answerSdp));
            setCallState('connecting');
          }
        },
        onCallEnded: (callId) => {
          if (callId === callIdRef.current) {
            endCall();
          }
        },
        onIceCandidate: async (callId, candidate) => {
          if (callId === callIdRef.current) {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
          }
        }
      });
    } catch (err: any) {
      console.error('Error initiating call:', err);
      setError('Failed to initiate call');
      setTimeout(onClose, 2000);
    }
  }, [calleeId, callType, createPeerConnection, currentUser.id, endCall, initializeMedia, onClose]);

  const answerCall = useCallback(async () => {
    if (!incomingCall) return;

    try {
      callIdRef.current = incomingCall.id;

      const profile = await profileService.getProfile(incomingCall.caller_id);
      setRemoteUser(profile);

      await initializeMedia();

      const pc = createPeerConnection();

      if (incomingCall.offer_sdp) {
        await pc.setRemoteDescription(new RTCSessionDescription(incomingCall.offer_sdp));
      }

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await callService.storeAnswer(incomingCall.id, answer);

      setCallState('connecting');

      // Subscribe to ICE candidates
      callService.subscribeToCallEvents(currentUser.id, {
        onIceCandidate: async (callId, candidate) => {
          if (callId === incomingCall.id) {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
          }
        },
        onCallEnded: (callId) => {
          if (callId === incomingCall.id) {
            endCall();
          }
        }
      });
    } catch (err: any) {
      console.error('Error answering call:', err);
      setError('Failed to answer call');
      setTimeout(onClose, 2000);
    }
  }, [createPeerConnection, currentUser.id, endCall, incomingCall, initializeMedia, onClose]);

  const declineCall = useCallback(async () => {
    if (incomingCall) {
      await callService.updateCallStatus(incomingCall.id, 'declined');
    }
    cleanupCall();
    onClose();
  }, [cleanupCall, incomingCall, onClose]);

  useEffect(() => {
    if (incomingCall) {
      setCallState('ringing');
      profileService.getProfile(incomingCall.caller_id).then(setRemoteUser);
    } else if (calleeId) {
      initiateCall();
    }

    return () => {
      cleanupCall();
    };
  }, [calleeId, cleanupCall, incomingCall, initiateCall]);

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
                onClick={onClose}
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
            ) : (
              <VideoCallControls
                isMuted={isMuted}
                isVideoOff={isVideoOff}
                onToggleMute={toggleMute}
                onToggleVideo={toggleVideo}
                onEndCall={endCall}
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
              onClick={onClose}
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
                  : error
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
            ) : (
              <AudioCallControls
                isMuted={isMuted}
                isSpeakerOn={isSpeakerOn}
                onToggleMute={toggleMute}
                onToggleSpeaker={toggleSpeaker}
                onEndCall={endCall}
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
