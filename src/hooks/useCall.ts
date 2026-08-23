/**
 * useCall Hook - WebRTC Call Management
 *
 * Handles voice and video calls with proper WebRTC signaling.
 * Works like WhatsApp/IMO with ringing, accepting, and real-time audio/video.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { callService } from '../services/callService';
import { supabase } from '../supabaseClient';
import { UserProfile, CallSignal } from '../types';
import { log } from '../utils/logger';

interface UseCallProps {
  currentUserId: string | null;
  onCallEnded?: () => void;
}

interface UseCallReturn {
  // State
  callSignal: CallSignal | null;
  activeCall: boolean;
  caller: UserProfile | null;
  isOutgoing: boolean;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  isMicOn: boolean;
  isVideoOn: boolean;
  callDuration: number;
  connectionState: RTCPeerConnectionState | null;

  // Actions
  initiateCall: (contact: UserProfile, type: 'voice' | 'video') => Promise<void>;
  acceptCall: () => Promise<void>;
  rejectCall: () => Promise<void>;
  endCall: () => Promise<void>;
  toggleMic: () => void;
  toggleVideo: () => void;
}

// ICE Server configuration
const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    // Free TURN server for testing
    {
      urls: 'turn:openrelay.metered.ca:80',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    },
    {
      urls: 'turn:openrelay.metered.ca:443',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    },
    {
      urls: 'turn:openrelay.metered.ca:443?transport=tcp',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    }
  ],
  iceCandidatePoolSize: 10
};

export function useCall({ currentUserId, onCallEnded }: UseCallProps): UseCallReturn {
  // State
  const [callSignal, setCallSignal] = useState<CallSignal | null>(null);
  const [activeCall, setActiveCall] = useState(false);
  const [caller, setCaller] = useState<UserProfile | null>(null);
  const [isOutgoing, setIsOutgoing] = useState(false);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [isMicOn, setIsMicOn] = useState(true);
  const [isVideoOn, setIsVideoOn] = useState(true);
  const [callDuration, setCallDuration] = useState(0);
  const [connectionState, setConnectionState] = useState<RTCPeerConnectionState | null>(null);

  // Refs
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const callIdRef = useRef<string | null>(null);
  const durationIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const iceCandidatesQueue = useRef<RTCIceCandidateInit[]>([]);
  const callChannelRef = useRef<any>(null);

  // Cleanup function
  const cleanup = useCallback(() => {
    log.info('Cleaning up call resources', null, 'useCall');

    // Stop duration timer
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }

    // Stop local stream tracks
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
    }

    // Stop remote stream tracks
    if (remoteStream) {
      remoteStream.getTracks().forEach(track => track.stop());
    }

    // Close peer connection
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }

    // Reset state
    setLocalStream(null);
    setRemoteStream(null);
    setCallSignal(null);
    setActiveCall(false);
    setCaller(null);
    setIsOutgoing(false);
    setIsMicOn(true);
    setIsVideoOn(true);
    setCallDuration(0);
    setConnectionState(null);
    callIdRef.current = null;
    iceCandidatesQueue.current = [];

    onCallEnded?.();
  }, [localStream, remoteStream, onCallEnded]);

  // Get user media
  const getUserMedia = useCallback(async (callType: 'audio' | 'video'): Promise<MediaStream | null> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: callType === 'video' ? {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: 'user'
        } : false
      });
      return stream;
    } catch (error: any) {
      log.error('Failed to get user media', error, 'useCall');

      if (error.name === 'NotAllowedError') {
        alert('Please allow camera/microphone access to make calls.');
      } else if (error.name === 'NotFoundError') {
        alert('No camera or microphone found on this device.');
      }
      return null;
    }
  }, []);

  // Create peer connection
  const createPeerConnection = useCallback((callId: string) => {
    const pc = new RTCPeerConnection(ICE_SERVERS);

    pc.onicecandidate = async (event) => {
      if (event.candidate && currentUserId) {
        log.info('ICE candidate generated', event.candidate.candidate, 'useCall');
        await callService.storeIceCandidate(callId, currentUserId, event.candidate.toJSON());
      }
    };

    pc.ontrack = (event) => {
      log.info('Remote track received', null, 'useCall');
      if (event.streams && event.streams[0]) {
        setRemoteStream(event.streams[0]);
      }
    };

    pc.onconnectionstatechange = () => {
      log.info(`Connection state: ${pc.connectionState}`, null, 'useCall');
      setConnectionState(pc.connectionState);

      if (pc.connectionState === 'connected') {
        setActiveCall(true);
        // Start duration timer
        durationIntervalRef.current = setInterval(() => {
          setCallDuration(prev => prev + 1);
        }, 1000);
      } else if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        cleanup();
      }
    };

    pc.oniceconnectionstatechange = () => {
      log.info(`ICE connection state: ${pc.iceConnectionState}`, null, 'useCall');
    };

    return pc;
  }, [currentUserId, cleanup]);

  // Process queued ICE candidates
  const processIceCandidates = useCallback(async () => {
    const pc = peerConnectionRef.current;
    if (!pc || pc.remoteDescription === null) return;

    while (iceCandidatesQueue.current.length > 0) {
      const candidate = iceCandidatesQueue.current.shift();
      if (candidate) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
          log.info('ICE candidate added', null, 'useCall');
        } catch (error) {
          log.error('Failed to add ICE candidate', error, 'useCall');
        }
      }
    }
  }, []);

  // Initiate a call
  const initiateCall = useCallback(async (contact: UserProfile, type: 'voice' | 'video') => {
    if (!currentUserId) return;

    log.info(`Initiating ${type} call to ${contact.full_name}`, null, 'useCall');

    // Get media stream first
    const stream = await getUserMedia(type === 'voice' ? 'audio' : 'video');
    if (!stream) return;

    setLocalStream(stream);
    setCaller(contact);
    setIsOutgoing(true);
    setIsVideoOn(type === 'video');

    // Create call record
    const result = await callService.initiateCall(currentUserId, contact.id, type === 'voice' ? 'audio' : 'video');
    if (!result.success || !result.data) {
      log.error('Failed to initiate call', result.error, 'useCall');
      cleanup();
      return;
    }

    const callId = result.data.id;
    callIdRef.current = callId;

    setCallSignal({
      type: 'offer',
      caller_id: currentUserId,
      call_type: type === 'voice' ? 'audio' : 'video',
      call_id: callId
    });

    // Create peer connection
    const pc = createPeerConnection(callId);
    peerConnectionRef.current = pc;

    // Add local stream tracks to peer connection
    stream.getTracks().forEach(track => {
      pc.addTrack(track, stream);
    });

    // Create and store offer
    try {
      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: type === 'video'
      });
      await pc.setLocalDescription(offer);
      await callService.storeOffer(callId, offer);
      log.info('Offer created and stored', null, 'useCall');
    } catch (error) {
      log.error('Failed to create offer', error, 'useCall');
      cleanup();
    }

    // Subscribe to call updates
    subscribeToCallUpdates(callId);
  }, [currentUserId, getUserMedia, createPeerConnection, cleanup]);

  // Subscribe to call updates
  const subscribeToCallUpdates = useCallback((callId: string) => {
    const channel = supabase
      .channel(`call_${callId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'calls',
          filter: `id=eq.${callId}`
        },
        async (payload: any) => {
          const call = payload.new;
          log.info(`Call update: ${call.status}`, null, 'useCall');

          if (call.status === 'answered' && call.answer_sdp && peerConnectionRef.current) {
            try {
              await peerConnectionRef.current.setRemoteDescription(
                new RTCSessionDescription(call.answer_sdp)
              );
              log.info('Remote description set from answer', null, 'useCall');
              await processIceCandidates();
            } catch (error) {
              log.error('Failed to set remote description', error, 'useCall');
            }
          } else if (call.status === 'declined' || call.status === 'missed' || call.status === 'ended') {
            cleanup();
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'call_candidates',
          filter: `call_id=eq.${callId}`
        },
        async (payload: any) => {
          const candidateData = payload.new;
          if (candidateData.from_user_id !== currentUserId) {
            const candidate = candidateData.candidate;
            if (peerConnectionRef.current?.remoteDescription) {
              try {
                await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(candidate));
                log.info('ICE candidate added from remote', null, 'useCall');
              } catch (error) {
                log.error('Failed to add ICE candidate', error, 'useCall');
              }
            } else {
              iceCandidatesQueue.current.push(candidate);
            }
          }
        }
      )
      .subscribe();

    callChannelRef.current = channel;
  }, [currentUserId, processIceCandidates, cleanup]);

  // Accept an incoming call
  const acceptCall = useCallback(async () => {
    if (!callSignal || !currentUserId) return;

    const callId = callSignal.call_id;
    if (!callId) return;

    log.info('Accepting call', null, 'useCall');

    // Get media stream
    const stream = await getUserMedia(callSignal.call_type);
    if (!stream) return;

    setLocalStream(stream);
    setIsVideoOn(callSignal.call_type === 'video');

    // Get the call with offer SDP
    const { data: callData } = await supabase
      .from('calls')
      .select('*')
      .eq('id', callId)
      .single();

    if (!callData?.offer_sdp) {
      log.error('No offer SDP found', null, 'useCall');
      cleanup();
      return;
    }

    // Create peer connection
    const pc = createPeerConnection(callId);
    peerConnectionRef.current = pc;
    callIdRef.current = callId;

    // Add local stream tracks
    stream.getTracks().forEach(track => {
      pc.addTrack(track, stream);
    });

    // Set remote description and create answer
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(callData.offer_sdp));
      log.info('Remote description set from offer', null, 'useCall');

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await callService.storeAnswer(callId, answer);
      log.info('Answer created and stored', null, 'useCall');

      // Process any queued ICE candidates
      await processIceCandidates();

      // Subscribe to call updates
      subscribeToCallUpdates(callId);
    } catch (error) {
      log.error('Failed to accept call', error, 'useCall');
      cleanup();
    }
  }, [callSignal, currentUserId, getUserMedia, createPeerConnection, processIceCandidates, subscribeToCallUpdates, cleanup]);

  // Reject an incoming call
  const rejectCall = useCallback(async () => {
    if (callIdRef.current) {
      await callService.updateCallStatus(callIdRef.current, 'declined');
    } else if (callSignal?.call_id) {
      await callService.updateCallStatus(callSignal.call_id, 'declined');
    }
    cleanup();
  }, [callSignal, cleanup]);

  // End the call
  const endCall = useCallback(async () => {
    const callId = callIdRef.current || callSignal?.call_id;
    if (callId) {
      await callService.updateCallStatus(callId, 'ended', callDuration);
    }
    cleanup();
  }, [callSignal, callDuration, cleanup]);

  // Toggle microphone
  const toggleMic = useCallback(() => {
    if (localStream) {
      localStream.getAudioTracks().forEach(track => {
        track.enabled = !track.enabled;
      });
      setIsMicOn(prev => !prev);
    }
  }, [localStream]);

  // Toggle video
  const toggleVideo = useCallback(() => {
    if (localStream) {
      localStream.getVideoTracks().forEach(track => {
        track.enabled = !track.enabled;
      });
      setIsVideoOn(prev => !prev);
    }
  }, [localStream]);

  // Subscribe to incoming calls
  useEffect(() => {
    if (!currentUserId) return;

    const channel = supabase
      .channel(`incoming_calls_${currentUserId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'calls',
          filter: `receiver_id=eq.${currentUserId}`
        },
        async (payload: any) => {
          const call = payload.new;
          log.info('Incoming call received', call, 'useCall');

          // Get caller profile
          const { data: callerProfile } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', call.caller_id)
            .single();

          if (callerProfile) {
            setCaller(callerProfile as UserProfile);
            setCallSignal({
              type: 'offer',
              caller_id: call.caller_id,
              call_type: call.call_type,
              call_id: call.id
            });
            setIsOutgoing(false);
            callIdRef.current = call.id;
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'calls',
          filter: `receiver_id=eq.${currentUserId}`
        },
        async (payload: any) => {
          const call = payload.new;

          if (call.status === 'ringing' && call.offer_sdp && !activeCall) {
            // Call is now ringing with offer - update signal
            setCallSignal(prev => prev ? {
              ...prev,
              offer_sdp: call.offer_sdp
            } : null);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentUserId, activeCall]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanup();
      if (callChannelRef.current) {
        supabase.removeChannel(callChannelRef.current);
      }
    };
  }, [cleanup]);

  return {
    callSignal,
    activeCall,
    caller,
    isOutgoing,
    localStream,
    remoteStream,
    isMicOn,
    isVideoOn,
    callDuration,
    connectionState,
    initiateCall,
    acceptCall,
    rejectCall,
    endCall,
    toggleMic,
    toggleVideo
  };
}
