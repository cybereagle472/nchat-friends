import { useState, useRef, useCallback, useEffect } from 'react';
import { User, Camera, Check, AtSign, Loader2, AlertCircle } from 'lucide-react';
import { profileService } from '../services/profileService';
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

/** Client-side image resize — no createImageBitmap dependency */
function resizeImage(file: File, maxDim = 320, quality = 0.85): Promise<File> {
  return new Promise((resolve) => {
    if (!file.type.startsWith('image/') || file.type === 'image/gif') {
      resolve(file);
      return;
    }
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) { resolve(file); return; }
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob(
        (blob) => {
          if (!blob || blob.size >= file.size) { resolve(file); return; }
          resolve(new File([blob], 'avatar.jpg', { type: 'image/jpeg' }));
        },
        'image/jpeg',
        quality
      );
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
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
  const [avatarError, setAvatarError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null);
  const [checkingUsername, setCheckingUsername] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const usernameTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    return () => { if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current); };
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
    if (!file.type.startsWith('image/')) { setError('Please select an image file'); return; }
    if (file.size > 5 * 1024 * 1024) { setError('Image must be less than 5MB'); return; }

    setError('');
    setAvatarError('');

    // Instant local preview
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    const previewUrl = URL.createObjectURL(file);
    objectUrlRef.current = previewUrl;
    setCustomAvatarPreview(previewUrl);

    // Compress + upload in background
    setAvatarUploading(true);
    try {
      // Resize the image client-side
      const resized = await resizeImage(file, 320, 0.85);
      const dataUrl = await fileToDataUrl(resized);

      // Guard: data URL must be under ~2 MB base64 for Convex action args
      if (dataUrl.length > 2_500_000) {
        setAvatarError('Image is too large after processing. Please pick a smaller photo or use an avatar below.');
        setAvatarUploading(false);
        return;
      }

      const result = await convex.action(api.actions.uploadFile, {
        dataUrl,
        filename: `avatar_${Date.now()}.jpg`,
        mimeType: 'image/jpeg',
      });

      const serverUrl = (result as { url?: string; error?: string }).url;
      if (!serverUrl) {
        throw new Error((result as { url?: string; error?: string }).error || 'No URL returned');
      }

      setUploadedAvatarUrl(serverUrl);
      setAvatarUrl(serverUrl);
      if (objectUrlRef.current) { URL.revokeObjectURL(objectUrlRef.current); objectUrlRef.current = null; }
      setCustomAvatarPreview(null);
    } catch (err) {
      console.error('Avatar upload failed:', err);
      const msg = err instanceof Error ? err.message : String(err);
      setAvatarError(`Photo upload failed: ${msg}. You can pick an avatar below instead.`);
    } finally {
      setAvatarUploading(false);
    }
  }, []);

  const getFinalAvatarUrl = (): string => {
    if (uploadedAvatarUrl) return uploadedAvatarUrl;
    if (customAvatarPreview) return customAvatarPreview;
    return avatarUrl;
  };

  const isFormValid = fullName.trim().length > 0 && username.length >= 3 && !submitting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim()) { setError('Please enter your full name'); return; }
    if (username.length < 3) { setError('Username must be at least 3 characters'); return; }
    if (usernameAvailable === false) { setError('This username is already taken. Please choose another.'); return; }
    if (avatarUploading) { setError('Please wait for your photo to finish uploading.'); return; }

    setSubmitting(true);
    setError('');
    try {
      const finalAvatarUrl = getFinalAvatarUrl();
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
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 -left-4 w-72 h-72 bg-purple-300 rounded-full mix-blend-multiply blur-xl opacity-60 animate-blob" />
        <div className="absolute top-0 -right-4 w-72 h-72 bg-fuchsia-300 rounded-full mix-blend-multiply blur-xl opacity-60 animate-blob animation-delay-2000" />
        <div className="absolute -bottom-8 left-20 w-72 h-72 bg-violet-300 rounded-full mix-blend-multiply blur-xl opacity-60 animate-blob animation-delay-4000" />
      </div>

      <div className="relative z-10 w-full max-w-sm animate-slide-up">
        <div className="backdrop-blur-2xl bg-white/70 rounded-3xl border border-white/70 shadow-2xl shadow-purple-500/10 p-5 sm:p-6 max-h-[90vh] overflow-y-auto">
          <div className="text-center mb-5 sm:mb-6">
            <h1 className="text-lg sm:text-xl font-bold text-slate-800 tracking-tight mb-1">
              Complete Your Profile
            </h1>
            <p className="text-xs text-slate-600">
              Set up your profile to get started with NChat
            </p>
          </div>

          {/* Avatar */}
          <div className="flex flex-col items-center mb-5 sm:mb-6">
            <div className="relative mb-3">
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-violet-400 via-purple-400 to-fuchsia-400 p-1 shadow-lg shadow-purple-500/30 overflow-hidden">
                {currentAvatar ? (
                  <img src={currentAvatar} alt="Avatar" className="w-full h-full rounded-xl object-cover bg-white" />
                ) : (
                  <div className="w-full h-full rounded-xl bg-white flex items-center justify-center">
                    <User className="w-8 h-8 text-slate-400" />
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={avatarUploading}
                className="absolute -bottom-1.5 -right-1.5 w-8 h-8 bg-gradient-to-r from-violet-500 to-fuchsia-500 rounded-xl flex items-center justify-center text-white shadow-lg shadow-violet-500/40 hover:scale-110 active:scale-95 transition-all duration-300 disabled:opacity-60"
              >
                {avatarUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" strokeWidth={2} />}
              </button>
              <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileSelect} className="hidden" />
            </div>

            {avatarUploading && (
              <p className="text-[11px] text-violet-600 font-medium mb-1 flex items-center gap-1">
                <Loader2 className="w-3 h-3 animate-spin" /> Uploading…
              </p>
            )}
            {avatarError && !avatarUploading && (
              <p className="text-[11px] text-red-500 font-medium mb-1 flex items-center gap-1 max-w-[220px] text-center">
                <AlertCircle className="w-3 h-3 flex-shrink-0" /> {avatarError}
              </p>
            )}
            {!avatarUploading && !avatarError && uploadedAvatarUrl && (
              <p className="text-[11px] text-green-600 font-medium mb-1 flex items-center gap-1">
                <Check className="w-3 h-3" /> Photo uploaded
              </p>
            )}

            <div className="flex gap-1.5 flex-wrap justify-center max-w-[240px]">
              {AVATAR_OPTIONS.map((avatar, index) => (
                <button
                  key={index}
                  type="button"
                  onClick={() => {
                    setAvatarUrl(avatar);
                    setCustomAvatarPreview(null);
                    setUploadedAvatarUrl(null);
                    setAvatarError('');
                    if (objectUrlRef.current) { URL.revokeObjectURL(objectUrlRef.current); objectUrlRef.current = null; }
                  }}
                  className={`w-9 h-9 rounded-lg overflow-hidden border-2 transition-all duration-300 hover:scale-110 flex-shrink-0 ${
                    avatarUrl === avatar && !customAvatarPreview ? 'border-violet-500 shadow-md shadow-violet-500/30' : 'border-transparent'
                  }`}
                >
                  <img src={avatar} alt={`Avatar ${index + 1}`} className="w-full h-full" />
                </button>
              ))}
            </div>
          </div>

          {error && (
            <div className="mb-3 p-2.5 rounded-xl bg-red-50 border border-red-200 text-red-600 text-xs animate-slide-up flex items-start gap-2">
              <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="relative group">
              <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 transition-colors duration-300 group-focus-within:text-violet-500" strokeWidth={2} />
              <input
                type="text"
                placeholder="Full Name *"
                value={fullName}
                onChange={(e) => { setFullName(e.target.value); setError(''); }}
                required
                className="w-full pl-10 pr-3 py-3 text-sm rounded-xl bg-white/80 border border-slate-200 focus:border-violet-400 focus:ring-2 focus:ring-violet-400/20 text-slate-800 placeholder-slate-400 transition-all duration-300 outline-none"
              />
            </div>

            <div className="relative group">
              <AtSign className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 transition-colors duration-300 group-focus-within:text-violet-500" strokeWidth={2} />
              <input
                type="text"
                placeholder="Username *"
                value={username}
                onChange={(e) => { handleUsernameChange(e.target.value); setError(''); }}
                required
                minLength={3}
                maxLength={20}
                className="w-full pl-10 pr-10 py-3 text-sm rounded-xl bg-white/80 border border-slate-200 focus:border-violet-400 focus:ring-2 focus:ring-violet-400/20 text-slate-800 placeholder-slate-400 transition-all duration-300 outline-none"
              />
              <div className="absolute right-3.5 top-1/2 -translate-y-1/2">
                {checkingUsername && <Loader2 className="w-4 h-4 text-slate-400 animate-spin" />}
                {!checkingUsername && usernameAvailable === true && <Check className="w-4 h-4 text-green-500" />}
                {!checkingUsername && usernameAvailable === false && <span className="text-[10px] text-red-500 font-medium">Taken</span>}
              </div>
            </div>

            <div>
              <textarea
                placeholder="Bio (optional)"
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                maxLength={150}
                rows={2}
                className="w-full px-3.5 py-2.5 text-sm rounded-xl bg-white/80 border border-slate-200 focus:border-violet-400 focus:ring-2 focus:ring-violet-400/20 text-slate-800 placeholder-slate-400 transition-all duration-300 outline-none resize-none"
              />
              <p className="text-[10px] text-slate-500 mt-0.5 text-right">{bio.length}/150</p>
            </div>

            <button
              type="submit"
              disabled={!isFormValid}
              className="w-full py-3 px-5 bg-gradient-to-r from-violet-500 via-purple-500 to-fuchsia-500 text-white font-semibold rounded-xl shadow-lg shadow-violet-500/40 hover:shadow-xl hover:shadow-violet-500/50 hover:scale-[1.02] active:scale-[0.98] transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 flex items-center justify-center gap-2 text-sm"
            >
              {submitting ? (<><Loader2 className="w-4 h-4 animate-spin" /><span>Setting up…</span></>)
                : avatarUploading ? (<><Loader2 className="w-4 h-4 animate-spin" /><span>Uploading…</span></>)
                : (<><span>Get Started</span><Check className="w-4 h-4" strokeWidth={2} /></>)}
            </button>

            {!isFormValid && !submitting && (
              <p className="text-center text-[11px] text-slate-500 mt-0.5">
                {fullName.trim().length === 0 ? 'Enter your full name to continue' : username.length < 3 ? 'Choose a username (at least 3 characters)' : ''}
              </p>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}
