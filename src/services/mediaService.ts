/**
 * Media Service - Supabase Storage Integration
 *
 * Features:
 * - Signed upload URLs for direct uploads
 * - Thumbnail generation for images/videos
 * - File type validation
 * - Progress tracking
 * - Media metadata storage
 */

import { supabase } from '../supabaseClient';
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

const BUCKET_NAME = 'chat-media';

export const mediaService = {
  /**
   * Upload media file to Supabase Storage
   */
  async uploadMedia(
    file: File,
    userId: string,
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
      const timestamp = Date.now();
      const sanitizedName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
      const filePath = `${userId}/${mediaType}/${timestamp}_${sanitizedName}`;

      let fileToUpload: File | Blob = file;
      let thumbnailUrl: string | undefined;
      let width: number | undefined;
      let height: number | undefined;
      let duration: number | undefined;

      if (mediaType === 'image') {
        try {
          const compressed = await compressImage(file, 1920, 1080, 0.85);
          fileToUpload = compressed.blob;

          const img = new Image();
          await new Promise<void>((resolve) => {
            img.onload = () => {
              width = img.width;
              height = img.height;
              resolve();
            };
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

          const thumbnailBlob = await fetch(thumbnail).then(r => r.blob());
          const thumbPath = `${userId}/thumbnails/${timestamp}_thumb.jpg`;

          const { error: thumbError } = await supabase.storage
            .from(BUCKET_NAME)
            .upload(thumbPath, thumbnailBlob, {
              contentType: 'image/jpeg',
              cacheControl: '31536000'
            });

          if (!thumbError) {
            const { data: thumbData } = supabase.storage
              .from(BUCKET_NAME)
              .getPublicUrl(thumbPath);
            thumbnailUrl = thumbData.publicUrl;
          }
        } catch (err) {
          console.warn('Video processing failed:', err);
        }
      }

      if (mediaType === 'audio') {
        try {
          duration = await getAudioDuration(file);
        } catch (err) {
          console.warn('Audio duration detection failed:', err);
        }
      }

      const { error: uploadError } = await supabase.storage
        .from(BUCKET_NAME)
        .upload(filePath, fileToUpload, {
          contentType: file.type,
          cacheControl: '31536000',
          upsert: false
        });

      if (uploadError) {
        return { success: false, error: uploadError.message };
      }

      const { data: urlData } = supabase.storage
        .from(BUCKET_NAME)
        .getPublicUrl(filePath);

      const metadata: MediaMetadata = {
        fileName: file.name,
        fileSize: file.size,
        fileSizeFormatted: formatFileSize(file.size),
        mimeType: file.type,
        mediaType,
        width,
        height,
        duration,
        thumbnailUrl
      };

      onProgress?.({ loaded: file.size, total: file.size, percentage: 100 });

      return {
        success: true,
        url: urlData.publicUrl,
        thumbnailUrl,
        metadata
      };
    } catch (err: any) {
      return { success: false, error: err.message || 'Upload failed' };
    }
  },

  /**
   * Upload media and get base64 for backward compatibility
   * Use this for existing message flow that expects base64
   */
  async uploadAndGetBase64(
    file: File,
    userId: string
  ): Promise<MediaUploadResult & { base64?: string }> {
    const result = await this.uploadMedia(file, userId);

    if (!result.success) {
      return result;
    }

    try {
      let base64: string;

      if (result.metadata?.mediaType === 'image') {
        const compressed = await compressImage(file, 800, 600, 0.7);
        base64 = compressed.dataUrl;
      } else {
        base64 = await blobToBase64(file);
      }

      return { ...result, base64 };
    } catch (err) {
      return { ...result, base64: undefined };
    }
  },

  /**
   * Delete media file from storage
   */
  async deleteMedia(filePath: string): Promise<{ success: boolean; error?: string }> {
    try {
      const { error } = await supabase.storage
        .from(BUCKET_NAME)
        .remove([filePath]);

      if (error) {
        return { success: false, error: error.message };
      }

      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  },

  /**
   * Get signed URL for private files (if needed)
   */
  async getSignedUrl(
    filePath: string,
    expiresIn = 3600
  ): Promise<{ success: boolean; url?: string; error?: string }> {
    try {
      const { data, error } = await supabase.storage
        .from(BUCKET_NAME)
        .createSignedUrl(filePath, expiresIn);

      if (error) {
        return { success: false, error: error.message };
      }

      return { success: true, url: data.signedUrl };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  },

  /**
   * Save media attachment record to database
   */
  async saveMediaRecord(
    messageId: string,
    uploaderId: string,
    metadata: MediaMetadata,
    filePath: string
  ): Promise<{ success: boolean; id?: string; error?: string }> {
    try {
      const { data, error } = await supabase
        .from('media_attachments')
        .insert({
          message_id: messageId,
          uploader_id: uploaderId,
          file_path: filePath,
          file_name: metadata.fileName,
          file_size: metadata.fileSize,
          mime_type: metadata.mimeType,
          media_type: metadata.mediaType,
          thumbnail_path: metadata.thumbnailUrl,
          duration_seconds: metadata.duration,
          width: metadata.width,
          height: metadata.height
        })
        .select('id')
        .single();

      if (error) {
        return { success: false, error: error.message };
      }

      return { success: true, id: data.id };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  },

  /**
   * Get media attachments for a message
   */
  async getMediaForMessage(messageId: string): Promise<MediaMetadata[]> {
    const { data, error } = await supabase
      .from('media_attachments')
      .select('*')
      .eq('message_id', messageId);

    if (error || !data) {
      return [];
    }

    return data.map(item => ({
      id: item.id,
      fileName: item.file_name,
      fileSize: item.file_size,
      fileSizeFormatted: formatFileSize(item.file_size),
      mimeType: item.mime_type,
      mediaType: item.media_type,
      width: item.width,
      height: item.height,
      duration: item.duration_seconds,
      thumbnailUrl: item.thumbnail_path
    }));
  },

  /**
   * Upload avatar image for profile
   */
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
      const compressed = await compressImage(file, 400, 400, 0.9);
      const filePath = `avatars/${userId}_${Date.now()}.jpg`;

      const { error: uploadError } = await supabase.storage
        .from(BUCKET_NAME)
        .upload(filePath, compressed.blob, {
          contentType: 'image/jpeg',
          cacheControl: '31536000',
          upsert: true
        });

      if (uploadError) {
        return { success: false, error: uploadError.message };
      }

      const { data } = supabase.storage
        .from(BUCKET_NAME)
        .getPublicUrl(filePath);

      return { success: true, url: data.publicUrl };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  },

  /**
   * Upload group avatar
   */
  async uploadGroupAvatar(
    file: File,
    groupId: string
  ): Promise<{ success: boolean; url?: string; error?: string }> {
    if (!file.type.startsWith('image/')) {
      return { success: false, error: 'Only images are allowed' };
    }

    try {
      const compressed = await compressImage(file, 400, 400, 0.9);
      const filePath = `groups/${groupId}_${Date.now()}.jpg`;

      const { error: uploadError } = await supabase.storage
        .from(BUCKET_NAME)
        .upload(filePath, compressed.blob, {
          contentType: 'image/jpeg',
          cacheControl: '31536000',
          upsert: true
        });

      if (uploadError) {
        return { success: false, error: uploadError.message };
      }

      const { data } = supabase.storage
        .from(BUCKET_NAME)
        .getPublicUrl(filePath);

      return { success: true, url: data.publicUrl };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }
};
