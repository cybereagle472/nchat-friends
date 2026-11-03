/**
 * Group Call Service — WebRTC Signaling for group voice/video calls
 * (Cloudflare Worker backend).
 *
 * Mirrors callService.ts's shape and conventions exactly (apiFetch against
 * the Worker, events delivered over the shared per-user WebSocket), but
 * for worker/src/routes/groupCalls.ts's group-aware routes instead of
 * calls.ts's 1:1 ones. The actual WebRTC primitives (getUserMedia,
 * RTCPeerConnection, ICE server config, audio-bitrate tuning) are generic
 * and not 1:1-specific at all — GroupCallModal.tsx calls `callService`
 * directly for those instead of this module duplicating them.
 */

import { apiFetch } from '../lib/apiClient';
import { realtimeClient } from '../lib/realtimeClient';
import { UserProfile } from '../types';

export interface GroupCallParticipantBrief {
  userId: string;
  fullName: string;
  avatarUrl?: string;
}

export interface GroupCallSession {
  id: string;
  groupId: string;
  callerId: string;
  callType: 'audio' | 'video';
  status: 'active' | 'ended';
  startedAt: string;
  groupName?: string;
  groupAvatarUrl?: string;
  callerProfile?: UserProfile;
}

export interface ServiceResult<T = void> {
  success: boolean;
  data?: T;
  error?: string;
}

interface WireCall {
  id: string;
  group_id: string;
  caller_id: string;
  call_type: 'audio' | 'video';
  status: 'active' | 'ended';
  created_at: string;
  group_name?: string;
  group_avatar_url?: string;
  caller_profile?: UserProfile;
}

interface WireParticipant {
  user_id: string;
  full_name: string;
  avatar_url?: string;
}

function toSession(call: WireCall): GroupCallSession {
  return {
    id: call.id,
    groupId: call.group_id,
    callerId: call.caller_id,
    callType: call.call_type,
    status: call.status,
    startedAt: call.created_at,
    groupName: call.group_name,
    groupAvatarUrl: call.group_avatar_url,
    callerProfile: call.caller_profile,
  };
}

function toParticipants(rows: WireParticipant[]): GroupCallParticipantBrief[] {
  return rows.map((r) => ({ userId: r.user_id, fullName: r.full_name, avatarUrl: r.avatar_url }));
}

export const groupCallService = {
  /**
   * Start a call for this group, or — if the group already has one
   * running — transparently join it instead. Always the right call for
   * a "Call" button tap in a group chat; it never needs to know whether
   * someone beat it to starting the call.
   */
  async startOrJoinCall(
    groupId: string,
    callType: 'audio' | 'video'
  ): Promise<ServiceResult<{ call: GroupCallSession; participants: GroupCallParticipantBrief[] }>> {
    try {
      const { call, participants } = await apiFetch<{ call: WireCall; participants: WireParticipant[] }>('/group-calls', {
        method: 'POST',
        body: JSON.stringify({ group_id: groupId, call_type: callType }),
      });
      return { success: true, data: { call: toSession(call), participants: toParticipants(participants) } };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Failed to start group call' };
    }
  },

  /** Explicit accept of a ringing group call, or joining one already in progress. */
  async joinCall(
    callId: string
  ): Promise<ServiceResult<{ call: GroupCallSession; participants: GroupCallParticipantBrief[] }>> {
    try {
      const { call, participants } = await apiFetch<{ call: WireCall; participants: WireParticipant[] }>(
        `/group-calls/${callId}/join`,
        { method: 'POST' }
      );
      return { success: true, data: { call: toSession(call), participants: toParticipants(participants) } };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Failed to join group call' };
    }
  },

  async declineCall(callId: string): Promise<ServiceResult> {
    try {
      await apiFetch(`/group-calls/${callId}/decline`, { method: 'POST' });
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Failed to decline group call' };
    }
  },

  async leaveCall(callId: string): Promise<ServiceResult> {
    try {
      await apiFetch(`/group-calls/${callId}/leave`, { method: 'POST' });
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Failed to leave group call' };
    }
  },

  /**
   * Directed signal to exactly one other participant: an SDP offer/answer,
   * an ICE candidate, or `request_offer` — a joiner sends this to every
   * already-joined participant right after subscribing to call events, as
   * a guaranteed fallback alongside the server's own "someone joined"
   * notification to them (see groupCalls.ts's joinCall). That
   * notification alone has a real race: it can arrive before the
   * recipient's own join/start request has even round-tripped back to
   * finish subscribing, so it gets silently missed and no offer is ever
   * made. `request_offer` can't have that problem — whoever receives it
   * has necessarily been subscribed since *their own* join finished,
   * which already happened before this joiner could possibly exist.
   */
  async sendSignal(
    callId: string,
    to: string,
    signal: {
      offer_sdp?: RTCSessionDescriptionInit;
      answer_sdp?: RTCSessionDescriptionInit;
      candidate?: RTCIceCandidateInit;
      request_offer?: boolean;
    }
  ): Promise<ServiceResult> {
    try {
      await apiFetch(`/group-calls/${callId}/signal`, {
        method: 'POST',
        body: JSON.stringify({ to, ...signal }),
      });
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Failed to send signal' };
    }
  },

  /** Subscribe to incoming group calls (ring screen), app-wide — mirrors callService.subscribeToIncomingCalls. */
  subscribeToIncomingGroupCalls(onIncomingCall: (call: GroupCallSession) => void): () => void {
    const subscription = realtimeClient.on('group-call:incoming', (payload) => {
      const call = payload?.call;
      if (!call) return;
      onIncomingCall(toSession(call));
    });
    return subscription.unsubscribe;
  },

  /** Subscribe to every signaling/roster event for one specific call in progress. */
  subscribeToGroupCallEvents(
    callId: string,
    callbacks: {
      onParticipantJoined?: (userId: string) => void;
      onSignal?: (
        from: string,
        signal: { offer_sdp?: RTCSessionDescriptionInit; answer_sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit; request_offer?: boolean }
      ) => void;
      onParticipantLeft?: (userId: string) => void;
      onParticipantDeclined?: (userId: string) => void;
      onCallEnded?: () => void;
    }
  ): { unsubscribe: () => void } {
    const subs = [
      realtimeClient.on('group-call:participant-joined', (payload) => {
        if (payload?.call_id === callId && payload?.user_id) callbacks.onParticipantJoined?.(payload.user_id);
      }),
      realtimeClient.on('group-call:signal', (payload) => {
        if (payload?.call_id === callId && payload?.from) {
          callbacks.onSignal?.(payload.from, {
            offer_sdp: payload.offer_sdp,
            answer_sdp: payload.answer_sdp,
            candidate: payload.candidate,
            request_offer: payload.request_offer,
          });
        }
      }),
      realtimeClient.on('group-call:participant-left', (payload) => {
        if (payload?.call_id === callId && payload?.user_id) callbacks.onParticipantLeft?.(payload.user_id);
      }),
      realtimeClient.on('group-call:participant-declined', (payload) => {
        if (payload?.call_id === callId && payload?.user_id) callbacks.onParticipantDeclined?.(payload.user_id);
      }),
      realtimeClient.on('group-call:ended', (payload) => {
        if (payload?.call_id === callId) callbacks.onCallEnded?.();
      }),
    ];
    return { unsubscribe: () => subs.forEach((s) => s.unsubscribe()) };
  },
};
