/**
 * GroupMessageActions Component
 * WhatsApp-style message actions for group chats: Reactions, Delete, Forward
 */

import { useState, useRef, useEffect } from 'react';
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

  // Calculate menu position to keep it in viewport
  const getMenuStyle = () => {
    const menuWidth = 200;
    const menuHeight = 300;
    let x = position.x;
    let y = position.y;

    if (x + menuWidth > window.innerWidth) {
      x = window.innerWidth - menuWidth - 16;
    }
    if (x < 16) x = 16;

    if (y + menuHeight > window.innerHeight) {
      y = window.innerHeight - menuHeight - 16;
    }
    if (y < 16) y = 16;

    return { left: x, top: y };
  };

  // Delete Confirmation
  if (showDeleteConfirm) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl animate-scale-in">
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
    );
  }

  // All Reactions Picker
  if (showAllReactions) {
    return (
      <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50" onClick={onClose}>
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
      </div>
    );
  }

  // Main Context Menu
  return (
    <div className="fixed inset-0 z-50" onClick={onClose}>
      <div
        ref={menuRef}
        className="absolute bg-white rounded-2xl shadow-2xl overflow-hidden animate-scale-in min-w-[200px]"
        style={getMenuStyle()}
        onClick={e => e.stopPropagation()}
      >
        {/* Quick Reactions */}
        <div className="flex items-center gap-1 p-2 border-b border-slate-100">
          {QUICK_REACTIONS.map((emoji) => {
            const userReacted = message.reactions?.[emoji]?.includes(currentUserId);
            return (
              <button
                key={emoji}
                onClick={() => handleReaction(emoji)}
                disabled={isProcessing}
                className={`text-xl p-2 rounded-full transition-all hover:scale-125 hover:bg-slate-100 ${
                  userReacted ? 'bg-violet-100' : ''
                }`}
              >
                {emoji}
              </button>
            );
          })}
          <button
            onClick={() => setShowAllReactions(true)}
            className="p-2 rounded-full hover:bg-slate-100 text-slate-500"
          >
            <Smile className="w-5 h-5" />
          </button>
        </div>

        {/* Action Buttons */}
        <div className="py-1">
          <button
            onClick={handleReply}
            className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 text-slate-700"
          >
            <Reply className="w-5 h-5 text-slate-500" />
            <span className="text-sm font-medium">Reply</span>
          </button>

          <button
            onClick={handleForward}
            className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 text-slate-700"
          >
            <Forward className="w-5 h-5 text-slate-500" />
            <span className="text-sm font-medium">Forward</span>
          </button>

          {(!message.type || message.type === 'text') && (
            <button
              onClick={handleCopy}
              className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 text-slate-700"
            >
              <Copy className="w-5 h-5 text-slate-500" />
              <span className="text-sm font-medium">Copy</span>
            </button>
          )}

          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-red-50 text-red-600"
          >
            <Trash2 className="w-5 h-5" />
            <span className="text-sm font-medium">Delete</span>
          </button>
        </div>
      </div>
    </div>
  );
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
