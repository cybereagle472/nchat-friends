/**
 * Application Constants
 * Centralized configuration for the entire application
 */

// File size limits (in MB)
export const FILE_SIZE_LIMITS = {
  IMAGE: 10,
  VIDEO: 50,
  AUDIO: 25,
  DOCUMENT: 100,
} as const;

// Message limits
export const MESSAGE_LIMITS = {
  MAX_LENGTH: 10000,
  MAX_REPLIES_DEPTH: 10,
} as const;

// Rate limiting
export const RATE_LIMITS = {
  MESSAGES_PER_MINUTE: 30,
  FRIEND_REQUESTS_PER_HOUR: 10,
  LOGIN_ATTEMPTS: 5,
  LOGIN_WINDOW_MS: 15 * 60 * 1000, // 15 minutes
} as const;

// Pagination
export const PAGINATION = {
  MESSAGES_PER_PAGE: 50,
  CONTACTS_PER_PAGE: 100,
  NOTIFICATIONS_PER_PAGE: 50,
} as const;

// Timeouts (in milliseconds)
export const TIMEOUTS = {
  TYPING_INDICATOR: 3000, // 3 seconds
  CONNECTION_RETRY: 5000, // 5 seconds
  MESSAGE_SEND_TIMEOUT: 30000, // 30 seconds
  CALL_RING_TIMEOUT: 60000, // 60 seconds
} as const;

// Allowed file types
export const ALLOWED_FILE_TYPES = {
  IMAGE: ['jpg', 'jpeg', 'png', 'gif', 'webp'],
  VIDEO: ['mp4', 'webm', 'mov', 'avi'],
  AUDIO: ['mp3', 'wav', 'm4a', 'ogg', 'aac'],
  DOCUMENT: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv'],
} as const;

// Validation rules
export const VALIDATION = {
  USERNAME_MIN_LENGTH: 3,
  USERNAME_MAX_LENGTH: 30,
  PASSWORD_MIN_LENGTH: 8,
  EMAIL_MAX_LENGTH: 255,
  MESSAGE_MAX_LENGTH: 10000,
  GROUP_NAME_MAX_LENGTH: 50,
  BIO_MAX_LENGTH: 500,
} as const;

// UI Constants
export const UI = {
  TOAST_DURATION: 4000, // 4 seconds
  ANIMATION_DURATION: 200, // 200ms
  DEBOUNCE_DELAY: 300, // 300ms
  INFINITE_SCROLL_THRESHOLD: 100, // pixels from bottom
} as const;

// Feature flags
export const FEATURES = {
  ENABLE_VOICE_MESSAGES: true,
  ENABLE_VIDEO_CALLS: true,
  ENABLE_GROUP_CHATS: true,
  ENABLE_MESSAGE_REACTIONS: true,
  ENABLE_MESSAGE_REPLIES: true,
  ENABLE_TYPING_INDICATORS: true,
  ENABLE_READ_RECEIPTS: true,
  ENABLE_LAST_SEEN: true,
} as const;

// Storage keys
export const STORAGE_KEYS = {
  THEME: 'nchat_theme',
  LANGUAGE: 'nchat_language',
  NOTIFICATIONS_ENABLED: 'nchat_notifications_enabled',
  SOUND_ENABLED: 'nchat_sound_enabled',
} as const;

