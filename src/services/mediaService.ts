/**
 * Media Service - Convex Storage-backed implementation.
 * Same public surface as the original Supabase Storage service. Files are
 * converted to data URLs and uploaded through the Convex uploadFile action.
 */

import { api, convex } from '../lib/convexClient';

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

export interface MediaUploadResult {
  success: boolean;
  url?: string;
  thumbnailUrl?: string;
  metadata?: MediaMetadata;
  error?: string;
}

export interface UploadProgress {
  loaded: number;
  total: number;
  percentage: number;
}

const MAX_FILE_SIZES: Record<string, number> = {
  image: 10,
  video: 50,
  audio: 20,
  document: 25,
};

function getMediaType(mime: string): 'image' | 'video' | 'audio' | 'document' {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'document';
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isSupportedFileType(file: File): boolean {
  const supported = [
    'image/',
    'video/',
    'audio/',
    'application/pdf',
    'text/',
    'application/msword',
    'application/vnd.openxmlformats',
  ];
  return supported.some((p) => file.type.startsWith(p) || file.type.includes(p));
}

function validateFileSize(file: File, maxSizeMB: number): boolean {
  return file.size <= maxSizeMB * 1024 * 1024;
}

function fileToDataUrl(file: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Downscale and recompress an image entirely on the client before upload.
 * A 4MB phone photo becomes a ~30KB square JPEG — dramatically faster
 * uploads (and near-instant avatars) on mobile connections.
 */
export async function compressImage(
  file: File | Blob,
  maxDimension = 320,
  quality = 0.85
): Promise<File> {
  const type = file instanceof File ? file.type : 'image/jpeg';
  if (!type.startsWith('image/') || type === 'image/gif') {
    return file instanceof File ? file : new File([file], 'image.jpg', { type });
  }
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file instanceof File ? file : new File([file], 'image.jpg', { type });
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', quality)
    );
    if (!blob || blob.size >= file.size) {
      return file instanceof File ? file : new File([file], 'image.jpg', { type });
    }
    const baseName = file instanceof File ? file.name.replace(/\.[^.]+$/, '') : 'avatar';
    return new File([blob], `${baseName}.jpg`, { type: 'image/jpeg' });
  } catch {
    return file instanceof File ? file : new File([file], 'image.jpg', { type });
  }
}

async function uploadToConvex(
  file: File | Blob,
  filename: string,
  mimeType: string
): Promise<{ url: string }> {
  const dataUrl = await fileToDataUrl(file);
  const result = await convex.action(api.actions.uploadFile, {
    dataUrl,
    filename,
    mimeType,
  });
  return { url: (result as { url: string }).url };
}

export const mediaService = {
  async uploadMedia(
    file: File,
    _userId: string,
    onProgress?: (progress: UploadProgress) => void
  ): Promise<MediaUploadResult> {
    try {
      if (!isSupportedFileType(file)) {
        return { success: false, error: 'Unsupported file type' };
      }
      const mediaType = getMediaType(file.type);
      const maxSize = MAX_FILE_SIZES[mediaType];
      if (!validateFileSize(file, maxSize)) {
        return {
          success: false,
          error: `File too large. Maximum size is ${maxSize}MB`,
        };
      }

      onProgress?.({ loaded: 0, total: file.size, percentage: 5 });

      const { url } = await uploadToConvex(
        file,
        file.name || `media_${Date.now()}`,
        file.type || 'application/octet-stream'
      );

      onProgress?.({
        loaded: file.size,
        total: file.size,
        percentage: 100,
      });

      const metadata: MediaMetadata = {
        fileName: file.name,
        fileSize: file.size,
        fileSizeFormatted: formatBytes(file.size),
        mimeType: file.type,
        mediaType,
      };

      return { success: true, url, metadata, thumbnailUrl: url };
    } catch (err) {
      return { success: false, error: errMsg(err) };
    }
  },

  async uploadAndGetBase64(
    file: File
  ): Promise<{ success: boolean; base64?: string; error?: string }> {
    try {
      const dataUrl = await fileToDataUrl(file);
      return { success: true, base64: dataUrl.split(',')[1] };
    } catch (err) {
      return { success: false, error: errMsg(err) };
    }
  },

  async deleteMedia(_filePath: string): Promise<{ success: boolean; error?: string }> {
    /* Convex storage cleanup handled server-side */
    return { success: true };
  },

  async getSignedUrl(url: string): Promise<{ success: boolean; url?: string; error?: string }> {
    // Convex storage URLs are already directly accessible.
    return { success: true, url };
  },

  async saveMediaRecord(_record: Record<string, unknown>): Promise<{ success: boolean; error?: string }> {
    /* Metadata rides on the message row in the Convex model */
    return { success: true };
  },

  async getMediaForMessage(_messageId: string): Promise<MediaMetadata[]> {
    /* Attachment metadata comes with messages from chatService */
    return [];
  },

  async uploadAvatar(
    file: File,
    userId: string
  ): Promise<{ success: boolean; url?: string; error?: string }> {
    if (!file.type.startsWith('image/')) {
      return { success: false, error: 'Only images are allowed for avatars' };
    }
    if (!validateFileSize(file, 5)) {
      return { success: false, error: 'Avatar must be less than 5MB' };
    }
    try {
      void userId;
      const { url } = await uploadToConvex(
        file,
        `avatar_${Date.now()}_${file.name || 'image.jpg'}`,
        file.type
      );
      return { success: true, url };
    } catch (err) {
      return { success: false, error: errMsg(err) };
    }
  },

  async uploadGroupAvatar(
    file: File,
    _groupId: string,
    _userId: string
  ): Promise<{ success: boolean; url?: string; error?: string }> {
    return this.uploadAvatar(file, _userId ?? '');
  },
};
