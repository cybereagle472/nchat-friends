import { Phone, Video, PhoneIncoming, PhoneMissed, PhoneOutgoing, MessageCircle, Clock } from 'lucide-react';
import { useState } from 'react';
import { UserProfile } from '../types';

interface HistoryItem {
  id: string;
  name: string;
  avatar?: string;
  userId: string;
  type: 'voice' | 'video';
  direction: 'incoming' | 'outgoing' | 'missed';
  timestamp: string;
  duration?: string;
}

interface HistoryProps {
  currentUser: UserProfile;
  history: HistoryItem[];
  onCall: (userId: string, type: 'voice' | 'video') => void;
  onMessage: (userId: string) => void;
}

export function History({ history, onCall, onMessage }: HistoryProps) {
  const [filter, setFilter] = useState<'all' | 'voice' | 'video' | 'missed'>('all');

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) {
      return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    } else if (days === 1) {
      return 'Yesterday';
    } else if (days < 7) {
      return date.toLocaleDateString('en-US', { weekday: 'short' });
    } else {
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
  };

  const filteredHistory = history.filter((item) => {
    if (filter === 'all') return true;
    if (filter === 'missed') return item.direction === 'missed';
    return item.type === filter;
  });

  const getCallIcon = (item: HistoryItem) => {
    if (item.direction === 'incoming') {
      return <PhoneIncoming className="w-3.5 h-3.5 text-green-600" strokeWidth={2.5} />;
    }
    if (item.direction === 'outgoing') {
      return <PhoneOutgoing className="w-3.5 h-3.5 text-violet-600" strokeWidth={2.5} />;
    }
    return <PhoneMissed className="w-3.5 h-3.5 text-red-500" strokeWidth={2.5} />;
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="backdrop-blur-2xl bg-gradient-to-r from-violet-500/95 via-purple-500/95 to-fuchsia-500/95 text-white px-4 py-3.5 shadow-xl shadow-purple-500/20">
        <h1 className="text-xl font-bold mb-3 tracking-tight flex items-center gap-2">
          <Clock className="w-5 h-5" strokeWidth={2.5} />
          Call History
        </h1>

        {/* Filter Tabs */}
        <div className="flex gap-2 overflow-x-auto pb-1">
          <button
            onClick={() => setFilter('all')}
            className={`px-4 py-2 rounded-xl whitespace-nowrap transition-all duration-300 text-xs font-bold ${
              filter === 'all'
                ? 'bg-white text-violet-600 shadow-lg shadow-white/15 scale-105'
                : 'bg-white/20 backdrop-blur-sm text-white hover:bg-white/30 border border-white/20 active:scale-95'
            }`}
          >
            All
          </button>
          <button
            onClick={() => setFilter('voice')}
            className={`px-4 py-2 rounded-xl whitespace-nowrap transition-all duration-300 text-xs font-bold ${
              filter === 'voice'
                ? 'bg-white text-violet-600 shadow-lg shadow-white/15 scale-105'
                : 'bg-white/20 backdrop-blur-sm text-white hover:bg-white/30 border border-white/20 active:scale-95'
            }`}
          >
            Voice
          </button>
          <button
            onClick={() => setFilter('video')}
            className={`px-4 py-2 rounded-xl whitespace-nowrap transition-all duration-300 text-xs font-bold ${
              filter === 'video'
                ? 'bg-white text-violet-600 shadow-lg shadow-white/15 scale-105'
                : 'bg-white/20 backdrop-blur-sm text-white hover:bg-white/30 border border-white/20 active:scale-95'
            }`}
          >
            Video
          </button>
          <button
            onClick={() => setFilter('missed')}
            className={`px-4 py-2 rounded-xl whitespace-nowrap transition-all duration-300 text-xs font-bold ${
              filter === 'missed'
                ? 'bg-white text-violet-600 shadow-lg shadow-white/15 scale-105'
                : 'bg-white/20 backdrop-blur-sm text-white hover:bg-white/30 border border-white/20 active:scale-95'
            }`}
          >
            Missed
          </button>
        </div>
      </div>

      {/* History List */}
      <div className="flex-1 overflow-y-auto px-2.5 py-3">
        {filteredHistory.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full backdrop-blur-lg bg-white/50 rounded-2xl border border-white/70 p-8">
            <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-violet-400 via-purple-400 to-fuchsia-400 flex items-center justify-center text-3xl mb-4 shadow-lg shadow-purple-500/30">
              📞
            </div>
            <p className="text-sm text-slate-600 font-medium mb-1">No call history</p>
            <p className="text-xs text-slate-500 text-center">Your calls will appear here</p>
          </div>
        ) : (
          filteredHistory.map((item, index) => (
            <div
              key={item.id}
              style={{ animationDelay: `${index * 30}ms` }}
              className="flex items-center gap-3 p-3 mb-2 rounded-2xl backdrop-blur-xl bg-white/70 border border-white/70 hover:bg-white/90 hover:shadow-lg hover:shadow-purple-500/15 transition-all duration-300 hover:scale-[1.02] active:scale-[0.98] animate-slide-up group"
            >
              <div
                className={`w-12 h-12 rounded-xl flex items-center justify-center text-xl flex-shrink-0 shadow-md group-hover:scale-105 transition-transform duration-300 overflow-hidden ${
                  item.direction === 'missed'
                    ? 'bg-gradient-to-br from-red-400 to-rose-400 shadow-red-500/20'
                    : 'bg-gradient-to-br from-violet-400 via-purple-400 to-fuchsia-400 shadow-purple-500/20'
                }`}
              >
                {item.avatar ? (
                  <img src={item.avatar} alt={item.name} className="w-full h-full object-cover" />
                ) : (
                  <span className="text-white font-semibold">{item.name.charAt(0).toUpperCase()}</span>
                )}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <h3
                    className={`text-sm font-semibold truncate ${
                      item.direction === 'missed'
                        ? 'text-red-600'
                        : 'text-slate-800 group-hover:text-violet-600'
                    } transition-colors duration-300`}
                  >
                    {item.name}
                  </h3>
                </div>
                <div className="flex items-center gap-2 text-[11px] text-slate-600 mb-0.5">
                  {getCallIcon(item)}
                  <span className="capitalize font-medium">{item.direction}</span>
                  {item.type === 'video' && (
                    <div className="flex items-center gap-1 bg-violet-100 px-2 py-0.5 rounded-full">
                      <Video className="w-3 h-3 text-violet-600" strokeWidth={2.5} />
                      <span className="text-[9px] text-violet-600 font-bold">Video</span>
                    </div>
                  )}
                  {item.type === 'voice' && (
                    <div className="flex items-center gap-1 bg-blue-100 px-2 py-0.5 rounded-full">
                      <Phone className="w-3 h-3 text-blue-600" strokeWidth={2.5} />
                      <span className="text-[9px] text-blue-600 font-bold">Voice</span>
                    </div>
                  )}
                  {item.duration && (
                    <>
                      <span className="text-slate-400">•</span>
                      <span className="font-medium text-violet-600">{item.duration}</span>
                    </>
                  )}
                </div>
                <p className="text-[10px] text-slate-500 font-medium">
                  {formatTimestamp(item.timestamp)}
                </p>
              </div>

              <div className="flex items-center gap-1 flex-shrink-0">
                <button
                  onClick={() => onCall(item.userId, 'voice')}
                  className="text-violet-600 hover:bg-gradient-to-r hover:from-violet-500 hover:to-purple-500 hover:text-white p-2 rounded-xl transition-all duration-300 hover:scale-110 active:scale-95 hover:shadow-md hover:shadow-violet-500/30"
                  aria-label="Voice call"
                >
                  <Phone className="w-4 h-4" strokeWidth={2.5} />
                </button>
                <button
                  onClick={() => onCall(item.userId, 'video')}
                  className="text-violet-600 hover:bg-gradient-to-r hover:from-violet-500 hover:to-purple-500 hover:text-white p-2 rounded-xl transition-all duration-300 hover:scale-110 active:scale-95 hover:shadow-md hover:shadow-violet-500/30"
                  aria-label="Video call"
                >
                  <Video className="w-4 h-4" strokeWidth={2.5} />
                </button>
                <button
                  onClick={() => onMessage(item.userId)}
                  className="text-violet-600 hover:bg-gradient-to-r hover:from-violet-500 hover:to-purple-500 hover:text-white p-2 rounded-xl transition-all duration-300 hover:scale-110 active:scale-95 hover:shadow-md hover:shadow-violet-500/30"
                  aria-label="Message"
                >
                  <MessageCircle className="w-4 h-4" strokeWidth={2.5} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
