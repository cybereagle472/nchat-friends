import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  ArrowLeft,
  Phone,
  Video,
  Send,
  Plus,
  Image as ImageIcon,
  Film,
  FileText,
  Mic,
  Play,
  Pause,
  Lock,
  ChevronLeft,
  ChevronUp,
  Users,
  Clock,
  Check,
  CheckCheck,
  X,
  Trash2
} from 'lucide-react';
import { useGroupChat, GroupMessageWithStatus } from '../hooks/useGroupChat';
import { GroupWithMembers, groupService } from '../services/groupService';
import { UserProfile, GroupMessage } from '../types';
import LowPolyBackground from './LowPolyBackground';
import { mediaService } from '../services/mediaService';
import { VoiceMessageBubble, DocumentBubble, downsampleWaveform } from './ChatView';
import { GroupMessageActions, GroupReactionsDisplay } from './GroupMessageActions';
import { useKeyboardInset } from '../hooks/useKeyboardInset';
import { typingService } from '../services/typingService';

// Tiny debounce helper — same shape as the one ChatView.tsx keeps privately,
// duplicated here rather than shared so the two screens' typing/recording
// wiring stay fully independent (same reasoning as the voice-recording
// gesture system above).
function debounce<T extends (...args: never[]) => void>(fn: T, delay: number): T {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  return ((...args: Parameters<T>) => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => fn(...args), delay);
  }) as T;
}

// Voice Recording State — mirrors ChatView's VoiceRecordingState exactly
// (see ChatView.tsx for the full, heavily-commented history of this
// gesture system; duplicated here deliberately rather than shared via a
// hook, to avoid risking regressions in the already-proven 1:1 version).
interface VoiceRecordingState {
  isRecording: boolean;
  isPaused: boolean;
  duration: number;
  isLocked: boolean;
  isCancelling: boolean;
  startX: number;
  currentX: number;
  waveformData: number[];
  lockProgress: number;
}

interface MediaViewerState {
  isOpen: boolean;
  type: 'image' | 'video' | null;
  url: string;
}

interface GroupChatViewProps {
  currentUser: UserProfile;
  group: GroupWithMembers;
  onBack: () => void;
  onGroupCall?: (type: 'voice' | 'video') => void;
  onManageGroup: () => void;
}

export function GroupChatView({ currentUser, group, onBack, onGroupCall, onManageGroup }: GroupChatViewProps) {
  const [messageText, setMessageText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const chatRootRef = useRef<HTMLDivElement>(null);
  // See ChatView.tsx for why this exists alongside the app shell's own
  // visualViewport-driven resize — this is the fallback for when that
  // alone doesn't account for the keyboard on a given device/browser.
  const keyboardInset = useKeyboardInset(chatRootRef);

  // Message Actions State
  const [selectedMessage, setSelectedMessage] = useState<GroupMessageWithStatus | null>(null);
  const [actionMenuPosition, setActionMenuPosition] = useState({ x: 0, y: 0 });
  const [replyToMessage, setReplyToMessage] = useState<GroupMessageWithStatus | null>(null);

  // Long press handling refs
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const touchStartPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // Composer: "+" media popup, uploads, and the full voice-recording
  // subsystem — ported from ChatView.tsx (see that file for the extensive
  // history/reasoning behind every piece of this; kept as near-identical
  // duplicated logic here rather than a shared hook, deliberately, to
  // avoid regressing the already-proven 1:1 implementation).
  const [showMediaOptions, setShowMediaOptions] = useState(false);
  const [uploading, setUploading] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const voiceButtonRef = useRef<HTMLButtonElement>(null);

  const [voiceState, setVoiceState] = useState<VoiceRecordingState>({
    isRecording: false,
    isPaused: false,
    duration: 0,
    isLocked: false,
    isCancelling: false,
    startX: 0,
    currentX: 0,
    waveformData: [],
    lockProgress: 0
  });
  const [showHoldHint, setShowHoldHint] = useState(false);
  const holdHintTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const flashHoldHint = useCallback(() => {
    setShowHoldHint(true);
    if (holdHintTimeoutRef.current) clearTimeout(holdHintTimeoutRef.current);
    holdHintTimeoutRef.current = setTimeout(() => setShowHoldHint(false), 1800);
  }, []);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fullWaveformRef = useRef<number[]>([]);
  const durationRef = useRef(0);
  const isRecordingActiveRef = useRef(false);
  const lastRecordingRef = useRef<{ duration: number; waveform: number[] }>({ duration: 0, waveform: [] });
  const isCancellingRef = useRef(false);
  const lastWaveformRenderRef = useRef(0);
  const isRecordingGestureRef = useRef(false);
  const startXRef = useRef(0);
  const recordingTouchStartedAtRef = useRef(0);
  const recordingButtonRectRef = useRef<DOMRect | null>(null);

  const LOCK_SWIPE_UP_PX = 60;
  const CANCEL_SWIPE_PX = 100;
  const MIN_HOLD_MS = 300;

  // Each VoiceMessageBubble owns and drives its own <audio> element; this
  // just coordinates "only one plays at a time" across bubbles.
  const audioRefs = useRef<{ [key: string]: HTMLAudioElement }>({});

  // Media Viewer (full-screen tap-to-open for images/videos)
  const [mediaViewer, setMediaViewer] = useState<MediaViewerState>({
    isOpen: false,
    type: null,
    url: ''
  });

  const {
    messages,
    members,
    memberProfiles,
    isLoading,
    isSending,
    isOnline,
    error,
    sendMessage,
    loadMessages,
    loadMoreMessages,
    hasMore
  } = useGroupChat({
    groupId: group.id,
    userId: currentUser.id
  });

  // Fast id -> message lookup so reply quotes can resolve the original
  // message's content without an O(n) scan per rendered bubble.
  const messagesById = useMemo(() => {
    const map = new Map<string, GroupMessageWithStatus>();
    for (const m of messages) map.set(m.id, m);
    return map;
  }, [messages]);

  // Typing / recording indicators — mirrors ChatView's isTyping/
  // isContactRecording exactly, except a group can have more than one
  // member typing or recording at once, so these are Sets of member ids
  // rather than a single boolean.
  const [typingUserIds, setTypingUserIds] = useState<Set<string>>(new Set());
  const [recordingUserIds, setRecordingUserIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const typingSubscription = typingService.subscribeToGroupTyping(
      currentUser.id,
      group.id,
      (userId, isTyping) => {
        setTypingUserIds(prev => {
          const next = new Set(prev);
          if (isTyping) next.add(userId); else next.delete(userId);
          return next;
        });
      }
    );

    const recordingSubscription = typingService.subscribeToGroupRecording(
      currentUser.id,
      group.id,
      (userId, isRecording) => {
        setRecordingUserIds(prev => {
          const next = new Set(prev);
          if (isRecording) next.add(userId); else next.delete(userId);
          return next;
        });
      }
    );

    return () => {
      typingSubscription.unsubscribe();
      recordingSubscription.unsubscribe();
    };
  }, [currentUser.id, group.id]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Load messages on mount
  useEffect(() => {
    loadMessages();
  }, [loadMessages]);

  const handleSendMessage = useCallback(async () => {
    const text = messageText.trim();
    if (!text || isSending) return;

    // Tapping "Reply" on a message only ever showed a banner above the
    // input — it was never actually attached to the outgoing message, so
    // every "reply" silently sent as a normal, unlinked message. Capture
    // the target here and clear the banner immediately (matching
    // WhatsApp: it disappears the instant you hit send, not after the
    // server round-trip).
    const replyToId = replyToMessage?.id;
    setReplyToMessage(null);

    setMessageText('');
    typingService.sendGroupStoppedTyping(currentUser.id, group.id);
    await sendMessage(text, 'text', { replyToId });
  }, [messageText, isSending, sendMessage, currentUser.id, group.id, replyToMessage]);

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  // "Stopped typing" fires once, 2s after the last keystroke — same
  // debounce shape as ChatView's debouncedStopTyping. sendGroupTyping
  // itself is debounced internally (at most once every 500ms), so it's
  // called directly on every keystroke rather than behind an extra
  // debounce, keeping the very first "is typing" signal instant.
  const debouncedStopGroupTyping = useMemo(
    () => debounce(() => {
      typingService.sendGroupStoppedTyping(currentUser.id, group.id);
    }, 2000),
    [currentUser.id, group.id]
  );

  const handleMessageTextChange = useCallback((value: string) => {
    setMessageText(value);
    typingService.sendGroupTyping(currentUser.id, group.id);
    debouncedStopGroupTyping();
  }, [currentUser.id, group.id, debouncedStopGroupTyping]);

  // Generalized upload handler for photos/videos/files, mirroring
  // ChatView's handleFileUpload(file, type).
  const handleFileUpload = async (file: File, type: 'image' | 'video' | 'file') => {
    setUploading(true);
    setShowMediaOptions(false);
    // Same fix as handleSendMessage: a reply started before attaching
    // media must still carry through, and the banner should clear as
    // soon as the send is kicked off rather than being left dangling.
    const replyToId = replyToMessage?.id;
    setReplyToMessage(null);

    try {
      const result = await mediaService.uploadMedia(file, currentUser.id);
      if (result.success && result.url) {
        await sendMessage(result.url, type, { replyToId });
      }
    } catch (error) {
      console.error('Error uploading file:', error);
    } finally {
      setUploading(false);
    }
  };

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFileUpload(file, 'image');
    e.target.value = '';
  };

  const handleVideoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFileUpload(file, 'video');
    e.target.value = '';
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFileUpload(file, 'file');
    e.target.value = '';
  };

  // ---- Voice recording subsystem (ported from ChatView.tsx) ----

  const pauseRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.pause();
    }
    if (recordingIntervalRef.current) {
      clearInterval(recordingIntervalRef.current);
      recordingIntervalRef.current = null;
    }
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    setVoiceState(prev => ({ ...prev, isPaused: true }));
  }, []);

  const updateWaveform = useCallback(() => {
    if (!analyserRef.current) return;

    const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
    analyserRef.current.getByteFrequencyData(dataArray);

    const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
    const normalizedValue = average / 255;
    fullWaveformRef.current.push(normalizedValue);

    const now = performance.now();
    if (now - lastWaveformRenderRef.current >= 65) {
      lastWaveformRenderRef.current = now;
      setVoiceState(prev => ({
        ...prev,
        waveformData: [...prev.waveformData.slice(-49), normalizedValue]
      }));
    }

    animationFrameRef.current = requestAnimationFrame(updateWaveform);
  }, []);

  const startDurationTimer = useCallback(() => {
    if (recordingIntervalRef.current) clearInterval(recordingIntervalRef.current);
    recordingIntervalRef.current = setInterval(() => {
      setVoiceState(prev => {
        const duration = prev.duration + 1;
        durationRef.current = duration;
        return { ...prev, duration };
      });

      // Re-send "recording" every second as a heartbeat while this keeps
      // running — same reasoning as ChatView's 1:1 heartbeat: the other
      // members' indicator (typingService.subscribeToGroupRecording)
      // auto-expires 3s after the last signal as a dropped-connection
      // safety net, so a recording longer than ~3s needs refreshing well
      // inside that window to stay visible for its entire real length.
      typingService.sendGroupRecording(currentUser.id, group.id);
    }, 1000);
  }, [currentUser.id, group.id]);

  const resumeRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === 'paused') {
      mediaRecorderRef.current.resume();
    }
    setVoiceState(prev => ({ ...prev, isPaused: false }));
    startDurationTimer();
    updateWaveform();
  }, [startDurationTimer, updateWaveform]);

  const sendVoiceMessage = async (audioBlob: Blob, durationSeconds: number, waveformSamples: number[]) => {
    setUploading(true);
    // Same reply-attachment fix as handleSendMessage/handleFileUpload —
    // a reply started before recording a voice note must still carry
    // through instead of being silently dropped.
    const replyToId = replyToMessage?.id;
    setReplyToMessage(null);
    try {
      const actualType = audioBlob.type || 'audio/webm';
      const extension = actualType.includes('mp4')
        ? 'm4a'
        : actualType.includes('ogg')
          ? 'ogg'
          : actualType.includes('wav')
            ? 'wav'
            : 'webm';
      const file = new File([audioBlob], `voice_${Date.now()}.${extension}`, { type: actualType });
      const result = await mediaService.uploadMedia(file, currentUser.id);

      if (result.success && result.url) {
        await sendMessage(result.url, 'voice', {
          duration: durationSeconds,
          waveform: downsampleWaveform(waveformSamples),
          replyToId
        });
      } else {
        console.error('Voice message upload failed:', result.error);
        alert(`Couldn't send voice message${result.error ? `: ${result.error}` : '.'} Please try again.`);
      }
    } catch (error) {
      console.error('Error sending voice message:', error);
      alert('Couldn\'t send voice message. Please check your connection and try again.');
    } finally {
      setUploading(false);
    }
  };

  const startRecording = async () => {
    isCancellingRef.current = false;
    fullWaveformRef.current = [];
    durationRef.current = 0;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      streamRef.current = stream;

      const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const audioContext = new AudioContextClass();
      audioContextRef.current = audioContext;
      const analyser = audioContext.createAnalyser();
      analyserRef.current = analyser;
      analyser.fftSize = 256;
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);

      let mimeType = 'audio/webm';
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'audio/mp4';
        if (!MediaRecorder.isTypeSupported(mimeType)) {
          mimeType = 'audio/ogg';
          if (!MediaRecorder.isTypeSupported(mimeType)) {
            mimeType = '';
          }
        }
      }

      const options = mimeType ? { mimeType } : undefined;
      const mediaRecorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach(track => track.stop());
        if (audioContextRef.current) {
          audioContextRef.current.close();
          audioContextRef.current = null;
        }
        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
          animationFrameRef.current = null;
        }

        if (!isCancellingRef.current && audioChunksRef.current.length > 0) {
          const actualType = mediaRecorder.mimeType || mimeType || 'audio/webm';
          const audioBlob = new Blob(audioChunksRef.current, { type: actualType });
          const { duration, waveform } = lastRecordingRef.current;
          await sendVoiceMessage(audioBlob, duration, waveform);
        }
      };

      mediaRecorder.onerror = (e) => {
        console.error('MediaRecorder error:', e);
      };

      mediaRecorder.start(100);

      setVoiceState(prev => ({
        ...prev,
        isRecording: true,
        isPaused: false,
        duration: 0,
        isLocked: false,
        isCancelling: false,
        waveformData: [],
        lockProgress: 0
      }));

      updateWaveform();
      startDurationTimer();

      // Let the other group members know a voice message is being
      // recorded — same realtime mechanism as the group typing indicator,
      // its own event type so the chat header / groups list can show
      // "recording audio..." instead of typing dots.
      typingService.sendGroupRecording(currentUser.id, group.id);
    } catch (error) {
      console.error('Error starting recording:', error);
      alert('Could not access microphone. Please allow microphone access and try again.');
      isRecordingActiveRef.current = false;
      setVoiceState({
        isRecording: false,
        isPaused: false,
        duration: 0,
        isLocked: false,
        isCancelling: false,
        startX: 0,
        currentX: 0,
        waveformData: [],
        lockProgress: 0
      });
    }
  };

  const stopRecording = (cancel: boolean = false) => {
    isRecordingActiveRef.current = false;

    // Tell the other group members recording has ended, whether it's being
    // sent or cancelled — their "recording audio..." indicator shouldn't
    // outlive the actual recording (it also auto-expires after a few
    // seconds on their end as a safety net, but this makes it disappear
    // instantly).
    typingService.sendGroupStoppedRecording(currentUser.id, group.id);

    lastRecordingRef.current = { duration: Math.max(1, durationRef.current), waveform: fullWaveformRef.current };

    if (recordingIntervalRef.current) {
      clearInterval(recordingIntervalRef.current);
      recordingIntervalRef.current = null;
    }

    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    isCancellingRef.current = cancel;

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }

    setVoiceState({
      isRecording: false,
      isPaused: false,
      duration: 0,
      isLocked: false,
      isCancelling: false,
      startX: 0,
      currentX: 0,
      waveformData: [],
      lockProgress: 0
    });
  };

  const applyVoiceDrag = (clientX: number, clientY: number, prev: VoiceRecordingState): VoiceRecordingState => {
    const swipeDistance = startXRef.current - clientX;
    const buttonRect = recordingButtonRectRef.current;

    let isLocked = prev.isLocked;
    let lockProgress = prev.lockProgress;

    if (prev.isLocked) {
      lockProgress = 1;
    } else if (buttonRect) {
      const liftPx = buttonRect.top - clientY;
      lockProgress = Math.max(0, Math.min(1, liftPx / LOCK_SWIPE_UP_PX));
      if (liftPx > LOCK_SWIPE_UP_PX) {
        isLocked = true;
        lockProgress = 1;
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
          navigator.vibrate(15);
        }
      }
    }

    return {
      ...prev,
      currentX: clientX,
      isLocked,
      lockProgress,
      isCancelling: swipeDistance > CANCEL_SWIPE_PX
    };
  };

  const finishVoiceGesture = useCallback(() => {
    setVoiceState(prev => {
      if (prev.isLocked) {
        return prev;
      }

      const swipeDistance = startXRef.current - prev.currentX;
      const heldMs = Date.now() - recordingTouchStartedAtRef.current;
      if (heldMs < MIN_HOLD_MS && Math.abs(swipeDistance) < 10) {
        setTimeout(() => stopRecording(true), 0);
        flashHoldHint();
      } else if (prev.isCancelling || swipeDistance > CANCEL_SWIPE_PX) {
        setTimeout(() => stopRecording(true), 0);
      } else {
        setTimeout(() => stopRecording(false), 0);
      }
      return prev;
    });
  }, [flashHoldHint]);

  const handleGlobalMouseMove = useCallback((e: MouseEvent) => {
    if (!isRecordingGestureRef.current) return;
    setVoiceState(prev => applyVoiceDrag(e.clientX, e.clientY, prev));
  }, []);

  const handleGlobalMouseUp = useCallback(() => {
    document.removeEventListener('mousemove', handleGlobalMouseMove);
    document.removeEventListener('mouseup', handleGlobalMouseUp);
    if (!isRecordingGestureRef.current) return;
    isRecordingGestureRef.current = false;
    finishVoiceGesture();
  }, [handleGlobalMouseMove, finishVoiceGesture]);

  const handleGlobalTouchMove = useCallback((e: TouchEvent) => {
    if (!isRecordingGestureRef.current) return;
    const touch = e.touches[0];
    if (!touch) return;
    e.preventDefault();
    setVoiceState(prev => applyVoiceDrag(touch.clientX, touch.clientY, prev));
  }, []);

  const handleGlobalTouchEnd = useCallback(() => {
    document.removeEventListener('touchmove', handleGlobalTouchMove);
    document.removeEventListener('touchend', handleGlobalTouchEnd);
    document.removeEventListener('touchcancel', handleGlobalTouchEnd);
    if (!isRecordingGestureRef.current) return;
    isRecordingGestureRef.current = false;
    finishVoiceGesture();
  }, [handleGlobalTouchMove, finishVoiceGesture]);

  const handleVoiceButtonTouchStart = (e: React.TouchEvent | React.MouseEvent) => {
    e.preventDefault();
    pauseAllVoiceMessages();
    isRecordingActiveRef.current = true;
    const isTouch = 'touches' in e;
    const clientX = isTouch ? e.touches[0].clientX : e.clientX;
    startXRef.current = clientX;
    recordingTouchStartedAtRef.current = Date.now();
    isRecordingGestureRef.current = true;
    recordingButtonRectRef.current = voiceButtonRef.current?.getBoundingClientRect() ?? null;
    setVoiceState(prev => ({ ...prev, startX: clientX, currentX: clientX }));
    startRecording();

    if (isTouch) {
      document.addEventListener('touchmove', handleGlobalTouchMove, { passive: false });
      document.addEventListener('touchend', handleGlobalTouchEnd);
      document.addEventListener('touchcancel', handleGlobalTouchEnd);
    } else {
      document.addEventListener('mousemove', handleGlobalMouseMove);
      document.addEventListener('mouseup', handleGlobalMouseUp);
    }
  };

  useEffect(() => {
    return () => {
      document.removeEventListener('mousemove', handleGlobalMouseMove);
      document.removeEventListener('mouseup', handleGlobalMouseUp);
      document.removeEventListener('touchmove', handleGlobalTouchMove);
      document.removeEventListener('touchend', handleGlobalTouchEnd);
      document.removeEventListener('touchcancel', handleGlobalTouchEnd);
      if (holdHintTimeoutRef.current) clearTimeout(holdHintTimeoutRef.current);
    };
  }, [handleGlobalMouseMove, handleGlobalMouseUp, handleGlobalTouchMove, handleGlobalTouchEnd]);

  const pauseOtherVoiceMessages = useCallback((exceptMessageId: string) => {
    Object.entries(audioRefs.current).forEach(([id, audio]) => {
      if (id !== exceptMessageId && !audio.paused) {
        audio.pause();
      }
    });
  }, []);

  const pauseAllVoiceMessages = useCallback(() => {
    Object.values(audioRefs.current).forEach((audio) => {
      if (!audio.paused) audio.pause();
    });
  }, []);

  const openMediaViewer = (type: 'image' | 'video', url: string) => {
    setMediaViewer({ isOpen: true, type, url });
  };

  const closeMediaViewer = () => {
    setMediaViewer({ isOpen: false, type: null, url: '' });
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const formatTime = (timestamp: string) => {
    return new Date(timestamp).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit'
    });
  };

  const formatDate = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return date.toLocaleDateString('en-US', { weekday: 'long' });
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const getSenderName = (senderId: string) => {
    if (senderId === currentUser.id) return 'You';
    const profile = memberProfiles[senderId];
    return profile?.full_name?.split(' ')[0] || 'Unknown';
  };

  const getSenderAvatar = (senderId: string) => {
    const profile = memberProfiles[senderId];
    return profile?.avatar_url;
  };

  // Turns a set of member ids into a WhatsApp-style "Alice is typing" /
  // "Alice and Bob are typing" / "Alice and 2 others are typing" label —
  // recording takes priority over typing, same as the 1:1 indicator and
  // the Chats list's per-friend preview (a member who's doing both only
  // shows as "recording audio").
  const describeActivity = (userIds: Set<string>): string => {
    const names = Array.from(userIds).map(id => getSenderName(id));
    if (names.length === 0) return '';
    if (names.length === 1) return names[0];
    if (names.length === 2) return `${names[0]} and ${names[1]}`;
    return `${names[0]} and ${names.length - 1} others`;
  };

  const activeRecordingUserIds = recordingUserIds;
  const activeTypingUserIds = useMemo(() => {
    if (recordingUserIds.size === 0) return typingUserIds;
    const next = new Set(typingUserIds);
    recordingUserIds.forEach(id => next.delete(id));
    return next;
  }, [typingUserIds, recordingUserIds]);

  // Message Action Handlers
  const handleMessageLongPress = useCallback((message: GroupMessageWithStatus, position: { x: number; y: number }) => {
    setSelectedMessage(message);
    setActionMenuPosition(position);
  }, []);

  const handleCloseActionMenu = useCallback(() => {
    setSelectedMessage(null);
  }, []);

  const handleReactionClick = useCallback(async (messageId: string, emoji: string) => {
    const message = messages.find(m => m.id === messageId);
    if (!message) return;

    const userReacted = message.reactions?.[emoji]?.includes(currentUser.id);
    try {
      if (userReacted) {
        await groupService.removeReaction(messageId, currentUser.id, emoji);
      } else {
        await groupService.addReaction(messageId, currentUser.id, emoji);
      }
    } catch (error) {
      console.error('Failed to toggle reaction:', error);
    }
  }, [messages, currentUser.id]);

  const handleMessageDeleted = useCallback((_messageId: string, _forEveryone: boolean) => {
    // The message will be updated via realtime subscription
  }, []);

  const handleReplyMessage = useCallback((message: GroupMessageWithStatus) => {
    setReplyToMessage(message);
  }, []);

  const cancelReply = useCallback(() => {
    setReplyToMessage(null);
  }, []);

  // Touch handlers for long press
  const handleTouchStart = (e: React.TouchEvent, message: GroupMessageWithStatus) => {
    const touch = e.touches[0];
    touchStartPosRef.current = { x: touch.clientX, y: touch.clientY };
    longPressTimerRef.current = setTimeout(() => {
      handleMessageLongPress(message, { x: touch.clientX, y: touch.clientY });
    }, 500);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    const dx = Math.abs(touch.clientX - touchStartPosRef.current.x);
    const dy = Math.abs(touch.clientY - touchStartPosRef.current.y);
    if (dx > 10 || dy > 10) {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
    }
  };

  const handleTouchEnd = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const handleContextMenu = (e: React.MouseEvent, message: GroupMessageWithStatus) => {
    e.preventDefault();
    handleMessageLongPress(message, { x: e.clientX, y: e.clientY });
  };

  const renderMessage = (message: GroupMessageWithStatus, index: number) => {
    const isOwn = message.sender_id === currentUser.id;
    const isImage = message.type === 'image' && !!message.content;
    const isVideo = message.type === 'video' && !!(message.media_url || message.content);
    const isVoice = message.type === 'voice';
    const isFile = message.type === 'file';
    const isMedia = isImage || isVideo;
    const showDate = index === 0 ||
      formatDate(messages[index - 1].created_at) !== formatDate(message.created_at);
    const showSender = !isOwn && (index === 0 || messages[index - 1].sender_id !== message.sender_id);

    // Quoted "replying to" snippet, WhatsApp style — only rendered when
    // this message actually has a reply target AND it's resolvable in
    // the currently loaded history.
    const repliedTo = message.reply_to ? messagesById.get(message.reply_to) : undefined;
    const replyQuote = repliedTo ? (
      <div
        className={`mb-1 px-2 py-1 rounded-lg border-l-2 ${
          isOwn
            ? 'bg-white/15 border-white/60 text-white/90'
            : 'bg-slate-100 border-violet-400 text-slate-600'
        }`}
      >
        <p className={`text-[11px] font-semibold ${isOwn ? 'text-white' : 'text-violet-600'}`}>
          {repliedTo.sender_id === currentUser.id ? 'You' : getSenderName(repliedTo.sender_id)}
        </p>
        <p className="text-xs truncate">
          {repliedTo.is_deleted
            ? 'This message was deleted'
            : (!repliedTo.type || repliedTo.type === 'text')
              ? repliedTo.content
              : `[${repliedTo.type}]`}
        </p>
      </div>
    ) : null;

    // Check if message is deleted
    if (message.is_deleted) {
      return (
        <div key={message.id || message.client_message_id}>
          {showDate && (
            <div className="flex justify-center my-4">
              <span className="px-3 py-1 rounded-full bg-white/70 backdrop-blur-sm text-[10px] text-slate-500 font-medium shadow-sm">
                {formatDate(message.created_at)}
              </span>
            </div>
          )}
          <div className={`flex mb-2 ${isOwn ? 'justify-end' : 'justify-start'}`}>
            {!isOwn && showSender && <div className="w-8 h-8 mr-2" />}
            {!isOwn && !showSender && <div className="w-8 mr-2" />}
            <div className={`max-w-[75%] rounded-2xl px-3.5 py-2 ${
              isOwn
                ? 'bg-gradient-to-r from-violet-400/50 to-purple-400/50 text-white/70 rounded-tr-sm'
                : 'bg-slate-100 text-slate-400 rounded-tl-sm'
            }`}>
              <p className="text-sm italic flex items-center gap-1.5">
                <Trash2 className="w-3.5 h-3.5" />
                This message was deleted
              </p>
              <div className={`flex items-center justify-end gap-1 mt-0.5 ${isOwn ? 'text-white/50' : 'text-slate-300'}`}>
                <span className="text-[10px]">{formatTime(message.created_at)}</span>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div key={message.id || message.client_message_id}>
        {showDate && (
          <div className="flex justify-center my-4">
            <span className="px-3 py-1 rounded-full bg-white/70 backdrop-blur-sm text-[10px] text-slate-500 font-medium shadow-sm">
              {formatDate(message.created_at)}
            </span>
          </div>
        )}

        <div className={`flex mb-2 ${isOwn ? 'justify-end' : 'justify-start'}`}>
          {!isOwn && showSender && (
            <div className="w-8 h-8 rounded-full flex-shrink-0 mr-2 overflow-hidden bg-gradient-to-br from-violet-400 to-purple-400 flex items-center justify-center">
              {getSenderAvatar(message.sender_id) ? (
                <img
                  src={getSenderAvatar(message.sender_id)}
                  alt=""
                  className="w-full h-full object-cover"
                />
              ) : (
                <span className="text-white text-xs font-bold">
                  {getSenderName(message.sender_id).charAt(0).toUpperCase()}
                </span>
              )}
            </div>
          )}
          {!isOwn && !showSender && <div className="w-8 mr-2" />}

          <div className={`max-w-[75%] ${isOwn ? 'items-end' : 'items-start'}`}>
            {!isOwn && showSender && (
              <p className="text-[10px] text-violet-600 font-semibold mb-0.5 ml-1">
                {getSenderName(message.sender_id)}
              </p>
            )}

            {isMedia ? (
              <>
                {replyQuote}
                {/* Edge-to-edge media bubble (no px-3.5 py-2 text padding) —
                    matches the 1:1 chat's photo/video bubbles: the media
                    fills the whole rounded shape instead of sitting inside a
                    visible margin of solid bubble color, with the timestamp
                    overlaid directly on its own corner, WhatsApp-style. */}
                <div
                  className={`relative rounded-2xl overflow-hidden shadow-sm select-none ${
                    isOwn ? 'rounded-tr-sm' : 'rounded-tl-sm'
                  }`}
                  onTouchStart={(e) => handleTouchStart(e, message)}
                  onTouchMove={handleTouchMove}
                  onTouchEnd={handleTouchEnd}
                  onContextMenu={(e) => handleContextMenu(e, message)}
                >
                  {isImage ? (
                    <img
                      src={message.media_url || message.content}
                      alt="Shared image"
                      className="block cursor-pointer max-w-full max-h-[300px] object-cover hover:opacity-90 transition-opacity"
                      onClick={() => openMediaViewer('image', message.media_url || message.content)}
                    />
                  ) : (
                    <div
                      className="relative cursor-pointer group"
                      onClick={() => openMediaViewer('video', message.media_url || message.content)}
                    >
                      <video
                        src={message.media_url || message.content}
                        className="block max-w-full max-h-[300px] object-cover"
                      />
                      <div className="absolute inset-0 bg-black/30 flex items-center justify-center group-hover:bg-black/40 transition-colors">
                        <div className="w-14 h-14 rounded-full bg-white/90 flex items-center justify-center">
                          <Play className="w-6 h-6 text-slate-800 ml-1" fill="currentColor" />
                        </div>
                      </div>
                    </div>
                  )}
                  <div className="absolute bottom-1.5 right-1.5 flex items-center gap-1 pl-1.5 pr-1 py-0.5 rounded-full bg-black/45 text-[10px] text-white leading-none">
                    <span>{formatTime(message.created_at)}</span>
                    {message.is_edited && <span className="italic">edited</span>}
                    {isOwn && (
                      <>
                        {message.syncStatus === 'pending' && <Clock className="w-3 h-3 opacity-70" />}
                        {(!message.syncStatus || message.syncStatus === 'sent') && (
                          message.is_read
                            ? <CheckCheck className="w-3 h-3" />
                            : <Check className="w-3 h-3" />
                        )}
                        {message.syncStatus === 'failed' && <X className="w-3 h-3 text-red-400" />}
                      </>
                    )}
                  </div>
                </div>
                {/* Kept outside the rounded/clipped media box above so the
                    reaction pills never get clipped by its corner rounding. */}
                <GroupReactionsDisplay
                  reactions={message.reactions}
                  currentUserId={currentUser.id}
                  onReactionClick={(emoji) => handleReactionClick(message.id, emoji)}
                />
              </>
            ) : isVoice ? (
              <div
                className="relative select-none"
                onTouchStart={(e) => handleTouchStart(e, message)}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                onContextMenu={(e) => handleContextMenu(e, message)}
              >
                {replyQuote}
                <VoiceMessageBubble
                  message={message}
                  isOwn={isOwn}
                  audioRefs={audioRefs}
                  onRequestExclusivePlayback={pauseOtherVoiceMessages}
                  isRecordingActiveRef={isRecordingActiveRef}
                  avatarUrl={getSenderAvatar(message.sender_id)}
                  avatarFallback={getSenderName(message.sender_id).charAt(0).toUpperCase()}
                />
                <div className={`flex items-center gap-1 mt-1 px-1 text-[10px] ${isOwn ? 'text-slate-400 justify-end' : 'text-slate-400'}`}>
                  <span>{formatTime(message.created_at)}</span>
                  {message.is_edited && <span className="italic">edited</span>}
                  {isOwn && (
                    <>
                      {message.syncStatus === 'pending' && <Clock className="w-3 h-3 opacity-70" />}
                      {(!message.syncStatus || message.syncStatus === 'sent') && (
                        message.is_read
                          ? <CheckCheck className="w-3 h-3" />
                          : <Check className="w-3 h-3" />
                      )}
                      {message.syncStatus === 'failed' && <X className="w-3 h-3 text-red-400" />}
                    </>
                  )}
                </div>
                <GroupReactionsDisplay
                  reactions={message.reactions}
                  currentUserId={currentUser.id}
                  onReactionClick={(emoji) => handleReactionClick(message.id, emoji)}
                />
              </div>
            ) : (
              <div
                className={`rounded-2xl ${isFile ? '' : 'px-3.5 py-2'} shadow-sm select-none ${
                  isOwn
                    ? 'bg-gradient-to-r from-violet-500 to-purple-500 text-white rounded-tr-sm'
                    : 'bg-white/90 text-slate-800 rounded-tl-sm border border-white/70'
                }`}
                onTouchStart={(e) => handleTouchStart(e, message)}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                onContextMenu={(e) => handleContextMenu(e, message)}
              >
                {replyQuote}
                {isFile ? (
                  <DocumentBubble message={message} isOwn={isOwn} />
                ) : (
                  <p className="text-sm whitespace-pre-wrap break-words">{message.content}</p>
                )}

                <div className={`flex items-center justify-end gap-1 mt-0.5 ${isFile ? 'pb-2 px-3' : ''} ${isOwn ? 'text-white/70' : 'text-slate-400'}`}>
                  <span className="text-[10px]">{formatTime(message.created_at)}</span>
                  {message.is_edited && <span className="text-[10px] italic">edited</span>}
                  {isOwn && (
                    <>
                      {message.syncStatus === 'pending' && <Clock className="w-3 h-3 opacity-70" />}
                      {(!message.syncStatus || message.syncStatus === 'sent') && (
                        message.is_read
                          ? <CheckCheck className="w-3 h-3" />
                          : <Check className="w-3 h-3" />
                      )}
                      {message.syncStatus === 'failed' && <X className="w-3 h-3 text-red-400" />}
                    </>
                  )}
                </div>

                {/* Reactions Display */}
                <GroupReactionsDisplay
                  reactions={message.reactions}
                  currentUserId={currentUser.id}
                  onReactionClick={(emoji) => handleReactionClick(message.id, emoji)}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div
      ref={chatRootRef}
      className="h-full flex flex-col relative bg-gradient-to-br from-violet-50 via-purple-50 to-fuchsia-50"
      style={keyboardInset > 0 ? { paddingBottom: keyboardInset } : undefined}
    >
      {/* Animated low-poly chat background, same treatment as the 1:1
          chat screen (ChatView) — a different fixed seed just so the two
          screen types don't render the exact same mesh. */}
      <LowPolyBackground seed={23} />

      {/* Header */}
      <div className="relative z-20 backdrop-blur-2xl bg-gradient-to-r from-violet-500/95 via-purple-500/95 to-fuchsia-500/95 text-white px-3 py-3 shadow-xl shadow-purple-500/20">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="p-2 rounded-xl hover:bg-white/20 transition-all duration-300 active:scale-95"
            aria-label="Back"
          >
            <ArrowLeft className="w-5 h-5" strokeWidth={2.5} />
          </button>

          <button
            type="button"
            className="flex-1 flex items-center gap-3 text-left min-w-0"
            onClick={onManageGroup}
            aria-label="Open group info"
          >
            <div className="w-10 h-10 rounded-xl overflow-hidden flex-shrink-0 bg-white/20 flex items-center justify-center">
              {group.avatar_url ? (
                <img src={group.avatar_url} alt={group.name} className="w-full h-full object-cover" />
              ) : (
                <Users className="w-5 h-5 text-white" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="font-semibold text-sm truncate">{group.name}</h2>
              <p
                key={activeRecordingUserIds.size > 0 ? 'recording' : activeTypingUserIds.size > 0 ? 'typing' : 'status'}
                className="text-xs text-white/70 truncate animate-fade-in"
              >
                {activeRecordingUserIds.size > 0 ? (
                  <span className="inline-flex items-center gap-1.5 text-green-300 font-medium align-middle max-w-full truncate">
                    <Mic className="w-3 h-3 recording-indicator-mic shrink-0" strokeWidth={2.5} />
                    {describeActivity(activeRecordingUserIds)} recording audio
                  </span>
                ) : activeTypingUserIds.size > 0 ? (
                  <span className="inline-flex items-center gap-1.5 text-green-300 font-medium align-middle max-w-full truncate">
                    {describeActivity(activeTypingUserIds)} typing
                    <span className="flex items-end gap-0.5 h-2 shrink-0">
                      <span className="w-1 h-1 bg-green-300 rounded-full typing-dot" style={{ animationDelay: '0ms' }} />
                      <span className="w-1 h-1 bg-green-300 rounded-full typing-dot" style={{ animationDelay: '150ms' }} />
                      <span className="w-1 h-1 bg-green-300 rounded-full typing-dot" style={{ animationDelay: '300ms' }} />
                    </span>
                  </span>
                ) : (
                  <>
                    {members.length} members
                    {!isOnline && ' • Offline'}
                  </>
                )}
              </p>
            </div>
          </button>

          <div className="flex items-center gap-1">
            {onGroupCall && (
              <>
                <button
                  onClick={() => onGroupCall('voice')}
                  className="p-2 rounded-xl hover:bg-white/20 transition-all duration-300 active:scale-95"
                  aria-label="Voice call"
                >
                  <Phone className="w-5 h-5" strokeWidth={2.5} />
                </button>
                <button
                  onClick={() => onGroupCall('video')}
                  className="p-2 rounded-xl hover:bg-white/20 transition-all duration-300 active:scale-95"
                  aria-label="Video call"
                >
                  <Video className="w-5 h-5" strokeWidth={2.5} />
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Messages. min-h-0 keeps this flex child from refusing to shrink
          below its full content height (the default flex min-height is
          `auto`, not 0) — without it, once there are enough messages the
          list grows past its allotted space instead of scrolling inside
          it, and the last message(s) end up rendered behind the composer
          bar below instead of scrolled above it. */}
      <div className="relative z-10 flex-1 min-h-0 overflow-y-auto px-3 py-4">
        {isLoading && messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-400 to-purple-400 flex items-center justify-center mb-4 animate-pulse">
              <Users className="w-8 h-8 text-white" />
            </div>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-400 to-purple-400 flex items-center justify-center mb-4">
              <Users className="w-8 h-8 text-white" />
            </div>
            <p className="text-sm text-slate-600 font-medium">No messages yet</p>
            <p className="text-xs text-slate-500">Start the conversation!</p>
          </div>
        ) : (
          <>
            {hasMore && (
              <button
                onClick={loadMoreMessages}
                className="w-full py-2 text-xs text-violet-600 hover:text-violet-700 font-medium"
              >
                Load earlier messages
              </button>
            )}
            {messages.map((message, index) => renderMessage(message, index))}
          </>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Error Banner */}
      {error && (
        <div className="relative z-10 px-4 py-2 bg-red-100 border-t border-red-200">
          <p className="text-xs text-red-600">{error}</p>
        </div>
      )}

      {/* Uploading indicator - subtle, non-blocking (matches ChatView) */}
      {uploading && (
        <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-20">
          <div className="flex items-center gap-2 px-4 py-2 bg-violet-500/90 text-white rounded-full shadow-lg">
            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            <span className="text-sm font-medium">Sending...</span>
          </div>
        </div>
      )}

      {/* Voice Recording UI - WhatsApp Style (ported from ChatView.tsx) */}
      {voiceState.isRecording && (
        <div
          className="absolute bottom-0 left-0 right-0 z-30 bg-white border-t border-slate-200"
          style={{ touchAction: 'none', overscrollBehavior: 'none' }}
        >
          {voiceState.isLocked ? (
            <div className="px-4 py-3">
              <div className="flex items-center gap-3 mb-3">
                <div className="flex items-center gap-2 shrink-0">
                  <div className={`w-2.5 h-2.5 rounded-full bg-red-500 ${voiceState.isPaused ? '' : 'animate-pulse'}`} />
                  <span className="text-base font-semibold text-slate-800 tabular-nums min-w-[44px]">
                    {formatDuration(voiceState.duration)}
                  </span>
                </div>

                <div className="flex-1 min-w-0 overflow-hidden flex items-center gap-[3px] h-10">
                  {voiceState.waveformData.slice(-36).map((value, i) => (
                    <div
                      key={i}
                      className={`w-1 shrink-0 bg-violet-500 rounded-full transition-all duration-75 ${voiceState.isPaused ? 'opacity-40' : ''}`}
                      style={{ height: `${Math.max(4, value * 32)}px` }}
                    />
                  ))}
                  {Array.from({ length: Math.max(0, 36 - voiceState.waveformData.length) }).map((_, i) => (
                    <div key={`placeholder-${i}`} className="w-1 h-1 shrink-0 bg-slate-200 rounded-full" />
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={() => stopRecording(true)}
                  className="w-12 h-12 shrink-0 rounded-full bg-red-50 text-red-500 flex items-center justify-center hover:bg-red-100 active:scale-95 transition-all"
                  aria-label="Delete recording"
                >
                  <Trash2 className="w-5 h-5" />
                </button>

                <button
                  onClick={() => (voiceState.isPaused ? resumeRecording() : pauseRecording())}
                  className="flex-1 h-12 rounded-full bg-slate-100 text-slate-700 flex items-center justify-center gap-2 font-medium hover:bg-slate-200 active:scale-[0.98] transition-all"
                  aria-label={voiceState.isPaused ? 'Resume recording' : 'Pause recording'}
                >
                  {voiceState.isPaused ? (
                    <Play className="w-5 h-5" fill="currentColor" />
                  ) : (
                    <Pause className="w-5 h-5" fill="currentColor" />
                  )}
                  <span>{voiceState.isPaused ? 'Resume' : 'Pause'}</span>
                </button>

                <button
                  onClick={() => stopRecording(false)}
                  className="w-12 h-12 shrink-0 rounded-full bg-gradient-to-r from-violet-500 to-purple-500 text-white flex items-center justify-center shadow-lg hover:shadow-xl active:scale-95 transition-all"
                  aria-label="Send voice message"
                >
                  <Send className="w-5 h-5" />
                </button>
              </div>
            </div>
          ) : (
            <div className="voice-recording-slide-ui">
              <div className="voice-recording-bg" />

              <div className="voice-recording-toprow">
                <div className="voice-duration">
                  <div className="voice-recording-dot" />
                  <span>{formatDuration(voiceState.duration)}</span>
                </div>
                <div className="voice-waveform-container">
                  {voiceState.waveformData.slice(-28).map((value, i) => (
                    <div
                      key={i}
                      className="voice-waveform-bar"
                      style={{ height: `${Math.max(4, value * 32)}px` }}
                    />
                  ))}
                </div>
              </div>

              <div
                className={`voice-cancel-zone ${voiceState.isCancelling ? 'active' : ''}`}
                style={{
                  opacity: Math.min(1, (voiceState.startX - voiceState.currentX) / 100)
                }}
              >
                <Trash2 className="w-5 h-5" />
                <span>Release to cancel</span>
              </div>

              <div className="voice-recording-bottomrow">
                <div
                  className="voice-slide-hint-row"
                  style={{
                    transform: `translateX(${Math.max(-120, Math.min(0, voiceState.currentX - voiceState.startX))}px)`,
                    opacity: voiceState.isCancelling ? 0.5 : 1
                  }}
                >
                  <div className={`voice-slide-hint ${voiceState.isCancelling ? 'cancelling' : ''}`}>
                    <ChevronLeft className="w-4 h-4" />
                    <ChevronLeft className="w-4 h-4 -ml-2" />
                    <span>Slide to cancel</span>
                  </div>
                </div>

                <div
                  className="voice-lock-indicator"
                  style={{
                    transform: `translateY(${-voiceState.lockProgress * 14}px) scale(${1 + voiceState.lockProgress * 0.1})`,
                    opacity: 0.65 + voiceState.lockProgress * 0.35
                  }}
                >
                  <div className="voice-lock-circle">
                    <Lock className="w-3.5 h-3.5" />
                  </div>
                  <div className="voice-lock-arrows">
                    <ChevronUp className="voice-lock-arrow" />
                    <ChevronUp className="voice-lock-arrow" />
                    <ChevronUp className="voice-lock-arrow" />
                  </div>
                </div>

                <div
                  className={`voice-mic-float ${voiceState.isCancelling ? 'cancelling' : ''}`}
                  style={{
                    transform: `translateY(-50%) translateX(${Math.max(-120, Math.min(0, voiceState.currentX - voiceState.startX))}px)`
                  }}
                >
                  <Mic className="w-5 h-5" />
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Input Area — intentionally transparent (no background/border/
          shadow of its own): the textarea and buttons below already have
          their own visuals, wrapping them in a translucent white bar on
          top of the low-poly chat background made the whole composer
          read as a separate "container" sitting behind the input instead
          of the input floating directly on the chat background.
          Hidden off-screen (not unmounted) while recording, same fix as
          ChatView: touch listeners for slide-to-cancel/lock are bound to
          `document`, not this button, specifically because this whole
          block (including the mic button) would otherwise be removed
          from the DOM the instant recording starts, silently killing
          those listeners mid-gesture on real phones. */}
      <div
        className="relative z-10 px-3 py-2.5 pb-[max(10px,env(safe-area-inset-bottom))]"
        style={voiceState.isRecording ? {
          position: 'fixed',
          top: 0,
          left: 0,
          width: 1,
          height: 1,
          overflow: 'hidden',
          opacity: 0,
          pointerEvents: 'none'
        } : undefined}
      >
        {/* Reply Preview */}
        {replyToMessage && (
          <div className="glass-card glass-card-reply-accent mb-2 rounded-xl px-3 py-2 flex items-start gap-2">
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-violet-600">
                Replying to {replyToMessage.sender_id === currentUser.id ? 'yourself' : getSenderName(replyToMessage.sender_id)}
              </p>
              <p className="text-sm text-slate-600 truncate">
                {replyToMessage.type === 'text' || !replyToMessage.type ? replyToMessage.content : `[${replyToMessage.type}]`}
              </p>
            </div>
            <button
              onClick={cancelReply}
              className="p-1 rounded-full hover:bg-slate-100"
            >
              <X className="w-4 h-4 text-slate-400" />
            </button>
          </div>
        )}

        {/* Glassy Input Container — identical markup/classes to ChatView's
            1:1 composer so both screens float the exact same pill. */}
        <div className="chat-input-glass">
          <div className="chat-input-inner">
            <div className="relative">
              <button
                onClick={() => setShowMediaOptions(!showMediaOptions)}
                className={`chat-input-action-btn ${showMediaOptions ? 'active' : ''}`}
              >
                {showMediaOptions ? (
                  <X className="w-5 h-5" strokeWidth={2} />
                ) : (
                  <Plus className="w-5 h-5" strokeWidth={2} />
                )}
              </button>

              {showMediaOptions && (
                <div className="chat-media-popup">
                  <button
                    onClick={() => imageInputRef.current?.click()}
                    className="chat-media-option"
                  >
                    <div className="chat-media-option-icon purple">
                      <ImageIcon className="w-5 h-5" />
                    </div>
                    <span>Photos</span>
                  </button>
                  <button
                    onClick={() => videoInputRef.current?.click()}
                    className="chat-media-option"
                  >
                    <div className="chat-media-option-icon pink">
                      <Film className="w-5 h-5" />
                    </div>
                    <span>Videos</span>
                  </button>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="chat-media-option"
                  >
                    <div className="chat-media-option-icon blue">
                      <FileText className="w-5 h-5" />
                    </div>
                    <span>Files</span>
                  </button>
                </div>
              )}
            </div>

            <div className="chat-input-field">
              <input
                ref={inputRef}
                type="text"
                placeholder="Type a message..."
                value={messageText}
                onChange={(e) => handleMessageTextChange(e.target.value)}
                onKeyPress={handleKeyPress}
                onFocus={() => {
                  setTimeout(() => {
                    inputRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
                  }, 300);
                }}
              />
            </div>

            {messageText.trim() ? (
              <button
                onClick={handleSendMessage}
                disabled={isSending}
                className="chat-send-btn"
              >
                <Send className={`w-5 h-5 transition-opacity ${isSending ? 'opacity-50' : ''}`} strokeWidth={2} />
              </button>
            ) : (
              <div className="relative">
                {showHoldHint && (
                  <div className="voice-hold-hint">
                    Hold to record a voice message
                  </div>
                )}
                <button
                  ref={voiceButtonRef}
                  onTouchStart={handleVoiceButtonTouchStart}
                  onMouseDown={handleVoiceButtonTouchStart}
                  className="chat-voice-btn"
                >
                  <Mic className="w-5 h-5" strokeWidth={2} />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Click outside to close media options */}
      {showMediaOptions && (
        <div
          className="fixed inset-0 z-0"
          onClick={() => setShowMediaOptions(false)}
        />
      )}

      {/* Hidden File Inputs */}
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        onChange={handleImageSelect}
        style={{ display: 'none', position: 'absolute', visibility: 'hidden' }}
      />
      <input
        ref={videoInputRef}
        type="file"
        accept="video/*"
        onChange={handleVideoSelect}
        style={{ display: 'none', position: 'absolute', visibility: 'hidden' }}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip,.rar"
        onChange={handleFileSelect}
        style={{ display: 'none', position: 'absolute', visibility: 'hidden' }}
      />

      {/* Simple full-screen media viewer for tapping a photo/video bubble */}
      {mediaViewer.isOpen && (
        <div className="fixed inset-0 z-50 bg-black/95 flex flex-col animate-fade-in" onClick={closeMediaViewer}>
          <button
            onClick={closeMediaViewer}
            className="absolute top-4 right-4 z-20 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white"
            aria-label="Close"
          >
            <X className="w-6 h-6" />
          </button>
          <div className="flex-1 flex items-center justify-center p-4" onClick={(e) => e.stopPropagation()}>
            {mediaViewer.type === 'image' ? (
              <img src={mediaViewer.url} alt="" className="max-w-full max-h-full object-contain" />
            ) : (
              <video src={mediaViewer.url} controls autoPlay className="max-w-full max-h-full object-contain" />
            )}
          </div>
        </div>
      )}

      {/* Message Actions Menu */}
      {selectedMessage && (
        <GroupMessageActions
          message={selectedMessage as GroupMessage}
          isOwn={selectedMessage.sender_id === currentUser.id}
          currentUserId={currentUser.id}
          onClose={handleCloseActionMenu}
          onMessageDeleted={handleMessageDeleted}
          onReply={handleReplyMessage}
          position={actionMenuPosition}
        />
      )}

      {/* Animation Styles */}
      <style>{`
        @keyframes scale-in {
          from { opacity: 0; transform: scale(0.95); }
          to { opacity: 1; transform: scale(1); }
        }
        .animate-scale-in {
          animation: scale-in 0.25s ease-out;
        }
        @keyframes slide-up {
          from { opacity: 0; transform: translateY(100%); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-slide-up {
          animation: slide-up 0.3s ease-out;
        }
        @keyframes slide-down {
          from { opacity: 0; transform: translateY(-20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-slide-down {
          animation: slide-down 0.25s ease-out;
        }
      `}</style>
    </div>
  );
}
