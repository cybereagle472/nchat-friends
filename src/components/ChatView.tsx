import { ArrowLeft, MoreVertical, Phone, Video, Send, Plus, X, Image as ImageIcon, FileText, Film, Mic, CheckCheck, Play, Pause, Lock, Trash2, ChevronLeft, ChevronUp, UserX } from 'lucide-react';
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
import LowPolyBackground from './LowPolyBackground';
import { useKeyboardInset } from '../hooks/useKeyboardInset';

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
// Fewer, slightly taller/bolder bars read as a much more deliberate,
// "designed" waveform at typical bubble widths than a dense row of 35 thin
// slivers does — the latter is what made sent voice messages look like a
// flat dotted line rather than a proper waveform.
const VOICE_WAVEFORM_BARS = 27;

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
    bars.push(avg);
  }

  // getByteFrequencyData() averages across the *entire* FFT range, most of
  // which carries no energy for a voice recording (speech barely reaches
  // past a few kHz), so the raw per-bucket averages end up clustered in a
  // narrow, low band (observed: mostly ~0.03–0.12) no matter how loud or
  // expressive the actual audio is. Rendering that raw gave every bar
  // nearly the same (floored) height — a flat row of dots instead of a
  // waveform. Normalizing each clip to its own loudest bucket (the same
  // technique real waveform UIs use) stretches whatever real variation
  // exists back out across the full 0–1 range, so quiet vs. loud moments
  // in *this* clip are actually visually distinguishable.
  const max = Math.max(...bars, 0);
  const normalized = max > 0 ? bars.map((v) => v / max) : bars;
  return normalized.map((v) => Math.round(v * 100) / 100).join(',');
}

// Header subtitle text (the "last seen …" / presence line under the
// contact's name) that slides left-and-back to reveal its full content
// when it's too long to fit, instead of either wrapping onto extra lines
// (which used to make the header taller than intended) or just getting
// cut off with "…" and never showing the rest — this is the same sliding
// "marquee" behavior WhatsApp uses for the same spot.
function MarqueeText({ text, className }: { text: string; className?: string }) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [shift, setShift] = useState(0);

  useEffect(() => {
    const measure = () => {
      const container = containerRef.current;
      const textEl = textRef.current;
      if (!container || !textEl) return;
      const overflow = textEl.scrollWidth - container.clientWidth;
      // A few px of slack so the very last character actually clears the
      // edge instead of the animation stopping just short of it.
      setShift(overflow > 4 ? overflow + 6 : 0);
    };

    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [text]);

  return (
    <span ref={containerRef} className="block overflow-hidden whitespace-nowrap">
      <span
        ref={textRef}
        className={`inline-block whitespace-nowrap ${shift > 0 ? 'header-marquee-text' : ''} ${className || ''}`}
        style={shift > 0 ? ({ '--marquee-shift': `-${shift}px` } as React.CSSProperties) : undefined}
      >
        {text}
      </span>
    </span>
  );
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
  // Photos/videos/GIFs get their own bubble treatment below: unlike text
  // (which needs padding to breathe) a media bubble should be filled
  // edge-to-edge by the image/video itself, exactly like WhatsApp — the
  // standard px-3 py-2 bubble padding used to wrap a visible margin of
  // solid color around every photo's rounded corners, which looked like
  // wasted/broken space rather than a deliberate border.
  const isMedia = message.type === 'image' || message.type === 'video' || message.type === 'gif';
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
      ) : isMedia ? (
        <div
          className={`message-bubble-wrapper ${isOwn ? 'own' : 'received'}`}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onContextMenu={handleContextMenu}
        >
          <div
            className={`relative max-w-full rounded-2xl overflow-hidden select-none ${
              isOwn ? 'rounded-br-md' : 'rounded-bl-md'
            }`}
          >
            {renderMessageContent(message, isOwn)}
            {/* Timestamp + ticks overlaid directly on the media's own
                bottom-right corner (a small translucent pill, same as
                WhatsApp) instead of being pushed into a separate padded
                row below the image — that row was the other half of why
                these bubbles looked oversized relative to their content. */}
            <div className="absolute bottom-1.5 right-1.5 flex items-center gap-1 pl-1.5 pr-1 py-0.5 rounded-full bg-black/45 text-[10px] text-white leading-none">
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
      ) : (
        <div
          className={`message-bubble-wrapper ${isOwn ? 'own' : 'received'}`}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onContextMenu={handleContextMenu}
        >
          {/* This inner bubble used to also be `max-w-[80%]`, but its
              parent (.message-bubble-wrapper, right above) is ALREADY
              capped at `max-width: 80%` of the message row. Two nested
              80% caps compound multiplicatively — the bubble could only
              ever reach 80% * 80% = 64% of the row's width, so text wrapped
              far earlier than it needed to and short messages looked
              disproportionately tall/narrow. The wrapper's limit is the
              only one that should apply; this one just fills it. */}
          <div
            className={`max-w-full rounded-2xl px-3 py-2 select-none ${
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

// Voice Message Bubble — Modern design with waveform + drag-to-seek.
//
// IMPORTANT: this must stay a module-level (stable) component type, not be
// defined inline inside ChatView's render. It used to be defined inside
// ChatView, which meant every single re-render of ChatView created a brand
// new VoiceMessageBubble *function* (a new component type), and whenever
// the message bubble that rendered it re-rendered for any reason (e.g. a
// read-receipt flipping is_read on that very message, which happens almost
// immediately after it's opened), React fully unmounted and remounted it —
// wiping its local playbackProgress/currentTime/duration state back to 0
// mid-playback and making the play/pause button's visual state look stuck
// or inconsistent. Keeping it here, with everything it needs passed in as
// props instead of closed over, means re-renders just update it in place.
interface VoiceMessageBubbleProps {
  message: Message;
  isOwn: boolean;
  audioRefs: { current: Record<string, HTMLAudioElement> };
  // Called right before this bubble starts playing, so the parent can pause
  // whatever *other* voice message is currently playing — the only thing
  // that genuinely needs to be coordinated across bubbles.
  onRequestExclusivePlayback: (messageId: string) => void;
  // True for the entire time a voice *recording* is in progress (from the
  // moment the mic button is touched until it's sent/cancelled) — not just
  // at the instant it starts. Pausing other playback once, at record-start,
  // isn't enough: a locked/hands-free recording can run for a long time
  // afterward, and tapping play on any voice message during that window
  // would otherwise start audibly playing again straight into the live
  // microphone. A ref (not state) so checking/flipping it never triggers a
  // re-render of every voice bubble in the chat.
  isRecordingActiveRef: { current: boolean };
  // Shown as a small circular photo (with a mic badge) at the end of the
  // bubble, same as WhatsApp does for voice notes specifically — every
  // other bubble type stays avatar-free, this one gets it back because
  // it's genuinely how the reference app marks "who recorded this".
  avatarUrl?: string;
  avatarFallback: string;
}

const VoiceMessageBubble = memo(function VoiceMessageBubble({
  message,
  isOwn,
  audioRefs,
  onRequestExclusivePlayback,
  isRecordingActiveRef,
  avatarUrl,
  avatarFallback
}: VoiceMessageBubbleProps) {
  const [waveformData, setWaveformData] = useState<number[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  // currentTime/playbackProgress are intentionally only "checkpoints" —
  // updated a few times a second, not every frame (see the rAF effect
  // below) — they drive the duration *text* and the progress overlay's
  // resting position, not the live animation itself.
  const [playbackProgress, setPlaybackProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [dragRatio, setDragRatio] = useState<number | null>(null);
  const waveformRef = useRef<HTMLDivElement>(null);
  // The "played" portion is a second, absolutely-positioned copy of the
  // same bars in a brighter color, revealed left-to-right via clip-path as
  // playback advances — painted directly via this ref, not React state.
  const overlayRef = useRef<HTMLDivElement>(null);
  // Shared between the mount effect's Infinity-duration workaround and
  // seekTo() below, so the two can't silently stomp on each other's writes
  // to audio.currentTime. desiredTimeRef always holds "where the playhead
  // should actually end up" — kept current by normal playback checkpoints
  // *and* by explicit seeks — and is what the workaround restores to once
  // its forced discovery seek resolves, instead of a stale snapshot taken
  // before the user's tap had a chance to apply. fixingInfiniteDurationRef
  // lets seekTo know the workaround currently has an out-of-range seek
  // in flight, so it only records the intended position (desiredTimeRef)
  // rather than also writing audio.currentTime itself and racing it.
  const desiredTimeRef = useRef(0);
  const fixingInfiniteDurationRef = useRef(false);
  const bars = VOICE_WAVEFORM_BARS;
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

  // Paints the progress overlay directly via the DOM, bypassing React
  // entirely. clip-path on a GPU-composited layer is dramatically cheaper
  // than re-rendering (and re-diffing) up to 27 separate bar elements'
  // classes every frame, which is what made this feel laggy before —
  // this is the same technique native video/audio scrubbers use.
  const paintProgress = useCallback((ratio: number) => {
    const clamped = Math.max(0, Math.min(1, ratio));
    const el = overlayRef.current;
    if (el) el.style.clipPath = `inset(0 ${(1 - clamped) * 100}% 0 0)`;
  }, []);

  // This bubble owns its <audio> element outright: it creates it (if it
  // doesn't already exist — e.g. a previous mount of this exact message
  // already created and is still playing it) as soon as it mounts, and
  // drives every bit of its own UI (play/pause icon, progress, duration)
  // purely from that element's *native* play/pause/ended events (plus a
  // rAF loop for smooth progress, see below) rather than from any prop
  // computed by a parent.
  //
  // This used to instead receive `isPlaying` as a prop computed by the
  // parent from a `playingAudio` state value. That silently broke, because
  // the message-list item wrapping this bubble is wrapped in React.memo
  // with a *custom* comparator that only looks at a few message fields
  // (id/is_read/content/edited/deleted/reactions) — it has no idea
  // `playingAudio` even exists, so clicking play updated state in the
  // parent that this already-mounted, memo-blocked bubble was never told
  // about. Driving everything off the audio element's own events
  // sidesteps all of that: this component's *own* state updates always
  // cause *this* component to re-render, regardless of whether its parent
  // ever does.
  useEffect(() => {
    if (!audioRefs.current[message.id]) {
      const audioEl = new Audio(audioUrl);
      // 'metadata' (not 'none'): fetch just the header info (duration,
      // codec) as soon as the bubble mounts, not the full audio payload.
      // With 'none', the very first tap on play had to do a cold-start
      // connection *and* fetch metadata *and* buffer enough to play, all
      // back to back — which is exactly why the waveform sat frozen for a
      // few seconds before catching up. Pre-fetching just the lightweight
      // metadata while the user is already sitting in the chat (not
      // waiting on it) means duration/seekability are normally already
      // known by the time they actually tap play.
      audioEl.preload = 'metadata';
      audioRefs.current[message.id] = audioEl;
    }
    const audio = audioRefs.current[message.id];

    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => setIsPlaying(false);

    // Voice notes are recorded as MediaRecorder webm/opus blobs, which have
    // a well-known browser quirk: audio.duration reports Infinity until the
    // player has actually seeked through the file once, because the
    // container doesn't store an upfront duration. Left alone, that
    // Infinity flows into the UI as a literal "Infinity:NaN" (Infinity/60 is
    // Infinity, but Infinity%60 is NaN). The standard fix: force a seek to
    // a huge out-of-range time, which makes the browser scan to the real
    // end of the data and recompute a correct, finite duration, then snap
    // back to where playback actually was.
    const fixInfiniteDuration = () => {
      if (fixingInfiniteDurationRef.current || isFinite(audio.duration)) return;
      fixingInfiniteDurationRef.current = true;
      const onFixed = () => {
        audio.removeEventListener('timeupdate', onFixed);
        // Restore to desiredTimeRef — whatever position is actually
        // *wanted* right now — rather than a snapshot of currentTime taken
        // before this forced seek started. That snapshot used to silently
        // win a race against a tap-to-seek that happened while this was
        // still resolving in the background (which, for a voice message
        // whose metadata just finished loading, is a very common moment
        // for someone to immediately tap somewhere on the waveform): the
        // seek would land fine for an instant, then get stomped back to 0
        // the moment this callback fired, which looked exactly like
        // "seeking does nothing, it just plays from the start."
        audio.currentTime = desiredTimeRef.current;
        fixingInfiniteDurationRef.current = false;
        if (isFinite(audio.duration)) setDuration(audio.duration);
      };
      audio.addEventListener('timeupdate', onFixed);
      audio.currentTime = 1e101;
    };

    const syncCheckpoint = () => {
      // While the forced end-seek above is in flight, audio.currentTime is
      // sitting near the very end of the clip on purpose — skip painting
      // from it so the waveform doesn't flash to "finished" for a frame
      // before snapping back to where playback really is.
      if (fixingInfiniteDurationRef.current) return;
      if (!isFinite(audio.duration)) {
        fixInfiniteDuration();
        return;
      }
      if (audio.duration) {
        const ratio = audio.currentTime / audio.duration;
        setPlaybackProgress(ratio);
        setCurrentTime(audio.currentTime);
        setDuration(audio.duration);
        paintProgress(ratio);
        // Track genuine, non-workaround playhead movement too, so if the
        // Infinity-duration fix ever kicks in later mid-playback it has an
        // accurate "resume here" position rather than only ever knowing
        // about explicit seeks.
        desiredTimeRef.current = audio.currentTime;
      }
    };

    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onEnded);
    // 'timeupdate' only fires a handful of times a second in most browsers
    // — far too coarse to animate from directly, but perfect as the
    // low-frequency "checkpoint" that keeps the text/resting position
    // accurate whenever the fast rAF loop below isn't the one driving it
    // (i.e. whenever this message isn't the one currently playing).
    audio.addEventListener('timeupdate', syncCheckpoint);
    audio.addEventListener('loadedmetadata', syncCheckpoint);
    audio.addEventListener('durationchange', syncCheckpoint);

    // Sync immediately in case the element already existed with state this
    // fresh instance doesn't know about yet (e.g. it's already playing).
    setIsPlaying(!audio.paused);
    if (audio.readyState >= 1) syncCheckpoint();

    return () => {
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('timeupdate', syncCheckpoint);
      audio.removeEventListener('loadedmetadata', syncCheckpoint);
      audio.removeEventListener('durationchange', syncCheckpoint);
    };
  }, [message.id, audioUrl, audioRefs, paintProgress]);

  // The actual smooth animation: while this message is playing, repaint
  // the progress overlay every animation frame (~60fps) straight from the
  // audio element's currentTime, with zero React re-renders in the hot
  // path. The timer text is throttled to ~5/sec here, since a counting
  // clock redrawing faster than that is imperceptible but a wasted render.
  useEffect(() => {
    if (!isPlaying) return;
    const audio = audioRefs.current[message.id];
    if (!audio) return;

    let rafId = 0;
    let lastTextUpdate = 0;

    const tick = (now: number) => {
      if (audio.duration && isFinite(audio.duration)) {
        paintProgress(audio.currentTime / audio.duration);
        if (now - lastTextUpdate >= 200) {
          lastTextUpdate = now;
          setCurrentTime(audio.currentTime);
        }
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(rafId);
  }, [isPlaying, message.id, audioRefs, paintProgress]);

  // Keep the overlay in sync with any *non*-animated progress change too
  // (a seek while paused, drag feedback, metadata finally loading in) —
  // the rAF loop above only runs while actually playing.
  useEffect(() => {
    if (dragRatio !== null) return;
    paintProgress(playbackProgress);
  }, [playbackProgress, dragRatio, paintProgress]);

  const formatAudioTime = (seconds: number) => {
    // isNaN(Infinity) is false and !Infinity is false too, so neither half
    // of the old check caught it — Infinity/60 is Infinity and Infinity%60
    // is NaN, which rendered as the literal text "Infinity:NaN". That could
    // show up any time audio.duration hadn't resolved yet (see the
    // MediaRecorder Infinity-duration workaround above), so guard
    // explicitly against non-finite values here too as a last line of
    // defense regardless of where a bad value might come from.
    if (!seconds || !isFinite(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const knownDuration = duration || parseFloat(message.duration || '0');
  // Floor at 1s for the same reason the recorder now floors it when
  // saving (see stopRecording) — covers any voice message sent before
  // that fix which may still have a stored duration of exactly 0.
  const displayTime = dragRatio !== null
    ? formatAudioTime(dragRatio * knownDuration)
    : isPlaying
      ? formatAudioTime(currentTime)
      : formatAudioTime(Math.max(1, knownDuration));

  const ratioFromPointer = (e: { clientX: number }) => {
    const el = waveformRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0) return 0;
    return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  };

  const seekTo = (ratio: number) => {
    const audio = audioRefs.current[message.id];
    if (!audio) return;
    const clampedRatio = Math.max(0, Math.min(1, ratio));

    const applySeek = () => {
      // audio.duration can still be Infinity here even once metadata is
      // "loaded" — MediaRecorder-produced webm/opus blobs don't carry a
      // real duration in their container until the forced huge-seek
      // workaround above (fixInfiniteDuration) has actually resolved it,
      // which can easily still be in flight the first time someone
      // touches a just-opened bubble. The old code only ever trusted
      // audio.duration and silently did nothing when it wasn't finite yet
      // — currentTime stayed at 0, so tapping Play right after looked
      // exactly like the seek had been ignored and playback had jumped
      // back to the very start. knownDuration (the server-reported
      // duration for this clip) is already available independently of
      // whatever the <audio> element itself currently believes, so fall
      // back to it instead of giving up.
      const effectiveDuration = audio.duration && isFinite(audio.duration) ? audio.duration : knownDuration;
      if (!(effectiveDuration && isFinite(effectiveDuration) && effectiveDuration > 0)) return;
      const target = clampedRatio * effectiveDuration;
      // Always record the intended position first...
      desiredTimeRef.current = target;
      // ...but if the Infinity-duration workaround currently has its own
      // out-of-range seek in flight (see fixInfiniteDuration above), don't
      // also assign audio.currentTime here: the two writes race, and
      // whichever happens to apply last wins by accident. That workaround
      // reads desiredTimeRef the moment it resolves, so updating it above
      // is enough to land this seek correctly once that settles — no need
      // to fight over audio.currentTime in the meantime.
      if (fixingInfiniteDurationRef.current) return;
      audio.currentTime = target;
    };

    if (audio.readyState >= 1) {
      applySeek();
    } else {
      audio.addEventListener('loadedmetadata', applySeek, { once: true });
    }

    // Seeking only repositions — it no longer starts playback on its own.
    // It used to call audio.play() here unconditionally, so tapping/
    // dragging anywhere on the waveform while paused would immediately
    // start playing, and combined with the stale-duration bug above often
    // audibly restarted from 0 right as you were trying to jump somewhere
    // specific. Now: drag/tap to land on a position, then press Play to
    // actually start listening from there — same two-step gesture as the
    // dedicated play button everywhere else in the UI.
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const ratio = ratioFromPointer(e);
    setDragRatio(ratio);
    paintProgress(ratio);
    seekTo(ratio);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragRatio === null) return;
    const ratio = ratioFromPointer(e);
    setDragRatio(ratio);
    paintProgress(ratio);
    seekTo(ratio);
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    // No need to fall back to a stale playbackProgress here anymore — the
    // checkpoint/rAF effects above keep it genuinely in sync with the
    // audio element in real time, so dropping back to it on release no
    // longer snaps the bar backwards.
    setDragRatio(null);
  };

  const handleTogglePlayback = () => {
    const audio = audioRefs.current[message.id];
    if (!audio) return;
    if (audio.paused) {
      // Never start playing a voice message while a recording is in
      // progress — its own speaker output would get captured straight
      // back into the microphone (see isRecordingActiveRef above).
      if (isRecordingActiveRef.current) return;
      onRequestExclusivePlayback(message.id);
      audio.play().catch(() => {});
    } else {
      audio.pause();
    }
  };

  // Sized roughly in proportion to the clip's own length (clamped to a
  // sane range), instead of every voice note — a 2-second "ok" or a
  // minute-long ramble alike — always stretching out to the same near-
  // maximum width. `knownDuration` is 0 until it's actually known (either
  // from the server-sent message.duration or the <audio> element's own
  // metadata), so brand-new/unloaded bubbles still get a small, sane
  // default rather than momentarily rendering at 0 width.
  const bubbleWidth = Math.round(Math.min(284, Math.max(176, 176 + knownDuration * 2.6)));

  // The stored waveform is always a fixed 27 samples (see
  // VOICE_WAVEFORM_BARS/downsampleWaveform), regardless of the bubble's
  // own width — rendering all 27 as fixed-width, non-shrinking bars inside
  // a narrow bubble would force them to overflow or touch edge-to-edge
  // instead of actually looking narrower. Resample down to however many
  // bars comfortably fit the *actual* waveform area this bubble has (play
  // button + avatar + padding subtracted out) so short clips genuinely
  // read as short, compact waveforms instead of a squeezed full-size one.
  const waveformAreaWidth = Math.max(32, bubbleWidth - 92);
  const displayBarCount = Math.max(8, Math.min(waveformData.length || VOICE_WAVEFORM_BARS, Math.round(waveformAreaWidth / 5.5)));
  const displayWaveform = useMemo(() => {
    if (waveformData.length <= displayBarCount) return waveformData;
    const resampled: number[] = [];
    for (let i = 0; i < displayBarCount; i++) {
      resampled.push(waveformData[Math.floor((i / displayBarCount) * waveformData.length)]);
    }
    return resampled;
  }, [waveformData, displayBarCount]);

  const renderBars = (variant: 'base' | 'overlay') => displayWaveform.map((value, i) => {
    // `value` is already normalized per-clip at record time (see
    // downsampleWaveform) so it genuinely spans ~0–1 with real contrast
    // between quiet and loud moments. A light gamma lift still helps
    // quieter-but-real bars stay readable, and a small floor just keeps a
    // near-silent bucket from collapsing to an invisible sliver.
    const clamped = Math.max(0, Math.min(1, value));
    const visualHeight = Math.max(0.12, Math.pow(clamped, 0.7));
    return (
      <div
        key={i}
        className={`voice-waveform-bar ${isOwn ? 'own' : 'received'} ${variant === 'overlay' ? 'played' : ''}`}
        style={{ height: `${visualHeight * 100}%` }}
      />
    );
  });

  return (
    <div className={`voice-message-bubble ${isOwn ? 'own' : 'received'}`} style={{ width: `${bubbleWidth}px` }}>
      {/* Play/Pause Button */}
      <button
        onClick={handleTogglePlayback}
        className={`voice-message-play-btn ${isOwn ? 'own' : 'received'} ${isPlaying ? 'is-playing' : ''}`}
        aria-label={isPlaying ? 'Pause voice message' : 'Play voice message'}
      >
        {isPlaying ? (
          <Pause className="w-4 h-4" fill="currentColor" />
        ) : (
          <Play className="w-4 h-4 ml-0.5" fill="currentColor" />
        )}
      </button>

      {/* Waveform and Duration */}
      <div className="voice-message-content">
        {/* Waveform — tap or drag anywhere on it to jump to that point and
            keep listening from there. Two stacked copies of the same bars:
            a static "unplayed" base layer, and a brighter "played" layer
            clipped to the current progress and repainted directly via
            paintProgress() for a smooth 60fps fill with no React
            re-renders in the hot path. */}
        <div
          ref={waveformRef}
          className="voice-message-waveform"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <div className="voice-waveform-track">
            <div className="voice-waveform-bars-layer">{renderBars('base')}</div>
            <div ref={overlayRef} className="voice-waveform-bars-layer overlay">{renderBars('overlay')}</div>
          </div>
        </div>

        {/* Duration */}
        <div className={`voice-message-duration ${isOwn ? 'own' : 'received'}`}>
          <span>{displayTime}</span>
        </div>
      </div>

      {/* Sender photo with a small mic badge — mirrors WhatsApp's voice
          note bubbles, which are the one message type that keeps a
          per-message avatar even in a 1:1 chat. */}
      <div className={`voice-message-avatar ${isOwn ? 'own' : 'received'}`}>
        {avatarUrl ? (
          <img src={avatarUrl} alt="" className="voice-message-avatar-img" />
        ) : (
          <span className="voice-message-avatar-fallback">{avatarFallback}</span>
        )}
        <span className={`voice-message-mic-badge ${isOwn ? 'own' : 'received'}`}>
          <Mic className="w-2.5 h-2.5" fill="currentColor" />
        </span>
      </div>
    </div>
  );
});

// Document Bubble Component - Modern design with preview. Also kept at
// module scope for the same "stable component type" reason as
// VoiceMessageBubble above (it doesn't need any ChatView-scoped state, so
// nothing else changes).
interface DocumentBubbleProps {
  message: Message;
  isOwn: boolean;
}

const DocumentBubble = memo(function DocumentBubble({ message, isOwn }: DocumentBubbleProps) {
  const [isDownloading, setIsDownloading] = useState(false);
  const fileUrl = message.media_url || message.content;

  // Extract file info from URL or message metadata
  const getFileInfo = () => {
    const fileName = message.fileName || fileUrl.split('/').pop()?.split('?')[0] || 'Document';
    const extension = fileName.split('.').pop()?.toLowerCase() || '';
    let fileType = 'File';
    let bgColor = isOwn ? 'bg-white/20' : 'bg-slate-100';
    let iconColor = isOwn ? 'text-white' : 'text-slate-600';

    // Determine file type based on extension
    if (['pdf'].includes(extension)) {
      fileType = 'PDF Document';
      bgColor = isOwn ? 'bg-red-400/30' : 'bg-red-100';
      iconColor = isOwn ? 'text-red-200' : 'text-red-600';
    } else if (['doc', 'docx'].includes(extension)) {
      fileType = 'Word Document';
      bgColor = isOwn ? 'bg-blue-400/30' : 'bg-blue-100';
      iconColor = isOwn ? 'text-blue-200' : 'text-blue-600';
    } else if (['xls', 'xlsx'].includes(extension)) {
      fileType = 'Excel Spreadsheet';
      bgColor = isOwn ? 'bg-green-400/30' : 'bg-green-100';
      iconColor = isOwn ? 'text-green-200' : 'text-green-600';
    } else if (['ppt', 'pptx'].includes(extension)) {
      fileType = 'PowerPoint';
      bgColor = isOwn ? 'bg-orange-400/30' : 'bg-orange-100';
      iconColor = isOwn ? 'text-orange-200' : 'text-orange-600';
    } else if (['zip', 'rar', '7z'].includes(extension)) {
      fileType = 'Archive';
      bgColor = isOwn ? 'bg-amber-400/30' : 'bg-amber-100';
      iconColor = isOwn ? 'text-amber-200' : 'text-amber-600';
    } else if (['txt'].includes(extension)) {
      fileType = 'Text File';
    }

    return { fileName, fileType, bgColor, iconColor, extension };
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
});

interface ChatViewProps {
  currentUser: UserProfile;
  contact: Contact;
  onBack: () => void;
  onCall: (type: 'voice' | 'video') => void;
  onBlockUser?: (userId: string) => void;
  /** Opens the full profile preview for this contact. */
  onViewProfile?: () => void;
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

export function ChatView({ currentUser, contact, onBack, onCall, onBlockUser, onViewProfile }: ChatViewProps) {
  // Seed state synchronously from the in-memory cache (if warm) so reopening a
  // chat you just viewed never renders an empty/skeleton frame before
  // painting — this is what eliminates the visible "blink" on reopen.
  const [messages, setMessages] = useState<Message[]>(
    () => chatService.getCachedMessages(currentUser.id, contact.user_id) || []
  );
  const [inputMessage, setInputMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [isContactRecording, setIsContactRecording] = useState(false);
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
  // Mirrors voiceState.duration, kept in sync everywhere that state updates.
  // stopRecording() is a plain (non-memoized) function, and the gesture
  // handlers that end up calling it (finishVoiceGesture et al.) are
  // useCallback'd with stable/empty deps, so they close over the
  // *original, mount-time* `stopRecording` — whose captured `voiceState`
  // is permanently frozen at duration: 0. Reading from this ref instead
  // sidesteps the stale closure entirely (refs are always read live,
  // regardless of which render's closure does the reading), which is why
  // every voice message was being saved/shown as 0:01 no matter how long
  // it was actually held for.
  const durationRef = useRef(0);

  // True for the entire span of an in-progress recording (including while
  // locked/hands-free), so voice message playback can be blocked the whole
  // time, not just paused once at the moment recording starts. See the
  // VoiceMessageBubbleProps doc comment for the full story.
  const isRecordingActiveRef = useRef(false);

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

  // Audio Playback — each VoiceMessageBubble owns and drives its own
  // <audio> element entirely from that element's native events (see the
  // component for why), so the only thing ChatView itself needs to
  // coordinate is making sure starting one voice message pauses any other
  // one that's currently playing. audioRefs is a ref, not state, on
  // purpose: nothing here needs to trigger a ChatView re-render.
  const audioRefs = useRef<{ [key: string]: HTMLAudioElement }>({});

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messageInputRef = useRef<HTMLInputElement>(null);
  const chatRootRef = useRef<HTMLDivElement>(null);
  // See useKeyboardInset's doc comment — this is the fallback that kicks
  // in specifically when the keyboard is covering the input *despite* the
  // app shell's own resize (useVisualViewportHeight, in App.tsx), by
  // measuring this exact screen's own bottom edge against the real
  // visible viewport instead of assuming the shell already got it right.
  const keyboardInset = useKeyboardInset(chatRootRef);
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

    const recordingSubscription = typingService.subscribeToRecording(
      currentUser.id,
      contact.user_id,
      (userId, recording) => {
        if (userId === contact.user_id) {
          setIsContactRecording(recording);
        }
      }
    );

    return () => {
      subscription.unsubscribe();
      readReceiptSubscription.unsubscribe();
      typingSubscription.unsubscribe();
      recordingSubscription.unsubscribe();
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

  // Belt-and-suspenders for the on-screen keyboard covering the input:
  // the app shell already resizes itself to the real visible viewport
  // (see useVisualViewportHeight in App.tsx) so this normally isn't even
  // needed, but that relies on the browser/WebView actually reporting
  // visualViewport resizes promptly and on nothing else on the page
  // overriding that height. Explicitly scrolling the focused input into
  // view is the same trick every mobile web app with a bottom-pinned
  // input bar ends up needing as a fallback, and costs nothing when the
  // shell resize already did its job (scrolling an element that's already
  // fully in view is a no-op). The delay gives the keyboard's own open
  // animation time to finish — scrolling immediately on focus races it
  // and commonly undershoots on Android.
  const handleInputFocus = useCallback(() => {
    setTimeout(() => {
      messageInputRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
    }, 300);
  }, []);

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
      setVoiceState(prev => {
        const duration = prev.duration + 1;
        durationRef.current = duration;
        return { ...prev, duration };
      });

      // Re-send "recording" every second as a heartbeat while this keeps
      // running. The contact's indicator (typingService.subscribeToRecording)
      // auto-expires 3s after the last signal it received as a safety net
      // for a dropped connection — without a heartbeat, that meant a real
      // recording longer than ~3s made their "recording audio" indicator
      // vanish on its own well before the recording actually stopped. This
      // keeps it refreshed every second — comfortably inside that 3s
      // window — so it stays visible for the recording's *entire* real
      // length, no matter how long that turns out to be, and still
      // self-heals the same way if the connection genuinely drops. The
      // explicit "stopped recording" call in stopRecording (sent the
      // instant the mic button is released) is what makes it disappear
      // instantly rather than waiting out this interval.
      typingService.sendRecording(currentUser.id, contact.user_id);
    }, 1000);
  }, [currentUser.id, contact.user_id]);

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
    durationRef.current = 0;

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

      // Let the contact know a voice message is being recorded — same
      // realtime mechanism as the typing indicator, just its own event type
      // so their header/list can show "recording audio..." instead of
      // typing dots (WhatsApp makes the same distinction).
      typingService.sendRecording(currentUser.id, contact.user_id);

    } catch (error) {
      console.error('Error starting recording:', error);
      alert('Could not access microphone. Please allow microphone access and try again.');
      // Recording never actually started (mic permission denied/unavailable)
      // — undo the block on voice message playback set in
      // handleVoiceButtonTouchStart, or every voice message would be stuck
      // unplayable for the rest of the session.
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
    console.log('Stopping recording, cancel:', cancel);

    // Recording is over either way (sent or cancelled) — voice messages
    // are safe to play again from this point on.
    isRecordingActiveRef.current = false;

    // Tell the contact recording has ended, whether it's being sent or
    // cancelled — their "recording audio..." indicator shouldn't outlive
    // the actual recording (it also auto-expires after a few seconds on
    // their end as a safety net, but this makes it disappear instantly).
    typingService.sendStoppedRecording(currentUser.id, contact.user_id);

    // Snapshot the final duration/waveform now, while they're still live —
    // onstop (below) fires asynchronously and runs after voiceState has
    // already been reset to 0/empty by the setVoiceState call below.
    //
    // Read from durationRef, NOT voiceState.duration: stopRecording is a
    // plain (non-memoized) function, and every path that calls it
    // (finishVoiceGesture, the lock-panel send/cancel buttons) is a
    // useCallback/handler that was created once with a stable/empty
    // dependency list, so it closes over the mount-time `stopRecording` —
    // whose captured `voiceState` is permanently frozen at duration: 0.
    // That's why every voice message was being saved as "0:01" regardless
    // of how long it was actually held for. durationRef is a ref, so it's
    // always read live no matter which stale closure does the reading.
    //
    // It also only increments once per *completed* second (see
    // startDurationTimer), so any recording released before its first full
    // second elapsed — anywhere from the ~300ms minimum hold up to just
    // under 1s — would still read 0 even with the stale-closure bug fixed.
    // A sent voice message is never actually silent/instant (the
    // accidental-tap guard above already filters those out), so floor the
    // displayed/stored duration at 1 second, matching WhatsApp's own
    // convention of never showing a voice note as "0:00".
    lastRecordingRef.current = { duration: Math.max(1, durationRef.current), waveform: fullWaveformRef.current };

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
      } else {
        // Previously failed silently here with no feedback at all whenever
        // uploadMedia rejected the recording (e.g. the MIME-type mismatch
        // bug where MediaRecorder's "audio/webm;codecs=opus" never matched
        // the supported-types allowlist's bare "audio/webm") — the user saw
        // the recording UI finish normally with no error and no bubble, and
        // had no way to tell anything had gone wrong. Surface it instead.
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
    // Stop any voice message that's currently playing the instant the user
    // touches the mic button — before even asking for microphone
    // permission, which can itself take a moment. Otherwise the speaker is
    // still audibly playing while the mic opens, and gets picked right back
    // up into the new recording. Also block *starting* any voice message
    // for the rest of the recording (handled in VoiceMessageBubble via
    // isRecordingActiveRef) — pausing once here isn't enough on its own
    // because a locked/hands-free recording can run for a long time after
    // this, and tapping play during that window would otherwise start
    // playing straight into the live mic again.
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

  // Audio Playback — only cross-bubble concern left: when one voice
  // message starts playing, pause whatever other one is currently playing,
  // so only one plays at a time. Everything else (play/pause state, seek,
  // progress) is now fully owned by each VoiceMessageBubble itself.
  const pauseOtherVoiceMessages = useCallback((exceptMessageId: string) => {
    Object.entries(audioRefs.current).forEach(([id, audio]) => {
      if (id !== exceptMessageId && !audio.paused) {
        audio.pause();
      }
    });
  }, []);

  // Also used by startRecording (see below): stop *every* currently
  // playing voice message, with no exception. Starting a new recording
  // while another voice message is still audibly playing both sounds
  // wrong and, worse, the speaker output bleeds straight back into the
  // microphone and gets captured into the new recording.
  const pauseAllVoiceMessages = useCallback(() => {
    Object.values(audioRefs.current).forEach((audio) => {
      if (!audio.paused) audio.pause();
    });
  }, []);

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

  // "Today" / "Yesterday" / weekday-and-date pill shown between groups of
  // messages sent on different days — WhatsApp always has this, and
  // without it a chat with any real history just reads as one undated
  // wall of bubbles with no sense of when anything happened.
  const formatDateSeparator = useCallback((timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const diffDays = Math.round((startOf(now) - startOf(date)) / 86_400_000);

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays > 1 && diffDays < 7) {
      return date.toLocaleDateString('en-US', { weekday: 'long' });
    }
    return date.toLocaleDateString('en-US', {
      day: 'numeric',
      month: 'long',
      year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
    });
  }, []);

  // Voice Message Bubble Component - Modern design with waveform
  // VoiceMessageBubble and DocumentBubble now live at module scope (see
  // above MessageBubble) so they're stable component types across renders
  // — see the comment above the module-level VoiceMessageBubble for why
  // that matters (it used to reset/remount on almost every unrelated
  // ChatView re-render, wiping playback progress and breaking the
  // play/pause button's visual state).

  const renderMessageContent = (message: Message, isOwn: boolean) => {
    switch (message.type) {
      case 'image':
        // No wrapping/rounding/overflow-hidden here — the parent media
        // bubble (see isMedia branch in MessageBubble) already clips and
        // rounds this to the bubble's own shape. Adding another rounded,
        // clipped container around it here used to nest two different
        // corner radii on the exact same box for no visual benefit.
        return (
          <img
            src={message.media_url || message.content}
            alt="Shared image"
            className="block cursor-pointer max-w-[250px] max-h-[300px] object-cover hover:opacity-90 transition-opacity"
            onClick={() => openMediaViewer('image', message.media_url || message.content)}
          />
        );
      case 'video':
        return (
          <div
            className="relative cursor-pointer group"
            onClick={() => openMediaViewer('video', message.media_url || message.content)}
          >
            <video
              src={message.media_url || message.content}
              className="block max-w-[250px] max-h-[300px] object-cover"
            />
            <div className="absolute inset-0 bg-black/30 flex items-center justify-center group-hover:bg-black/40 transition-colors">
              <div className="w-14 h-14 rounded-full bg-white/90 flex items-center justify-center">
                <Play className="w-6 h-6 text-slate-800 ml-1" fill="currentColor" />
              </div>
            </div>
          </div>
        );
      case 'voice':
        return (
          <VoiceMessageBubble
            message={message}
            isOwn={isOwn}
            audioRefs={audioRefs}
            onRequestExclusivePlayback={pauseOtherVoiceMessages}
            isRecordingActiveRef={isRecordingActiveRef}
            avatarUrl={isOwn ? currentUser.avatar_url : contact.profile.avatar_url}
            avatarFallback={(isOwn ? currentUser.full_name : contact.profile.full_name).charAt(0).toUpperCase()}
          />
        );
      case 'gif':
        return (
          <img
            src={message.gif_url || message.content}
            alt="GIF"
            className="block max-w-[250px] object-cover"
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
    <div
      ref={chatRootRef}
      className="h-full flex flex-col relative bg-gradient-to-br from-violet-50 via-white to-purple-50"
      style={keyboardInset > 0 ? { paddingBottom: keyboardInset } : undefined}
    >
      {/* Animated low-poly chat background, in the app's own
          violet/purple/fuchsia palette — replaces the old flat
          white/slate background + barely-visible dot pattern. */}
      <LowPolyBackground />

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

          {/* Circular Profile Picture — tap to view this contact's profile */}
          <button
            onClick={onViewProfile}
            disabled={!onViewProfile}
            className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center text-lg overflow-hidden ring-2 ring-white/30 flex-shrink-0 active:scale-95 transition-transform disabled:cursor-default"
            aria-label="View profile"
          >
            {contact.profile.avatar_url ? (
              <img
                src={contact.profile.avatar_url}
                alt={contact.profile.full_name}
                className="w-full h-full object-cover"
              />
            ) : (
              <span className="font-semibold">{contact.profile.full_name.charAt(0).toUpperCase()}</span>
            )}
          </button>

          <button onClick={onViewProfile} disabled={!onViewProfile} className="flex-1 min-w-0 text-left disabled:cursor-default">
            <h2 className="text-base font-semibold truncate">{contact.profile.full_name}</h2>
            {/* `truncate` (not `flex`) on the <p> itself — this used to be
                a flex row, which has no text-overflow/ellipsis behavior of
                its own, so a longer presence string (e.g. "last seen today
                at 6:09 PM") just wrapped onto a second and third line
                instead of being clipped, stretching the header taller than
                intended. A single-line, ellipsis-truncated status is what
                every other chat app does here — the inner spans switch to
                `inline-flex` so they still lay out their icon/dots
                correctly while remaining part of that one truncatable
                line. */}
            <p
              key={isContactRecording ? 'recording' : isTyping ? 'typing' : 'status'}
              className="text-xs text-white/80 h-4 overflow-hidden animate-fade-in"
            >
              {isContactRecording ? (
                <span className="inline-flex items-center gap-1.5 text-green-300 font-medium align-middle max-w-full truncate">
                  <Mic className="w-3 h-3 recording-indicator-mic shrink-0" strokeWidth={2.5} />
                  recording audio
                </span>
              ) : isTyping ? (
                <span className="inline-flex items-center gap-1.5 text-green-300 font-medium align-middle max-w-full truncate">
                  typing
                  <span className="flex items-end gap-0.5 h-2 shrink-0">
                    <span className="w-1 h-1 bg-green-300 rounded-full typing-dot" style={{ animationDelay: '0ms' }} />
                    <span className="w-1 h-1 bg-green-300 rounded-full typing-dot" style={{ animationDelay: '150ms' }} />
                    <span className="w-1 h-1 bg-green-300 rounded-full typing-dot" style={{ animationDelay: '300ms' }} />
                  </span>
                </span>
              ) : (
                <MarqueeText
                  text={presenceStatusText(contact.profile.is_online, contact.profile.last_seen)}
                  className={contact.profile.is_online ? 'text-green-300 font-medium' : ''}
                />
              )}
            </p>
          </button>

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
          (() => {
            let lastDateKey: string | null = null;
            const items: React.ReactNode[] = [];

            messages.forEach((message) => {
              const dateKey = new Date(message.created_at).toDateString();
              if (dateKey !== lastDateKey) {
                lastDateKey = dateKey;
                items.push(
                  <div key={`date-${dateKey}`} className="flex justify-center my-2">
                    <span className="date-separator-pill">
                      {formatDateSeparator(message.created_at)}
                    </span>
                  </div>
                );
              }

              items.push(
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
              );
            });

            return items;
          })()
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

      {/* Voice Recording UI - WhatsApp Style */}
      {voiceState.isRecording && (
        <div
          className="absolute bottom-0 left-0 right-0 z-30 bg-white border-t border-slate-200"
          style={{ touchAction: 'none', overscrollBehavior: 'none' }}
        >
          {voiceState.isLocked ? (
            // Locked Recording Mode — two rows, WhatsApp-style: the top row
            // is purely the duration + live waveform (so the waveform
            // actually has room to be legible), the bottom row is the three
            // actions (delete / pause-resume / send) as clear, labeled,
            // full-size touch targets instead of competing for space with
            // the waveform in a single cramped line.
            <div className="px-4 py-3">
              {/* Row 1 — duration + live waveform */}
              <div className="flex items-center gap-3 mb-3">
                <div className="flex items-center gap-2 shrink-0">
                  <div className={`w-2.5 h-2.5 rounded-full bg-red-500 ${voiceState.isPaused ? '' : 'animate-pulse'}`} />
                  <span className="text-base font-semibold text-slate-800 tabular-nums min-w-[44px]">
                    {formatDuration(voiceState.duration)}
                  </span>
                </div>

                {/* `min-w-0` + `overflow-hidden` on the waveform cell is
                    required here: this row used to render up to 50
                    fixed-width (4px) bars inside a plain `flex-1` cell,
                    which has no min-width override by default —
                    flexbox's automatic minimum size for a non-wrapping row
                    of fixed-width children is the sum of their widths, so
                    the cell refused to shrink below ~400px and pushed
                    other controls straight off the right edge of the
                    screen on real phones. */}
                <div className="flex-1 min-w-0 overflow-hidden flex items-center gap-[3px] h-10">
                  {voiceState.waveformData.slice(-36).map((value, i) => (
                    <div
                      key={i}
                      className={`w-1 shrink-0 bg-violet-500 rounded-full transition-all duration-75 ${voiceState.isPaused ? 'opacity-40' : ''}`}
                      style={{ height: `${Math.max(4, value * 32)}px` }}
                    />
                  ))}
                  {/* Fill remaining space with placeholder bars */}
                  {Array.from({ length: Math.max(0, 36 - voiceState.waveformData.length) }).map((_, i) => (
                    <div key={`placeholder-${i}`} className="w-1 h-1 shrink-0 bg-slate-200 rounded-full" />
                  ))}
                </div>
              </div>

              {/* Row 2 — delete / pause-resume (labeled) / send */}
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
            // Slide to Cancel Mode - WhatsApp Style. Deliberately built as
            // the same two-row shape as the locked UI below (duration +
            // waveform on top, controls/guidance on the bottom) instead of
            // squeezing everything into one cramped line — the single-row
            // version used to look flat and thin next to the locked
            // screen's spacious layout even though it's the exact same
            // recording.
            <div className="voice-recording-slide-ui">
              {/* Gradient + shimmer background, separated into its own
                  layer (with its own overflow: hidden) so the bar itself
                  can stay overflow: visible — that's what lets the lock
                  guidance below float slightly above the bar instead of
                  needing its own row, which is what kept making this
                  screen so much taller than the locked one. */}
              <div className="voice-recording-bg" />

              {/* Row 1 — duration + live waveform, same visual weight as
                  the locked UI's top row. Doesn't move with the drag;
                  only the cancel hint and the floating mic below do. */}
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

              {/* Row 2 — slide-to-cancel hint (drags left with the
                  finger) on the left, floating mic on the right. Kept to
                  exactly two rows total (same as the locked UI) so this
                  bar stays just as compact — the lock guidance below
                  floats above it rather than adding a third row. */}
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

                {/* Lock guidance — a padlock sitting above three chevrons
                    that continuously animate climbing upward (WhatsApp's
                    "slide up to lock" cue). Floats directly above the mic
                    button (same right offset, so the two line up) instead
                    of taking up its own row, keeping the bar's overall
                    height the same as the locked UI's. lockProgress still
                    drives a real-time lift/brighten/scale-up on top of
                    that as direct drag feedback. */}
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

                {/* Floating mic button that follows finger */}
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
                  ref={messageInputRef}
                  type="text"
                  placeholder="Type a message..."
                  value={inputMessage}
                  onChange={(e) => handleInputChange(e.target.value)}
                  onKeyPress={handleKeyPress}
                  onFocus={handleInputFocus}
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

              <button
                onClick={() => {
                  if (!onViewProfile) return;
                  closeMediaViewer();
                  onViewProfile();
                }}
                disabled={!onViewProfile}
                className="flex items-center gap-3 active:opacity-80 transition-opacity disabled:cursor-default"
              >
                <div className="w-9 h-9 rounded-full overflow-hidden ring-2 ring-white/20">
                  {contact.profile.avatar_url ? (
                    <img src={contact.profile.avatar_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full bg-gradient-to-br from-violet-500 to-purple-500 flex items-center justify-center text-white text-sm font-semibold">
                      {contact.profile.full_name.charAt(0)}
                    </div>
                  )}
                </div>
                <div className="text-left">
                  <p className="text-white font-medium text-sm">{contact.profile.full_name}</p>
                  {onViewProfile && <p className="text-white/60 text-xs">Tap to view profile</p>}
                </div>
              </button>

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

        /* Glassy Chat Input Styles.
           The pill itself should read as a single floating element with
           nothing visually "stuck" behind it — it used to carry a large
           0 8px 32px purple glow (30% opacity) that, sitting on top of
           the light chat background, rendered as an obvious soft rounded
           panel surrounding the pill, looking like a separate container
           rather than depth on the pill. Kept here as a much tighter,
           barely-there shadow for a hint of lift, nothing more. */
        .chat-input-glass {
          background: linear-gradient(135deg, rgba(168, 85, 247, 0.9) 0%, rgba(139, 92, 246, 0.9) 50%, rgba(124, 58, 237, 0.9) 100%);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border-radius: 28px;
          padding: 4px;
          box-shadow:
            0 2px 8px rgba(124, 58, 237, 0.18),
            0 0 0 1px rgba(255, 255, 255, 0.1) inset;
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
          gap: 8px;
          padding: 5px 10px 5px 5px;
          /* Match the corner treatment of every other bubble type
             (rounded-2xl = 16px with a 6px "tail" corner) instead of the
             bespoke 20px radius this used to have — voice bubbles used to
             be the only message type with its own unique shape *and* a
             per-message avatar, which made them look out of place next to
             text/image bubbles in a 1:1 chat. Width itself is set inline
             per-bubble (see bubbleWidth above), scaled to the clip's own
             length instead of a single fixed size for every recording. */
          border-radius: 16px;
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

        .voice-message-play-btn {
          width: 34px;
          height: 34px;
          min-width: 34px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          border: none;
          cursor: pointer;
          transition: transform 0.15s ease, background 0.2s ease, box-shadow 0.2s ease;
        }

        .voice-message-play-btn:active {
          transform: scale(0.9);
        }

        .voice-message-play-btn.own {
          background: rgba(255, 255, 255, 0.22);
          color: white;
        }

        .voice-message-play-btn.own:hover {
          background: rgba(255, 255, 255, 0.32);
        }

        .voice-message-play-btn.own.is-playing {
          background: rgba(255, 255, 255, 0.95);
          color: #7c3aed;
        }

        .voice-message-play-btn.received {
          background: linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%);
          color: white;
          box-shadow: 0 2px 8px rgba(139, 92, 246, 0.3);
        }

        .voice-message-play-btn.received:hover {
          box-shadow: 0 4px 12px rgba(139, 92, 246, 0.4);
        }

        .voice-message-play-btn.received.is-playing {
          box-shadow: 0 2px 10px rgba(139, 92, 246, 0.45);
        }

        .voice-message-content {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 2px;
          padding-right: 2px;
        }

        .voice-message-waveform {
          display: flex;
          align-items: center;
          cursor: pointer;
          /* Prevent the page from scrolling while dragging to seek on
             touch, and stop the default double-tap/long-press highlight
             from flashing on every tap. */
          touch-action: none;
          -webkit-tap-highlight-color: transparent;
          user-select: none;
          /* A little vertical hit-area padding still helps dragging with a
             finger (much less precise than a mouse), but this used to add
             a full 16px (8px top+bottom) on top of the already-30px bar
             track — nearly 50px just for the waveform row — which was the
             single biggest reason these bubbles were so much taller than
             a WhatsApp voice bubble. box-sizing: content-box means this
             sits outside the bar track's own height, so it doesn't squash
             the bars. */
          padding: 3px 0;
          box-sizing: content-box;
        }

        /* Positioning context for the overlay layer below — kept as a
           separate inner element (rather than making .voice-message-waveform
           itself position:relative) so the extra touch-target padding above
           doesn't have to be accounted for in the overlay's offsets. */
        .voice-waveform-track {
          position: relative;
          width: 100%;
          height: 22px;
        }

        .voice-waveform-bars-layer {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 2.5px;
          width: 100%;
          height: 22px;
        }

        /* The "played" copy of the bars, drawn directly on top of the base
           (unplayed) layer and revealed left-to-right via clip-path as
           playback advances. Updated straight through a ref in JS
           (paintProgress) rather than React state/props, and clip-path is
           GPU-composited, so this animates at a smooth 60fps with none of
           the per-bar class-toggling + re-render cost the old approach had. */
        .voice-waveform-bars-layer.overlay {
          position: absolute;
          inset: 0;
          pointer-events: none;
          will-change: clip-path;
        }

        .voice-waveform-bar {
          width: 3px;
          flex-shrink: 0;
          border-radius: 2px;
          min-height: 6px;
        }

        .voice-waveform-bar.own {
          background: rgba(255, 255, 255, 0.45);
        }

        .voice-waveform-bar.own.played {
          background: #ffffff;
        }

        .voice-waveform-bar.received {
          background: #e2e8f0;
        }

        .voice-waveform-bar.received.played {
          background: #8b5cf6;
        }

        .voice-message-duration {
          font-size: 11px;
          font-weight: 500;
          font-variant-numeric: tabular-nums;
          letter-spacing: 0.01em;
          line-height: 1.1;
        }

        .voice-message-duration.own {
          color: rgba(255, 255, 255, 0.8);
        }

        .voice-message-duration.received {
          color: #64748b;
        }

        .voice-message-avatar {
          position: relative;
          width: 28px;
          height: 28px;
          min-width: 28px;
          border-radius: 50%;
          overflow: visible;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .voice-message-avatar-img {
          width: 100%;
          height: 100%;
          border-radius: 50%;
          object-fit: cover;
          display: block;
        }

        .voice-message-avatar.own .voice-message-avatar-img {
          box-shadow: 0 0 0 1.5px rgba(255, 255, 255, 0.5);
        }

        .voice-message-avatar.received .voice-message-avatar-img {
          box-shadow: 0 0 0 1.5px rgba(139, 92, 246, 0.15);
        }

        .voice-message-avatar-fallback {
          width: 100%;
          height: 100%;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 13px;
          font-weight: 700;
          color: white;
          background: linear-gradient(135deg, #a78bfa 0%, #7c3aed 100%);
        }

        .voice-message-mic-badge {
          position: absolute;
          bottom: -2px;
          right: -2px;
          width: 14px;
          height: 14px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
        }

        .voice-message-mic-badge.own {
          background: #7c3aed;
          box-shadow: 0 0 0 2px #8b5cf6;
        }

        .voice-message-mic-badge.received {
          background: #7c3aed;
          box-shadow: 0 0 0 2px #ffffff;
        }

        /* Voice Recording Slide UI - WhatsApp Style. Same compact two-row
           shape as the locked recording UI (duration+waveform, then
           cancel-hint+mic) so the bar carries the same visual weight and
           height — the lock guidance floats above it rather than adding
           a third row that would make the whole thing noticeably taller. */
        .voice-recording-slide-ui {
          position: relative;
          padding: 12px 16px 14px;
        }

        .voice-recording-bg {
          position: absolute;
          inset: 0;
          z-index: -1;
          background: linear-gradient(135deg, rgba(168, 85, 247, 0.95) 0%, rgba(139, 92, 246, 0.95) 50%, rgba(124, 58, 237, 0.95) 100%);
          overflow: hidden;
        }

        .voice-recording-toprow {
          display: flex;
          align-items: center;
          gap: 14px;
          margin-bottom: 8px;
        }

        .voice-cancel-zone {
          position: absolute;
          left: 18px;
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

        .voice-recording-bottomrow {
          position: relative;
          display: flex;
          align-items: center;
          min-height: 48px;
          /* Reserve room on the right for the floating mic so the
             sliding hint never runs underneath it. */
          padding-right: 70px;
        }

        .voice-slide-hint-row {
          display: flex;
          align-items: center;
          transition: transform 0.05s ease-out, opacity 0.15s ease;
        }

        .voice-slide-hint {
          display: flex;
          align-items: center;
          gap: 2px;
          flex-shrink: 0;
          color: rgba(255, 255, 255, 0.75);
          font-size: 13px;
          font-weight: 500;
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
          gap: 3px;
          height: 36px;
          min-width: 0;
          overflow: hidden;
          /* Leaves the floating lock guidance (see .voice-lock-indicator)
             a clean, empty patch of background to sit in above the mic,
             instead of bars running underneath it. */
          padding-right: 48px;
        }

        .voice-waveform-bar {
          width: 3px;
          flex-shrink: 0;
          background: rgba(255, 255, 255, 0.85);
          border-radius: 2px;
          transition: height 0.05s ease;
          min-height: 4px;
        }

        .voice-duration {
          display: flex;
          align-items: center;
          gap: 7px;
          color: white;
          font-size: 16px;
          font-weight: 600;
          font-variant-numeric: tabular-nums;
          flex-shrink: 0;
        }

        .voice-recording-dot {
          width: 9px;
          height: 9px;
          border-radius: 50%;
          background: #ef4444;
          animation: recording-pulse 1s ease-in-out infinite;
        }

        @keyframes recording-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(0.85); }
        }

        /* Lock guidance — padlock sitting above three chevrons that
           continuously "climb" upward, one after another, to cue the
           swipe-up-to-lock gesture the way WhatsApp's does. Floats
           directly above the mic button (same right offset, right: 18px,
           as .voice-mic-float below) instead of taking up its own row —
           that's what keeps this bar the same compact height as the
           locked UI. lockProgress layers a live lift/brighten/scale-up
           on top via its own transform as the user actually drags up. */
        .voice-lock-indicator {
          position: absolute;
          right: 18px;
          bottom: 56px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 3px;
          transition: transform 0.08s linear, opacity 0.08s linear;
        }

        .voice-lock-circle {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 26px;
          height: 26px;
          background: rgba(255, 255, 255, 0.22);
          border-radius: 50%;
          color: white;
          box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.25) inset;
        }

        .voice-lock-arrows {
          display: flex;
          flex-direction: column;
          align-items: center;
          height: 16px;
        }

        .voice-lock-arrow {
          width: 11px;
          height: 11px;
          margin-top: -4px;
          color: rgba(255, 255, 255, 0.85);
          animation: lock-arrow-climb 1.4s ease-in-out infinite;
        }

        .voice-lock-arrow:nth-child(1) { animation-delay: 0.3s; }
        .voice-lock-arrow:nth-child(2) { animation-delay: 0.15s; }
        .voice-lock-arrow:nth-child(3) { animation-delay: 0s; }

        @keyframes lock-arrow-climb {
          0% { opacity: 0; transform: translateY(7px); }
          35% { opacity: 1; transform: translateY(0); }
          70% { opacity: 0.9; transform: translateY(-3px); }
          100% { opacity: 0; transform: translateY(-9px); }
        }

        .voice-mic-float {
          position: absolute;
          right: 18px;
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

        /* Header subtitle sliding marquee — see MarqueeText above. Slides
           left to reveal the clipped end, pauses, slides back, pauses,
           repeats — same back-and-forth WhatsApp uses instead of a
           continuous one-direction loop. */
        /* 11s cycle: ~1s holding the start, ~1s sliding out, a full 3.5s
           holding fully revealed (this used to be only ~1.2s, so it felt
           like it snapped back almost as soon as it finished sliding —
           not enough time to actually read the end of the text), ~1s
           sliding back, then another hold before it repeats. */
        .header-marquee-text {
          animation: header-marquee-slide 11s ease-in-out infinite;
        }

        @keyframes header-marquee-slide {
          0%, 9% { transform: translateX(0); }
          18% { transform: translateX(var(--marquee-shift)); }
          50% { transform: translateX(var(--marquee-shift)); }
          59% { transform: translateX(0); }
          100% { transform: translateX(0); }
        }

        /* Date Separator Pill - shown between messages sent on different
           days, WhatsApp-style. */
        .date-separator-pill {
          display: inline-block;
          padding: 5px 14px;
          font-size: 12px;
          font-weight: 600;
          color: #64748b;
          background: rgba(255, 255, 255, 0.9);
          border-radius: 10px;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
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

        /* Voice Recording Enhanced Animation — layered onto the
           background div (see .voice-recording-bg above), not the bar
           itself, so the bar can stay overflow: visible and let the lock
           guidance float slightly above it. */
        .voice-recording-bg::before {
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
