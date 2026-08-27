import { useState, useRef, useCallback, useEffect } from 'react';
import { User, Camera, Check, AtSign, Loader2, AlertCircle } from 'lucide-react';
import { profileService } from '../services/profileService';
import { compressImage } from '../services/mediaService';
import { api, convex } from '../lib/convexClient';
import type { UserProfile } from '../types';

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

function fileToDataUrl(file: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

export function ProfileSetup({ userId, email, onComplete }: ProfileSetupProps) {
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [bio, setBio] = useState('');
  const [avatarUrl, setAvatarUrl] = useState(AVATAR_OPTIONS[0]);
  const [customAvatarPreview, setCustomAvatarPreview] = useState<string | null>(null);
  const [uploadedAvatarUrl, setUploadedAvatarUrl] = useState<string | null>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null);
  const [checkingUsername, setCheckingUsername] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const usernameTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  // Cleanup object URLs on unmount
  useEffect(() => {
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, []);

  const handleUsernameChange = useCallback((value: string) => {
    const sanitized = value.toLowerCase().replace(/[^a-z0-9_]/g, '');
    setUsername(sanitized);
    setUsernameAvailable(null);

    if (usernameTimeoutRef.current) clearTimeout(usernameTimeoutRef.current);

    if (sanitized.length >= 3) {
      setCheckingUsername(true);
      usernameTimeoutRef.current = setTimeout(async () => {
        try {
          const available = await profileService.isUsernameAvailable(sanitized);
          setUsernameAvailable(available);
        } catch {
          // If the check fails, don't block the user — allow submission
          // The server-side mutation will enforce uniqueness anyway
          setUsernameAvailable(null);
        } finally {
          setCheckingUsername(false);
        }
      }, 500);
    } else {
      setCheckingUsername(false);
    }
  }, []);

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
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

    setError('');

    // Step 1: Show instant local preview (zero delay)
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    const previewUrl = URL.createObjectURL(file);
    objectUrlRef.current = previewUrl;
    setCustomAvatarPreview(previewUrl);
    setAvatarUrl(previewUrl);

    // Step 2: Compress + upload in background
    setAvatarUploading(true);
    try {
      const compressed = await compressImage(file, 320, 0.85);
      const dataUrl = await fileToDataUrl(compressed);
      const result = await convex.action(api.actions.uploadFile, {
        dataUrl,
        filename: `avatar_${Date.now()}.jpg`,
        mimeType: 'image/jpeg',
      });
      const serverUrl = (result as { url: string }).url;
      setUploadedAvatarUrl(serverUrl);
      setAvatarUrl(serverUrl);
    } catch (err) {
      // Preview still shows — upload failed but user sees their image
      console.error('Avatar upload failed:', err);
    } finally {
      setAvatarUploading(false);
    }
  }, []);

  // Form is valid when name and username meet minimum requirements
  // Username uniqueness is enforced server-side, so we don't block on the client check
  const isFormValid =
    fullName.trim().length > 0 &&
    username.length >= 3 &&
    !submitting;

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
      setError('This username is already taken. Please choose another.');
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      // Use server URL if upload succeeded, otherwise use the default avatar
      const finalAvatarUrl = uploadedAvatarUrl || (customAvatarPreview ? AVATAR_OPTIONS[0] : avatarUrl);

      const result = await profileService.createProfile({
        id: userId,
        email,
        full_name: fullName.trim(),
        username: username.toLowerCase(),
        avatar_url: finalAvatarUrl,
        bio: bio.trim() || 'Hey there! I am using NChat.',
      });

      if (result.success && result.profile) {
        onComplete(result.profile);
      } else {
        setError(result.error || 'Failed to create profile. Please try again.');
      }
    } catch (err: unknown) {
      console.error('Profile creation error:', err);
      setError(err instanceof Error ? err.message : 'An error occurred. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const currentAvatar = customAvatarPreview || avatarUrl;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-violet-50 via-purple-50 to-fuchsia-50 relative overflow-hidden px-4 py-6">
      {/* Animated Background Blobs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 -left-4 w-72 h-72 bg-purple-300 rounded-full mix-blend-multiply blur-xl opacity-60 animate-blob" />
        <div className="absolute top-0 -right-4 w-72 h-72 bg-fuchsia-300 rounded-full mix-blend-multiply blur-xl opacity-60 animate-blob animation-delay-2000" />
        <div className="absolute -bottom-8 left-20 w-72 h-72 bg-violet-300 rounded-full mix-blend-multiply blur-xl opacity-60 animate-blob animation-delay-4000" />
      </div>

      {/* Profile Setup Card */}
      <div className="relative z-10 w-full max-w-md animate-slide-up">
        <div className="backdrop-blur-2xl bg-white/70 rounded-3xl border border-white/70 shadow-2xl shadow-purple-500/10 p-6 sm:p-8 max-h-[90vh] overflow-y-auto">
          {/* Header */}
          <div className="text-center mb-6 sm:mb-8">
            <h1 className="text-xl sm:text-2xl font-bold text-slate-800 tracking-tight mb-2">
              Complete Your Profile
            </h1>
            <p className="text-sm text-slate-600">
              Let's set up your profile to get started with NChat
            </p>
          </div>

          {/* Avatar Section */}
          <div className="flex flex-col items-center mb-6 sm:mb-8">
            <div className="relative mb-4">
              {/* Avatar circle — bounded to 96px always */}
              <div className="w-24 h-24 rounded-2xl bg-gradient-to-br from-violet-400 via-purple-400 to-fuchsia-400 p-1 shadow-lg shadow-purple-500/30 overflow-hidden">
                {currentAvatar ? (
                  <img
                    src={currentAvatar}
                    alt="Avatar"
                    className="w-full h-full rounded-xl object-cover bg-white"
                    onError={(e) => {
                      // Fallback to a solid color avatar on image load error
                      const target = e.target as HTMLImageElement;
                      target.style.display = 'none';
                    }}
                  />
                ) : (
                  <div className="w-full h-full rounded-xl bg-white flex items-center justify-center">
                    <User className="w-10 h-10 text-slate-400" />
                  </div>
                )}
              </div>
              {/* Camera button */}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={avatarUploading}
                className="absolute -bottom-2 -right-2 w-10 h-10 bg-gradient-to-r from-violet-500 to-fuchsia-500 rounded-xl flex items-center justify-center text-white shadow-lg shadow-violet-500/40 hover:scale-110 active:scale-95 transition-all duration-300 disabled:opacity-60"
              >
                {avatarUploading ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <Camera className="w-5 h-5" strokeWidth={2} />
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

            {/* Avatar Options */}
            <div className="flex gap-2 flex-wrap justify-center max-w-[280px]">
              {AVATAR_OPTIONS.map((avatar, index) => (
                <button
                  key={index}
                  type="button"
                  onClick={() => {
                    setAvatarUrl(avatar);
                    setCustomAvatarPreview(null);
                    setUploadedAvatarUrl(null);
                  }}
                  className={`w-10 h-10 rounded-lg overflow-hidden border-2 transition-all duration-300 hover:scale-110 flex-shrink-0 ${
                    avatarUrl === avatar && !customAvatarPreview
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
            <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-red-600 text-sm animate-slide-up flex items-start gap-2">
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Full Name (required) */}
            <div className="relative group">
              <User className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 transition-colors duration-300 group-focus-within:text-violet-500" strokeWidth={2} />
              <input
                type="text"
                placeholder="Full Name *"
                value={fullName}
                onChange={(e) => { setFullName(e.target.value); setError(''); }}
                required
                className="w-full pl-12 pr-4 py-3.5 text-sm rounded-xl bg-white/80 border border-slate-200 focus:border-violet-400 focus:ring-2 focus:ring-violet-400/20 text-slate-800 placeholder-slate-400 transition-all duration-300 outline-none"
              />
            </div>

            {/* Username (required) */}
            <div className="relative group">
              <AtSign className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 transition-colors duration-300 group-focus-within:text-violet-500" strokeWidth={2} />
              <input
                type="text"
                placeholder="Username *"
                value={username}
                onChange={(e) => { handleUsernameChange(e.target.value); setError(''); }}
                required
                minLength={3}
                maxLength={20}
                className="w-full pl-12 pr-12 py-3.5 text-sm rounded-xl bg-white/80 border border-slate-200 focus:border-violet-400 focus:ring-2 focus:ring-violet-400/20 text-slate-800 placeholder-slate-400 transition-all duration-300 outline-none"
              />
              <div className="absolute right-4 top-1/2 -translate-y-1/2">
                {checkingUsername && (
                  <Loader2 className="w-4 h-4 text-slate-400 animate-spin" />
                )}
                {!checkingUsername && usernameAvailable === true && (
                  <Check className="w-5 h-5 text-green-500" />
                )}
                {!checkingUsername && usernameAvailable === false && (
                  <span className="text-xs text-red-500 font-medium">Taken</span>
                )}
              </div>
            </div>

            {/* Bio (optional) */}
            <div>
              <textarea
                placeholder="Bio (optional)"
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                maxLength={150}
                rows={2}
                className="w-full px-4 py-3 text-sm rounded-xl bg-white/80 border border-slate-200 focus:border-violet-400 focus:ring-2 focus:ring-violet-400/20 text-slate-800 placeholder-slate-400 transition-all duration-300 outline-none resize-none"
              />
              <p className="text-xs text-slate-500 mt-1 text-right">{bio.length}/150</p>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={!isFormValid}
              className="w-full py-3.5 px-6 bg-gradient-to-r from-violet-500 via-purple-500 to-fuchsia-500 text-white font-semibold rounded-xl shadow-lg shadow-violet-500/40 hover:shadow-xl hover:shadow-violet-500/50 hover:scale-[1.02] active:scale-[0.98] transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 flex items-center justify-center gap-2"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span>Setting up…</span>
                </>
              ) : avatarUploading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span>Uploading photo…</span>
                </>
              ) : (
                <>
                  <span>Get Started</span>
                  <Check className="w-5 h-5" strokeWidth={2} />
                </>
              )}
            </button>

            {/* Hint text when button is disabled */}
            {!isFormValid && !submitting && (
              <p className="text-center text-xs text-slate-500 mt-1">
                {fullName.trim().length === 0
                  ? 'Enter your full name to continue'
                  : username.length < 3
                  ? 'Choose a username (at least 3 characters)'
                  : ''}
              </p>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}
