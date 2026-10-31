import { useState, useRef } from 'react';
import { User, Camera, Check, AtSign } from 'lucide-react';
import { profileService } from '../services/profileService';
import { mediaService } from '../services/mediaService';
import { UserProfile } from '../types';

interface ProfileSetupProps {
  userId: string;
  email: string;
  onComplete: (profile: UserProfile) => void;
}

const AVATAR_OPTIONS = [
  'https://api.dicebear.com/7.x/avataaars/svg?seed=1',
  'https://api.dicebear.com/7.x/avataaars/svg?seed=2',
  'https://api.dicebear.com/7.x/avataaars/svg?seed=3',
  'https://api.dicebear.com/7.x/avataaars/svg?seed=4',
  'https://api.dicebear.com/7.x/avataaars/svg?seed=5',
  'https://api.dicebear.com/7.x/avataaars/svg?seed=6',
];

export function ProfileSetup({ userId, email, onComplete }: ProfileSetupProps) {
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [bio, setBio] = useState('');
  const [avatarUrl, setAvatarUrl] = useState(AVATAR_OPTIONS[0]);
  const [customAvatar, setCustomAvatar] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null);
  const [checkingUsername, setCheckingUsername] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const usernameTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleUsernameChange = (value: string) => {
    const sanitized = value.toLowerCase().replace(/[^a-z0-9_]/g, '');
    setUsername(sanitized);
    setUsernameAvailable(null);

    if (usernameTimeoutRef.current) {
      clearTimeout(usernameTimeoutRef.current);
    }

    if (sanitized.length >= 3) {
      setCheckingUsername(true);
      usernameTimeoutRef.current = setTimeout(async () => {
        const available = await profileService.isUsernameAvailable(sanitized);
        setUsernameAvailable(available);
        setCheckingUsername(false);
      }, 500);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setError('Please select an image file');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setError('Image must be less than 5MB');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const result = await mediaService.uploadAvatar(file, userId);
      if (result.success && result.url) {
        setCustomAvatar(result.url);
        setAvatarUrl(result.url);
      } else {
        setError(result.error || 'Failed to upload avatar');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to upload avatar');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!fullName.trim()) {
      setError('Please enter your full name');
      return;
    }

    if (username.length < 3) {
      setError('Username must be at least 3 characters');
      return;
    }

    if (usernameAvailable === false) {
      setError('Username is already taken');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const result = await profileService.createProfile({
        id: userId,
        email,
        full_name: fullName.trim(),
        username: username.toLowerCase(),
        avatar_url: customAvatar || avatarUrl,
        bio: bio.trim() || 'Hey there! I am using NChat.'
      });

      if (result.success && result.profile) {
        onComplete(result.profile);
      } else {
        setError(result.error || 'Failed to create profile');
      }
    } catch (err: any) {
      setError(err.message || 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-violet-50 via-purple-50 to-fuchsia-50 relative overflow-hidden px-4 py-8">
      {/* Animated Background Blobs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 -left-4 w-72 h-72 bg-purple-300 rounded-full mix-blend-multiply filter blur-xl opacity-60 animate-blob"></div>
        <div className="absolute top-0 -right-4 w-72 h-72 bg-fuchsia-300 rounded-full mix-blend-multiply filter blur-xl opacity-60 animate-blob animation-delay-2000"></div>
        <div className="absolute -bottom-8 left-20 w-72 h-72 bg-violet-300 rounded-full mix-blend-multiply filter blur-xl opacity-60 animate-blob animation-delay-4000"></div>
      </div>

      {/* Profile Setup Card */}
      <div className="relative z-10 w-full max-w-md animate-slide-up">
        <div className="backdrop-blur-2xl bg-white/70 rounded-3xl border border-white/70 shadow-2xl shadow-purple-500/10 p-8">
          {/* Header */}
          <div className="text-center mb-8">
            <h1 className="text-2xl font-bold text-slate-800 tracking-tight mb-2">
              Complete Your Profile
            </h1>
            <p className="text-sm text-slate-600">
              Let's set up your profile to get started
            </p>
          </div>

          {/* Avatar Section */}
          <div className="flex flex-col items-center mb-8">
            <div className="relative mb-4">
              <div className="w-24 h-24 rounded-2xl bg-gradient-to-br from-violet-400 via-purple-400 to-fuchsia-400 p-1 shadow-lg shadow-purple-500/30">
                {customAvatar || avatarUrl ? (
                  <img
                    src={customAvatar || avatarUrl}
                    alt="Avatar"
                    className="w-full h-full rounded-xl object-cover bg-white"
                  />
                ) : (
                  <div className="w-full h-full rounded-xl bg-white flex items-center justify-center">
                    <User className="w-10 h-10 text-slate-400" />
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="absolute -bottom-2 -right-2 w-10 h-10 bg-gradient-to-r from-violet-500 to-fuchsia-500 rounded-xl flex items-center justify-center text-white shadow-lg shadow-violet-500/40 hover:scale-110 active:scale-95 transition-all duration-300"
              >
                <Camera className="w-5 h-5" strokeWidth={2} />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileSelect}
                className="hidden"
              />
            </div>

            {/* Avatar Options */}
            <div className="flex gap-2 flex-wrap justify-center">
              {AVATAR_OPTIONS.map((avatar, index) => (
                <button
                  key={index}
                  type="button"
                  onClick={() => {
                    setAvatarUrl(avatar);
                    setCustomAvatar(null);
                  }}
                  className={`w-10 h-10 rounded-lg overflow-hidden border-2 transition-all duration-300 hover:scale-110 ${
                    avatarUrl === avatar && !customAvatar
                      ? 'border-violet-500 shadow-md shadow-violet-500/30'
                      : 'border-transparent'
                  }`}
                >
                  <img src={avatar} alt={`Avatar ${index + 1}`} className="w-full h-full" />
                </button>
              ))}
            </div>
          </div>

          {/* Error Message */}
          {error && (
            <div className="mb-6 p-4 rounded-xl bg-red-50 border border-red-200 text-red-600 text-sm animate-slide-up">
              {error}
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Full Name */}
            <div className="relative group">
              <User className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 transition-colors duration-300 group-focus-within:text-violet-500" strokeWidth={2} />
              <input
                type="text"
                placeholder="Full Name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
                className="w-full pl-12 pr-4 py-4 text-sm rounded-xl bg-white/80 border border-slate-200 focus:border-violet-400 focus:ring-2 focus:ring-violet-400/20 text-slate-800 placeholder-slate-400 transition-all duration-300 outline-none"
              />
            </div>

            {/* Username */}
            <div className="relative group">
              <AtSign className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 transition-colors duration-300 group-focus-within:text-violet-500" strokeWidth={2} />
              <input
                type="text"
                placeholder="Username (min 3 characters)"
                value={username}
                onChange={(e) => handleUsernameChange(e.target.value)}
                required
                minLength={3}
                maxLength={20}
                className="w-full pl-12 pr-12 py-4 text-sm rounded-xl bg-white/80 border border-slate-200 focus:border-violet-400 focus:ring-2 focus:ring-violet-400/20 text-slate-800 placeholder-slate-400 transition-all duration-300 outline-none"
              />
              <div className="absolute right-4 top-1/2 -translate-y-1/2">
                {checkingUsername && (
                  <span className="text-xs text-slate-400 font-medium">...</span>
                )}
                {!checkingUsername && usernameAvailable === true && (
                  <Check className="w-5 h-5 text-green-500" />
                )}
                {!checkingUsername && usernameAvailable === false && (
                  <span className="text-xs text-red-500 font-medium">Taken</span>
                )}
              </div>
            </div>

            {/* Bio */}
            <div>
              <textarea
                placeholder="Bio (optional)"
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                maxLength={150}
                rows={3}
                className="w-full px-4 py-3 text-sm rounded-xl bg-white/80 border border-slate-200 focus:border-violet-400 focus:ring-2 focus:ring-violet-400/20 text-slate-800 placeholder-slate-400 transition-all duration-300 outline-none resize-none"
              />
              <p className="text-xs text-slate-500 mt-1 text-right">{bio.length}/150</p>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={loading || usernameAvailable === false}
              className="w-full py-4 px-6 bg-gradient-to-r from-violet-500 via-purple-500 to-fuchsia-500 text-white font-semibold rounded-xl shadow-lg shadow-violet-500/40 hover:shadow-xl hover:shadow-violet-500/50 hover:scale-[1.02] active:scale-[0.98] transition-all duration-300 disabled:opacity-70 disabled:cursor-not-allowed disabled:hover:scale-100 flex items-center justify-center gap-2"
            >
                <span>{loading ? 'Setting up...' : 'Get Started'}</span>
              <Check className={`w-5 h-5 ${loading ? 'opacity-50' : ''}`} strokeWidth={2} />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
