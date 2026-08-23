/**
 * Group Call Service
 * Supports up to 8 participants using WebRTC mesh network
 * Uses Supabase Realtime for signaling (FREE)
 * Uses free STUN servers, optional TURN for NAT traversal
 */

import { supabase } from '../supabaseClient';
import { UserProfile } from '../types';

// Free STUN servers (Google, Twilio)
const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
  { urls: 'stun:stun4.l.google.com:19302' },
  { urls: 'stun:global.stun.twilio.com:3478' }
];

export type CallType = 'audio' | 'video';
export type ParticipantState = 'connecting' | 'connected' | 'disconnected' | 'failed';

export interface GroupCallParticipant {
  id: string;
  profile: UserProfile;
  state: ParticipantState;
  stream?: MediaStream;
  isMuted: boolean;
  isVideoOff: boolean;
  isSpeaking: boolean;
}

export interface GroupCall {
  id: string;
  groupId: string;
  type: CallType;
  hostId: string;
  participants: Map<string, GroupCallParticipant>;
  startedAt: string;
  isActive: boolean;
}

type SignalType = 'offer' | 'answer' | 'ice-candidate' | 'join' | 'leave' | 'mute' | 'video-off';

interface SignalMessage {
  type: SignalType;
  from: string;
  to?: string;
  payload?: any;
}

class GroupCallService {
  private currentCall: GroupCall | null = null;
  private localStream: MediaStream | null = null;
  private peerConnections: Map<string, RTCPeerConnection> = new Map();
  private signalingChannel: any = null;
  private onParticipantChange?: (participants: GroupCallParticipant[]) => void;
  private onCallEnd?: () => void;
  private currentUserId: string = '';

  private readonly MAX_PARTICIPANTS = 8;

  /**
   * Initialize a group call
   */
  async initializeCall(
    groupId: string,
    userId: string,
    userProfile: UserProfile,
    callType: CallType,
    onParticipantChange: (participants: GroupCallParticipant[]) => void,
    onCallEnd: () => void
  ): Promise<{ success: boolean; callId?: string; error?: string }> {
    try {
      this.currentUserId = userId;
      this.onParticipantChange = onParticipantChange;
      this.onCallEnd = onCallEnd;

      // Get local media stream
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: callType === 'video'
      });

      // Create call ID
      const callId = `${groupId}_${Date.now()}`;

      // Initialize call object
      this.currentCall = {
        id: callId,
        groupId,
        type: callType,
        hostId: userId,
        participants: new Map(),
        startedAt: new Date().toISOString(),
        isActive: true
      };

      // Add self as participant
      this.currentCall.participants.set(userId, {
        id: userId,
        profile: userProfile,
        state: 'connected',
        stream: this.localStream,
        isMuted: false,
        isVideoOff: false,
        isSpeaking: false
      });

      // Setup signaling channel
      await this.setupSignaling(callId, userId);

      // Announce join
      await this.sendSignal({
        type: 'join',
        from: userId,
        payload: { profile: userProfile, callType }
      });

      // Save call to database
      await supabase.from('group_calls').insert({
        id: callId,
        group_id: groupId,
        host_id: userId,
        call_type: callType,
        started_at: this.currentCall.startedAt,
        is_active: true
      });

      this.notifyParticipantChange();

      return { success: true, callId };
    } catch (error: any) {
      console.error('Failed to initialize call:', error);
      this.cleanup();
      return { success: false, error: error.message };
    }
  }

  /**
   * Join an existing call
   */
  async joinCall(
    callId: string,
    userId: string,
    userProfile: UserProfile,
    onParticipantChange: (participants: GroupCallParticipant[]) => void,
    onCallEnd: () => void
  ): Promise<{ success: boolean; error?: string }> {
    try {
      this.currentUserId = userId;
      this.onParticipantChange = onParticipantChange;
      this.onCallEnd = onCallEnd;

      // Get call info
      const { data: callData, error: callError } = await supabase
        .from('group_calls')
        .select('*')
        .eq('id', callId)
        .single();

      if (callError || !callData) {
        return { success: false, error: 'Call not found' };
      }

      if (!callData.is_active) {
        return { success: false, error: 'Call has ended' };
      }

      // Get local media
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: callData.call_type === 'video'
      });

      // Initialize call object
      this.currentCall = {
        id: callId,
        groupId: callData.group_id,
        type: callData.call_type,
        hostId: callData.host_id,
        participants: new Map(),
        startedAt: callData.started_at,
        isActive: true
      };

      // Add self as participant
      this.currentCall.participants.set(userId, {
        id: userId,
        profile: userProfile,
        state: 'connected',
        stream: this.localStream,
        isMuted: false,
        isVideoOff: false,
        isSpeaking: false
      });

      // Setup signaling
      await this.setupSignaling(callId, userId);

      // Announce join to existing participants
      await this.sendSignal({
        type: 'join',
        from: userId,
        payload: { profile: userProfile, callType: callData.call_type }
      });

      this.notifyParticipantChange();

      return { success: true };
    } catch (error: any) {
      console.error('Failed to join call:', error);
      this.cleanup();
      return { success: false, error: error.message };
    }
  }

  /**
   * Setup Supabase Realtime for signaling
   */
  private async setupSignaling(callId: string, _userId: string): Promise<void> {
    this.signalingChannel = supabase.channel(`group-call:${callId}`, {
      config: { broadcast: { self: false } }
    });

    this.signalingChannel
      .on('broadcast', { event: 'signal' }, async ({ payload }: { payload: SignalMessage }) => {
        await this.handleSignal(payload);
      })
      .subscribe();
  }

  /**
   * Send signal to other participants
   */
  private async sendSignal(message: SignalMessage): Promise<void> {
    if (!this.signalingChannel) return;

    await this.signalingChannel.send({
      type: 'broadcast',
      event: 'signal',
      payload: message
    });
  }

  /**
   * Handle incoming signals
   */
  private async handleSignal(message: SignalMessage): Promise<void> {
    if (!this.currentCall) return;

    // Ignore messages to specific users if not meant for us
    if (message.to && message.to !== this.currentUserId) return;

    switch (message.type) {
      case 'join':
        await this.handleParticipantJoin(message.from, message.payload);
        break;

      case 'leave':
        this.handleParticipantLeave(message.from);
        break;

      case 'offer':
        await this.handleOffer(message.from, message.payload);
        break;

      case 'answer':
        await this.handleAnswer(message.from, message.payload);
        break;

      case 'ice-candidate':
        await this.handleIceCandidate(message.from, message.payload);
        break;

      case 'mute':
        this.handleMuteChange(message.from, message.payload.isMuted);
        break;

      case 'video-off':
        this.handleVideoChange(message.from, message.payload.isVideoOff);
        break;
    }
  }

  /**
   * Handle new participant joining
   */
  private async handleParticipantJoin(
    peerId: string,
    payload: { profile: UserProfile; callType: CallType }
  ): Promise<void> {
    if (!this.currentCall || this.currentCall.participants.size >= this.MAX_PARTICIPANTS) return;

    // Add participant
    this.currentCall.participants.set(peerId, {
      id: peerId,
      profile: payload.profile,
      state: 'connecting',
      isMuted: false,
      isVideoOff: false,
      isSpeaking: false
    });

    // Create peer connection and send offer
    await this.createPeerConnection(peerId);
    await this.createAndSendOffer(peerId);

    this.notifyParticipantChange();
  }

  /**
   * Handle participant leaving
   */
  private handleParticipantLeave(peerId: string): void {
    if (!this.currentCall) return;

    // Close peer connection
    const pc = this.peerConnections.get(peerId);
    if (pc) {
      pc.close();
      this.peerConnections.delete(peerId);
    }

    // Remove participant
    this.currentCall.participants.delete(peerId);
    this.notifyParticipantChange();

    // If no participants left, end call
    if (this.currentCall.participants.size <= 1) {
      this.endCall();
    }
  }

  /**
   * Create WebRTC peer connection
   */
  private async createPeerConnection(peerId: string): Promise<RTCPeerConnection> {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    // Add local tracks
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        pc.addTrack(track, this.localStream!);
      });
    }

    // Handle remote tracks
    pc.ontrack = (event) => {
      const participant = this.currentCall?.participants.get(peerId);
      if (participant) {
        participant.stream = event.streams[0];
        participant.state = 'connected';
        this.notifyParticipantChange();
      }
    };

    // Handle ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendSignal({
          type: 'ice-candidate',
          from: this.currentUserId,
          to: peerId,
          payload: event.candidate
        });
      }
    };

    // Handle connection state changes
    pc.onconnectionstatechange = () => {
      const participant = this.currentCall?.participants.get(peerId);
      if (participant) {
        switch (pc.connectionState) {
          case 'connected':
            participant.state = 'connected';
            break;
          case 'disconnected':
          case 'failed':
            participant.state = pc.connectionState;
            break;
        }
        this.notifyParticipantChange();
      }
    };

    this.peerConnections.set(peerId, pc);
    return pc;
  }

  /**
   * Create and send offer
   */
  private async createAndSendOffer(peerId: string): Promise<void> {
    const pc = this.peerConnections.get(peerId);
    if (!pc) return;

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    await this.sendSignal({
      type: 'offer',
      from: this.currentUserId,
      to: peerId,
      payload: offer
    });
  }

  /**
   * Handle incoming offer
   */
  private async handleOffer(peerId: string, offer: RTCSessionDescriptionInit): Promise<void> {
    let pc = this.peerConnections.get(peerId);
    if (!pc) {
      pc = await this.createPeerConnection(peerId);
    }

    await pc.setRemoteDescription(offer);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    await this.sendSignal({
      type: 'answer',
      from: this.currentUserId,
      to: peerId,
      payload: answer
    });
  }

  /**
   * Handle incoming answer
   */
  private async handleAnswer(peerId: string, answer: RTCSessionDescriptionInit): Promise<void> {
    const pc = this.peerConnections.get(peerId);
    if (!pc) return;

    await pc.setRemoteDescription(answer);
  }

  /**
   * Handle ICE candidate
   */
  private async handleIceCandidate(peerId: string, candidate: RTCIceCandidateInit): Promise<void> {
    const pc = this.peerConnections.get(peerId);
    if (!pc) return;

    await pc.addIceCandidate(candidate);
  }

  /**
   * Handle mute status change
   */
  private handleMuteChange(peerId: string, isMuted: boolean): void {
    const participant = this.currentCall?.participants.get(peerId);
    if (participant) {
      participant.isMuted = isMuted;
      this.notifyParticipantChange();
    }
  }

  /**
   * Handle video status change
   */
  private handleVideoChange(peerId: string, isVideoOff: boolean): void {
    const participant = this.currentCall?.participants.get(peerId);
    if (participant) {
      participant.isVideoOff = isVideoOff;
      this.notifyParticipantChange();
    }
  }

  /**
   * Toggle mute
   */
  async toggleMute(): Promise<boolean> {
    if (!this.localStream || !this.currentCall) return false;

    const audioTracks = this.localStream.getAudioTracks();
    const newMuteState = !audioTracks[0]?.enabled;

    audioTracks.forEach(track => {
      track.enabled = !newMuteState;
    });

    const participant = this.currentCall.participants.get(this.currentUserId);
    if (participant) {
      participant.isMuted = newMuteState;
    }

    await this.sendSignal({
      type: 'mute',
      from: this.currentUserId,
      payload: { isMuted: newMuteState }
    });

    this.notifyParticipantChange();
    return newMuteState;
  }

  /**
   * Toggle video
   */
  async toggleVideo(): Promise<boolean> {
    if (!this.localStream || !this.currentCall) return false;

    const videoTracks = this.localStream.getVideoTracks();
    const newVideoOffState = videoTracks[0]?.enabled ?? false;

    videoTracks.forEach(track => {
      track.enabled = !newVideoOffState;
    });

    const participant = this.currentCall.participants.get(this.currentUserId);
    if (participant) {
      participant.isVideoOff = newVideoOffState;
    }

    await this.sendSignal({
      type: 'video-off',
      from: this.currentUserId,
      payload: { isVideoOff: newVideoOffState }
    });

    this.notifyParticipantChange();
    return newVideoOffState;
  }

  /**
   * Leave the call
   */
  async leaveCall(): Promise<void> {
    await this.sendSignal({
      type: 'leave',
      from: this.currentUserId
    });

    this.cleanup();
  }

  /**
   * End the call (host only)
   */
  async endCall(): Promise<void> {
    if (!this.currentCall) return;

    // Update database
    await supabase
      .from('group_calls')
      .update({
        is_active: false,
        ended_at: new Date().toISOString()
      })
      .eq('id', this.currentCall.id);

    await this.sendSignal({
      type: 'leave',
      from: this.currentUserId
    });

    this.cleanup();
    this.onCallEnd?.();
  }

  /**
   * Get current call
   */
  getCurrentCall(): GroupCall | null {
    return this.currentCall;
  }

  /**
   * Get local stream
   */
  getLocalStream(): MediaStream | null {
    return this.localStream;
  }

  /**
   * Cleanup resources
   */
  private cleanup(): void {
    // Close all peer connections
    this.peerConnections.forEach(pc => pc.close());
    this.peerConnections.clear();

    // Stop local stream
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }

    // Unsubscribe from signaling
    if (this.signalingChannel) {
      supabase.removeChannel(this.signalingChannel);
      this.signalingChannel = null;
    }

    this.currentCall = null;
  }

  /**
   * Notify participant change
   */
  private notifyParticipantChange(): void {
    if (!this.currentCall || !this.onParticipantChange) return;

    const participants = Array.from(this.currentCall.participants.values());
    this.onParticipantChange(participants);
  }
}

export const groupCallService = new GroupCallService();
export default groupCallService;
