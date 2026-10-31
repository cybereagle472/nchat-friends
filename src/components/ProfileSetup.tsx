import { useState, useRef } from 'react';
import { Camera, Check, AtSign, User2, Sparkles, Loader2 } from 'lucide-react';
import { profileService } from '../services/profileService';
import { mediaService } from '../services/mediaService';
import { UserProfile } from '../types';

interface ProfileSetupProps {
  userId: string;
  email: string;
  onComplete: (profile: UserProfile) => void;
}

const AVATAR_OPTIONS = [
  'https://api.dicebear.com/7.x/avataaars/svg?seed=Felix&backgroundColor=b6e3f4',
  'https://api.dicebear.com/7.x/avataaars/svg?seed=Aneka&backgroundColor=ffd5dc',
  'https://api.dicebear.com/7.x/avataaars/svg?seed=Milo&backgroundColor=c0aede',
  'https://api.dicebear.com/7.x/avataaars/svg?seed=Nova&backgroundColor=ffdfbf',
  'https://api.dicebear.com/7.x/avataaars/svg?seed=Zoe&backgroundColor=d1f7c4',
  'https://api.dicebear.com/7.x/avataaars/svg?seed=Kai&backgroundColor=c4e9f7',
];

/** Deterministic gradient + initials fallback so the screen never shows a broken image. */
const GRADIENTS = [
  'from-violet-500 to-fuchsia-500',
  'from-sky-500 to-indigo-500',
  'from-emerald-500 to-teal-500',
  'from-amber-500 to-orange-500',
  'from-rose-500 to-pink-500',
  'from-indigo-500 to-purple-500',
];

function initialsOf(name: string, fallback: string) {
  const source = name.trim() || fallback;
  return source.slice(0, 2).toUpperCase();
}

export function ProfileSetup({ userId, email, onComplete }: ProfileSetupProps) {
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [bio, setBio] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [customAvatar, setCustomAvatar] = useState<string | null>(null);
  const [avatarBroken, setAvatarBroken] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null);
  const [checkingUsername, setCheckingUsername] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const usernameTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const gradient = GRADIENTS[email.charCodeAt(0) % GRADIENTS.length];
  const previewSrc = customAvatar || avatarUrl;

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

    setUploadingAvatar(true);
    setError('');

    try {
      const result = await mediaService.uploadAvatar(file, userId);
      if (result.success && result.url) {
        setCustomAvatar(result.url);
        setAvatarBroken(false);
      } else {
        setError(result.error || 'Failed to upload avatar');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to upload avatar');
    } finally {
      setUploadingAvatar(false);
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
        avatar_url: customAvatar || avatarUrl || '',
        bio: bio.trim() || 'Hey there! I am using NChat.',
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
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-violet-50 via-purple-50 to-fuchsia-50 relative overflow-hidden px-4 py-10">
      {/* Animated background blobs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 -left-10 w-72 h-72 bg-purple-300 rounded-full mix-blend-multiply filter blur-3xl opacity-50 animate-blob" />
        <div className="absolute top-0 -right-10 w-72 h-72 bg-fuchsia-300 rounded-full mix-blend-multiply filter blur-3xl opacity-50 animate-blob animation-delay-2000" />
        <div className="absolute -bottom-10 left-1/4 w-72 h-72 bg-sky-300 rounded-full mix-blend-multiply filter blur-3xl opacity-40 animate-blob animation-delay-4000" />
      </div>

      <div className="relative z-10 w-full max-w-md animate-slide-up">
        <div className="backdrop-blur-2xl bg-white/80 rounded-[2rem] border border-white/70 shadow-2xl shadow-purple-500/10 p-7 sm:p-9">
          {/* Header */}
          <div className="flex items-center justify-center gap-1.5 mb-1.5">
            <Sparkles className="w-4 h-4 text-violet-500" />
            <span className="text-xs font-semibold tracking-wide text-violet-600 uppercase">
              One last step
            </span>
          </div>
          <h1 className="text-center text-[1.65rem] font-bold text-slate-900 tracking-tight mb-1.5">
            Create your profile
          </h1>
          <p className="text-center text-sm text-slate-500 mb-8">
            This is how friends will see you on NChat
          </p>

          {/* Avatar */}
          <div className="flex flex-col items-center mb-7">
            <div className="relative">
              <div
                className={`w-28 h-28 rounded-full p-[3px] bg-gradient-to-br ${gradient} shadow-lg shadow-purple-500/25`}
              >
                <div className="w-full h-full rounded-full bg-white p-1">
                  {previewSrc && !avatarBroken ? (
                    <img
                      src={previewSrc}
                      alt="Your avatar"
                      onError={() => setAvatarBroken(true)}
                      className="w-full h-full rounded-full object-cover"
                    />
                  ) : (
                    <div
                      className={`w-full h-full rounded-full bg-gradient-to-br ${gradient} flex items-center justify-center text-white text-2xl font-bold tracking-wide`}
                    >
                      {initialsOf(fullName, email)}
                    </div>
                  )}
                </div>
              </div>

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingAvatar}
                aria-label="Upload a photo"
                className="absolute bottom-0 right-0 w-9 h-9 bg-gradient-to-br from-violet-500 to-fuchsia-500 rounded-full flex items-center justify-center text-white shadow-md shadow-violet-500/40 ring-4 ring-white hover:scale-110 active:scale-95 transition-transform duration-200 disabled:opacity-60"
              >
                {uploadingAvatar ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Camera className="w-4 h-4" strokeWidth={2.25} />
                )}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileSelect}
                className="hidden"
              />
            </div>

            <p className="text-xs text-slate-400 mt-3 mb-3">or pick a style</p>

            {/* Avatar presets */}
            <div className="flex gap-2.5">
              {AVATAR_OPTIONS.map((avatar, index) => {
                const selected = avatarUrl === avatar && !customAvatar;
                return (
                  <button
                    key={avatar}
                    type="button"
                    onClick={() => {
                      setAvatarUrl(avatar);
                      setCustomAvatar(null);
                      setAvatarBroken(false);
                    }}
                    aria-label={`Choose avatar style ${index + 1}`}
                    className={`relative w-11 h-11 rounded-full overflow-hidden transition-all duration-200 hover:scale-110 ${
                      selected
                        ? 'ring-2 ring-violet-500 ring-offset-2 ring-offset-white scale-105'
                        : 'ring-1 ring-slate-200 opacity-80 hover:opacity-100'
                    }`}
                  >
                    <img src={avatar} alt="" className="w-full h-full bg-slate-50" loading="lazy" />
                  </button>
                );
              })}
            </div>
          </div>

          {/* Error message */}
          {error && (
            <div className="mb-5 px-4 py-3 rounded-xl bg-red-50 border border-red-100 text-red-600 text-sm animate-slide-down">
              {error}
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1.5 ml-1">
                Full name
              </label>
              <div className="relative">
                <User2 className="absolute left-4 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-slate-400" strokeWidth={2} />
                <input
                  type="text"
                  placeholder="Jane Doe"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                  className="w-full pl-11 pr-4 py-3.5 text-sm rounded-2xl bg-white border border-slate-200 focus:border-violet-400 focus:ring-4 focus:ring-violet-400/15 text-slate-800 placeholder-slate-400 transition-all duration-200 outline-none"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1.5 ml-1">
                Username
              </label>
              <div className="relative">
                <AtSign className="absolute left-4 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-slate-400" strokeWidth={2} />
                <input
                  type="text"
                  placeholder="janedoe"
                  value={username}
                  onChange={(e) => handleUsernameChange(e.target.value)}
                  required
                  minLength={3}
                  maxLength={20}
                  className="w-full pl-11 pr-10 py-3.5 text-sm rounded-2xl bg-white border border-slate-200 focus:border-violet-400 focus:ring-4 focus:ring-violet-400/15 text-slate-800 placeholder-slate-400 transition-all duration-200 outline-none"
                />
                <div className="absolute right-4 top-1/2 -translate-y-1/2">
                  {checkingUsername && (
                    <Loader2 className="w-4 h-4 text-slate-300 animate-spin" />
                  )}
                  {!checkingUsername && username.length >= 3 && usernameAvailable === true && (
                    <Check className="w-[18px] h-[18px] text-emerald-500" strokeWidth={2.5} />
                  )}
                  {!checkingUsername && usernameAvailable === false && (
                    <span className="text-[11px] font-semibold text-red-500 bg-red-50 px-2 py-0.5 rounded-full">
                      Taken
                    </span>
                  )}
                </div>
              </div>
              {username.length > 0 && username.length < 3 && (
                <p className="text-[11px] text-slate-400 mt-1 ml-1">At least 3 characters</p>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5 ml-1 mr-1">
                <label className="block text-xs font-medium text-slate-500">
                  Bio <span className="text-slate-300">(optional)</span>
                </label>
                <span className="text-[11px] text-slate-400">{bio.length}/150</span>
              </div>
              <textarea
                placeholder="Hey there! I am using NChat."
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                maxLength={150}
                rows={2}
                className="w-full px-4 py-3 text-sm rounded-2xl bg-white border border-slate-200 focus:border-violet-400 focus:ring-4 focus:ring-violet-400/15 text-slate-800 placeholder-slate-400 transition-all duration-200 outline-none resize-none"
              />
            </div>

            <button
              type="submit"
              disabled={loading || usernameAvailable === false}
              className="w-full py-3.5 px-6 mt-2 bg-gradient-to-r from-violet-600 via-purple-600 to-fuchsia-600 text-white text-sm font-semibold rounded-2xl shadow-lg shadow-violet-500/30 hover:shadow-xl hover:shadow-violet-500/40 hover:scale-[1.015] active:scale-[0.985] transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:scale-100 flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <Loader2 className="w-[18px] h-[18px] animate-spin" />
                  <span>Setting up your account...</span>
                </>
              ) : (
                <>
                  <span>Start chatting</span>
                  <Check className="w-[18px] h-[18px]" strokeWidth={2.5} />
                </>
              )}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-slate-400 mt-5">
          Signed in as <span className="text-slate-500 font-medium">{email}</span>
        </p>
      </div>
    </div>
  );
}
