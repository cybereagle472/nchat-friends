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

// Cloudflare mints short-lived (2 hour) TURN credentials via the Worker's
// GET /calls/turn-credentials (worker/src/routes/calls.ts) — the long-lived
// TURN key itself never reaches the browser. Cache the result in memory so
// a flurry of peer connections in the same session (mute/unmute-induced
// renegotiation, a redial, etc.) doesn't mint a fresh credential every
// single time; refresh a little before the real expiry rather than at
// the exact edge.
let cloudflareTurnCache: { iceServers: RTCIceServer[]; expiresAt: number } | null = null;

async function fetchCloudflareTurnServers(): Promise<RTCIceServer[]> {
  const now = Date.now();
  if (cloudflareTurnCache && cloudflareTurnCache.expiresAt > now) {
    return cloudflareTurnCache.iceServers;
  }
  try {
    const result = await apiFetch<{ iceServers: RTCIceServer[] | null }>('/calls/turn-credentials');
    if (!result.iceServers || result.iceServers.length === 0) return [];
    cloudflareTurnCache = { iceServers: result.iceServers, expiresAt: now + 100 * 60 * 1000 };
    return result.iceServers;
  } catch {
    // Not configured yet (CF_TURN_KEY_ID/CF_TURN_KEY_API_TOKEN unset on the
    // Worker), or Cloudflare's API was briefly unreachable — fall back
    // silently to the static STUN/TURN list below rather than failing the
    // call outright over a missing "nice to have".
    return [];
  }
}

// ICE Server configuration with STUN and TURN servers
// TURN servers are essential for calls behind NAT/firewalls
const getIceServers = async (): Promise<RTCConfiguration> => {
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

  // Cloudflare Realtime TURN, if the Worker has a TURN key configured —
  // this is the reliable relay for calls across different networks/NATs.
  iceServers.push(...(await fetchCloudflareTurnServers()));

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

// Tunes each sender's encoding so audio stays clear even when video is
// competing for the same (often limited, mobile) connection — without
// this, a congested link naturally lets video eat into the bandwidth
// audio needs, which shows up as choppy/garbled/noisy-sounding audio.
// Giving audio a healthy floor and explicit network priority, and capping
// video's ceiling, keeps voice quality consistent regardless of video.
function prioritizeAudioQuality(pc: RTCPeerConnection) {
  pc.getSenders().forEach((sender) => {
    if (!sender.track) return;
    try {
      const params = sender.getParameters();
      if (!params.encodings || params.encodings.length === 0) {
        params.encodings = [{}];
      }
      const encoding = params.encodings[0] as RTCRtpEncodingParameters & {
        priority?: string;
        networkPriority?: string;
      };
      if (sender.track.kind === 'audio') {
        encoding.maxBitrate = 64_000; // plenty of headroom for clear Opus voice
        encoding.priority = 'high';
        encoding.networkPriority = 'high';
      } else if (sender.track.kind === 'video') {
        encoding.maxBitrate = 900_000; // enough for a decent 720p picture, capped so it can't crowd out audio
        encoding.priority = 'medium';
        encoding.networkPriority = 'medium';
      }
      sender.setParameters(params).catch(() => {
        /* Some browsers reject setParameters before the first negotiation
           completes — harmless, the call still works without this tuning. */
      });
    } catch {
      // getParameters/setParameters encoding tuning isn't supported
      // everywhere (notably older WebViews) — nothing more to do here.
    }
  });
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
  /**
   * Re-balance sender bitrates so audio stays clear/smooth even when video
   * is competing for bandwidth. Call this once local tracks have actually
   * been added to the peer connection.
   */
  prioritizeAudioQuality(pc: RTCPeerConnection) {
    prioritizeAudioQuality(pc);
  },

  async createPeerConnection(
    onIceCandidate: (candidate: RTCIceCandidate) => void,
    onTrack: (stream: MediaStream) => void,
    onConnectionStateChange?: (state: RTCPeerConnectionState) => void
  ): Promise<RTCPeerConnection> {
    const pc = new RTCPeerConnection(await getIceServers());

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
      // Plain `audio: true` leaves it up to the browser/OS whether to
      // actually apply noise suppression, echo cancellation and gain
      // control (defaults vary a lot across Android OEMs/browsers — some
      // ship fairly weak defaults). Asking for all three explicitly as
      // `ideal` gets the strongest available processing without failing
      // the call on a device that can't honor one of them. The legacy
      // `goog*` properties are non-standard Chrome-only extensions that
      // tend to meaningfully improve mobile mic quality further where
      // they're supported; unsupported properties are simply ignored
      // rather than rejected, so this is safe everywhere else.
      const constraints: MediaStreamConstraints = {
        audio: {
          echoCancellation: { ideal: true },
          noiseSuppression: { ideal: true },
          autoGainControl: { ideal: true },
          channelCount: { ideal: 1 },
          ...({
            googEchoCancellation: true,
            googNoiseSuppression: true,
            googAutoGainControl: true,
            googHighpassFilter: true,
            googTypingNoiseDetection: true,
          } as MediaTrackConstraints),
        },
        video: callType === 'video'
          ? {
              width: { ideal: 1280 },
              height: { ideal: 720 },
              frameRate: { ideal: 30, max: 30 },
            }
          : false,
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
