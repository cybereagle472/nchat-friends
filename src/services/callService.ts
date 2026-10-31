/**
 * Call Service - WebRTC Signaling Implementation
 *
 * Features:
 * - Voice and video call initiation
 * - WebRTC signaling over Supabase Realtime
 * - ICE candidate exchange
 * - Call state management
 * - Call history tracking
 */

import { supabase } from '../supabaseClient';
import { CallHistory, UserProfile } from '../types';

export interface CallSession {
  id: string;
  callerId: string;
  receiverId: string;
  callType: 'audio' | 'video';
  status: 'initiated' | 'ringing' | 'answered' | 'ended' | 'missed' | 'declined';
  startedAt: string;
  endedAt?: string;
  duration?: number;
}

export interface ServiceResult<T = void> {
  success: boolean;
  data?: T;
  error?: string;
}

// ICE Server configuration with STUN and TURN servers
// TURN servers are essential for calls behind NAT/firewalls
const getIceServers = (): RTCConfiguration => {
  const iceServers: RTCIceServer[] = [
    // Free public STUN servers
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
    // Additional free STUN servers for redundancy
    { urls: 'stun:stun.stunprotocol.org:3478' },
    { urls: 'stun:stun.voip.eutelia.it:3478' },
  ];

  // Add TURN server if configured via environment variables
  // TURN servers relay media when direct P2P connection fails
  const turnUrl = import.meta.env.VITE_TURN_SERVER_URL as string;
  const turnUsername = import.meta.env.VITE_TURN_SERVER_USERNAME as string;
  const turnCredential = import.meta.env.VITE_TURN_SERVER_CREDENTIAL as string;

  if (turnUrl && turnUsername && turnCredential) {
    iceServers.push({
      urls: turnUrl,
      username: turnUsername,
      credential: turnCredential
    });
    // Also add TURNS (TURN over TLS) if available
    if (turnUrl.includes(':443')) {
      iceServers.push({
        urls: turnUrl.replace('turn:', 'turns:'),
        username: turnUsername,
        credential: turnCredential
      });
    }
  } else {
    // Warn in development if TURN not configured
    if (import.meta.env.DEV) {
      console.warn('⚠️ No TURN server configured. Calls may fail behind NAT/firewalls. Set VITE_TURN_SERVER_URL, VITE_TURN_SERVER_USERNAME, and VITE_TURN_SERVER_CREDENTIAL in .env');
    }
  }

  // Free TURN servers for testing (not for production - limited bandwidth)
  // Uncomment these for testing if you don't have your own TURN server
  iceServers.push({
    urls: 'turn:openrelay.metered.ca:80',
    username: 'openrelayproject',
    credential: 'openrelayproject'
  });
  iceServers.push({
    urls: 'turn:openrelay.metered.ca:443',
    username: 'openrelayproject',
    credential: 'openrelayproject'
  });
  iceServers.push({
    urls: 'turn:openrelay.metered.ca:443?transport=tcp',
    username: 'openrelayproject',
    credential: 'openrelayproject'
  });

  return {
    iceServers,
    iceCandidatePoolSize: 10, // Pre-gather candidates for faster connection
  };
};

const ICE_SERVERS: RTCConfiguration = getIceServers();

export const callService = {
  /**
   * Initiate a call
   */
  async initiateCall(
    callerId: string,
    receiverId: string,
    callType: 'audio' | 'video'
  ): Promise<ServiceResult<CallSession>> {
    try {
      const { data, error } = await supabase
        .from('calls')
        .insert({
          caller_id: callerId,
          receiver_id: receiverId,
          call_type: callType,
          status: 'initiated'
        })
        .select()
        .single();

      if (error) {
        return { success: false, error: error.message };
      }

      supabase.from('notifications').insert({
        user_id: receiverId,
        actor_id: callerId,
        type: 'incoming_call',
        payload: { call_id: data.id, call_type: callType }
      }).then(() => {});

      return {
        success: true,
        data: {
          id: data.id,
          callerId: data.caller_id,
          receiverId: data.receiver_id,
          callType: data.call_type,
          status: data.status,
          startedAt: data.created_at
        }
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An error occurred';
      return { success: false, error: message };
    }
  },

  /**
   * Update call status
   */
  async updateCallStatus(
    callId: string,
    status: CallSession['status'],
    duration?: number
  ): Promise<ServiceResult> {
    try {
      const updateData: any = { status };

      if (status === 'ended' || status === 'missed' || status === 'declined') {
        updateData.ended_at = new Date().toISOString();
        if (duration !== undefined) {
          updateData.duration = duration;
        }
      }

      const { error } = await supabase
        .from('calls')
        .update(updateData)
        .eq('id', callId);

      if (error) {
        return { success: false, error: error.message };
      }

      return { success: true };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An error occurred';
      return { success: false, error: message };
    }
  },

  /**
   * Store WebRTC offer SDP
   */
  async storeOffer(callId: string, offerSdp: RTCSessionDescriptionInit): Promise<ServiceResult> {
    try {
      const { error } = await supabase
        .from('calls')
        .update({ offer_sdp: offerSdp, status: 'ringing' })
        .eq('id', callId);

      if (error) {
        return { success: false, error: error.message };
      }

      return { success: true };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An error occurred';
      return { success: false, error: message };
    }
  },

  /**
   * Store WebRTC answer SDP
   */
  async storeAnswer(callId: string, answerSdp: RTCSessionDescriptionInit): Promise<ServiceResult> {
    try {
      const { error } = await supabase
        .from('calls')
        .update({ answer_sdp: answerSdp, status: 'answered' })
        .eq('id', callId);

      if (error) {
        return { success: false, error: error.message };
      }

      return { success: true };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An error occurred';
      return { success: false, error: message };
    }
  },

  /**
   * Store ICE candidate
   */
  async storeIceCandidate(
    callId: string,
    fromUserId: string,
    candidate: RTCIceCandidateInit
  ): Promise<ServiceResult> {
    try {
      const { error } = await supabase
        .from('call_candidates')
        .insert({
          call_id: callId,
          from_user_id: fromUserId,
          candidate: candidate
        });

      if (error) {
        return { success: false, error: error.message };
      }

      return { success: true };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An error occurred';
      return { success: false, error: message };
    }
  },

  /**
   * Get call by ID
   */
  async getCall(callId: string): Promise<ServiceResult<CallSession>> {
    try {
      const { data, error } = await supabase
        .from('calls')
        .select('*')
        .eq('id', callId)
        .single();

      if (error) {
        return { success: false, error: error.message };
      }

      return {
        success: true,
        data: {
          id: data.id,
          callerId: data.caller_id,
          receiverId: data.receiver_id,
          callType: data.call_type,
          status: data.status,
          startedAt: data.created_at,
          endedAt: data.ended_at,
          duration: data.duration
        }
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An error occurred';
      return { success: false, error: message };
    }
  },

  /**
   * Get call history for a user
   */
  async getCallHistory(
    userId: string,
    limit = 50
  ): Promise<ServiceResult<CallHistory[]>> {
    try {
      const { data: calls, error } = await supabase
        .from('calls')
        .select('*')
        .or(`caller_id.eq.${userId},receiver_id.eq.${userId}`)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) {
        return { success: false, error: error.message };
      }

      if (!calls || calls.length === 0) {
        return { success: true, data: [] };
      }

      const userIds = new Set<string>();
      calls.forEach(call => {
        userIds.add(call.caller_id);
        userIds.add(call.receiver_id);
      });

      const { data: profiles } = await supabase
        .from('profiles')
        .select('*')
        .in('id', Array.from(userIds));

      const profileMap = new Map((profiles || []).map(p => [p.id, p as UserProfile]));

      const history: CallHistory[] = calls.map(call => {
        const isCaller = call.caller_id === userId;

        let status: CallHistory['status'] = 'answered';
        if (call.status === 'missed' || (call.status === 'ended' && !call.duration)) {
          status = isCaller ? 'missed' : 'missed';
        } else if (call.status === 'declined') {
          status = 'declined';
        }

        return {
          id: call.id,
          caller_id: call.caller_id,
          callee_id: call.receiver_id,
          call_type: call.call_type,
          status,
          duration: call.duration,
          started_at: call.created_at,
          ended_at: call.ended_at,
          caller_profile: profileMap.get(call.caller_id),
          callee_profile: profileMap.get(call.receiver_id)
        };
      });

      return { success: true, data: history };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An error occurred';
      return { success: false, error: message };
    }
  },

  /**
   * Create RTCPeerConnection with proper configuration
   */
  createPeerConnection(
    onIceCandidate: (candidate: RTCIceCandidate) => void,
    onTrack: (stream: MediaStream) => void,
    onConnectionStateChange?: (state: RTCPeerConnectionState) => void
  ): RTCPeerConnection {
    const pc = new RTCPeerConnection(ICE_SERVERS);

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        onIceCandidate(event.candidate);
      }
    };

    pc.ontrack = (event) => {
      if (event.streams && event.streams[0]) {
        onTrack(event.streams[0]);
      }
    };

    if (onConnectionStateChange) {
      pc.onconnectionstatechange = () => {
        onConnectionStateChange(pc.connectionState);
      };
    }

    return pc;
  },

  /**
   * Get user media stream
   */
  async getUserMedia(
    callType: 'audio' | 'video'
  ): Promise<ServiceResult<MediaStream>> {
    try {
      const constraints: MediaStreamConstraints = {
        audio: true,
        video: callType === 'video'
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      return { success: true, data: stream };
    } catch (err: any) {
      let errorMessage = 'Failed to access media devices';

      if (err.name === 'NotAllowedError') {
        errorMessage = 'Permission denied. Please allow camera/microphone access.';
      } else if (err.name === 'NotFoundError') {
        errorMessage = 'No camera or microphone found.';
      } else if (err.name === 'NotReadableError') {
        errorMessage = 'Camera or microphone is already in use.';
      }

      return { success: false, error: errorMessage };
    }
  },

  /**
   * Subscribe to incoming calls (simplified interface for App.tsx)
   */
  subscribeToIncomingCalls(
    userId: string,
    onIncomingCall: (call: CallSession & { offerSdp?: RTCSessionDescriptionInit }) => void
  ): () => void {
    const subscription = this.subscribeToCallEvents(userId, {
      onIncomingCall
    });
    return subscription.unsubscribe;
  },

  /**
   * Subscribe to call signaling events
   */
  subscribeToCallEvents(
    userId: string,
    callbacks: {
      onIncomingCall?: (call: CallSession & { offerSdp?: RTCSessionDescriptionInit }) => void;
      onCallAnswered?: (callId: string, answerSdp: RTCSessionDescriptionInit) => void;
      onCallEnded?: (callId: string) => void;
      onIceCandidate?: (callId: string, candidate: RTCIceCandidateInit) => void;
    }
  ) {
    const callChannel = supabase.channel(`calls_${userId}`);

    callChannel
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'calls',
          filter: `receiver_id=eq.${userId}`
        },
        (payload) => {
          const call = payload.new;
          callbacks.onIncomingCall?.({
            id: call.id,
            callerId: call.caller_id,
            receiverId: call.receiver_id,
            callType: call.call_type,
            status: call.status,
            startedAt: call.created_at,
            offerSdp: call.offer_sdp
          });
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'calls',
          filter: `caller_id=eq.${userId}`
        },
        (payload) => {
          const call = payload.new;

          if (call.status === 'answered' && call.answer_sdp) {
            callbacks.onCallAnswered?.(call.id, call.answer_sdp);
          } else if (call.status === 'ended' || call.status === 'declined' || call.status === 'missed') {
            callbacks.onCallEnded?.(call.id);
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'calls',
          filter: `receiver_id=eq.${userId}`
        },
        (payload) => {
          const call = payload.new;

          if (call.offer_sdp && call.status === 'ringing') {
            callbacks.onIncomingCall?.({
              id: call.id,
              callerId: call.caller_id,
              receiverId: call.receiver_id,
              callType: call.call_type,
              status: call.status,
              startedAt: call.created_at,
              offerSdp: call.offer_sdp
            });
          } else if (call.status === 'ended' || call.status === 'declined') {
            callbacks.onCallEnded?.(call.id);
          }
        }
      )
      .subscribe();

    const candidateChannel = supabase.channel(`call_candidates_${userId}`);

    candidateChannel
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'call_candidates'
        },
        async (payload) => {
          const candidate = payload.new;

          if (candidate.from_user_id !== userId) {
            const { data: call } = await supabase
              .from('calls')
              .select('caller_id, receiver_id')
              .eq('id', candidate.call_id)
              .single();

            if (call && (call.caller_id === userId || call.receiver_id === userId)) {
              callbacks.onIceCandidate?.(candidate.call_id, candidate.candidate);
            }
          }
        }
      )
      .subscribe();

    return {
      callChannel,
      candidateChannel,
      unsubscribe: () => {
        supabase.removeChannel(callChannel);
        supabase.removeChannel(candidateChannel);
      }
    };
  }
};
