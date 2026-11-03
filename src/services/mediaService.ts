/**
 * Media Service — Cloudflare R2 (via the Worker API)
 *
 * Replaces the old Supabase Storage implementation. Every file goes through
 * POST /media/upload (multipart) which stores it in R2 and records it in
 * D1's media_attachments table server-side; GET /media/file/:key serves it
 * back publicly, so the returned `url` can be used directly in <img>/<video>
 * tags with no extra auth.
 */

import { apiUpload, apiFetch, API_BASE, ApiError } from '../lib/apiClient';
import {
  compressImage,
  generateVideoThumbnail,
  getVideoDuration,
  getAudioDuration,
  formatFileSize,
  getFileCategory,
  validateFileSize,
  getMaxFileSize,
  isSupportedFileType,
  blobToBase64
} from '../utils/mediaUtils';

export interface MediaUploadResult {
  success: boolean;
  url?: string;
  thumbnailUrl?: string;
  metadata?: MediaMetadata;
  error?: string;
}

export interface MediaMetadata {
  id?: string;
  fileName: string;
  fileSize: number;
  fileSizeFormatted: string;
  mimeType: string;
  mediaType: 'image' | 'video' | 'audio' | 'document';
  width?: number;
  height?: number;
  duration?: number;
  thumbnailUrl?: string;
}

export interface UploadProgress {
  loaded: number;
  total: number;
  percentage: number;
}

interface WorkerUploadResponse {
  id: string;
  url: string;
  key: string;
  media_type: 'image' | 'video' | 'audio' | 'document';
  file_name: string;
  file_size: number;
}

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return fallback;
}

export const mediaService = {
  /**
   * Upload a media file (image/video/audio/document) for use in a chat message.
   */
  async uploadMedia(
    file: File,
    _userId: string,
    onProgress?: (progress: UploadProgress) => void
  ): Promise<MediaUploadResult> {
    if (!isSupportedFileType(file)) {
      return { success: false, error: 'Unsupported file type' };
    }

    const maxSize = getMaxFileSize(file.type);
    if (!validateFileSize(file, maxSize)) {
      return { success: false, error: `File too large. Maximum size is ${maxSize}MB` };
    }

    const mediaType = getFileCategory(file.type);
    if (mediaType === 'unknown') {
      return { success: false, error: 'Unknown file type' };
    }

    try {
      let fileToUpload: File = file;
      let thumbnailUrl: string | undefined;
      let width: number | undefined;
      let height: number | undefined;
      let duration: number | undefined;

      if (mediaType === 'image') {
        try {
          const compressed = await compressImage(file, 1920, 1080, 0.85);
          fileToUpload = new File([compressed.blob], file.name, { type: 'image/jpeg' });

          const img = new Image();
          await new Promise<void>((resolve) => {
            img.onload = () => {
              width = img.width;
              height = img.height;
              resolve();
            };
            img.onerror = () => resolve();
            img.src = compressed.dataUrl;
          });
        } catch (err) {
          console.warn('Image compression failed, using original:', err);
        }
      }

      if (mediaType === 'video') {
        try {
          duration = await getVideoDuration(file);
          const thumbnail = await generateVideoThumbnail(file);
          const thumbnailBlob = await fetch(thumbnail).then((r) => r.blob());
          const thumbFile = new File([thumbnailBlob], `${file.name}_thumb.jpg`, { type: 'image/jpeg' });
          const thumbResult = await apiUpload<WorkerUploadResponse>('/media/upload', thumbFile);
          thumbnailUrl = thumbResult.url;
        } catch (err) {
          console.warn('Video thumbnail generation failed:', err);
        }
      }

      if (mediaType === 'audio') {
        try {
          duration = await getAudioDuration(file);
        } catch (err) {
          console.warn('Audio duration detection failed:', err);
        }
      }

      const uploaded = await apiUpload<WorkerUploadResponse>('/media/upload', fileToUpload);
      onProgress?.({ loaded: file.size, total: file.size, percentage: 100 });

      const metadata: MediaMetadata = {
        id: uploaded.id,
        fileName: uploaded.file_name,
        fileSize: uploaded.file_size,
        fileSizeFormatted: formatFileSize(uploaded.file_size),
        mimeType: file.type,
        mediaType,
        width,
        height,
        duration,
        thumbnailUrl
      };

      return { success: true, url: uploaded.url, thumbnailUrl, metadata };
    } catch (err) {
      return { success: false, error: errorMessage(err, 'Upload failed') };
    }
  },

  /**
   * Upload media and also return a base64 copy, for call sites that still
   * expect inline (data URL) previews rather than a remote URL.
   */
  async uploadAndGetBase64(
    file: File,
    userId: string
  ): Promise<MediaUploadResult & { base64?: string }> {
    const result = await this.uploadMedia(file, userId);
    if (!result.success) return result;

    try {
      let base64: string;
      if (result.metadata?.mediaType === 'image') {
        const compressed = await compressImage(file, 800, 600, 0.7);
        base64 = compressed.dataUrl;
      } else {
        base64 = await blobToBase64(file);
      }
      return { ...result, base64 };
    } catch {
      return { ...result, base64: undefined };
    }
  },

  /**
   * Delete a previously uploaded file. `filePath` is the R2 key returned as
   * `key` from uploadMedia/uploadAvatar.
   */
  async deleteMedia(filePath: string): Promise<{ success: boolean; error?: string }> {
    try {
      await apiFetch(`/media/file/${filePath}`, { method: 'DELETE' });
      return { success: true };
    } catch (err) {
      return { success: false, error: errorMessage(err, 'Delete failed') };
    }
  },

  /**
   * Media is served publicly from R2 via the Worker, so there's no separate
   * "signed URL" concept — this just returns the public URL for the given key.
   */
  async getSignedUrl(filePath: string): Promise<{ success: boolean; url?: string; error?: string }> {
    if (!filePath) return { success: false, error: 'Missing file path' };
    return { success: true, url: `${API_BASE}/media/file/${filePath}` };
  },

  /**
   * No-op for compatibility: the Worker already records an attachment row
   * (in media_attachments) at upload time, so there's nothing left to save.
   */
  async saveMediaRecord(
    _messageId: string,
    _uploaderId: string,
    metadata: MediaMetadata,
    _filePath: string
  ): Promise<{ success: boolean; id?: string; error?: string }> {
    return { success: true, id: metadata.id };
  },

  /**
   * Not wired to a dedicated endpoint yet — messages already carry their own
   * media_url/thumbnail_url fields, so this isn't on the critical path.
   * Kept as a safe stub so existing call sites don't break.
   */
  async getMediaForMessage(_messageId: string): Promise<MediaMetadata[]> {
    return [];
  },

  /**
   * Upload a profile avatar image (compressed to a small square).
   */
  async uploadAvatar(
    file: File,
    _userId: string
  ): Promise<{ success: boolean; url?: string; error?: string }> {
    if (!file.type.startsWith('image/')) {
      return { success: false, error: 'Only images are allowed for avatars' };
    }

    if (!validateFileSize(file, 5)) {
      return { success: false, error: 'Avatar must be less than 5MB' };
    }

    try {
      const compressed = await compressImage(file, 400, 400, 0.9);
      const avatarFile = new File([compressed.blob], 'avatar.jpg', { type: 'image/jpeg' });
      const uploaded = await apiUpload<WorkerUploadResponse>('/media/upload', avatarFile);
      return { success: true, url: uploaded.url };
    } catch (err) {
      return { success: false, error: errorMessage(err, 'Failed to upload avatar') };
    }
  },

  /**
   * Upload a group avatar image (compressed to a small square).
   */
  async uploadGroupAvatar(
    file: File,
    _groupId: string
  ): Promise<{ success: boolean; url?: string; error?: string }> {
    if (!file.type.startsWith('image/')) {
      return { success: false, error: 'Only images are allowed' };
    }

    try {
      const compressed = await compressImage(file, 400, 400, 0.9);
      const avatarFile = new File([compressed.blob], 'group-avatar.jpg', { type: 'image/jpeg' });
      const uploaded = await apiUpload<WorkerUploadResponse>('/media/upload', avatarFile);
      return { success: true, url: uploaded.url };
    } catch (err) {
      return { success: false, error: errorMessage(err, 'Failed to upload avatar') };
    }
  }
};
