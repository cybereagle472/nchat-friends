/**
 * GroupMessageActions Component
 * WhatsApp-style message actions for group chats: Reactions, Delete, Forward
 */

import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  Smile,
  Trash2,
  Forward,
  Copy,
  Reply,
  X
} from 'lucide-react';
import { GroupMessage } from '../types';
import { groupService } from '../services/groupService';

// Common emoji reactions (WhatsApp style)
const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
const ALL_REACTIONS = [
  '👍', '👎', '❤️', '🧡', '💛', '💚', '💙', '💜',
  '😀', '😂', '🤣', '😊', '😍', '🥰', '😘', '😎',
  '😮', '😯', '😲', '😱', '😢', '😭', '😤', '😡',
  '🙏', '👏', '🎉', '🔥', '💯', '✨', '💪', '🤝'
];

interface GroupMessageActionsProps {
  message: GroupMessage;
  isOwn: boolean;
  currentUserId: string;
  onClose: () => void;
  onReactionAdded?: (messageId: string, emoji: string) => void;
  onMessageDeleted?: (messageId: string, forEveryone: boolean) => void;
  onForward?: (message: GroupMessage) => void;
  onReply?: (message: GroupMessage) => void;
  position: { x: number; y: number };
}

export function GroupMessageActions({
  message,
  isOwn,
  currentUserId,
  onClose,
  onReactionAdded,
  onMessageDeleted,
  onForward,
  onReply,
  position
}: GroupMessageActionsProps) {
  const [showAllReactions, setShowAllReactions] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPos, setMenuPos] = useState<{ left: number; top: number } | null>(null);
  const portalRoot = typeof document !== 'undefined' ? document.body : null;

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  // Position the context menu using its *real* rendered size instead of a
  // guessed width/height — the quick-reactions row alone (6 emoji buttons
  // plus the "more" button) is wider than a 200px guess, so a fixed
  // estimate reliably left part of the menu rendered off-screen for
  // messages near the screen edges (e.g. right-aligned own messages).
  // Measuring synchronously after mount (before the browser paints) and
  // only revealing the menu once positioned avoids any visible flash at
  // the wrong spot.
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el || showDeleteConfirm || showAllReactions) return;

    // `document.documentElement.clientWidth/clientHeight` (the layout
    // viewport, excluding any scrollbar) is used here instead of
    // `window.innerWidth/innerHeight` — on some mobile browsers/WebViews
    // `window.innerWidth` can momentarily report a stale or
    // zoom-/scrollbar-inflated value, which let this menu get positioned
    // (and then never re-clamped) partially or fully off the right edge
    // of the actual visible screen.
    const clamp = () => {
      const margin = 8;
      const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
      const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
      const rect = el.getBoundingClientRect();
      let left = position.x;
      let top = position.y;

      if (left + rect.width + margin > viewportWidth) {
        left = viewportWidth - rect.width - margin;
      }
      if (left < margin) left = margin;

      if (top + rect.height + margin > viewportHeight) {
        top = viewportHeight - rect.height - margin;
      }
      if (top < margin) top = margin;

      setMenuPos({ left, top });
    };

    clamp();
    window.addEventListener('resize', clamp);
    return () => window.removeEventListener('resize', clamp);
  }, [position.x, position.y, showDeleteConfirm, showAllReactions]);

  // Check if message can be deleted for everyone (own message, within 1 hour)
  const canDeleteForEveryone = isOwn &&
    !message.is_deleted &&
    (Date.now() - new Date(message.created_at).getTime()) < 60 * 60 * 1000;

  const handleReaction = async (emoji: string) => {
    setIsProcessing(true);
    try {
      const userReacted = message.reactions?.[emoji]?.includes(currentUserId);

      if (userReacted) {
        await groupService.removeReaction(message.id, currentUserId, emoji);
      } else {
        await groupService.addReaction(message.id, currentUserId, emoji);
      }

      onReactionAdded?.(message.id, emoji);
    } catch (error) {
      console.error('Failed to add reaction:', error);
    } finally {
      setIsProcessing(false);
      onClose();
    }
  };

  const handleDelete = async (forEveryone: boolean) => {
    setIsProcessing(true);
    try {
      if (forEveryone) {
        const result = await groupService.deleteMessageForEveryone(message.id, currentUserId);
        if (!result.success) {
          alert(result.error || 'Failed to delete message');
          return;
        }
      } else {
        const result = await groupService.deleteMessageForMe(message.id, currentUserId);
        if (!result.success) {
          alert(result.error || 'Failed to delete message');
          return;
        }
      }
      onMessageDeleted?.(message.id, forEveryone);
      setShowDeleteConfirm(false);
      onClose();
    } catch (error) {
      console.error('Failed to delete message:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      onClose();
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  };

  const handleForward = () => {
    onForward?.(message);
    onClose();
  };

  const handleReply = () => {
    onReply?.(message);
    onClose();
  };

  // Delete Confirmation — rendered via Portal to escape any ancestor
  // stacking context, matching the 1:1 chat MessageActions pattern.
  if (showDeleteConfirm) {
    return portalRoot ? createPortal(
      <div className="fixed inset-0 flex items-center justify-center bg-black/50 p-4" style={{ zIndex: 99999 }}>
        {/* animate-scale-in (transform + opacity) lives on this wrapper, not
            on the .glass-card element — animating transform/opacity on the
            same element as backdrop-filter is a known trigger for a real
            Chromium/Android-WebView compositing bug where the blur layer
            freezes and renders as a flat solid color instead of a live
            blur. */}
        <div className="w-full max-w-sm animate-scale-in">
        <div className="glass-card rounded-2xl">
          <div className="p-4 text-center">
            <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-3">
              <Trash2 className="w-6 h-6 text-red-500" />
            </div>
            <h3 className="font-semibold text-slate-800 mb-2">Delete Message?</h3>
            <p className="text-sm text-slate-500 mb-4">
              {canDeleteForEveryone
                ? 'Choose how you want to delete this message'
                : 'This message will be deleted for you only'}
            </p>
          </div>
          <div className="flex flex-col gap-2 px-4 pb-4">
            {canDeleteForEveryone && (
              <button
                onClick={() => handleDelete(true)}
                disabled={isProcessing}
                className="w-full py-3 rounded-xl bg-red-500 text-white font-medium hover:bg-red-600 disabled:opacity-50"
              >
                {isProcessing ? 'Deleting...' : 'Delete for Everyone'}
              </button>
            )}
            <button
              onClick={() => handleDelete(false)}
              disabled={isProcessing}
              className="w-full py-3 rounded-xl border border-red-200 text-red-600 font-medium hover:bg-red-50 disabled:opacity-50"
            >
              Delete for Me
            </button>
            <button
              onClick={() => { setShowDeleteConfirm(false); onClose(); }}
              className="w-full py-3 rounded-xl border border-slate-200 text-slate-600 font-medium hover:bg-slate-50"
            >
              Cancel
            </button>
          </div>
        </div>
        </div>
      </div>,
      portalRoot
    ) : null;
  }

  // All Reactions Picker — rendered via Portal, matching the 1:1 chat
  // MessageActions pattern.
  if (showAllReactions) {
    return portalRoot ? createPortal(
      <div className="fixed inset-0 flex items-end justify-center bg-black/50" style={{ zIndex: 99999 }} onClick={onClose}>
        <div
          className="bg-white rounded-t-3xl w-full max-w-md shadow-2xl animate-slide-up"
          onClick={e => e.stopPropagation()}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
            <h3 className="font-semibold text-slate-800">Reactions</h3>
            <button onClick={onClose} className="p-2 rounded-full hover:bg-slate-100">
              <X className="w-5 h-5 text-slate-500" />
            </button>
          </div>
          <div className="grid grid-cols-8 gap-2 p-4">
            {ALL_REACTIONS.map((emoji) => {
              const userReacted = message.reactions?.[emoji]?.includes(currentUserId);
              return (
                <button
                  key={emoji}
                  onClick={() => handleReaction(emoji)}
                  disabled={isProcessing}
                  className={`text-2xl p-2 rounded-xl transition-all hover:scale-110 hover:bg-slate-100 ${
                    userReacted ? 'bg-violet-100 ring-2 ring-violet-300' : ''
                  }`}
                >
                  {emoji}
                </button>
              );
            })}
          </div>
        </div>
      </div>,
      portalRoot
    ) : null;
  }

  // Main Context Menu — rendered via Portal to escape any ancestor
  // stacking context, matching the 1:1 chat MessageActions pattern.
  return portalRoot ? createPortal(
    <div className="fixed inset-0" style={{ zIndex: 99999 }} onClick={onClose}>
      <div
        ref={menuRef}
        // `max-w-[min(15.5rem,calc(100vw-16px))]` is a hard cap, not just a
        // hint: it guarantees this menu can never be wider than the actual
        // screen (minus an 8px margin on each side), independent of
        // whatever the clamping effect above computes.
        className="absolute bg-white rounded-2xl shadow-2xl overflow-hidden animate-scale-in w-max max-w-[min(15.5rem,calc(100vw-16px))]"
        style={{
          left: menuPos?.left ?? position.x,
          top: menuPos?.top ?? position.y,
          visibility: menuPos ? 'visible' : 'hidden',
          zIndex: 100000
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Quick Reactions.
            `overflow-x-auto` + `flex-nowrap` is a safety net for narrow
            screens: if the reactions + "more" button are ever wider than
            the menu's capped max-width above, this row scrolls
            horizontally inside itself instead of forcing the whole menu
            wider than the screen. */}
        <div className="flex items-center flex-nowrap gap-0.5 p-1.5 border-b border-slate-100 overflow-x-auto">
          {QUICK_REACTIONS.map((emoji) => {
            const userReacted = message.reactions?.[emoji]?.includes(currentUserId);
            return (
              <button
                key={emoji}
                onClick={() => handleReaction(emoji)}
                disabled={isProcessing}
                className={`shrink-0 text-lg p-1.5 rounded-full transition-all hover:scale-125 hover:bg-slate-100 ${
                  userReacted ? 'bg-violet-100' : ''
                }`}
              >
                {emoji}
              </button>
            );
          })}
          <button
            onClick={() => setShowAllReactions(true)}
            className="shrink-0 p-1.5 rounded-full hover:bg-slate-100 text-slate-500"
          >
            <Smile className="w-4 h-4" />
          </button>
        </div>

        {/* Action Buttons */}
        <div className="py-1">
          <button
            onClick={handleReply}
            className="w-full flex items-center gap-2.5 px-3.5 py-2 hover:bg-slate-50 text-slate-700"
          >
            <Reply className="w-4 h-4 text-slate-500" />
            <span className="text-sm font-medium">Reply</span>
          </button>

          <button
            onClick={handleForward}
            className="w-full flex items-center gap-2.5 px-3.5 py-2 hover:bg-slate-50 text-slate-700"
          >
            <Forward className="w-4 h-4 text-slate-500" />
            <span className="text-sm font-medium">Forward</span>
          </button>

          {(!message.type || message.type === 'text') && (
            <button
              onClick={handleCopy}
              className="w-full flex items-center gap-2.5 px-3.5 py-2 hover:bg-slate-50 text-slate-700"
            >
              <Copy className="w-4 h-4 text-slate-500" />
              <span className="text-sm font-medium">Copy</span>
            </button>
          )}

          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="w-full flex items-center gap-2.5 px-3.5 py-2 hover:bg-red-50 text-red-600"
          >
            <Trash2 className="w-4 h-4" />
            <span className="text-sm font-medium">Delete</span>
          </button>
        </div>
      </div>
    </div>,
    portalRoot
  ) : null;
}

// Reactions Display Component for group messages
interface GroupReactionsDisplayProps {
  reactions: { [emoji: string]: string[] } | undefined;
  currentUserId: string;
  onReactionClick: (emoji: string) => void;
}

export function GroupReactionsDisplay({ reactions, currentUserId, onReactionClick }: GroupReactionsDisplayProps) {
  if (!reactions || Object.keys(reactions).length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {Object.entries(reactions).map(([emoji, userIds]) => {
        const userReacted = userIds.includes(currentUserId);
        return (
          <button
            key={emoji}
            onClick={() => onReactionClick(emoji)}
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs transition-all hover:scale-105 ${
              userReacted
                ? 'bg-violet-100 border border-violet-300'
                : 'bg-slate-100 border border-slate-200 hover:bg-slate-200'
            }`}
          >
            <span>{emoji}</span>
            <span className={userReacted ? 'text-violet-600' : 'text-slate-600'}>
              {userIds.length}
            </span>
          </button>
        );
      })}
    </div>
  );
}
