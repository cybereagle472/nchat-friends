/**
 * Status Component - WhatsApp-style Stories
 *
 * Features:
 * - View my status and contacts' statuses
 * - Create text, image, video statuses
 * - Full-screen story viewer with progress bar
 * - View tracking and viewer list
 * - Reply to status
 * - Mute/unmute statuses
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Plus,
  Camera,
  Type,
  X,
  ChevronLeft,
  Send,
  Eye,
  MoreVertical,
  Trash2,
  VolumeX,
  Volume2,
  Image as ImageIcon,
  Film
} from 'lucide-react';
import { statusService, STATUS_BACKGROUNDS, STATUS_FONTS } from '../services/statusService';
import { Status as StatusType, UserStatuses, StatusView, UserProfile } from '../types';

interface StatusProps {
  currentUser: UserProfile;
  friends: { id: string; profile: UserProfile }[];
}

type CreateMode = 'text' | 'media' | null;

export function Status({ currentUser, friends }: StatusProps) {
  // State
  const [myStatuses, setMyStatuses] = useState<StatusType[]>([]);
  const [contactStatuses, setContactStatuses] = useState<UserStatuses[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewingStatus, setViewingStatus] = useState<{
    userStatuses: UserStatuses;
    currentIndex: number;
  } | null>(null);
  const [viewingMyStatus, setViewingMyStatus] = useState(false);
  const [statusViewers, setStatusViewers] = useState<StatusView[]>([]);
  const viewersPanelStatusIdRef = useRef<string | null>(null);
  const [showViewers, setShowViewers] = useState(false);

  // Create status state
  const [createMode, setCreateMode] = useState<CreateMode>(null);
  const [textContent, setTextContent] = useState('');
  const [selectedBgIndex, setSelectedBgIndex] = useState(0);
  const [selectedFontIndex, setSelectedFontIndex] = useState(0);
  const [selectedMedia, setSelectedMedia] = useState<File | null>(null);
  const [mediaPreview, setMediaPreview] = useState<string | null>(null);
  const [mediaType, setMediaType] = useState<'image' | 'video' | null>(null);
  const [caption, setCaption] = useState('');
  const [uploading, setUploading] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [isReplyFocused, setIsReplyFocused] = useState(false);
  const [showMenu, setShowMenu] = useState(false);

  // Refs
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const progressIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const [progress, setProgress] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isMuted, setIsMuted] = useState(false);

  // Load statuses
  const loadStatuses = useCallback(async () => {
    setLoading(true);
    try {
      const [mine, contacts] = await Promise.all([
        statusService.getMyStatuses(currentUser.id),
        statusService.getContactsStatuses(currentUser.id, friends.map(f => f.id))
      ]);
      setMyStatuses(mine);
      setContactStatuses(contacts);
    } catch (error) {
      console.error('Error loading statuses:', error);
    } finally {
      setLoading(false);
    }
  }, [currentUser.id, friends]);

  useEffect(() => {
    loadStatuses();
  }, [loadStatuses]);

  // Subscribe to new statuses
  useEffect(() => {
    if (friends.length === 0) return;

    const subscription = statusService.subscribeToStatuses(
      currentUser.id,
      friends.map(f => f.id),
      () => {
        loadStatuses(); // Refresh on new status
      }
    );

    return () => subscription.unsubscribe();
  }, [currentUser.id, friends, loadStatuses]);

  // Subscribe to views on my own statuses — updates the view count live
  // while I'm looking at my status, and the viewer list if it's open.
  useEffect(() => {
    const subscription = statusService.subscribeToMyStatusViews(currentUser.id, (view) => {
      setMyStatuses(prev =>
        prev.map(s => (s.id === view.status_id ? { ...s, view_count: s.view_count + 1 } : s))
      );
      setStatusViewers(prev => {
        if (prev.length === 0) return prev;
        if (viewersPanelStatusIdRef.current !== view.status_id) return prev;
        if (prev.some(v => v.viewer_id === view.viewer_id)) return prev;
        return [view, ...prev];
      });
    });

    return () => subscription.unsubscribe();
  }, [currentUser.id]);

  // Progress bar timer for status viewing
  useEffect(() => {
    if (!viewingStatus && !viewingMyStatus) {
      setProgress(0);
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
      }
      return;
    }

    // Also pause while the viewer list is open or the reply box is focused —
    // either of those means the user's attention is on that UI, not on
    // watching the story play through.
    if (isPaused || showViewers || isReplyFocused) return;

    const currentStatus = viewingMyStatus
      ? myStatuses[viewingStatus?.currentIndex || 0]
      : viewingStatus?.userStatuses.statuses[viewingStatus.currentIndex];

    const duration = currentStatus?.content_type === 'video'
      ? (currentStatus.duration || 30) * 1000
      : 5000; // 5 seconds for image/text

    const interval = 50; // Update every 50ms
    const increment = (interval / duration) * 100;

    progressIntervalRef.current = setInterval(() => {
      setProgress(prev => {
        if (prev >= 100) {
          // Move to next status
          handleNextStatus();
          return 0;
        }
        return prev + increment;
      });
    }, interval);

    return () => {
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
      }
    };
  }, [viewingStatus, viewingMyStatus, isPaused, showViewers, isReplyFocused]);

  // Mark status as viewed (not applicable to your own status — viewing your
  // own updates should never count as a "view" or add you to your own
  // viewer list, so skip the call entirely).
  useEffect(() => {
    if (!viewingStatus || viewingMyStatus) return;

    const currentStatus = viewingStatus.userStatuses.statuses[viewingStatus.currentIndex];
    if (currentStatus) {
      statusService.viewStatus(currentStatus.id, currentUser.id);
    }
  }, [viewingStatus?.currentIndex, viewingMyStatus, currentUser.id]);

  // Handle file selection
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const isVideo = file.type.startsWith('video/');
    const isImage = file.type.startsWith('image/');

    if (!isVideo && !isImage) {
      alert('Please select an image or video file');
      return;
    }

    // Check file size (50MB for video, 10MB for image)
    const maxSize = isVideo ? 50 * 1024 * 1024 : 10 * 1024 * 1024;
    if (file.size > maxSize) {
      alert(`File too large. Maximum size is ${isVideo ? '50MB' : '10MB'}`);
      return;
    }

    setSelectedMedia(file);
    setMediaType(isVideo ? 'video' : 'image');
    setMediaPreview(URL.createObjectURL(file));
    setCreateMode('media');
  };

  // Create text status
  const handleCreateTextStatus = async () => {
    if (!textContent.trim()) {
      console.log('Text content is empty');
      return;
    }

    console.log('Creating text status...', { textContent, bg: selectedBgIndex, font: selectedFontIndex });
    setUploading(true);
    try {
      const status = await statusService.createTextStatus(
        currentUser.id,
        textContent,
        STATUS_BACKGROUNDS[selectedBgIndex],
        STATUS_FONTS[selectedFontIndex]
      );

      console.log('Status created:', status);

      if (status) {
        setMyStatuses(prev => [status, ...prev]);
        setCreateMode(null);
        setTextContent('');
      } else {
        alert('Failed to create status. Please try again.');
      }
    } catch (error) {
      console.error('Error creating text status:', error);
      alert('Error creating status: ' + (error as Error).message);
    } finally {
      setUploading(false);
    }
  };

  // Create media status
  const handleCreateMediaStatus = async () => {
    if (!selectedMedia) {
      console.log('No media selected');
      return;
    }

    console.log('Creating media status...', { mediaType, caption, fileName: selectedMedia.name });
    setUploading(true);
    try {
      let status: StatusType | null = null;

      if (mediaType === 'image') {
        console.log('Uploading image...');
        status = await statusService.createImageStatus(
          currentUser.id,
          selectedMedia,
          caption
        );
      } else if (mediaType === 'video') {
        console.log('Uploading video...');
        status = await statusService.createVideoStatus(
          currentUser.id,
          selectedMedia,
          caption
        );
      }

      console.log('Media status created:', status);

      if (status) {
        setMyStatuses(prev => [status!, ...prev]);
        setCreateMode(null);
        setSelectedMedia(null);
        setMediaPreview(null);
        setMediaType(null);
        setCaption('');
      } else {
        alert('Failed to upload media. Please try again.');
      }
    } catch (error) {
      console.error('Error creating media status:', error);
      alert('Error uploading media: ' + (error as Error).message);
    } finally {
      setUploading(false);
    }
  };

  // Navigate statuses
  const handleNextStatus = () => {
    if (viewingMyStatus) {
      const nextIndex = (viewingStatus?.currentIndex || 0) + 1;
      if (nextIndex >= myStatuses.length) {
        closeStatusViewer();
      } else {
        setViewingStatus({
          userStatuses: {
            user_id: currentUser.id,
            user_profile: currentUser,
            statuses: myStatuses,
            hasUnviewed: false,
            lastStatusAt: myStatuses[myStatuses.length - 1]?.created_at || ''
          },
          currentIndex: nextIndex
        });
        setProgress(0);
      }
    } else if (viewingStatus) {
      const nextIndex = viewingStatus.currentIndex + 1;
      if (nextIndex >= viewingStatus.userStatuses.statuses.length) {
        // Move to next user's status
        const currentUserIndex = contactStatuses.findIndex(
          us => us.user_id === viewingStatus.userStatuses.user_id
        );
        if (currentUserIndex < contactStatuses.length - 1) {
          setViewingStatus({
            userStatuses: contactStatuses[currentUserIndex + 1],
            currentIndex: 0
          });
        } else {
          closeStatusViewer();
        }
      } else {
        setViewingStatus({
          ...viewingStatus,
          currentIndex: nextIndex
        });
      }
      setProgress(0);
    }
  };

  const handlePrevStatus = () => {
    if (viewingMyStatus && viewingStatus) {
      const prevIndex = viewingStatus.currentIndex - 1;
      if (prevIndex >= 0) {
        setViewingStatus({
          ...viewingStatus,
          currentIndex: prevIndex
        });
        setProgress(0);
      }
    } else if (viewingStatus) {
      const prevIndex = viewingStatus.currentIndex - 1;
      if (prevIndex >= 0) {
        setViewingStatus({
          ...viewingStatus,
          currentIndex: prevIndex
        });
        setProgress(0);
      } else {
        // Move to previous user's status
        const currentUserIndex = contactStatuses.findIndex(
          us => us.user_id === viewingStatus.userStatuses.user_id
        );
        if (currentUserIndex > 0) {
          const prevUserStatuses = contactStatuses[currentUserIndex - 1];
          setViewingStatus({
            userStatuses: prevUserStatuses,
            currentIndex: prevUserStatuses.statuses.length - 1
          });
        }
      }
      setProgress(0);
    }
  };

  const closeStatusViewer = () => {
    setViewingStatus(null);
    setViewingMyStatus(false);
    setProgress(0);
    setIsPaused(false);
    setShowViewers(false);
    setReplyText('');
    setIsReplyFocused(false);
    loadStatuses(); // Refresh to update view counts
  };

  // Open my status viewer
  const openMyStatusViewer = () => {
    if (myStatuses.length === 0) return;
    setViewingMyStatus(true);
    setViewingStatus({
      userStatuses: {
        user_id: currentUser.id,
        user_profile: currentUser,
        statuses: myStatuses,
        hasUnviewed: false,
        lastStatusAt: myStatuses[myStatuses.length - 1]?.created_at || ''
      },
      currentIndex: 0
    });
  };

  // Load viewers for current status
  const loadViewers = async (statusId: string) => {
    viewersPanelStatusIdRef.current = statusId;
    const viewers = await statusService.getStatusViewers(statusId);
    setStatusViewers(viewers);
    setShowViewers(true);
  };

  // Delete status
  const handleDeleteStatus = async (statusId: string) => {
    const confirmed = window.confirm('Delete this status?');
    if (!confirmed) return;

    const success = await statusService.deleteStatus(statusId, currentUser.id);
    if (success) {
      setMyStatuses(prev => prev.filter(s => s.id !== statusId));
      if (myStatuses.length <= 1) {
        closeStatusViewer();
      } else {
        handleNextStatus();
      }
    }
  };

  // Reply to status
  const handleReply = async () => {
    if (!replyText.trim() || !viewingStatus) return;

    const currentStatus = viewingStatus.userStatuses.statuses[viewingStatus.currentIndex];
    await statusService.replyToStatus(
      currentStatus.id,
      currentUser.id,
      viewingStatus.userStatuses.user_id,
      replyText
    );
    setReplyText('');
    alert('Reply sent!');
  };

  // Format time ago
  const formatTimeAgo = (timestamp: string) => {
    const diff = Date.now() - new Date(timestamp).getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return 'Yesterday';
  };

  // Get font class
  const getFontClass = (fontStyle: string) => {
    switch (fontStyle) {
      case 'serif': return 'font-serif';
      case 'mono': return 'font-mono';
      case 'handwriting': return 'font-cursive italic';
      case 'bold': return 'font-bold';
      default: return '';
    }
  };

  // Current status being viewed
  const currentViewingStatus = viewingStatus
    ? (viewingMyStatus ? myStatuses : viewingStatus.userStatuses.statuses)[viewingStatus.currentIndex]
    : null;

  // Render create mode
  if (createMode === 'text') {
    return (
      <div
        className="h-full flex flex-col"
        style={{ background: STATUS_BACKGROUNDS[selectedBgIndex] }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-black/20">
          <button
            onClick={() => setCreateMode(null)}
            className="p-2 rounded-full bg-white/20 text-white"
          >
            <X className="w-5 h-5" />
          </button>
          <button
            onClick={handleCreateTextStatus}
            disabled={!textContent.trim() || uploading}
            className="px-4 py-2 rounded-full bg-white text-violet-600 font-semibold text-sm disabled:opacity-50"
          >
            {uploading ? 'Posting...' : 'Post'}
          </button>
        </div>

        {/* Text Input */}
        <div className="flex-1 flex items-center justify-center p-4">
          <textarea
            value={textContent}
            onChange={(e) => setTextContent(e.target.value.slice(0, 700))}
            placeholder="Type a status..."
            className={`w-full text-center text-2xl bg-transparent text-white placeholder-white/60 outline-none resize-none ${getFontClass(STATUS_FONTS[selectedFontIndex])}`}
            style={{ minHeight: '200px' }}
            autoFocus
          />
        </div>

        {/* Character count */}
        <div className="text-center text-white/60 text-sm pb-2">
          {textContent.length}/700
        </div>

        {/* Background colors */}
        <div className="px-4 py-3 bg-black/20">
          <div className="flex gap-2 overflow-x-auto pb-2">
            {STATUS_BACKGROUNDS.map((bg, index) => (
              <button
                key={index}
                onClick={() => setSelectedBgIndex(index)}
                className={`w-8 h-8 rounded-full flex-shrink-0 border-2 ${
                  selectedBgIndex === index ? 'border-white' : 'border-transparent'
                }`}
                style={{ background: bg }}
              />
            ))}
          </div>

          {/* Font styles */}
          <div className="flex gap-2 mt-2">
            {STATUS_FONTS.map((font, index) => (
              <button
                key={font}
                onClick={() => setSelectedFontIndex(index)}
                className={`px-3 py-1 rounded-full text-xs ${
                  selectedFontIndex === index
                    ? 'bg-white text-violet-600'
                    : 'bg-white/20 text-white'
                } ${getFontClass(font)}`}
              >
                Aa
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (createMode === 'media' && mediaPreview) {
    return (
      <div className="h-full flex flex-col bg-black">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3">
          <button
            onClick={() => {
              setCreateMode(null);
              setSelectedMedia(null);
              setMediaPreview(null);
              setCaption('');
            }}
            className="p-2 rounded-full bg-white/20 text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Media Preview */}
        <div className="flex-1 flex items-center justify-center">
          {mediaType === 'video' ? (
            <video
              src={mediaPreview}
              controls
              className="max-h-full max-w-full"
            />
          ) : (
            <img
              src={mediaPreview}
              alt="Preview"
              className="max-h-full max-w-full object-contain"
            />
          )}
        </div>

        {/* Caption and Post */}
        <div className="p-4 bg-black/50">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={caption}
              onChange={(e) => setCaption(e.target.value.slice(0, 200))}
              placeholder="Add a caption..."
              className="flex-1 bg-white/10 text-white placeholder-white/60 px-4 py-3 rounded-full text-sm outline-none"
            />
            <button
              onClick={handleCreateMediaStatus}
              disabled={uploading}
              className="w-12 h-12 rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 flex items-center justify-center text-white disabled:opacity-50"
            >
              {uploading ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <Send className="w-5 h-5" />
              )}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Render status viewer
  if (viewingStatus && currentViewingStatus) {
    return (
      <div
        className="h-full flex flex-col bg-black"
        onClick={(e) => {
          // Click left/right to navigate
          const rect = (e.target as HTMLElement).getBoundingClientRect();
          const clickX = e.clientX - rect.left;
          if (clickX < rect.width / 3) {
            handlePrevStatus();
          } else if (clickX > (rect.width * 2) / 3) {
            handleNextStatus();
          }
        }}
        onTouchStart={() => setIsPaused(true)}
        onTouchEnd={() => setIsPaused(false)}
        onMouseDown={() => setIsPaused(true)}
        onMouseUp={() => setIsPaused(false)}
      >
        {/* Progress bars */}
        <div className="absolute top-0 left-0 right-0 z-20 flex gap-1 p-2">
          {(viewingMyStatus ? myStatuses : viewingStatus.userStatuses.statuses).map((_, idx) => (
            <div key={idx} className="flex-1 h-0.5 bg-white/30 rounded-full overflow-hidden">
              <div
                className="h-full bg-white transition-all duration-100"
                style={{
                  width: idx < viewingStatus.currentIndex
                    ? '100%'
                    : idx === viewingStatus.currentIndex
                    ? `${progress}%`
                    : '0%'
                }}
              />
            </div>
          ))}
        </div>

        {/* Header */}
        <div className="absolute top-6 left-0 right-0 z-20 flex items-center justify-between px-4 py-2">
          <div className="flex items-center gap-3">
            <button
              onClick={(e) => {
                e.stopPropagation();
                closeStatusViewer();
              }}
              className="p-2 rounded-full bg-black/20 text-white"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-violet-400 to-fuchsia-400 overflow-hidden">
                {viewingStatus.userStatuses.user_profile.avatar_url ? (
                  <img
                    src={viewingStatus.userStatuses.user_profile.avatar_url}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-white font-semibold">
                    {viewingStatus.userStatuses.user_profile.full_name.charAt(0)}
                  </div>
                )}
              </div>
              <div>
                <p className="text-white font-semibold text-sm">
                  {viewingMyStatus ? 'My Status' : viewingStatus.userStatuses.user_profile.full_name}
                </p>
                <p className="text-white/70 text-xs">
                  {formatTimeAgo(currentViewingStatus.created_at)}
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {currentViewingStatus.content_type === 'video' && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setIsMuted(!isMuted);
                  if (videoRef.current) {
                    videoRef.current.muted = !isMuted;
                  }
                }}
                className="p-2 rounded-full bg-black/20 text-white"
              >
                {isMuted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
              </button>
            )}
            {viewingMyStatus && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowMenu(!showMenu);
                }}
                className="p-2 rounded-full bg-black/20 text-white"
              >
                <MoreVertical className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>

        {/* Menu */}
        {showMenu && viewingMyStatus && (
          <div
            className="absolute top-20 right-4 z-30 bg-white rounded-xl shadow-lg overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => handleDeleteStatus(currentViewingStatus.id)}
              className="flex items-center gap-2 px-4 py-3 text-red-500 hover:bg-red-50 w-full"
            >
              <Trash2 className="w-4 h-4" />
              <span className="text-sm">Delete</span>
            </button>
          </div>
        )}

        {/* Status Content */}
        <div className="flex-1 flex items-center justify-center">
          {currentViewingStatus.content_type === 'text' ? (
            <div
              className="w-full h-full flex items-center justify-center p-8"
              style={{ background: currentViewingStatus.background_color }}
            >
              <p className={`text-white text-2xl text-center ${getFontClass(currentViewingStatus.font_style || 'default')}`}>
                {currentViewingStatus.text_content}
              </p>
            </div>
          ) : currentViewingStatus.content_type === 'video' ? (
            <video
              ref={videoRef}
              src={currentViewingStatus.content_url}
              autoPlay
              muted={isMuted}
              playsInline
              className="max-h-full max-w-full object-contain"
              onEnded={handleNextStatus}
            />
          ) : (
            <img
              src={currentViewingStatus.content_url}
              alt=""
              className="max-h-full max-w-full object-contain"
            />
          )}
        </div>

        {/* Caption */}
        {currentViewingStatus.caption && (
          <div className="absolute bottom-24 left-0 right-0 px-4">
            <p className="text-white text-center bg-black/30 backdrop-blur-sm rounded-lg px-4 py-2">
              {currentViewingStatus.caption}
            </p>
          </div>
        )}

        {/* Bottom - View count or Reply */}
        <div className="absolute bottom-0 left-0 right-0 z-20 p-4 bg-gradient-to-t from-black/50">
          {viewingMyStatus ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                loadViewers(currentViewingStatus.id);
              }}
              className="flex items-center gap-2 text-white"
            >
              <Eye className="w-5 h-5" />
              <span className="text-sm">{currentViewingStatus.view_count} views</span>
            </button>
          ) : (
            <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
              <input
                type="text"
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                onFocus={() => setIsReplyFocused(true)}
                onBlur={() => setIsReplyFocused(false)}
                placeholder="Reply..."
                className="flex-1 bg-white/10 text-white placeholder-white/60 px-4 py-3 rounded-full text-sm outline-none"
              />
              {replyText.trim() && (
                <button
                  onClick={handleReply}
                  className="p-3 rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white"
                >
                  <Send className="w-5 h-5" />
                </button>
              )}
            </div>
          )}
        </div>

        {/* Viewers modal */}
        {showViewers && (
          <div
            className="absolute inset-0 z-40 bg-black/80 flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
              <h3 className="text-white font-semibold">
                Viewed by {statusViewers.length}
              </h3>
              <button
                onClick={() => setShowViewers(false)}
                className="p-2 rounded-full bg-white/10 text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {statusViewers.map((view) => (
                <div key={view.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="w-12 h-12 rounded-full bg-gradient-to-br from-violet-400 to-fuchsia-400 overflow-hidden">
                    {view.viewer_profile?.avatar_url ? (
                      <img
                        src={view.viewer_profile.avatar_url}
                        alt=""
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-white font-semibold">
                        {view.viewer_profile?.full_name?.charAt(0) || '?'}
                      </div>
                    )}
                  </div>
                  <div className="flex-1">
                    <p className="text-white font-medium">
                      {view.viewer_profile?.full_name || 'Unknown'}
                    </p>
                    <p className="text-white/60 text-xs">
                      {formatTimeAgo(view.viewed_at)}
                    </p>
                  </div>
                </div>
              ))}
              {statusViewers.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full text-white/60">
                  <Eye className="w-12 h-12 mb-2" />
                  <p>No views yet</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  // Main status list view
  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="backdrop-blur-2xl bg-gradient-to-r from-violet-500/95 via-purple-500/95 to-fuchsia-500/95 text-white px-4 py-3.5 shadow-xl shadow-purple-500/20">
        <h1 className="text-xl font-bold tracking-tight">Status</h1>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {/* My Status */}
        <div className="p-4 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="relative">
              <button
                onClick={myStatuses.length > 0 ? openMyStatusViewer : () => setCreateMode('text')}
                className={`w-16 h-16 rounded-full overflow-hidden ${
                  myStatuses.length > 0
                    ? 'ring-2 ring-violet-500 ring-offset-2'
                    : 'border-2 border-dashed border-slate-300'
                }`}
              >
                {currentUser.avatar_url ? (
                  <img
                    src={currentUser.avatar_url}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full bg-gradient-to-br from-violet-400 to-fuchsia-400 flex items-center justify-center text-white text-xl font-semibold">
                    {currentUser.full_name.charAt(0)}
                  </div>
                )}
              </button>
              <button
                onClick={() => setCreateMode('text')}
                className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 flex items-center justify-center text-white shadow-lg"
              >
                <Plus className="w-4 h-4" strokeWidth={3} />
              </button>
            </div>
            <div className="flex-1">
              <p className="font-semibold text-slate-800">My Status</p>
              <p className="text-xs text-slate-500">
                {myStatuses.length > 0
                  ? `${myStatuses.length} status update${myStatuses.length > 1 ? 's' : ''}`
                  : 'Tap to add status update'}
              </p>
            </div>
          </div>

          {/* Create buttons */}
          <div className="flex gap-2 mt-4">
            <button
              onClick={() => setCreateMode('text')}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-violet-100 text-violet-600 font-medium text-sm"
            >
              <Type className="w-4 h-4" />
              Text
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-violet-100 text-violet-600 font-medium text-sm"
            >
              <ImageIcon className="w-4 h-4" />
              Photo
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-violet-100 text-violet-600 font-medium text-sm"
            >
              <Film className="w-4 h-4" />
              Video
            </button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*"
            onChange={handleFileSelect}
            className="hidden"
          />
        </div>

        {/* Recent Updates */}
        {contactStatuses.length > 0 && (
          <div className="p-4">
            <p className="text-xs font-semibold text-slate-500 mb-3">RECENT UPDATES</p>
            <div className="space-y-3">
              {contactStatuses.map((userStatuses) => (
                <button
                  key={userStatuses.user_id}
                  onClick={() => setViewingStatus({ userStatuses, currentIndex: 0 })}
                  className="w-full flex items-center gap-3 p-2 rounded-xl hover:bg-slate-50 transition-colors"
                >
                  <div className={`w-14 h-14 rounded-full overflow-hidden ${
                    userStatuses.hasUnviewed
                      ? 'ring-2 ring-violet-500 ring-offset-2'
                      : 'ring-2 ring-slate-200 ring-offset-2'
                  }`}>
                    {userStatuses.user_profile.avatar_url ? (
                      <img
                        src={userStatuses.user_profile.avatar_url}
                        alt=""
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full bg-gradient-to-br from-violet-400 to-fuchsia-400 flex items-center justify-center text-white font-semibold">
                        {userStatuses.user_profile.full_name.charAt(0)}
                      </div>
                    )}
                  </div>
                  <div className="flex-1 text-left">
                    <p className="font-semibold text-slate-800">
                      {userStatuses.user_profile.full_name}
                    </p>
                    <p className="text-xs text-slate-500">
                      {formatTimeAgo(userStatuses.lastStatusAt)}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Empty state */}
        {contactStatuses.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center h-64 text-slate-400">
            <div className="w-20 h-20 rounded-full bg-slate-100 flex items-center justify-center mb-4">
              <Camera className="w-10 h-10" />
            </div>
            <p className="font-medium">No status updates</p>
            <p className="text-sm">Status updates from your friends will appear here</p>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center h-32">
            <div className="w-8 h-8 border-2 border-violet-200 border-t-violet-500 rounded-full animate-spin" />
          </div>
        )}
      </div>
    </div>
  );
}

export default Status;
