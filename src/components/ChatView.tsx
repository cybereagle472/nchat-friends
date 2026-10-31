import { ArrowLeft, MoreVertical, Phone, Video, Send, Plus, X, Image as ImageIcon, FileText, Film, Mic, CheckCheck, Play, Pause, Lock, Trash2, ChevronLeft, UserX } from 'lucide-react';
import { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react';
import { chatService } from '../services/chatService';
import { mediaService } from '../services/mediaService';
import { typingService } from '../services/typingService';
import { groupService, GroupWithMembers } from '../services/groupService';
import { friendService } from '../services/friendService';
import { getChatId, getChatMessages, saveMessages, LocalMessage } from '../utils/offlineStorage';
import { presenceStatusText } from '../utils/presenceFormat';
import { Message, UserProfile, Contact } from '../types';
import { MessageActions, ForwardDialog, ReactionsDisplay } from './MessageActions';

// Debounce utility for typing indicator
const debounce = <T extends (...args: Parameters<T>) => void>(fn: T, delay: number) => {
  let timeoutId: NodeJS.Timeout;
  return (...args: Parameters<T>) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
};

// Number of bars drawn in a voice message's waveform (both when recording it
// into a storable string and when rendering it back in the bubble) — a
// single shared constant keeps the two sides in sync.
const VOICE_WAVEFORM_BARS = 35;

// Collapse the real amplitude samples captured during a recording (one per
// animation frame, so potentially thousands for a long message) down to a
// fixed number of bars representing the *whole* recording, so the sent
// message's waveform reflects the actual audio instead of a fake pattern.
function downsampleWaveform(samples: number[], targetBars: number = VOICE_WAVEFORM_BARS): string {
  if (samples.length === 0) return '';
  const bucketSize = samples.length / targetBars;
  const bars: number[] = [];
  for (let i = 0; i < targetBars; i++) {
    const start = Math.floor(i * bucketSize);
    const end = Math.max(start + 1, Math.floor((i + 1) * bucketSize));
    const slice = samples.slice(start, end);
    const avg = slice.reduce((a, b) => a + b, 0) / (slice.length || 1);
    bars.push(Math.round(avg * 100) / 100);
  }
  return bars.join(',');
}

// Memoized Message Bubble - prevents re-render of all messages when one changes
interface MessageBubbleProps {
  message: Message;
  isOwn: boolean;
  currentUserId: string;
  renderMessageContent: (message: Message, isOwn: boolean) => React.ReactNode;
  formatTime: (timestamp: string) => string;
  onLongPress: (message: Message, position: { x: number; y: number }) => void;
  onReactionClick: (messageId: string, emoji: string) => void;
}

const MessageBubble = memo(function MessageBubble({
  message,
  isOwn,
  currentUserId,
  renderMessageContent,
  formatTime,
  onLongPress,
  onReactionClick
}: MessageBubbleProps) {
  const isVoice = message.type === 'voice';
  const longPressTimer = useRef<NodeJS.Timeout | null>(null);
  const touchStartPos = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const handleTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    touchStartPos.current = { x: touch.clientX, y: touch.clientY };
    longPressTimer.current = setTimeout(() => {
      onLongPress(message, { x: touch.clientX, y: touch.clientY });
    }, 500);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    const dx = Math.abs(touch.clientX - touchStartPos.current.x);
    const dy = Math.abs(touch.clientY - touchStartPos.current.y);
    if (dx > 10 || dy > 10) {
      if (longPressTimer.current) {
        clearTimeout(longPressTimer.current);
        longPressTimer.current = null;
      }
    }
  };

  const handleTouchEnd = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    onLongPress(message, { x: e.clientX, y: e.clientY });
  };

  const renderStatus = () => {
    if (message.sender_id !== currentUserId) return null;
    if (message.is_read) {
      // Read - double check in blue/green
      return <CheckCheck className="w-3.5 h-3.5 text-sky-400" strokeWidth={2.5} />;
    }
    // Sent but not read - double check in gray/white (delivered to server)
    return <CheckCheck className="w-3.5 h-3.5 text-white/60" strokeWidth={2.5} />;
  };

  // Check if message is deleted
  if (message.is_deleted) {
    return (
      <div className={`flex ${isOwn ? 'justify-end' : 'justify-start'}`}>
        <div className={`max-w-[80%] rounded-2xl px-3 py-2 ${
          isOwn
            ? 'bg-gradient-to-r from-violet-400/50 to-purple-400/50 text-white/70 rounded-br-md'
            : 'bg-slate-100 text-slate-400 rounded-bl-md'
        }`}>
          <p className="text-sm italic flex items-center gap-1.5">
            <Trash2 className="w-3.5 h-3.5" />
            This message was deleted
          </p>
          <div className={`flex items-center gap-1 mt-1 text-[10px] ${isOwn ? 'text-white/50 justify-end' : 'text-slate-300'}`}>
            <span>{formatTime(message.created_at)}</span>
          </div>
        </div>
      </div>
    );
  }

  const hasReactions = message.reactions && Object.keys(message.reactions).length > 0;

  return (
    <div className={`flex ${isOwn ? 'justify-end' : 'justify-start'} ${hasReactions ? 'mb-4' : ''}`}>
      {isVoice ? (
        <div
          className="max-w-[85%] relative"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onContextMenu={handleContextMenu}
        >
          {renderMessageContent(message, isOwn)}
          <div className={`flex items-center gap-1 mt-1 px-2 text-[10px] ${isOwn ? 'text-slate-400 justify-end' : 'text-slate-400'}`}>
            <span>{formatTime(message.created_at)}</span>
            {message.is_edited && <span className="italic">edited</span>}
            {renderStatus()}
          </div>
          <ReactionsDisplay
            reactions={message.reactions}
            currentUserId={currentUserId}
            onReactionClick={(emoji) => onReactionClick(message.id, emoji)}
            isOwn={isOwn}
          />
        </div>
      ) : (
        <div
          className={`message-bubble-wrapper ${isOwn ? 'own' : 'received'}`}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onContextMenu={handleContextMenu}
        >
          <div
            className={`max-w-[80%] rounded-2xl px-3 py-2 select-none ${
              isOwn
                ? 'bg-gradient-to-r from-violet-500 to-purple-500 text-white rounded-br-md'
                : 'bg-white text-slate-800 rounded-bl-md shadow-sm'
            }`}
          >
            {renderMessageContent(message, isOwn)}
            <div className={`flex items-center gap-1 mt-1 text-[10px] ${isOwn ? 'text-white/70 justify-end' : 'text-slate-400'}`}>
              <span>{formatTime(message.created_at)}</span>
              {message.is_edited && <span className="italic">edited</span>}
              {renderStatus()}
            </div>
          </div>
          <ReactionsDisplay
            reactions={message.reactions}
            currentUserId={currentUserId}
            onReactionClick={(emoji) => onReactionClick(message.id, emoji)}
            isOwn={isOwn}
          />
        </div>
      )}
    </div>
  );
}, (prevProps, nextProps) => {
  // Custom comparison - only re-render if these specific props change
  return (
    prevProps.message.id === nextProps.message.id &&
    prevProps.message.is_read === nextProps.message.is_read &&
    prevProps.message.content === nextProps.message.content &&
    prevProps.message.is_edited === nextProps.message.is_edited &&
    prevProps.message.is_deleted === nextProps.message.is_deleted &&
    JSON.stringify(prevProps.message.reactions) === JSON.stringify(nextProps.message.reactions) &&
    prevProps.isOwn === nextProps.isOwn
  );
});

interface ChatViewProps {
  currentUser: UserProfile;
  contact: Contact;
  onBack: () => void;
  onCall: (type: 'voice' | 'video') => void;
  onBlockUser?: (userId: string) => void;
}

// Voice Recording State
interface VoiceRecordingState {
  isRecording: boolean;
  isPaused: boolean;
  duration: number;
  isLocked: boolean;
  isCancelling: boolean;
  startX: number;
  currentX: number;
  waveformData: number[];
  // 0-1 progress toward the swipe-up-to-lock threshold, drives the lock
  // icon sliding up as visual feedback (WhatsApp-style) while recording.
  lockProgress: number;
}

// Media Viewer State
interface MediaViewerState {
  isOpen: boolean;
  type: 'image' | 'video' | null;
  url: string;
}

export function ChatView({ currentUser, contact, onBack, onCall, onBlockUser }: ChatViewProps) {
  // Seed state synchronously from the in-memory cache (if warm) so reopening a
  // chat you just viewed never renders an empty/skeleton frame before
  // painting — this is what eliminates the visible "blink" on reopen.
  const [messages, setMessages] = useState<Message[]>(
    () => chatService.getCachedMessages(currentUser.id, contact.user_id) || []
  );
  const [inputMessage, setInputMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showMediaOptions, setShowMediaOptions] = useState(false);
  const [isInitialLoad, setIsInitialLoad] = useState(
    () => !(chatService.getCachedMessages(currentUser.id, contact.user_id)?.length)
  );

  // Menu and Block states
  const [showMenu, setShowMenu] = useState(false);
  const [showBlockConfirm, setShowBlockConfirm] = useState(false);
  const [blocking, setBlocking] = useState(false);

  // Voice Recording
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
  // Brief "Hold to record a voice message" nudge shown when a press is too
  // short/still to have been a deliberate recording (see MIN_HOLD_MS below).
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
  // Every amplitude sample captured for the recording in progress (unlike
  // voiceState.waveformData, which is cropped to a short sliding window for
  // the live "now recording" visual, this keeps the full recording so a
  // real, whole-message waveform can be saved and shown once it's sent).
  const fullWaveformRef = useRef<number[]>([]);
  // Snapshot of the duration/waveform at the moment recording stops — the
  // MediaRecorder's onstop callback fires asynchronously afterward, by which
  // point voiceState has already been reset back to 0/empty, so it can't be
  // read directly from there.
  const lastRecordingRef = useRef<{ duration: number; waveform: number[] }>({ duration: 0, waveform: [] });

  // Media Viewer
  const [mediaViewer, setMediaViewer] = useState<MediaViewerState>({
    isOpen: false,
    type: null,
    url: ''
  });

  // Message Actions State
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null);
  const [actionMenuPosition, setActionMenuPosition] = useState({ x: 0, y: 0 });
  const [showForwardDialog, setShowForwardDialog] = useState(false);
  const [messageToForward, setMessageToForward] = useState<Message | null>(null);
  const [replyToMessage, setReplyToMessage] = useState<Message | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [groups, setGroups] = useState<GroupWithMembers[]>([]);

  // Audio Playback
  const [playingAudio, setPlayingAudio] = useState<string | null>(null);
  const audioRefs = useRef<{ [key: string]: HTMLAudioElement }>({});

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const voiceButtonRef = useRef<HTMLButtonElement>(null);

  const scrollToBottom = (instant: boolean = false) => {
    messagesEndRef.current?.scrollIntoView({ behavior: instant ? 'instant' : 'smooth' });
  };

  // Load messages instantly from cache, then sync with server
  const loadMessages = useCallback(async () => {
    const chatId = getChatId(currentUser.id, contact.user_id);

    // STEP 1: Try in-memory cache first (INSTANT - 0ms)
    const memCached = chatService.getCachedMessages(currentUser.id, contact.user_id);
    if (memCached && memCached.length > 0) {
      setMessages(memCached);
      setIsInitialLoad(false);
      setTimeout(() => scrollToBottom(true), 0);

      // Background sync with server
      chatService.getMessages(currentUser.id, contact.user_id, { limit: 50, forceServerSync: true })
        .then(serverMessages => {
          setMessages(serverMessages);
          chatService.markAsRead(currentUser.id, contact.user_id);
        })
        .catch(() => {});
      return;
    }

    // STEP 2: Load from IndexedDB cache (Fast - <10ms typically)
    try {
      const cachedMessages = await getChatMessages(chatId, 50);
      if (cachedMessages.length > 0) {
        setMessages(cachedMessages as Message[]);
        setIsInitialLoad(false);
        setTimeout(() => scrollToBottom(true), 0);
      }
    } catch (e) {
      // Cache read failed, continue to server fetch
    }

    // STEP 3: Fetch from server in background and merge
    try {
      const serverMessages = await chatService.getMessages(currentUser.id, contact.user_id, { limit: 50 });

      // Cache messages for future instant loads
      const localMessages: LocalMessage[] = serverMessages.map(msg => ({
        ...msg,
        chatId,
        syncStatus: 'sent' as const,
        clientMessageId: msg.client_message_id || msg.id,
        localCreatedAt: msg.created_at,
        serverCreatedAt: msg.created_at,
        retryCount: 0
      }));
      saveMessages(localMessages).catch(() => {}); // Fire and forget

      // Update state with server messages (merge strategy)
      setMessages(prev => {
        if (prev.length === 0) return serverMessages;

        // Merge: keep optimistic messages, update with server data
        const messageMap = new Map<string, Message>();

        // Add server messages first
        serverMessages.forEach(msg => {
          messageMap.set(msg.id, msg);
          if (msg.client_message_id) {
            messageMap.set(msg.client_message_id, msg);
          }
        });

        // Overlay with any pending optimistic messages
        prev.forEach(msg => {
          const key = msg.client_message_id || msg.id;
          if (!messageMap.has(key) && !messageMap.has(msg.id)) {
            // This is a local optimistic message not yet on server
            messageMap.set(key, msg);
          }
        });

        return Array.from(new Map([...messageMap].map(([_, v]) => [v.id || v.client_message_id, v])).values())
          .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      });

      setIsInitialLoad(false);
      setTimeout(() => scrollToBottom(true), 0);

      // Mark as read in background
      chatService.markAsRead(currentUser.id, contact.user_id);
    } catch (error) {
      console.error('Error loading messages from server:', error);
      setIsInitialLoad(false);
    }
  }, [currentUser.id, contact.user_id]);

  useEffect(() => {
    loadMessages();

    const subscription = chatService.subscribeToMessages(
      currentUser.id,
      (message) => {
        if (
          (message.sender_id === contact.user_id && message.receiver_id === currentUser.id) ||
          (message.sender_id === currentUser.id && message.receiver_id === contact.user_id)
        ) {
          // Update in-memory cache immediately
          chatService.updateCache(currentUser.id, contact.user_id, message);

          setMessages((prev) => {
            // Check if message already exists (by id or client_message_id)
            const existingIndex = prev.findIndex(
              (m) => m.id === message.id ||
                     (m.client_message_id && m.client_message_id === message.client_message_id)
            );

            if (existingIndex !== -1) {
              // Update existing message (e.g., pending -> sent)
              const updated = [...prev];
              updated[existingIndex] = { ...prev[existingIndex], ...message };
              return updated;
            }

            // Add new message at the end (newest messages at bottom)
            const newMessages = [...prev, message];
            // Sort by created_at to ensure correct order
            return newMessages.sort((a, b) =>
              new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
            );
          });

          if (message.sender_id === contact.user_id) {
            chatService.markAsRead(currentUser.id, contact.user_id);
          }
        }
      },
      (message) => {
        // Update in-memory cache for message updates too
        chatService.updateCache(currentUser.id, contact.user_id, message);

        setMessages((prev) =>
          prev.map((m) => (m.id === message.id || m.client_message_id === message.client_message_id ? { ...m, ...message } : m))
        );
      }
    );

    // Subscribe to read receipts - when the contact reads our messages
    const readReceiptSubscription = chatService.subscribeToReadReceipts(
      currentUser.id,
      (messageIds) => {
        // Mark messages as read in local state
        setMessages((prev) =>
          prev.map((m) =>
            messageIds.includes(m.id) ? { ...m, is_read: true } : m
          )
        );
      }
    );

    const typingSubscription = typingService.subscribeToTyping(
      currentUser.id,
      contact.user_id,
      (userId, typing) => {
        if (userId === contact.user_id) {
          setIsTyping(typing);
        }
      }
    );

    return () => {
      subscription.unsubscribe();
      readReceiptSubscription.unsubscribe();
      typingSubscription.unsubscribe();
    };
  }, [currentUser.id, contact.user_id, loadMessages]);

  // Scroll to bottom when new messages arrive (smooth scroll)
  const prevMessagesLengthRef = useRef(messages.length);
  useEffect(() => {
    if (messages.length > prevMessagesLengthRef.current) {
      // New message added, scroll to bottom smoothly
      scrollToBottom(false);
    }
    prevMessagesLengthRef.current = messages.length;
  }, [messages.length]);

  // "Stopped typing" fires once, 2s after the user's last keystroke.
  // (typingService.sendTyping already throttles "is typing" internally —
  // it sends instantly on the first keystroke and at most once every 500ms
  // after that, so it must be called directly on every keystroke rather
  // than behind an extra debounce, otherwise the very first signal gets
  // delayed and the indicator feels laggy instead of instant like WhatsApp.)
  const debouncedStopTyping = useMemo(
    () => debounce(() => {
      typingService.sendStoppedTyping(currentUser.id, contact.user_id);
    }, 2000),
    [currentUser.id, contact.user_id]
  );

  // Optimized input handler - no blocking operations
  const handleInputChange = useCallback((value: string) => {
    // Update state immediately (React batches this)
    setInputMessage(value);

    // Non-blocking typing indicator — instant start, auto-expiring stop
    typingService.sendTyping(currentUser.id, contact.user_id);
    debouncedStopTyping();
  }, [currentUser.id, contact.user_id, debouncedStopTyping]);

  const handleSendMessage = async () => {
    if (!inputMessage.trim() || sending) return;

    const messageContent = inputMessage.trim();
    const tempId = `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Create optimistic message to show immediately
    const optimisticMessage: Message = {
      id: tempId,
      client_message_id: tempId,
      sender_id: currentUser.id,
      receiver_id: contact.user_id,
      content: messageContent,
      type: 'text',
      created_at: new Date().toISOString(),
      is_read: false,
      is_deleted: false
    };

    // Add optimistic message to UI immediately
    setMessages(prev => [...prev, optimisticMessage]);
    setInputMessage('');
    setSending(true);
    typingService.sendStoppedTyping(currentUser.id, contact.user_id);

    try {
      const result = await chatService.sendMessage({
        senderId: currentUser.id,
        receiverId: contact.user_id,
        content: messageContent,
        type: 'text',
        clientMessageId: tempId
      });

      // Update the optimistic message with real data from server
      if (result.success && result.message) {
        setMessages(prev =>
          prev.map(m =>
            m.client_message_id === tempId
              ? { ...result.message!, client_message_id: result.clientMessageId }
              : m
          )
        );
      }
    } catch (error) {
      console.error('Error sending message:', error);
      // Mark the message as failed (could add UI indicator here)
    } finally {
      setSending(false);
    }
  };

  const handleFileUpload = async (file: File, type: 'image' | 'video' | 'file') => {
    setUploading(true);
    setShowMediaOptions(false);

    try {
      const result = await mediaService.uploadMedia(file, currentUser.id);

      if (result.success && result.url) {
        await chatService.sendMessage({
          senderId: currentUser.id,
          receiverId: contact.user_id,
          content: result.url,
          type: type
        });
      }
    } catch (error) {
      console.error('Error uploading file:', error);
    } finally {
      setUploading(false);
    }
  };

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileUpload(file, 'image');
    }
    e.target.value = '';
  };

  const handleVideoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileUpload(file, 'video');
    }
    e.target.value = '';
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileUpload(file, 'file');
    }
    e.target.value = '';
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  // Message Action Handlers
  const handleMessageLongPress = useCallback((message: Message, position: { x: number; y: number }) => {
    setSelectedMessage(message);
    setActionMenuPosition(position);
  }, []);

  const handleCloseActionMenu = useCallback(() => {
    setSelectedMessage(null);
  }, []);

  const handleReactionAdded = useCallback((messageId: string, _emoji: string) => {
    // The message will be updated via realtime subscription
    // For optimistic UI update, we could update locally here
    setMessages(prev => prev.map(m => m.id === messageId ? { ...m } : m));
  }, []);

  const handleReactionClick = useCallback(async (messageId: string, emoji: string) => {
    const message = messages.find(m => m.id === messageId);
    if (!message) return;

    const userReacted = message.reactions?.[emoji]?.includes(currentUser.id);
    try {
      if (userReacted) {
        await chatService.removeReaction(messageId, currentUser.id, emoji);
      } else {
        await chatService.addReaction(messageId, currentUser.id, emoji);
      }
    } catch (error) {
      console.error('Failed to toggle reaction:', error);
    }
  }, [messages, currentUser.id]);

  const handleMessageEdited = useCallback((messageId: string, newContent: string) => {
    setMessages(prev => prev.map(m =>
      m.id === messageId
        ? { ...m, content: newContent, is_edited: true, edited_at: new Date().toISOString() }
        : m
    ));
  }, []);

  const handleMessageDeleted = useCallback((messageId: string, forEveryone: boolean) => {
    if (forEveryone) {
      setMessages(prev => prev.map(m =>
        m.id === messageId
          ? { ...m, is_deleted: true, content: 'This message was deleted' }
          : m
      ));
    } else {
      setMessages(prev => prev.filter(m => m.id !== messageId));
    }
  }, []);

  const handleForwardMessage = useCallback(async (message: Message) => {
    setMessageToForward(message);
    // Load contacts and groups for forward dialog
    try {
      const groupsResult = await groupService.getUserGroups(currentUser.id);
      if (groupsResult.success && groupsResult.data) {
        setGroups(groupsResult.data);
      }
      // Get contacts from friendships - we'll use the contact prop as a starting point
      // In a real app, you'd load all friends here
      setContacts([contact]);
    } catch (error) {
      console.error('Failed to load contacts/groups:', error);
    }
    setShowForwardDialog(true);
  }, [currentUser.id, contact]);

  const handleForwardComplete = useCallback((count: number) => {
    setShowForwardDialog(false);
    setMessageToForward(null);
    // Could show a toast notification here
    console.log(`Message forwarded to ${count} chats`);
  }, []);

  const handleReplyMessage = useCallback((message: Message) => {
    setReplyToMessage(message);
  }, []);

  const cancelReply = useCallback(() => {
    setReplyToMessage(null);
  }, []);

  // Block user handler
  const handleBlockUser = useCallback(async () => {
    setBlocking(true);
    try {
      const result = await friendService.blockUser(currentUser.id, contact.user_id);
      if (result.success) {
        setShowBlockConfirm(false);
        setShowMenu(false);
        // Notify parent component
        onBlockUser?.(contact.user_id);
        // Go back to chat list
        onBack();
      } else {
        console.error('Failed to block user:', result.error);
      }
    } catch (error) {
      console.error('Error blocking user:', error);
    } finally {
      setBlocking(false);
    }
  }, [currentUser.id, contact.user_id, onBlockUser, onBack]);

  // Track if recording was cancelled (ref for closure)
  const isCancellingRef = useRef(false);

  // Real-time waveform sampling loop — pulled out to component scope (not
  // just a local closure inside startRecording) so pauseRecording/
  // resumeRecording can stop and restart the exact same loop.
  const lastWaveformRenderRef = useRef(0);
  const updateWaveform = useCallback(() => {
    if (!analyserRef.current) return;

    const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
    analyserRef.current.getByteFrequencyData(dataArray);

    // Get average amplitude from frequency data
    const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
    const normalizedValue = average / 255;
    // Every frame (cheap: just appending to a plain array, no re-render).
    fullWaveformRef.current.push(normalizedValue);

    // But only push a React state update ~15 times/sec instead of on every
    // single animation frame (~60/sec). The live waveform bars don't need
    // to redraw faster than that to look smooth, and cutting the update
    // rate by 4x is what actually keeps the rest of the recording UI (and
    // the drag gesture driving it) feeling instant instead of janky.
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
      setVoiceState(prev => ({ ...prev, duration: prev.duration + 1 }));
    }, 1000);
  }, []);

  // Pause/resume a *locked* recording in place (same clip, same upload at
  // the end) — mirrors WhatsApp's locked-recording pause button. Recording
  // must be locked first since while the mic button is still being held
  // there's no separate tap target for this.
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

  const resumeRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === 'paused') {
      mediaRecorderRef.current.resume();
    }
    setVoiceState(prev => ({ ...prev, isPaused: false }));
    startDurationTimer();
    updateWaveform();
  }, [startDurationTimer, updateWaveform]);

  // Voice Recording Functions with Real-time Waveform
  const startRecording = async () => {
    console.log('Starting voice recording...');
    isCancellingRef.current = false;
    fullWaveformRef.current = [];

    try {
      // Request microphone permission
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      console.log('Microphone access granted');
      streamRef.current = stream;

      // Set up audio analysis for real-time waveform
      const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const audioContext = new AudioContextClass();
      audioContextRef.current = audioContext;
      const analyser = audioContext.createAnalyser();
      analyserRef.current = analyser;
      analyser.fftSize = 256;
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);

      // Try different MIME types for compatibility
      let mimeType = 'audio/webm';
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'audio/mp4';
        if (!MediaRecorder.isTypeSupported(mimeType)) {
          mimeType = 'audio/ogg';
          if (!MediaRecorder.isTypeSupported(mimeType)) {
            mimeType = ''; // Let browser choose
          }
        }
      }

      const options = mimeType ? { mimeType } : undefined;
      const mediaRecorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        console.log('Audio data available:', e.data.size);
        if (e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = async () => {
        console.log('MediaRecorder stopped, isCancelling:', isCancellingRef.current);
        stream.getTracks().forEach(track => track.stop());
        if (audioContextRef.current) {
          audioContextRef.current.close();
          audioContextRef.current = null;
        }
        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
          animationFrameRef.current = null;
        }

        // Use ref instead of state to avoid stale closure
        if (!isCancellingRef.current && audioChunksRef.current.length > 0) {
          const actualType = mediaRecorder.mimeType || mimeType || 'audio/webm';
          const audioBlob = new Blob(audioChunksRef.current, { type: actualType });
          console.log('Sending voice message, blob size:', audioBlob.size, 'type:', actualType);
          const { duration, waveform } = lastRecordingRef.current;
          await sendVoiceMessage(audioBlob, duration, waveform);
        }
      };

      mediaRecorder.onerror = (e) => {
        console.error('MediaRecorder error:', e);
      };

      mediaRecorder.start(100);
      console.log('MediaRecorder started');

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

      // Start real-time waveform analysis + duration timer
      updateWaveform();
      startDurationTimer();

    } catch (error) {
      console.error('Error starting recording:', error);
      alert('Could not access microphone. Please allow microphone access and try again.');
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
    console.log('Stopping recording, cancel:', cancel);

    // Snapshot the final duration/waveform now, while voiceState still has
    // them — onstop (below) fires asynchronously and runs after voiceState
    // has already been reset to 0/empty by the setVoiceState call below.
    lastRecordingRef.current = { duration: voiceState.duration, waveform: fullWaveformRef.current };

    if (recordingIntervalRef.current) {
      clearInterval(recordingIntervalRef.current);
      recordingIntervalRef.current = null;
    }

    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    // Update ref for closure
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

  const sendVoiceMessage = async (audioBlob: Blob, durationSeconds: number, waveformSamples: number[]) => {
    setUploading(true);
    try {
      // Use the blob's *actual* recorded type (webm/mp4/ogg, whichever the
      // browser negotiated — e.g. Safari/iOS records audio/mp4, not webm)
      // instead of a hardcoded one, otherwise the file is uploaded with a
      // mismatched extension/Content-Type and silently fails to play back.
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
        await chatService.sendMessage({
          senderId: currentUser.id,
          receiverId: contact.user_id,
          content: result.url,
          type: 'voice',
          duration: durationSeconds,
          waveform: downsampleWaveform(waveformSamples)
        });
      }
    } catch (error) {
      console.error('Error sending voice message:', error);
    } finally {
      setUploading(false);
    }
  };

  // Track if we're currently in a voice recording drag gesture
  const isRecordingGestureRef = useRef(false);
  const startXRef = useRef(0);
  const recordingTouchStartedAtRef = useRef(0);
  // The mic button unmounts the instant recording starts (swapped for the
  // recording overlay below), so voiceButtonRef.current is null for the
  // rest of the gesture — its position must be captured up front here,
  // otherwise swipe-up-to-lock can never detect anything.
  const recordingButtonRectRef = useRef<DOMRect | null>(null);

  const LOCK_SWIPE_UP_PX = 60;
  const CANCEL_SWIPE_PX = 100;
  // Below this hold duration (with negligible drag) a press is almost
  // certainly an accidental tap rather than a deliberate recording, so it's
  // cancelled instead of sending a near-silent sliver of a voice message —
  // mirrors WhatsApp's "hold to record" behavior.
  const MIN_HOLD_MS = 300;

  // Shared drag-update logic for both mouse and touch move handlers.
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

  // Called once the finger/mouse lifts (and the gesture wasn't a lock) to
  // decide whether to cancel, send, or — for a too-brief/too-still press —
  // treat it as an accidental tap.
  const finishVoiceGesture = useCallback(() => {
    setVoiceState(prev => {
      if (prev.isLocked) {
        // Keep recording, user will tap pause/send/cancel buttons instead.
        return prev;
      }

      const swipeDistance = startXRef.current - prev.currentX;
      const heldMs = Date.now() - recordingTouchStartedAtRef.current;
      if (heldMs < MIN_HOLD_MS && Math.abs(swipeDistance) < 10) {
        // Too brief to be a deliberate recording — treat as an accidental tap.
        setTimeout(() => stopRecording(true), 0);
        flashHoldHint();
      } else if (prev.isCancelling || swipeDistance > CANCEL_SWIPE_PX) {
        // Cancel recording
        setTimeout(() => stopRecording(true), 0);
      } else {
        // Send recording
        setTimeout(() => stopRecording(false), 0);
      }
      return prev;
    });
  }, [flashHoldHint]);

  // Mouse (desktop) drag handlers — bound to `document`, not the mic
  // button, since they must keep firing after the button unmounts.
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

  // Touch (phone) drag handlers — also bound to `document` rather than the
  // mic button. The button is swapped out for the recording overlay the
  // instant recording starts, and once the node a touch's listeners were
  // registered on is removed from the DOM, the browser stops delivering
  // further touchmove/touchend events to it — which is exactly why
  // slide-to-cancel/slide-up-to-lock never appeared to do anything.
  // `{ passive: false }` is required so preventDefault() can actually stop
  // the page from scrolling while the user is dragging the bubble around.
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

  // Cleanup global event listeners on unmount
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

  // Audio Playback
  const toggleAudioPlayback = (messageId: string, audioUrl: string) => {
    if (playingAudio === messageId) {
      audioRefs.current[messageId]?.pause();
      setPlayingAudio(null);
    } else {
      // Pause any currently playing audio
      if (playingAudio && audioRefs.current[playingAudio]) {
        audioRefs.current[playingAudio].pause();
      }

      if (!audioRefs.current[messageId]) {
        audioRefs.current[messageId] = new Audio(audioUrl);
        audioRefs.current[messageId].onended = () => setPlayingAudio(null);
      }

      audioRefs.current[messageId].play();
      setPlayingAudio(messageId);
    }
  };

  // Media Viewer
  const openMediaViewer = (type: 'image' | 'video', url: string) => {
    setMediaViewer({ isOpen: true, type, url });
  };

  const closeMediaViewer = () => {
    setMediaViewer({ isOpen: false, type: null, url: '' });
  };

  // Pure/stable — wrapped so the identity passed down to memoized
  // MessageBubble never changes, see the renderMessageContent ref-trick
  // below for why that matters.
  const formatTime = useCallback((timestamp: string) => {
    return new Date(timestamp).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit'
    });
  }, []);

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Voice Message Bubble Component - Modern design with waveform
  const VoiceMessageBubble = ({
    message,
    isOwn
  }: {
    message: Message;
    isOwn: boolean;
  }) => {
    const [waveformData, setWaveformData] = useState<number[]>([]);
    const [playbackProgress, setPlaybackProgress] = useState(0);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const bars = VOICE_WAVEFORM_BARS;
    const isPlaying = playingAudio === message.id;
    const audioUrl = message.media_url || message.content;

    // Voice messages sent after this fix carry their *real* recorded
    // amplitude in thumbnail_url (reusing that otherwise-unused column, see
    // chatService's `waveform` param). Older messages sent before the fix
    // don't have it, so fall back to a deterministic placeholder pattern
    // based on the message id, rather than showing nothing.
    useEffect(() => {
      const real = (message.thumbnail_url ?? '')
        .split(',')
        .map((n) => parseFloat(n))
        .filter((n) => !isNaN(n) && isFinite(n));

      if (real.length > 0) {
        setWaveformData(real);
        return;
      }

      const data: number[] = [];
      let hash = 0;
      for (let i = 0; i < message.id.length; i++) {
        hash = ((hash << 5) - hash) + message.id.charCodeAt(i);
        hash |= 0;
      }

      for (let i = 0; i < bars; i++) {
        const seed = Math.abs(Math.sin(hash * (i + 1) * 0.1)) * 0.6;
        const variation = Math.abs(Math.sin(i * 0.4)) * 0.3;
        const noise = Math.abs(Math.cos(hash * i * 0.05)) * 0.1;
        data.push(0.2 + seed + variation + noise);
      }
      setWaveformData(data);
    }, [message.id, message.thumbnail_url, bars]);

    // Track playback progress and duration
    useEffect(() => {
      const audio = audioRefs.current[message.id];
      if (!audio) return;

      const updateProgress = () => {
        if (audio.duration) {
          setPlaybackProgress(audio.currentTime / audio.duration);
          setCurrentTime(audio.currentTime);
          setDuration(audio.duration);
        }
      };

      const onLoadedMetadata = () => {
        setDuration(audio.duration);
      };

      audio.addEventListener('timeupdate', updateProgress);
      audio.addEventListener('loadedmetadata', onLoadedMetadata);

      return () => {
        audio.removeEventListener('timeupdate', updateProgress);
        audio.removeEventListener('loadedmetadata', onLoadedMetadata);
      };
    }, [message.id, isPlaying]);

    const playedBars = Math.floor(playbackProgress * bars);

    const formatAudioTime = (seconds: number) => {
      if (!seconds || isNaN(seconds)) return '0:00';
      const mins = Math.floor(seconds / 60);
      const secs = Math.floor(seconds % 60);
      return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    const displayTime = isPlaying ? formatAudioTime(currentTime) : formatAudioTime(duration || parseFloat(message.duration || '0'));

    return (
      <div className={`voice-message-bubble ${isOwn ? 'own' : 'received'}`}>
        {/* Avatar for received messages */}
        {!isOwn && (
          <div className="voice-message-avatar">
            {contact.profile.avatar_url ? (
              <img src={contact.profile.avatar_url} alt="" className="w-full h-full object-cover" />
            ) : (
              <span className="text-xs font-semibold text-white">
                {contact.profile.full_name.charAt(0).toUpperCase()}
              </span>
            )}
          </div>
        )}

        {/* Play/Pause Button */}
        <button
          onClick={() => toggleAudioPlayback(message.id, audioUrl)}
          className={`voice-message-play-btn ${isOwn ? 'own' : 'received'}`}
        >
          {isPlaying ? (
            <Pause className="w-5 h-5" fill="currentColor" />
          ) : (
            <Play className="w-5 h-5 ml-0.5" fill="currentColor" />
          )}
        </button>

        {/* Waveform and Duration */}
        <div className="voice-message-content">
          {/* Waveform */}
          <div className="voice-message-waveform">
            {waveformData.map((value, i) => (
              <div
                key={i}
                className={`voice-waveform-bar ${isOwn ? 'own' : 'received'} ${i < playedBars ? 'played' : ''}`}
                style={{
                  height: `${value * 100}%`,
                }}
              />
            ))}
          </div>

          {/* Duration */}
          <div className={`voice-message-duration ${isOwn ? 'own' : 'received'}`}>
            <span>{displayTime}</span>
          </div>
        </div>

        {/* Avatar for own messages */}
        {isOwn && (
          <div className="voice-message-avatar own">
            {currentUser.avatar_url ? (
              <img src={currentUser.avatar_url} alt="" className="w-full h-full object-cover" />
            ) : (
              <span className="text-xs font-semibold text-white">
                {currentUser.full_name.charAt(0).toUpperCase()}
              </span>
            )}
          </div>
        )}
      </div>
    );
  };

  // Document Bubble Component - Modern design with preview
  const DocumentBubble = ({
    message,
    isOwn
  }: {
    message: Message;
    isOwn: boolean;
  }) => {
    const [isDownloading, setIsDownloading] = useState(false);
    const fileUrl = message.media_url || message.content;

    // Extract file info from URL or message metadata
    const getFileInfo = () => {
      const fileName = message.fileName || fileUrl.split('/').pop()?.split('?')[0] || 'Document';
      const extension = fileName.split('.').pop()?.toLowerCase() || '';
      let fileType = 'File';
      let icon = 'file';
      let bgColor = isOwn ? 'bg-white/20' : 'bg-slate-100';
      let iconColor = isOwn ? 'text-white' : 'text-slate-600';

      // Determine file type based on extension
      if (['pdf'].includes(extension)) {
        fileType = 'PDF Document';
        icon = 'pdf';
        bgColor = isOwn ? 'bg-red-400/30' : 'bg-red-100';
        iconColor = isOwn ? 'text-red-200' : 'text-red-600';
      } else if (['doc', 'docx'].includes(extension)) {
        fileType = 'Word Document';
        icon = 'word';
        bgColor = isOwn ? 'bg-blue-400/30' : 'bg-blue-100';
        iconColor = isOwn ? 'text-blue-200' : 'text-blue-600';
      } else if (['xls', 'xlsx'].includes(extension)) {
        fileType = 'Excel Spreadsheet';
        icon = 'excel';
        bgColor = isOwn ? 'bg-green-400/30' : 'bg-green-100';
        iconColor = isOwn ? 'text-green-200' : 'text-green-600';
      } else if (['ppt', 'pptx'].includes(extension)) {
        fileType = 'PowerPoint';
        icon = 'ppt';
        bgColor = isOwn ? 'bg-orange-400/30' : 'bg-orange-100';
        iconColor = isOwn ? 'text-orange-200' : 'text-orange-600';
      } else if (['zip', 'rar', '7z'].includes(extension)) {
        fileType = 'Archive';
        icon = 'zip';
        bgColor = isOwn ? 'bg-amber-400/30' : 'bg-amber-100';
        iconColor = isOwn ? 'text-amber-200' : 'text-amber-600';
      } else if (['txt'].includes(extension)) {
        fileType = 'Text File';
        icon = 'txt';
      }

      return { fileName, fileType, icon, bgColor, iconColor, extension };
    };

    const { fileName, fileType, bgColor, iconColor, extension } = getFileInfo();

    const handleDownload = async () => {
      setIsDownloading(true);
      try {
        window.open(fileUrl, '_blank');
      } catch (error) {
        console.error('Error downloading file:', error);
      } finally {
        setTimeout(() => setIsDownloading(false), 1000);
      }
    };

    const handlePreview = () => {
      // For PDFs and images, open in new tab for preview
      window.open(fileUrl, '_blank');
    };

    return (
      <div className={`document-bubble ${isOwn ? 'own' : 'received'}`}>
        {/* File Icon */}
        <div className={`document-icon ${bgColor}`}>
          <FileText className={`w-6 h-6 ${iconColor}`} />
          <span className={`document-extension ${isOwn ? 'bg-white/90 text-violet-600' : 'bg-violet-500 text-white'}`}>
            {extension.toUpperCase()}
          </span>
        </div>

        {/* File Info */}
        <div className="document-info">
          <p className={`document-name ${isOwn ? 'text-white' : 'text-slate-800'}`}>
            {fileName.length > 25 ? fileName.substring(0, 22) + '...' : fileName}
          </p>
          <p className={`document-type ${isOwn ? 'text-white/70' : 'text-slate-500'}`}>
            {fileType} • {message.fileSize || 'Tap to open'}
          </p>
        </div>

        {/* Action Buttons */}
        <div className="document-actions">
          <button
            onClick={handlePreview}
            className={`document-action-btn ${isOwn ? 'bg-white/20 hover:bg-white/30 text-white' : 'bg-slate-100 hover:bg-slate-200 text-slate-600'}`}
            title="Preview"
          >
            <Play className="w-4 h-4" />
          </button>
          <button
            onClick={handleDownload}
            disabled={isDownloading}
            className={`document-action-btn ${isOwn ? 'bg-white/20 hover:bg-white/30 text-white' : 'bg-violet-500 hover:bg-violet-600 text-white'}`}
            title="Download"
          >
            {isDownloading ? (
              <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
            ) : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
            )}
          </button>
        </div>
      </div>
    );
  };

  const renderMessageContent = (message: Message, isOwn: boolean) => {
    switch (message.type) {
      case 'image':
        return (
          <div
            className="cursor-pointer overflow-hidden rounded-xl"
            onClick={() => openMediaViewer('image', message.media_url || message.content)}
          >
            <img
              src={message.media_url || message.content}
              alt="Shared image"
              className="max-w-[250px] max-h-[300px] object-cover hover:opacity-90 transition-opacity"
            />
          </div>
        );
      case 'video':
        return (
          <div
            className="relative cursor-pointer overflow-hidden rounded-xl group"
            onClick={() => openMediaViewer('video', message.media_url || message.content)}
          >
            <video
              src={message.media_url || message.content}
              className="max-w-[250px] max-h-[300px] object-cover"
            />
            <div className="absolute inset-0 bg-black/30 flex items-center justify-center group-hover:bg-black/40 transition-colors">
              <div className="w-14 h-14 rounded-full bg-white/90 flex items-center justify-center">
                <Play className="w-6 h-6 text-slate-800 ml-1" fill="currentColor" />
              </div>
            </div>
          </div>
        );
      case 'voice':
        return <VoiceMessageBubble message={message} isOwn={isOwn} />;
      case 'gif':
        return (
          <img
            src={message.gif_url || message.content}
            alt="GIF"
            className="max-w-[250px] rounded-xl"
          />
        );
      case 'file':
        return (
          <DocumentBubble message={message} isOwn={isOwn} />
        );
      default:
        return (
          <p className="text-sm leading-relaxed break-words whitespace-pre-wrap">{message.content}</p>
        );
    }
  };

  // renderMessageContent is recreated every render (it closes over a lot:
  // openMediaViewer, VoiceMessageBubble, DocumentBubble, etc.) which used to
  // break MessageBubble's React.memo — a brand new function prop every
  // render makes memo always see "changed props" and re-render every single
  // message bubble on every render of ChatView, including the ~60-times-
  // a-second setVoiceState calls that drive the recording waveform. On a
  // chat with any real history that alone was enough to make the whole
  // recording interaction (and the drag gesture driving it) feel stuck.
  // Keeping a ref to the latest version and handing MessageBubble a
  // permanently-stable wrapper fixes that without having to hand-audit a
  // large dependency array (and risk stale closures) for useCallback.
  const renderMessageContentRef = useRef(renderMessageContent);
  renderMessageContentRef.current = renderMessageContent;
  const stableRenderMessageContent = useCallback(
    (message: Message, isOwn: boolean) => renderMessageContentRef.current(message, isOwn),
    []
  );

  return (
    <div className="h-full flex flex-col relative bg-slate-100">
      {/* Chat Background Pattern */}
      <div className="absolute inset-0 opacity-[0.03] pointer-events-none">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%239C92AC' fill-opacity='0.4'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
          }}
        ></div>
      </div>

      {/* Chat Header */}
      <div className="relative z-10 bg-gradient-to-r from-violet-500 via-purple-500 to-fuchsia-500 text-white px-3 py-2.5 shadow-lg">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="p-2 -ml-1 rounded-full hover:bg-white/20 active:bg-white/30 transition-all"
            aria-label="Back"
          >
            <ArrowLeft className="w-5 h-5" strokeWidth={2} />
          </button>

          {/* Circular Profile Picture */}
          <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center text-lg overflow-hidden ring-2 ring-white/30">
            {contact.profile.avatar_url ? (
              <img
                src={contact.profile.avatar_url}
                alt={contact.profile.full_name}
                className="w-full h-full object-cover"
              />
            ) : (
              <span className="font-semibold">{contact.profile.full_name.charAt(0).toUpperCase()}</span>
            )}
          </div>

          <div className="flex-1 min-w-0">
            <h2 className="text-base font-semibold truncate">{contact.profile.full_name}</h2>
            <p key={isTyping ? 'typing' : 'status'} className="text-xs text-white/80 h-4 flex items-center animate-fade-in">
              {isTyping ? (
                <span className="flex items-center gap-1.5 text-green-300 font-medium">
                  typing
                  <span className="flex items-end gap-0.5 h-2">
                    <span className="w-1 h-1 bg-green-300 rounded-full typing-dot" style={{ animationDelay: '0ms' }} />
                    <span className="w-1 h-1 bg-green-300 rounded-full typing-dot" style={{ animationDelay: '150ms' }} />
                    <span className="w-1 h-1 bg-green-300 rounded-full typing-dot" style={{ animationDelay: '300ms' }} />
                  </span>
                </span>
              ) : (
                <span className={contact.profile.is_online ? 'text-green-300 font-medium' : ''}>
                  {presenceStatusText(contact.profile.is_online, contact.profile.last_seen)}
                </span>
              )}
            </p>
          </div>

          <button
            onClick={() => onCall('video')}
            className="p-2 rounded-full hover:bg-white/20 active:bg-white/30 transition-all"
          >
            <Video className="w-5 h-5" strokeWidth={2} />
          </button>
          <button
            onClick={() => onCall('voice')}
            className="p-2 rounded-full hover:bg-white/20 active:bg-white/30 transition-all"
          >
            <Phone className="w-5 h-5" strokeWidth={2} />
          </button>
          <div className="relative">
            <button
              onClick={() => setShowMenu(!showMenu)}
              className="p-2 rounded-full hover:bg-white/20 active:bg-white/30 transition-all"
            >
              <MoreVertical className="w-5 h-5" strokeWidth={2} />
            </button>

            {/* Dropdown Menu */}
            {showMenu && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setShowMenu(false)}
                />
                <div className="absolute right-0 top-full mt-1 w-48 bg-white rounded-xl shadow-xl border border-slate-200 overflow-hidden z-50 animate-scale-in">
                  <button
                    onClick={() => {
                      setShowMenu(false);
                      setShowBlockConfirm(true);
                    }}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left text-red-600 hover:bg-red-50 transition-colors"
                  >
                    <UserX className="w-4 h-4" />
                    <span className="text-sm font-medium">Block User</span>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Block Confirmation Modal */}
      {showBlockConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl">
            <div className="flex flex-col items-center text-center">
              <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mb-4">
                <UserX className="w-8 h-8 text-red-500" />
              </div>
              <h3 className="text-lg font-bold text-slate-800 mb-2">Block {contact.profile.full_name}?</h3>
              <p className="text-sm text-slate-500 mb-6">
                Blocked users cannot send you messages or call you. They will also be removed from your friends list.
              </p>
              <div className="flex gap-3 w-full">
                <button
                  onClick={() => setShowBlockConfirm(false)}
                  disabled={blocking}
                  className="flex-1 py-3 px-4 rounded-xl bg-slate-100 text-slate-700 font-semibold text-sm hover:bg-slate-200 transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleBlockUser}
                  disabled={blocking}
                  className="flex-1 py-3 px-4 rounded-xl bg-red-500 text-white font-semibold text-sm hover:bg-red-600 transition-colors disabled:opacity-50"
                >
                  {blocking ? 'Blocking...' : 'Block'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-1.5 relative z-10">
        {messages.length === 0 && isInitialLoad ? (
          // Show subtle skeleton placeholder during initial load - no spinner
          <div className="flex flex-col gap-2 animate-pulse">
            {[1, 2, 3].map(i => (
              <div key={i} className={`flex ${i % 2 === 0 ? 'justify-end' : 'justify-start'}`}>
                <div className={`h-10 rounded-2xl bg-slate-200/50 ${i % 2 === 0 ? 'w-48' : 'w-56'}`} />
              </div>
            ))}
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full">
            <div className="bg-white rounded-2xl p-6 shadow-sm text-center max-w-[280px]">
              <div className="w-16 h-16 rounded-full bg-gradient-to-br from-violet-400 to-fuchsia-400 flex items-center justify-center text-2xl mb-3 mx-auto">
                👋
              </div>
              <p className="text-sm text-slate-700 font-medium">Say hello to {contact.profile.full_name}!</p>
              <p className="text-xs text-slate-500 mt-1">Start the conversation</p>
            </div>
          </div>
        ) : (
          messages.map((message) => (
            <MessageBubble
              key={message.client_message_id || message.id}
              message={message}
              isOwn={message.sender_id === currentUser.id}
              currentUserId={currentUser.id}
              renderMessageContent={stableRenderMessageContent}
              formatTime={formatTime}
              onLongPress={handleMessageLongPress}
              onReactionClick={handleReactionClick}
            />
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Uploading indicator - subtle, non-blocking */}
      {uploading && (
        <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-20">
          <div className="flex items-center gap-2 px-4 py-2 bg-violet-500/90 text-white rounded-full shadow-lg">
            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            <span className="text-sm font-medium">Sending...</span>
          </div>
        </div>
      )}

      {/* TEMP DEBUG — remove once the slide-to-cancel/lock gesture is
          confirmed fixed. Shows live numbers so we can tell from a
          screenshot whether touchmove is even reaching our handlers (the
          numbers should change the instant you start dragging), instead of
          guessing from how the overlay looks. */}
      {voiceState.isRecording && (
        <div
          style={{
            position: 'fixed',
            top: 'max(6px, env(safe-area-inset-top))',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 9999,
            background: 'rgba(0,0,0,0.85)',
            color: '#0f0',
            fontFamily: 'monospace',
            fontSize: '11px',
            padding: '4px 8px',
            borderRadius: '6px',
            whiteSpace: 'nowrap',
            pointerEvents: 'none'
          }}
        >
          dx:{Math.round(voiceState.startX - voiceState.currentX)} lockProg:{voiceState.lockProgress.toFixed(2)} locked:{String(voiceState.isLocked)} cancel:{String(voiceState.isCancelling)} dur:{voiceState.duration}
        </div>
      )}

      {/* Voice Recording UI - WhatsApp Style */}
      {voiceState.isRecording && (
        <div
          className="absolute bottom-0 left-0 right-0 z-30 bg-white border-t border-slate-200"
          style={{ touchAction: 'none', overscrollBehavior: 'none' }}
        >
          {voiceState.isLocked ? (
            // Locked Recording Mode
            <div className="px-4 py-3">
              {/* `min-w-0` + `overflow-hidden` on the waveform cell and
                  `shrink-0` on every other control are both required here:
                  this row used to render up to 50 fixed-width (4px) bars
                  inside a plain `flex-1` cell, which has no min-width
                  override by default — flexbox's automatic minimum size
                  for a non-wrapping row of fixed-width children is the sum
                  of their widths, so the cell refused to shrink below
                  ~400px and pushed the pause/duration/send buttons straight
                  off the right edge of the screen on real phones. */}
              <div className="flex items-center gap-3">
                <button
                  onClick={() => stopRecording(true)}
                  className="w-10 h-10 shrink-0 rounded-full bg-red-100 text-red-500 flex items-center justify-center hover:bg-red-200 transition-colors"
                >
                  <Trash2 className="w-5 h-5" />
                </button>

                {/* Real-time Waveform */}
                <div className="flex-1 min-w-0 overflow-hidden flex items-center gap-1 h-10 px-2">
                  {voiceState.waveformData.slice(-18).map((value, i) => (
                    <div
                      key={i}
                      className={`w-1 shrink-0 bg-violet-500 rounded-full transition-all duration-75 ${voiceState.isPaused ? 'opacity-50' : ''}`}
                      style={{ height: `${Math.max(4, value * 32)}px` }}
                    />
                  ))}
                  {/* Fill remaining space with placeholder bars */}
                  {Array.from({ length: Math.max(0, 18 - voiceState.waveformData.length) }).map((_, i) => (
                    <div key={`placeholder-${i}`} className="w-1 h-1 shrink-0 bg-slate-300 rounded-full" />
                  ))}
                </div>

                {/* Pause / Resume the locked recording in place */}
                <button
                  onClick={() => (voiceState.isPaused ? resumeRecording() : pauseRecording())}
                  className="w-10 h-10 shrink-0 rounded-full bg-violet-100 text-violet-600 flex items-center justify-center hover:bg-violet-200 transition-colors"
                  aria-label={voiceState.isPaused ? 'Resume recording' : 'Pause recording'}
                >
                  {voiceState.isPaused ? (
                    <Play className="w-5 h-5 ml-0.5" fill="currentColor" />
                  ) : (
                    <Pause className="w-5 h-5" fill="currentColor" />
                  )}
                </button>

                <div className="flex items-center gap-2 shrink-0">
                  <div className={`w-2 h-2 rounded-full bg-red-500 ${voiceState.isPaused ? '' : 'animate-pulse'}`} />
                  <span className="text-sm font-semibold text-slate-700 tabular-nums min-w-[40px]">
                    {formatDuration(voiceState.duration)}
                  </span>
                </div>


                <button
                  onClick={() => stopRecording(false)}
                  className="w-10 h-10 shrink-0 rounded-full bg-gradient-to-r from-violet-500 to-purple-500 text-white flex items-center justify-center shadow-lg"
                >
                  <Send className="w-5 h-5" />
                </button>
              </div>
            </div>
          ) : (
            // Slide to Cancel Mode - WhatsApp Style
            <div className="voice-recording-slide-ui">
              {/* Cancel Zone - appears when sliding left */}
              <div
                className={`voice-cancel-zone ${voiceState.isCancelling ? 'active' : ''}`}
                style={{
                  opacity: Math.min(1, (voiceState.startX - voiceState.currentX) / 100)
                }}
              >
                <Trash2 className="w-5 h-5" />
                <span>Release to cancel</span>
              </div>

              {/* Main recording UI */}
              <div
                className="voice-recording-content"
                style={{
                  transform: `translateX(${Math.max(-120, Math.min(0, voiceState.currentX - voiceState.startX))}px)`,
                  opacity: voiceState.isCancelling ? 0.5 : 1
                }}
              >
                {/* Slide to cancel hint */}
                <div className={`voice-slide-hint ${voiceState.isCancelling ? 'cancelling' : ''}`}>
                  <ChevronLeft className="w-4 h-4" />
                  <ChevronLeft className="w-4 h-4 -ml-2" />
                  <span>Slide to cancel</span>
                </div>

                {/* Real-time Waveform */}
                <div className="voice-waveform-container">
                  {voiceState.waveformData.slice(-25).map((value, i) => (
                    <div
                      key={i}
                      className="voice-waveform-bar"
                      style={{ height: `${Math.max(4, value * 28)}px` }}
                    />
                  ))}
                </div>

                {/* Duration & Lock */}
                <div className="voice-recording-right">
                  <div className="voice-duration">
                    <div className="voice-recording-dot" />
                    <span>{formatDuration(voiceState.duration)}</span>
                  </div>

                  {/* Lock indicator - swipe up to lock. Slides up and
                      brightens as the user drags toward the threshold, so
                      the gesture has clear visual feedback instead of
                      snapping on/off with no warning. */}
                  <div
                    className="voice-lock-hint"
                    style={{
                      transform: `translateY(${-voiceState.lockProgress * 10}px)`,
                      opacity: 0.55 + voiceState.lockProgress * 0.45
                    }}
                  >
                    <ChevronLeft className="w-3 h-3 rotate-90 -mb-1 opacity-70" />
                    <Lock className="w-3.5 h-3.5" />
                  </div>
                </div>
              </div>

              {/* Floating mic button that follows finger */}
              <div
                className={`voice-mic-float ${voiceState.isCancelling ? 'cancelling' : ''}`}
                style={{
                  transform: `translateX(${Math.max(-120, Math.min(0, voiceState.currentX - voiceState.startX))}px)`
                }}
              >
                <Mic className="w-5 h-5" />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Hidden File Inputs - Outside of visible area */}
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

      {/* Message Input - Glassy Modern Design.
          IMPORTANT: this used to be conditionally UNMOUNTED while recording
          ({!voiceState.isRecording && (...)}), which removed the mic
          <button> (the exact element that received touchstart) from the
          DOM the instant recording began. Per the touch-events spec, once
          an active touch's original target is disconnected from the
          document, some browsers (confirmed: Android Chrome on the
          reporting user's device) stop delivering touchmove/touchend for
          that touch at all — they do NOT reliably re-target/bubble to a
          surviving ancestor like `document`, even though Round 2's fix
          assumed they would. That's why slide-to-cancel/slide-up-to-lock
          never worked on a real phone despite listeners being correctly
          attached to `document`: the events were never being dispatched
          anywhere once the button vanished.
          Fix: keep this whole block mounted at all times, and hide it with
          an off-screen/opacity-0/pointer-events-none style instead of
          unmounting it. `position: fixed` takes it out of layout flow so
          it can't cause a layout shift or block the recording overlay
          rendered on top of it. */}
      <div
        className="relative z-10 px-3 py-3 pb-[max(12px,env(safe-area-inset-bottom))]"
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
            <div className="mb-2 bg-white/90 backdrop-blur-sm rounded-xl px-3 py-2 flex items-start gap-2 border-l-4 border-violet-500">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-violet-600">
                  Replying to {replyToMessage.sender_id === currentUser.id ? 'yourself' : contact.profile.full_name}
                </p>
                <p className="text-sm text-slate-600 truncate">
                  {replyToMessage.type === 'text' ? replyToMessage.content : `[${replyToMessage.type}]`}
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

          {/* Glassy Input Container */}
          <div className="chat-input-glass">
            <div className="chat-input-inner">
              {/* Media Options Button */}
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

                {/* Media Options Popup */}
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


              {/* Text Input Field */}
              <div className="chat-input-field">
                <input
                  type="text"
                  placeholder="Type a message..."
                  value={inputMessage}
                  onChange={(e) => handleInputChange(e.target.value)}
                  onKeyPress={handleKeyPress}
                />
              </div>

              {/* Send or Voice Button */}
              {inputMessage.trim() ? (
                <button
                  onClick={handleSendMessage}
                  disabled={sending}
                  className="chat-send-btn"
                >
                  <Send className={`w-5 h-5 transition-opacity ${sending ? 'opacity-50' : ''}`} strokeWidth={2} />
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

      {/* Modern Media Viewer - Instagram/WhatsApp Style */}
      {mediaViewer.isOpen && (
        <div className="fixed inset-0 z-50 bg-black/95 flex flex-col animate-fade-in">
          {/* Viewer Header with Glassmorphism */}
          <div className="absolute top-0 left-0 right-0 z-20 bg-gradient-to-b from-black/70 via-black/40 to-transparent">
            <div className="flex items-center justify-between px-4 py-4 safe-area-inset-top">
              <button
                onClick={closeMediaViewer}
                className="w-10 h-10 rounded-full bg-white/10 backdrop-blur-lg flex items-center justify-center hover:bg-white/20 transition-all active:scale-95"
              >
                <ArrowLeft className="w-5 h-5 text-white" />
              </button>

              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full overflow-hidden ring-2 ring-white/20">
                  {contact.profile.avatar_url ? (
                    <img src={contact.profile.avatar_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full bg-gradient-to-br from-violet-500 to-purple-500 flex items-center justify-center text-white text-sm font-semibold">
                      {contact.profile.full_name.charAt(0)}
                    </div>
                  )}
                </div>
                <div>
                  <p className="text-white font-medium text-sm">{contact.profile.full_name}</p>
                  <p className="text-white/60 text-xs">Tap to view profile</p>
                </div>
              </div>

              <button className="w-10 h-10 rounded-full bg-white/10 backdrop-blur-lg flex items-center justify-center hover:bg-white/20 transition-all active:scale-95">
                <MoreVertical className="w-5 h-5 text-white" />
              </button>
            </div>
          </div>

          {/* Media Content - Centered with animation */}
          <div className="flex-1 flex items-center justify-center p-4 pt-20 pb-8">
            {mediaViewer.type === 'image' ? (
              <div className="relative animate-scale-in">
                <img
                  src={mediaViewer.url}
                  alt="Full size"
                  className="max-w-full max-h-[80vh] object-contain rounded-lg shadow-2xl"
                />
              </div>
            ) : mediaViewer.type === 'video' ? (
              <div className="relative w-full max-w-3xl animate-scale-in">
                <video
                  src={mediaViewer.url}
                  controls
                  autoPlay
                  playsInline
                  className="w-full max-h-[80vh] rounded-xl shadow-2xl bg-black"
                  controlsList="nodownload"
                />
              </div>
            ) : null}
          </div>

          {/* Bottom Actions Bar */}
          <div className="absolute bottom-0 left-0 right-0 z-20 bg-gradient-to-t from-black/70 via-black/40 to-transparent">
            <div className="flex items-center justify-center gap-6 px-4 py-6 safe-area-inset-bottom">
              <button className="flex flex-col items-center gap-1 text-white/80 hover:text-white transition-colors">
                <div className="w-12 h-12 rounded-full bg-white/10 backdrop-blur-lg flex items-center justify-center">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                  </svg>
                </div>
                <span className="text-xs">Share</span>
              </button>

              <button className="flex flex-col items-center gap-1 text-white/80 hover:text-white transition-colors">
                <div className="w-12 h-12 rounded-full bg-white/10 backdrop-blur-lg flex items-center justify-center">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                </div>
                <span className="text-xs">Save</span>
              </button>

              <button className="flex flex-col items-center gap-1 text-white/80 hover:text-white transition-colors">
                <div className="w-12 h-12 rounded-full bg-white/10 backdrop-blur-lg flex items-center justify-center">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                  </svg>
                </div>
                <span className="text-xs">Bookmark</span>
              </button>
            </div>
          </div>

          {/* Tap to close overlay (optional) */}
          <div
            className="absolute inset-0 z-10"
            onClick={closeMediaViewer}
            style={{ pointerEvents: 'auto' }}
          />
        </div>
      )}

      {/* Message Actions Menu */}
      {selectedMessage && (
        <MessageActions
          message={selectedMessage}
          isOwn={selectedMessage.sender_id === currentUser.id}
          currentUserId={currentUser.id}
          onClose={handleCloseActionMenu}
          onReactionAdded={handleReactionAdded}
          onMessageEdited={handleMessageEdited}
          onMessageDeleted={handleMessageDeleted}
          onForward={handleForwardMessage}
          onReply={handleReplyMessage}
          position={actionMenuPosition}
        />
      )}

      {/* Forward Dialog */}
      {showForwardDialog && messageToForward && (
        <ForwardDialog
          message={messageToForward}
          contacts={contacts}
          groups={groups}
          currentUserId={currentUser.id}
          onClose={() => { setShowForwardDialog(false); setMessageToForward(null); }}
          onForwardComplete={handleForwardComplete}
        />
      )}

      {/* Animation Styles */}
      <style>{`
        @keyframes waveform {
          0% { transform: scaleY(0.5); }
          100% { transform: scaleY(1); }
        }
        @keyframes fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes scale-in {
          from { opacity: 0; transform: scale(0.95); }
          to { opacity: 1; transform: scale(1); }
        }
        .animate-fade-in {
          animation: fade-in 0.2s ease-out;
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

        /* Glassy Chat Input Styles */
        .chat-input-glass {
          background: linear-gradient(135deg, rgba(168, 85, 247, 0.9) 0%, rgba(139, 92, 246, 0.9) 50%, rgba(124, 58, 237, 0.9) 100%);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border-radius: 28px;
          padding: 4px;
          box-shadow:
            0 8px 32px rgba(168, 85, 247, 0.3),
            0 0 0 1px rgba(255, 255, 255, 0.1) inset,
            0 2px 4px rgba(0, 0, 0, 0.1);
        }

        .chat-input-inner {
          display: flex;
          align-items: center;
          gap: 8px;
          background: rgba(255, 255, 255, 0.15);
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
          border-radius: 24px;
          padding: 6px 6px 6px 8px;
          border: 1px solid rgba(255, 255, 255, 0.2);
        }

        .chat-input-action-btn {
          width: 40px;
          height: 40px;
          border-radius: 50%;
          background: rgba(255, 255, 255, 0.2);
          border: none;
          color: white;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all 0.2s ease;
          flex-shrink: 0;
        }

        .chat-input-action-btn:hover {
          background: rgba(255, 255, 255, 0.3);
          transform: scale(1.05);
        }

        .chat-input-action-btn.active {
          background: rgba(255, 255, 255, 0.35);
          transform: rotate(45deg);
        }

        .chat-input-field {
          flex: 1;
          min-width: 0;
        }

        .chat-input-field input {
          width: 100%;
          background: transparent;
          border: none;
          outline: none;
          font-size: 15px;
          color: white;
          padding: 10px 4px;
          line-height: 1.4;
        }

        .chat-input-field input::placeholder {
          color: rgba(255, 255, 255, 0.6);
        }

        .chat-send-btn,
        .chat-voice-btn {
          width: 44px;
          height: 44px;
          min-width: 44px;
          min-height: 44px;
          border-radius: 50%;
          background: white;
          border: none;
          color: #8b5cf6;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all 0.2s ease;
          flex-shrink: 0;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        }

        .chat-voice-btn {
          user-select: none;
          -webkit-user-select: none;
          touch-action: none;
        }

        .voice-hold-hint {
          position: absolute;
          bottom: calc(100% + 10px);
          right: 0;
          white-space: nowrap;
          background: rgba(30, 27, 46, 0.92);
          color: white;
          font-size: 12.5px;
          font-weight: 500;
          padding: 7px 12px;
          border-radius: 10px;
          box-shadow: 0 6px 18px rgba(0, 0, 0, 0.25);
          animation: hold-hint-pop 0.18s ease-out;
          pointer-events: none;
          z-index: 5;
        }

        .voice-hold-hint::after {
          content: '';
          position: absolute;
          top: 100%;
          right: 16px;
          border: 5px solid transparent;
          border-top-color: rgba(30, 27, 46, 0.92);
        }

        @keyframes hold-hint-pop {
          from { opacity: 0; transform: translateY(4px); }
          to { opacity: 1; transform: translateY(0); }
        }

        .chat-send-btn:hover,
        .chat-voice-btn:hover {
          transform: scale(1.08);
          box-shadow: 0 6px 20px rgba(0, 0, 0, 0.2);
        }

        .chat-send-btn:active,
        .chat-voice-btn:active {
          transform: scale(0.95);
        }

        .chat-send-btn:disabled {
          opacity: 0.7;
          cursor: not-allowed;
          transform: none;
        }

        /* Media Options Popup */
        .chat-media-popup {
          position: absolute;
          bottom: 54px;
          left: 0;
          background: white;
          border-radius: 20px;
          box-shadow: 0 10px 40px rgba(0, 0, 0, 0.15);
          overflow: hidden;
          animation: popup-slide 0.25s ease-out;
          min-width: 160px;
        }

        @keyframes popup-slide {
          from {
            opacity: 0;
            transform: translateY(10px) scale(0.95);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }

        .chat-media-option {
          display: flex;
          align-items: center;
          gap: 12px;
          width: 100%;
          padding: 14px 16px;
          border: none;
          background: transparent;
          cursor: pointer;
          transition: background 0.15s ease;
        }

        .chat-media-option:hover {
          background: #f9fafb;
        }

        .chat-media-option:active {
          background: #f3f4f6;
        }

        .chat-media-option span {
          font-size: 14px;
          font-weight: 500;
          color: #374151;
        }

        .chat-media-option-icon {
          width: 40px;
          height: 40px;
          border-radius: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .chat-media-option-icon.purple {
          background: linear-gradient(135deg, #f3e8ff 0%, #e9d5ff 100%);
          color: #9333ea;
        }

        .chat-media-option-icon.pink {
          background: linear-gradient(135deg, #fce7f3 0%, #fbcfe8 100%);
          color: #db2777;
        }

        .chat-media-option-icon.blue {
          background: linear-gradient(135deg, #dbeafe 0%, #bfdbfe 100%);
          color: #2563eb;
        }

        /* Voice Message Bubble Styles */
        .voice-message-bubble {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 14px;
          border-radius: 20px;
          min-width: 240px;
          max-width: 320px;
        }

        .voice-message-bubble.own {
          background: linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%);
          border-bottom-right-radius: 6px;
        }

        .voice-message-bubble.received {
          background: #ffffff;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
          border-bottom-left-radius: 6px;
        }

        .voice-message-avatar {
          width: 36px;
          height: 36px;
          min-width: 36px;
          border-radius: 50%;
          background: linear-gradient(135deg, #a855f7 0%, #7c3aed 100%);
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
          flex-shrink: 0;
        }

        .voice-message-avatar.own {
          background: linear-gradient(135deg, #c084fc 0%, #a855f7 100%);
        }

        .voice-message-play-btn {
          width: 42px;
          height: 42px;
          min-width: 42px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          border: none;
          cursor: pointer;
          transition: all 0.2s ease;
          flex-shrink: 0;
        }

        .voice-message-play-btn.own {
          background: rgba(255, 255, 255, 0.25);
          color: white;
        }

        .voice-message-play-btn.own:hover {
          background: rgba(255, 255, 255, 0.35);
        }

        .voice-message-play-btn.received {
          background: linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%);
          color: white;
          box-shadow: 0 2px 8px rgba(139, 92, 246, 0.3);
        }

        .voice-message-play-btn.received:hover {
          transform: scale(1.05);
          box-shadow: 0 4px 12px rgba(139, 92, 246, 0.4);
        }

        .voice-message-content {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .voice-message-waveform {
          display: flex;
          align-items: center;
          gap: 2px;
          height: 28px;
        }

        .voice-waveform-bar {
          width: 3px;
          border-radius: 3px;
          transition: all 0.1s ease;
          min-height: 4px;
        }

        .voice-waveform-bar.own {
          background: rgba(255, 255, 255, 0.4);
        }

        .voice-waveform-bar.own.played {
          background: rgba(255, 255, 255, 0.9);
        }

        .voice-waveform-bar.received {
          background: #e2e8f0;
        }

        .voice-waveform-bar.received.played {
          background: #8b5cf6;
        }

        .voice-message-duration {
          font-size: 12px;
          font-weight: 500;
          font-variant-numeric: tabular-nums;
        }

        .voice-message-duration.own {
          color: rgba(255, 255, 255, 0.8);
        }

        .voice-message-duration.received {
          color: #64748b;
        }

        /* Voice Recording Slide UI - WhatsApp Style */
        .voice-recording-slide-ui {
          position: relative;
          padding: 12px 16px;
          background: linear-gradient(135deg, rgba(168, 85, 247, 0.95) 0%, rgba(139, 92, 246, 0.95) 50%, rgba(124, 58, 237, 0.95) 100%);
          overflow: hidden;
        }

        .voice-cancel-zone {
          position: absolute;
          left: 16px;
          top: 50%;
          transform: translateY(-50%);
          display: flex;
          align-items: center;
          gap: 8px;
          color: #ef4444;
          font-size: 13px;
          font-weight: 500;
          opacity: 0;
          transition: opacity 0.15s ease;
        }

        .voice-cancel-zone.active {
          opacity: 1;
        }

        .voice-recording-content {
          display: flex;
          align-items: center;
          gap: 12px;
          transition: transform 0.05s ease-out, opacity 0.15s ease;
        }

        .voice-slide-hint {
          display: flex;
          align-items: center;
          gap: 2px;
          flex-shrink: 0;
          color: rgba(255, 255, 255, 0.7);
          font-size: 12px;
          animation: slide-hint 1.5s ease-in-out infinite;
        }

        .voice-slide-hint.cancelling {
          color: #fca5a5;
        }

        .voice-slide-hint span {
          margin-left: 4px;
        }

        @keyframes slide-hint {
          0%, 100% { transform: translateX(0); opacity: 0.7; }
          50% { transform: translateX(-5px); opacity: 1; }
        }

        .voice-waveform-container {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 2px;
          height: 32px;
          min-width: 0;
          overflow: hidden;
        }

        .voice-waveform-bar {
          width: 3px;
          flex-shrink: 0;
          background: rgba(255, 255, 255, 0.8);
          border-radius: 2px;
          transition: height 0.05s ease;
          min-height: 4px;
        }

        .voice-recording-right {
          display: flex;
          align-items: center;
          gap: 12px;
          flex-shrink: 0;
        }

        .voice-duration {
          display: flex;
          align-items: center;
          gap: 6px;
          color: white;
          font-size: 15px;
          font-weight: 600;
          font-variant-numeric: tabular-nums;
        }

        .voice-recording-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #ef4444;
          animation: recording-pulse 1s ease-in-out infinite;
        }

        @keyframes recording-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(0.85); }
        }

        .voice-lock-hint {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          width: 32px;
          height: 32px;
          background: rgba(255, 255, 255, 0.2);
          border-radius: 50%;
          color: rgba(255, 255, 255, 0.8);
          /* Position/opacity are driven live by how far the user has
             dragged up toward the lock threshold (see lockProgress), this
             transition just smooths out the per-frame updates. */
          transition: transform 0.08s linear, opacity 0.08s linear;
        }

        .voice-mic-float {
          position: absolute;
          right: 16px;
          top: 50%;
          transform: translateY(-50%);
          width: 48px;
          height: 48px;
          border-radius: 50%;
          background: white;
          color: #8b5cf6;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
          transition: transform 0.05s ease-out, background 0.2s ease, color 0.2s ease;
        }

        .voice-mic-float.cancelling {
          background: #fef2f2;
          color: #ef4444;
        }

        /* Responsive adjustments */
        @media (max-width: 380px) {
          .chat-input-inner {
            gap: 6px;
            padding: 5px 5px 5px 6px;
          }

          .chat-input-action-btn {
            width: 36px;
            height: 36px;
          }

          .chat-send-btn,
          .chat-voice-btn {
            width: 40px;
            height: 40px;
          }

          .chat-input-field input {
            font-size: 14px;
            padding: 8px 2px;
          }
        }

        /* Message Bubble Wrapper for Reactions Positioning */
        .message-bubble-wrapper {
          position: relative;
          display: inline-flex;
          flex-direction: column;
          max-width: 80%;
        }

        .message-bubble-wrapper.own {
          align-items: flex-end;
        }

        .message-bubble-wrapper.received {
          align-items: flex-start;
        }

        /* Reactions Container - Bottom Right Corner */
        .reactions-container {
          position: absolute;
          bottom: -12px;
          z-index: 10;
        }

        .reactions-container.own {
          right: 8px;
        }

        .reactions-container.received {
          left: 8px;
        }

        .reactions-wrapper {
          display: flex;
          gap: 4px;
          padding: 2px;
          background: white;
          border-radius: 12px;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
        }

        .reaction-pill {
          display: flex;
          align-items: center;
          gap: 2px;
          padding: 3px 6px;
          border-radius: 10px;
          background: #f1f5f9;
          border: none;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .reaction-pill:hover {
          background: #e2e8f0;
          transform: scale(1.05);
        }

        .reaction-pill.reacted {
          background: linear-gradient(135deg, #ede9fe 0%, #ddd6fe 100%);
          box-shadow: 0 0 0 1.5px #a78bfa;
        }

        .reaction-emoji {
          font-size: 14px;
          line-height: 1;
        }

        .reaction-count {
          font-size: 10px;
          font-weight: 600;
          color: #64748b;
          min-width: 12px;
          text-align: center;
        }

        .reaction-pill.reacted .reaction-count {
          color: #7c3aed;
        }

        /* Document Bubble Styles */
        .document-bubble {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px;
          border-radius: 16px;
          min-width: 260px;
          max-width: 300px;
        }

        .document-bubble.own {
          background: rgba(255, 255, 255, 0.15);
        }

        .document-bubble.received {
          background: #f8fafc;
          border: 1px solid #e2e8f0;
        }

        .document-icon {
          position: relative;
          width: 48px;
          height: 48px;
          min-width: 48px;
          border-radius: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .document-extension {
          position: absolute;
          bottom: -4px;
          right: -4px;
          font-size: 8px;
          font-weight: 700;
          padding: 2px 4px;
          border-radius: 4px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .document-info {
          flex: 1;
          min-width: 0;
          overflow: hidden;
        }

        .document-name {
          font-size: 14px;
          font-weight: 600;
          line-height: 1.3;
          word-break: break-word;
        }

        .document-type {
          font-size: 12px;
          margin-top: 2px;
        }

        .document-actions {
          display: flex;
          gap: 6px;
        }

        .document-action-btn {
          width: 32px;
          height: 32px;
          border-radius: 8px;
          border: none;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .document-action-btn:hover {
          transform: scale(1.05);
        }

        .document-action-btn:active {
          transform: scale(0.95);
        }

        /* Voice Button Animation States */
        .chat-voice-btn {
          position: relative;
          overflow: visible;
        }

        .chat-voice-btn::before {
          content: '';
          position: absolute;
          inset: -4px;
          border-radius: 50%;
          background: rgba(139, 92, 246, 0.2);
          opacity: 0;
          transform: scale(0.8);
          transition: all 0.2s ease;
        }

        .chat-voice-btn:active::before {
          opacity: 1;
          transform: scale(1.2);
          animation: voice-ripple 0.6s ease-out;
        }

        @keyframes voice-ripple {
          0% {
            opacity: 0.6;
            transform: scale(1);
          }
          100% {
            opacity: 0;
            transform: scale(1.8);
          }
        }

        /* Voice Recording Enhanced Animation */
        .voice-recording-slide-ui {
          position: relative;
          padding: 12px 16px;
          background: linear-gradient(135deg, rgba(168, 85, 247, 0.98) 0%, rgba(139, 92, 246, 0.98) 50%, rgba(124, 58, 237, 0.98) 100%);
          overflow: hidden;
        }

        .voice-recording-slide-ui::before {
          content: '';
          position: absolute;
          inset: 0;
          background: linear-gradient(90deg, transparent 0%, rgba(255, 255, 255, 0.1) 50%, transparent 100%);
          animation: recording-shimmer 2s infinite linear;
        }

        @keyframes recording-shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
      `}</style>
    </div>
  );
}
