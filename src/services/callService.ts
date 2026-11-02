/**
 * Call Service — WebRTC Signaling (Cloudflare Worker backend)
 *
 * Mirrors groupService.ts's shape and conventions: apiFetch against the
 * Worker's /calls routes (worker/src/routes/calls.ts) for creating calls,
 * answering, forwarding ICE candidates and ending calls, with signaling
 * events delivered over the single shared per-user WebSocket
 * (src/lib/realtimeClient.ts) instead of polling a database table.
 *
 * The actual WebRTC plumbing (getUserMedia, RTCPeerConnection) is pure
 * browser API and unaffected by the backend — only the signaling
 * transport changed.
 */

import { apiFetch, getCurrentUserId } from '../lib/apiClient';
import { realtimeClient } from '../lib/realtimeClient';
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
  offerSdp?: RTCSessionDescriptionInit;
  callerProfile?: UserProfile;
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
  } else if (import.meta.env.DEV) {
    // Warn in development if TURN not configured
    console.warn('⚠️ No TURN server configured. Calls may fail behind NAT/firewalls. Set VITE_TURN_SERVER_URL, VITE_TURN_SERVER_USERNAME, and VITE_TURN_SERVER_CREDENTIAL in .env');
  }

  // Free TURN servers for testing (not for production - limited bandwidth)
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

// Wire shape returned by GET /calls/history (see worker/src/routes/calls.ts).
interface WireCallHistoryRow {
  id: string;
  caller_id: string;
  receiver_id: string;
  call_type: 'audio' | 'video';
  status: string;
  duration: number | null;
  created_at: string;
  ended_at: string | null;
  other_profile?: UserProfile;
}

export const callService = {
  /**
   * Initiate a call. The offer must already be created (createPeerConnection
   * + createOffer) before calling this, so the whole thing is a single
   * request — the callee's incoming-call event arrives with the offer
   * already attached, no separate "store the offer" round trip needed.
   */
  async initiateCall(
    receiverId: string,
    callType: 'audio' | 'video',
    offerSdp: RTCSessionDescriptionInit
  ): Promise<ServiceResult<CallSession>> {
    try {
      const { call } = await apiFetch<{ call: { id: string; caller_id: string; receiver_id: string; call_type: string; status: string; created_at: string } }>(
        '/calls',
        {
          method: 'POST',
          body: JSON.stringify({ receiver_id: receiverId, call_type: callType, offer_sdp: offerSdp }),
        }
      );
      return {
        success: true,
        data: {
          id: call.id,
          callerId: call.caller_id,
          receiverId: call.receiver_id,
          callType: call.call_type as 'audio' | 'video',
          status: call.status as CallSession['status'],
          startedAt: call.created_at,
        },
      };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Failed to start call' };
    }
  },

  /** Callee answers: send our SDP answer back to the caller. */
  async answerCall(callId: string, answerSdp: RTCSessionDescriptionInit): Promise<ServiceResult> {
    try {
      await apiFetch(`/calls/${callId}/answer`, {
        method: 'POST',
        body: JSON.stringify({ answer_sdp: answerSdp }),
      });
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Failed to answer call' };
    }
  },

  /** Forward an ICE candidate (or any other signal) to the other participant. */
  async sendIceCandidate(callId: string, candidate: RTCIceCandidateInit): Promise<ServiceResult> {
    try {
      await apiFetch(`/calls/${callId}/signal`, {
        method: 'POST',
        body: JSON.stringify({ candidate }),
      });
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Failed to send signal' };
    }
  },

  /** End, decline, or mark a call missed — status is one of 'ended' | 'declined' | 'missed'. */
  async endCall(callId: string, status: 'ended' | 'declined' | 'missed' = 'ended', duration?: number): Promise<ServiceResult> {
    try {
      await apiFetch(`/calls/${callId}/end`, {
        method: 'POST',
        body: JSON.stringify({ status, duration }),
      });
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Failed to end call' };
    }
  },

  /** Get call history for the current user. */
  async getCallHistory(limit = 50): Promise<ServiceResult<CallHistory[]>> {
    try {
      const { history } = await apiFetch<{ history: WireCallHistoryRow[] }>(`/calls/history?limit=${limit}`);
      const myId = getCurrentUserId();
      const data: CallHistory[] = history.map((call) => {
        let status: CallHistory['status'] = 'answered';
        if (call.status === 'declined') status = 'declined';
        else if (call.status === 'missed' || (call.status === 'ended' && !call.duration)) status = 'missed';

        // other_profile is always "the other participant" — map it onto
        // whichever side of caller/callee that actually is for this row.
        const isCaller = call.caller_id === myId;

        return {
          id: call.id,
          caller_id: call.caller_id,
          callee_id: call.receiver_id,
          // CallHistory/HistoryItem use 'voice', while the signaling layer
          // (and the DB column) uses 'audio' — normalize here so filters
          // and icons downstream (History.tsx) match correctly.
          call_type: call.call_type === 'audio' ? 'voice' : 'video',
          status,
          duration: call.duration ?? undefined,
          started_at: call.created_at,
          ended_at: call.ended_at ?? undefined,
          caller_profile: isCaller ? undefined : call.other_profile,
          callee_profile: isCaller ? call.other_profile : undefined,
        };
      });
      return { success: true, data };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Failed to load call history' };
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
      // `connectionState` (combined ICE + DTLS state) is the modern,
      // preferred signal, but it's a newer addition to the spec than
      // `iceConnectionState` and isn't equally reliable everywhere — on
      // some mobile browsers/WebViews it can sit on 'connecting' and never
      // actually flip to 'connected' even once media is already flowing,
      // which is exactly what leaves the call UI stuck on "Connecting..."
      // forever with nothing actually wrong with the call itself. Watching
      // `iceConnectionState` too and reporting whichever of the two
      // reaches a terminal state first means the UI still updates
      // correctly even on a browser where `connectionState` alone never
      // fires.
      const reportState = () => {
        const cs = pc.connectionState;
        const ics = pc.iceConnectionState;
        if (cs === 'connected' || ics === 'connected' || ics === 'completed') {
          onConnectionStateChange('connected');
        } else if (cs === 'failed' || ics === 'failed') {
          onConnectionStateChange('failed');
        } else if (cs === 'disconnected' || ics === 'disconnected') {
          onConnectionStateChange('disconnected');
        } else {
          onConnectionStateChange(cs);
        }
      };
      pc.onconnectionstatechange = reportState;
      pc.oniceconnectionstatechange = reportState;
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
   * Subscribe to incoming calls (simplified interface for App.tsx). Returns
   * an unsubscribe function.
   */
  subscribeToIncomingCalls(
    onIncomingCall: (call: CallSession) => void
  ): () => void {
    const subscription = realtimeClient.on('call:incoming', (payload) => {
      const call = payload?.call;
      if (!call) return;
      onIncomingCall({
        id: call.id,
        callerId: call.caller_id,
        receiverId: call.receiver_id,
        callType: call.call_type,
        status: call.status,
        startedAt: call.created_at,
        offerSdp: call.offer_sdp,
        callerProfile: call.caller_profile,
      });
    });
    return subscription.unsubscribe;
  },

  /**
   * Subscribe to signaling events for a specific call in progress.
   */
  subscribeToCallEvents(callbacks: {
    onCallAnswered?: (callId: string, answerSdp: RTCSessionDescriptionInit) => void;
    onCallEnded?: (callId: string, status: string) => void;
    onIceCandidate?: (callId: string, candidate: RTCIceCandidateInit) => void;
  }): { unsubscribe: () => void } {
    const subs = [
      realtimeClient.on('call:answered', (payload) => {
        if (payload?.callId && payload?.answer_sdp) callbacks.onCallAnswered?.(payload.callId, payload.answer_sdp);
      }),
      realtimeClient.on('call:signal', (payload) => {
        if (payload?.callId && payload?.candidate) callbacks.onIceCandidate?.(payload.callId, payload.candidate);
      }),
      realtimeClient.on('call:ended', (payload) => {
        if (payload?.callId) callbacks.onCallEnded?.(payload.callId, payload.status);
      }),
    ];
    return { unsubscribe: () => subs.forEach((s) => s.unsubscribe()) };
  }
};
