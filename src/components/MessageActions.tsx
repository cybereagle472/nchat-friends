/**
 * MessageActions Component
 * WhatsApp-style message actions: Reactions, Edit, Delete, Forward
 */

import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  Smile,
  Pencil,
  Trash2,
  Forward,
  Copy,
  Reply,
  X,
  Check,
  Users,
  Search
} from 'lucide-react';
import { Message, Contact } from '../types';
import { chatService } from '../services/chatService';
import { GroupWithMembers } from '../services/groupService';

// Common emoji reactions (WhatsApp style)
const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
const ALL_REACTIONS = [
  '👍', '👎', '❤️', '🧡', '💛', '💚', '💙', '💜',
  '😀', '😂', '🤣', '😊', '😍', '🥰', '😘', '😎',
  '😮', '😯', '😲', '😱', '😢', '😭', '😤', '😡',
  '🙏', '👏', '🎉', '🔥', '💯', '✨', '💪', '🤝'
];

interface MessageActionsProps {
  message: Message;
  isOwn: boolean;
  currentUserId: string;
  onClose: () => void;
  onReactionAdded?: (messageId: string, emoji: string) => void;
  onMessageEdited?: (messageId: string, newContent: string) => void;
  onMessageDeleted?: (messageId: string, forEveryone: boolean) => void;
  onForward?: (message: Message) => void;
  onReply?: (message: Message) => void;
  position: { x: number; y: number };
}

export function MessageActions({
  message,
  isOwn,
  currentUserId,
  onClose,
  onReactionAdded,
  onMessageEdited,
  onMessageDeleted,
  onForward,
  onReply,
  position
}: MessageActionsProps) {
  const [showAllReactions, setShowAllReactions] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [editText, setEditText] = useState(message.content);
  const [isProcessing, setIsProcessing] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPos, setMenuPos] = useState<{ left: number; top: number } | null>(null);

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
  // plus the "more" button) is wider than a 200px guess, and the action
  // list's height varies with how many rows actually show (Edit only for
  // your own recent text messages, Copy only for text messages, etc.), so
  // a fixed estimate reliably left part of the menu rendered off-screen.
  // Measuring synchronously after mount (before the browser paints) and
  // only revealing the menu once positioned avoids any visible flash at
  // the wrong spot.
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el || showEditModal || showDeleteConfirm || showAllReactions) return;
    const margin = 8;
    const rect = el.getBoundingClientRect();
    let left = position.x;
    let top = position.y;

    if (left + rect.width + margin > window.innerWidth) {
      left = window.innerWidth - rect.width - margin;
    }
    if (left < margin) left = margin;

    if (top + rect.height + margin > window.innerHeight) {
      top = window.innerHeight - rect.height - margin;
    }
    if (top < margin) top = margin;

    setMenuPos({ left, top });
  }, [position.x, position.y, showEditModal, showDeleteConfirm, showAllReactions]);

  // Check if message can be edited (only text, within 15 minutes, own message)
  const canEdit = isOwn &&
    message.type === 'text' &&
    !message.is_deleted &&
    (Date.now() - new Date(message.created_at).getTime()) < 15 * 60 * 1000;

  // Check if message can be deleted for everyone (own message)
  const canDeleteForEveryone = isOwn && !message.is_deleted;

  const handleReaction = async (emoji: string) => {
    setIsProcessing(true);
    try {
      // Check if user already reacted with this emoji
      const userReacted = message.reactions?.[emoji]?.includes(currentUserId);

      if (userReacted) {
        await chatService.removeReaction(message.id, currentUserId, emoji);
      } else {
        await chatService.addReaction(message.id, currentUserId, emoji);
      }

      onReactionAdded?.(message.id, emoji);
    } catch (error) {
      console.error('Failed to add reaction:', error);
    } finally {
      setIsProcessing(false);
      onClose();
    }
  };

  const handleEdit = async () => {
    if (!editText.trim() || editText === message.content) {
      setShowEditModal(false);
      return;
    }

    setIsProcessing(true);
    try {
      const result = await chatService.editMessage(message.id, currentUserId, editText.trim());
      if (result.success) {
        onMessageEdited?.(message.id, editText.trim());
        setShowEditModal(false);
        onClose();
      } else {
        alert(result.error || 'Failed to edit message');
      }
    } catch (error) {
      console.error('Failed to edit message:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDelete = async (forEveryone: boolean) => {
    setIsProcessing(true);
    try {
      if (forEveryone) {
        const result = await chatService.deleteForEveryone(message.id, currentUserId);
        if (!result.success) {
          alert(result.error || 'Failed to delete message');
          return;
        }
      } else {
        const result = await chatService.deleteForMe(message.id, currentUserId);
        if (!result.success) {
          alert('Failed to delete message');
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

  // All modal content rendered via Portal to escape stacking context
  const portalRoot = typeof document !== 'undefined' ? document.body : null;

  // Edit Modal
  if (showEditModal) {
    return portalRoot ? createPortal(
      <div className="fixed inset-0 flex items-center justify-center bg-black/50 p-4" style={{ zIndex: 99999 }}>
        <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl animate-scale-in">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
            <h3 className="font-semibold text-slate-800">Edit Message</h3>
            <button
              onClick={() => { setShowEditModal(false); onClose(); }}
              className="p-2 rounded-full hover:bg-slate-100"
            >
              <X className="w-5 h-5 text-slate-500" />
            </button>
          </div>
          <div className="p-4">
            <textarea
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              className="w-full px-4 py-3 border border-slate-200 rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-300"
              rows={4}
              autoFocus
            />
          </div>
          <div className="flex gap-3 px-4 pb-4">
            <button
              onClick={() => { setShowEditModal(false); onClose(); }}
              className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-600 font-medium hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              onClick={handleEdit}
              disabled={isProcessing || !editText.trim() || editText === message.content}
              className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-violet-500 to-purple-500 text-white font-medium hover:opacity-90 disabled:opacity-50"
            >
              {isProcessing ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </div>,
      portalRoot
    ) : null;
  }

  // Delete Confirmation
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

  // All Reactions Picker
  if (showAllReactions) {
    return portalRoot ? createPortal(
      <div className="fixed inset-0 flex items-end justify-center bg-black/50" style={{ zIndex: 99999 }} onClick={onClose}>
        <div
          className="bg-white rounded-t-3xl w-full max-w-md shadow-2xl animate-slide-up"
          onClick={e => e.stopPropagation()}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
            <h3 className="font-semibold text-slate-800">Reactions</h3>
            <button
              onClick={onClose}
              className="p-2 rounded-full hover:bg-slate-100"
            >
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

  // Main Context Menu - rendered via Portal
  return portalRoot ? createPortal(
    <div className="fixed inset-0" style={{ zIndex: 99999 }} onClick={onClose}>
      <div className="fixed inset-0 bg-black/30 backdrop-blur-sm" />
      <div
        ref={menuRef}
        className="absolute bg-white rounded-2xl shadow-2xl overflow-hidden animate-scale-in min-w-[200px]"
        style={{
          left: menuPos?.left ?? position.x,
          top: menuPos?.top ?? position.y,
          visibility: menuPos ? 'visible' : 'hidden',
          zIndex: 100000
        }}
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

          {message.type === 'text' && (
            <button
              onClick={handleCopy}
              className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 text-slate-700"
            >
              <Copy className="w-5 h-5 text-slate-500" />
              <span className="text-sm font-medium">Copy</span>
            </button>
          )}

          {canEdit && (
            <button
              onClick={() => setShowEditModal(true)}
              className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 text-slate-700"
            >
              <Pencil className="w-5 h-5 text-slate-500" />
              <span className="text-sm font-medium">Edit</span>
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
    </div>,
    portalRoot
  ) : null;
}

// Forward Dialog Component
interface ForwardDialogProps {
  message: Message;
  contacts: Contact[];
  groups: GroupWithMembers[];
  currentUserId: string;
  onClose: () => void;
  onForwardComplete: (count: number) => void;
}

export function ForwardDialog({
  message,
  contacts,
  groups,
  currentUserId,
  onClose,
  onForwardComplete
}: ForwardDialogProps) {
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isForwarding, setIsForwarding] = useState(false);
  const [activeTab, setActiveTab] = useState<'contacts' | 'groups'>('contacts');

  const filteredContacts = contacts.filter(c =>
    c.profile.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.profile.username?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredGroups = groups.filter(g =>
    g.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const toggleUser = (userId: string) => {
    setSelectedUsers(prev =>
      prev.includes(userId)
        ? prev.filter(id => id !== userId)
        : [...prev, userId]
    );
  };

  const toggleGroup = (groupId: string) => {
    setSelectedGroups(prev =>
      prev.includes(groupId)
        ? prev.filter(id => id !== groupId)
        : [...prev, groupId]
    );
  };

  const handleForward = async () => {
    if (selectedUsers.length === 0 && selectedGroups.length === 0) return;

    setIsForwarding(true);
    let totalSent = 0;

    try {
      if (selectedUsers.length > 0) {
        const result = await chatService.forwardToUsers(currentUserId, selectedUsers, message);
        totalSent += result.sentCount;
      }

      if (selectedGroups.length > 0) {
        const result = await chatService.forwardToGroups(currentUserId, selectedGroups, message);
        totalSent += result.sentCount;
      }

      onForwardComplete(totalSent);
      onClose();
    } catch (error) {
      console.error('Failed to forward message:', error);
    } finally {
      setIsForwarding(false);
    }
  };

  const totalSelected = selectedUsers.length + selectedGroups.length;
  const portalRoot = typeof document !== 'undefined' ? document.body : null;

  return portalRoot ? createPortal(
    <div className="fixed inset-0 flex items-center justify-center bg-black/50 p-4" style={{ zIndex: 99999 }}>
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl animate-scale-in max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
          <h3 className="font-semibold text-slate-800">Forward to</h3>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-slate-100">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        {/* Search */}
        <div className="px-4 py-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
            <input
              type="text"
              placeholder="Search contacts or groups..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-300"
            />
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-100">
          <button
            onClick={() => setActiveTab('contacts')}
            className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
              activeTab === 'contacts'
                ? 'text-violet-600 border-b-2 border-violet-600'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            Contacts
          </button>
          <button
            onClick={() => setActiveTab('groups')}
            className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
              activeTab === 'groups'
                ? 'text-violet-600 border-b-2 border-violet-600'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            Groups
          </button>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {activeTab === 'contacts' ? (
            filteredContacts.length === 0 ? (
              <div className="p-8 text-center text-slate-500 text-sm">
                No contacts found
              </div>
            ) : (
              filteredContacts.map((contact) => (
                <button
                  key={contact.user_id}
                  onClick={() => toggleUser(contact.user_id)}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors"
                >
                  <div className="relative">
                    <div className="w-10 h-10 rounded-full overflow-hidden bg-gradient-to-br from-violet-400 to-purple-400 flex items-center justify-center">
                      {contact.profile.avatar_url ? (
                        <img src={contact.profile.avatar_url} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-white font-semibold">
                          {contact.profile.full_name.charAt(0).toUpperCase()}
                        </span>
                      )}
                    </div>
                    {selectedUsers.includes(contact.user_id) && (
                      <div className="absolute -right-1 -bottom-1 w-5 h-5 rounded-full bg-violet-500 flex items-center justify-center">
                        <Check className="w-3 h-3 text-white" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 text-left">
                    <p className="font-medium text-slate-800">{contact.profile.full_name}</p>
                    {contact.profile.username && (
                      <p className="text-xs text-slate-500">@{contact.profile.username}</p>
                    )}
                  </div>
                </button>
              ))
            )
          ) : (
            filteredGroups.length === 0 ? (
              <div className="p-8 text-center text-slate-500 text-sm">
                No groups found
              </div>
            ) : (
              filteredGroups.map((group) => (
                <button
                  key={group.id}
                  onClick={() => toggleGroup(group.id)}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors"
                >
                  <div className="relative">
                    <div className="w-10 h-10 rounded-full overflow-hidden bg-gradient-to-br from-violet-400 to-purple-400 flex items-center justify-center">
                      {group.avatar_url ? (
                        <img src={group.avatar_url} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <Users className="w-5 h-5 text-white" />
                      )}
                    </div>
                    {selectedGroups.includes(group.id) && (
                      <div className="absolute -right-1 -bottom-1 w-5 h-5 rounded-full bg-violet-500 flex items-center justify-center">
                        <Check className="w-3 h-3 text-white" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 text-left">
                    <p className="font-medium text-slate-800">{group.name}</p>
                    <p className="text-xs text-slate-500">{group.members.length} members</p>
                  </div>
                </button>
              ))
            )
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-100">
          <button
            onClick={handleForward}
            disabled={totalSelected === 0 || isForwarding}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-violet-500 to-purple-500 text-white font-medium hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <Forward className="w-5 h-5" />
            {isForwarding ? 'Forwarding...' : `Forward${totalSelected > 0 ? ` (${totalSelected})` : ''}`}
          </button>
        </div>
      </div>
    </div>,
    portalRoot
  ) : null;
}

// Reactions Display Component (to show at bottom right of messages)
interface ReactionsDisplayProps {
  reactions: { [emoji: string]: string[] } | undefined;
  currentUserId: string;
  onReactionClick: (emoji: string) => void;
  isOwn?: boolean;
}

export function ReactionsDisplay({ reactions, currentUserId, onReactionClick, isOwn = false }: ReactionsDisplayProps) {
  if (!reactions || Object.keys(reactions).length === 0) return null;

  return (
    <div className={`reactions-container ${isOwn ? 'own' : 'received'}`}>
      <div className="reactions-wrapper">
        {Object.entries(reactions).map(([emoji, userIds]) => {
          const userReacted = userIds.includes(currentUserId);
          return (
            <button
              key={emoji}
              onClick={(e) => {
                e.stopPropagation();
                onReactionClick(emoji);
              }}
              className={`reaction-pill ${userReacted ? 'reacted' : ''}`}
            >
              <span className="reaction-emoji">{emoji}</span>
              {userIds.length > 1 && (
                <span className="reaction-count">{userIds.length}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
