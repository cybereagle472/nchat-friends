/**
 * Media Utilities for Image/Video Compression and Processing
 */

// Image Compression
export const compressImage = async (
  file: File,
  maxWidth = 1920,
  maxHeight = 1080,
  quality = 0.8
): Promise<{ blob: Blob; dataUrl: string }> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      const img = new Image();

      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        // Calculate new dimensions
        if (width > maxWidth || height > maxHeight) {
          const ratio = Math.min(maxWidth / width, maxHeight / height);
          width = Math.floor(width * ratio);
          height = Math.floor(height * ratio);
        }

        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Could not get canvas context'));
          return;
        }

        // Draw with high quality
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, width, height);

        // Convert to blob
        canvas.toBlob(
          (blob) => {
            if (blob) {
              const dataUrl = canvas.toDataURL('image/jpeg', quality);
              resolve({ blob, dataUrl });
            } else {
              reject(new Error('Could not create blob'));
            }
          },
          'image/jpeg',
          quality
        );
      };

      img.onerror = () => reject(new Error('Could not load image'));
      img.src = e.target?.result as string;
    };

    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
};

// Generate Video Thumbnail
export const generateVideoThumbnail = (
  videoFile: File,
  seekTime = 2
): Promise<string> => {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;

    video.onloadedmetadata = () => {
      // Seek to desired time or middle of video
      video.currentTime = Math.min(seekTime, video.duration / 2);
    };

    video.onseeked = () => {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Could not get canvas context'));
        return;
      }

      ctx.drawImage(video, 0, 0);
      const thumbnail = canvas.toDataURL('image/jpeg', 0.7);

      // Cleanup
      URL.revokeObjectURL(video.src);
      resolve(thumbnail);
    };

    video.onerror = () => {
      URL.revokeObjectURL(video.src);
      reject(new Error('Could not load video'));
    };

    video.src = URL.createObjectURL(videoFile);
  });
};

// Get Video Duration
export const getVideoDuration = (videoFile: File): Promise<number> => {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';

    video.onloadedmetadata = () => {
      URL.revokeObjectURL(video.src);
      resolve(Math.floor(video.duration));
    };

    video.onerror = () => {
      URL.revokeObjectURL(video.src);
      reject(new Error('Could not load video'));
    };

    video.src = URL.createObjectURL(videoFile);
  });
};

// Get Audio Duration
export const getAudioDuration = (audioFile: File | Blob): Promise<number> => {
  return new Promise((resolve, reject) => {
    const audio = new Audio();

    audio.onloadedmetadata = () => {
      URL.revokeObjectURL(audio.src);
      resolve(Math.floor(audio.duration));
    };

    audio.onerror = () => {
      URL.revokeObjectURL(audio.src);
      reject(new Error('Could not load audio'));
    };

    audio.src = URL.createObjectURL(audioFile);
  });
};

// Convert Blob to Base64
export const blobToBase64 = (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};

// Format File Size
export const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 B';

  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
};

// Get File Type Category
export const getFileCategory = (mimeType: string): 'image' | 'video' | 'audio' | 'document' | 'unknown' => {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (
    mimeType.includes('pdf') ||
    mimeType.includes('document') ||
    mimeType.includes('text') ||
    mimeType.includes('sheet') ||
    mimeType.includes('presentation')
  ) {
    return 'document';
  }
  return 'unknown';
};

// Validate File Size
export const validateFileSize = (file: File, maxSizeMB: number): boolean => {
  const maxBytes = maxSizeMB * 1024 * 1024;
  return file.size <= maxBytes;
};

// Get File Extension Icon
export const getFileIcon = (filename: string): string => {
  const ext = filename.split('.').pop()?.toLowerCase();

  const iconMap: { [key: string]: string } = {
    // Documents
    pdf: '📄',
    doc: '📝',
    docx: '📝',
    txt: '📃',
    // Spreadsheets
    xls: '📊',
    xlsx: '📊',
    csv: '📊',
    // Presentations
    ppt: '📽️',
    pptx: '📽️',
    // Archives
    zip: '🗜️',
    rar: '🗜️',
    '7z': '🗜️',
    // Code
    js: '💻',
    ts: '💻',
    py: '🐍',
    java: '☕',
    // Others
    json: '{ }',
    xml: '< >',
  };

  return iconMap[ext || ''] || '📎';
};

// Create Audio Waveform Data (simplified)
export const generateWaveformData = async (_audioBlob: Blob): Promise<number[]> => {
  // Simplified waveform - in production, use Web Audio API
  // This creates a fake waveform for demo purposes
  const dataPoints = 50;
  const waveform: number[] = [];

  for (let i = 0; i < dataPoints; i++) {
    // Generate semi-realistic looking waveform
    const value = Math.sin(i / 5) * 0.5 + Math.random() * 0.5;
    waveform.push(Math.abs(value));
  }

  return waveform;
};

// Check if file type is supported
export const isSupportedFileType = (file: File): boolean => {
  const supportedTypes = [
    // Images
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/gif',
    'image/webp',
    // Videos
    'video/mp4',
    'video/webm',
    'video/quicktime', // .mov
    // Audio
    'audio/mpeg',
    'audio/mp3',
    'audio/wav',
    'audio/webm',
    'audio/ogg',
    'audio/m4a',
    // Documents
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain',
    'text/csv',
    'application/json',
    // Archives
    'application/zip',
    'application/x-rar-compressed',
  ];

  return supportedTypes.includes(file.type);
};

// Get max file size for type
export const getMaxFileSize = (fileType: string): number => {
  const category = getFileCategory(fileType);

  switch (category) {
    case 'image':
      return 10; // 10 MB
    case 'video':
      return 50; // 50 MB
    case 'audio':
      return 20; // 20 MB
    case 'document':
      return 100; // 100 MB
    default:
      return 25; // 25 MB default
  }
};
