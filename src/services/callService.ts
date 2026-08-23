/**
 * Call Service - Convex-backed WebRTC call management.
 * Same public surface as the original Supabase service. Signaling flows
 * through the Convex calls/callSignals tables (polling replaces realtime).
 */

import { api, convex } from '../lib/convexClient';
import { CallHistory } from '../types';

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
}

export interface ServiceResult<T = void> {
  success: boolean;
  data?: T;
  error?: string;
}

const ICE_SERVERS: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
];

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function ensureConversation(
  userId: string,
  otherId: string
): Promise<string | null> {
  try {
    return await convex.mutation(api.conversations.getOrCreate, {
      otherUserId: otherId as never,
    });
  } catch {
    return null;
  }
}

async function signalCall(
  callId: string,
  toId: string | undefined,
  kind: string,
  payload: unknown
): Promise<ServiceResult> {
  try {
    await convex.mutation(api.calls.signal, {
      callId: callId as never,
      toId: (toId ?? undefined) as never,
      kind,
      payload: JSON.stringify(payload),
    });
    return { success: true };
  } catch (err) {
    return { success: false, error: errMsg(err) };
  }
}

export const callService = {
  async initiateCall(
    callerId: string,
    receiverId: string,
    callType: 'audio' | 'video'
  ): Promise<ServiceResult<CallSession>> {
    try {
      const conversationId = await ensureConversation(callerId, receiverId);
      if (!conversationId) {
        return { success: false, error: 'Could not open a conversation for this call' };
      }
      const callId = await convex.mutation(api.calls.start, {
        conversationId: conversationId as never,
        type: callType,
      });
      return {
        success: true,
        data: {
          id: callId,
          callerId,
          receiverId,
          callType,
          status: 'ringing',
          startedAt: new Date().toISOString(),
        },
      };
    } catch (err) {
      return { success: false, error: errMsg(err) };
    }
  },

  async updateCallStatus(
    callId: string,
    status: CallSession['status'],
    _duration?: number
  ): Promise<ServiceResult> {
    try {
      if (status === 'declined') {
        await convex.mutation(api.calls.decline, { callId: callId as never });
      } else if (
        status === 'ended' ||
        status === 'missed'
      ) {
        // Answer first if we never joined, so `end` is allowed.
        await convex
          .mutation(api.calls.join, { callId: callId as never })
          .catch(() => undefined);
        await convex.mutation(api.calls.end, { callId: callId as never });
      } else if (status === 'answered') {
        await convex.mutation(api.calls.join, { callId: callId as never });
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: errMsg(err) };
    }
  },

  async storeOffer(
    callId: string,
    offerSdp: RTCSessionDescriptionInit
  ): Promise<ServiceResult> {
    return signalCall(callId, undefined, 'offer', offerSdp);
  },

  async storeAnswer(
    callId: string,
    answerSdp: RTCSessionDescriptionInit
  ): Promise<ServiceResult> {
    return signalCall(callId, undefined, 'answer', answerSdp);
  },

  async storeIceCandidate(
    callId: string,
    fromUserId: string,
    candidate: RTCIceCandidateInit
  ): Promise<ServiceResult> {
    void fromUserId; // server stamps the sender
    return signalCall(callId, undefined, 'ice', candidate);
  },

  async getCall(callId: string): Promise<ServiceResult<CallSession>> {
    try {
      const raw = await convex.query(api.calls.get, { callId: callId as never });
      if (!raw) return { success: false, error: 'Call not found' };
      const r = raw as Record<string, unknown>;
      const startedAt = r.startedAt as number;
      return {
        success: true,
        data: {
          id: r._id as string,
          callerId: r.initiatorId as string,
          receiverId:
            ((r.participantIds as string[]) ?? []).find(
              (id) => id !== r.initiatorId
            ) ?? '',
          callType: r.type as 'audio' | 'video',
          status: (r.status as string) === 'active' ? 'answered' : (r.status as CallSession['status']),
          startedAt: new Date(startedAt).toISOString(),
        },
      };
    } catch (err) {
      return { success: false, error: errMsg(err) };
    }
  },

  async getCallHistory(
    _userId: string,
    limit = 50
  ): Promise<ServiceResult<CallHistory[]>> {
    try {
      const raw = await convex.query(api.calls.history, {});
      return { success: true, data: (raw as CallHistory[]).slice(0, limit) };
    } catch (err) {
      return { success: false, error: errMsg(err) };
    }
  },

  createPeerConnection(
    onIceCandidate: (candidate: RTCIceCandidate) => void,
    onRemoteStream?: (stream: MediaStream) => void,
    onStateChange?: (state: RTCPeerConnectionState) => void
  ): RTCPeerConnection {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    pc.onicecandidate = (event) => {
      if (event.candidate) onIceCandidate(event.candidate);
    };

    pc.ontrack = (event) => {
      if (onRemoteStream && event.streams[0]) {
        onRemoteStream(event.streams[0]);
      }
    };

    pc.onconnectionstatechange = () => {
      onStateChange?.(pc.connectionState);
    };

    return pc;
  },

  async getUserMedia(
    callType: 'audio' | 'video'
  ): Promise<ServiceResult<MediaStream>> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: callType === 'video',
      });
      return { success: true, data: stream };
    } catch (err) {
      return { success: false, error: errMsg(err) || 'Media permission denied' };
    }
  },

  subscribeToIncomingCalls(
    userId: string,
    onIncomingCall: (
      call: CallSession & { offerSdp?: RTCSessionDescriptionInit }
    ) => void
  ): () => void {
    const sub = this.subscribeToCallEvents(userId, { onIncomingCall });
    return sub.unsubscribe;
  },

  subscribeToCallEvents(
    userId: string,
    callbacks: {
      onIncomingCall?: (
        call: CallSession & { offerSdp?: RTCSessionDescriptionInit }
      ) => void;
      onCallAnswered?: (callId: string, answerSdp: RTCSessionDescriptionInit) => void;
      onCallEnded?: (callId: string) => void;
      onIceCandidate?: (callId: string, candidate: RTCIceCandidateInit) => void;
    }
  ): { unsubscribe: () => void } {
    let stopped = false;
    let seenSignals = new Set<string>();
    let knownCalls = new Map<
      string,
      { status: string; participants: string[] }
    >();
    let firstRun = true;

    const poll = async () => {
      if (stopped) return;
      try {
        // 1. Incoming / ongoing calls involving me
        const current = await convex.query(api.calls.current, {});
        if (current) {
          const c = current as unknown as {
            call: {
              _id: string;
              type: 'audio' | 'video';
              status: string;
              initiatorId: string;
              participantIds: string[];
              startedAt: number;
            };
            hasJoined: boolean;
          };
          const call = c.call;

          if (!firstRun && !knownCalls.has(call._id)) {
            // New call appeared — ring if I'm not the initiator and haven't joined.
            if (call.initiatorId !== userId && !c.hasJoined) {
              callbacks.onIncomingCall?.({
                id: call._id,
                callerId: call.initiatorId,
                receiverId: userId,
                callType: call.type,
                status: 'ringing',
                startedAt: new Date(call.startedAt).toISOString(),
              });
            }
          }

          // 2. Fetch signaling payloads for this call
          if (
            c.hasJoined ||
            knownCalls.has(call._id)
          ) {
            const signals = (await convex.query(api.calls.signals, {
              callId: call._id as never,
              since: Date.now() - 60_000,
            })) as unknown as Array<{
              _id: string;
              fromId: string;
              kind: string;
              payload: string;
            }>;
            for (const s of signals) {
              if (s.fromId === userId) continue;
              const key = s._id;
              if (seenSignals.has(key)) continue;
              seenSignals.add(key);
              let parsed: unknown;
              try {
                parsed = JSON.parse(s.payload);
              } catch {
                continue;
              }
              if (s.kind === 'answer') {
                callbacks.onCallAnswered?.(call._id, parsed as RTCSessionDescriptionInit);
              } else if (s.kind === 'ice') {
                callbacks.onIceCandidate?.(call._id, parsed as RTCIceCandidateInit);
              }
            }
          }

          // Detect ended state transitions
          const prev = knownCalls.get(call._id);
          if (prev && prev.status !== 'ended' && call.status === 'ended') {
            callbacks.onCallEnded?.(call._id);
          }
          knownCalls.set(call._id, {
            status: call.status,
            participants: call.participantIds,
          });
        }

        // Detect ended calls we knew about that no longer show up in current()
        if (!firstRun && current === null) {
          for (const [callId] of knownCalls) {
            callbacks.onCallEnded?.(callId);
          }
          knownCalls.clear();
        }
        firstRun = false;
      } catch {
        /* ignore polling errors */
      }
    };

    poll();
    const interval = setInterval(poll, 1200);
    return {
      unsubscribe: () => {
        stopped = true;
        clearInterval(interval);
      },
    };
  },
};
