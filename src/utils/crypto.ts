// Simplified encryption for demo purposes
// In a production app, we would exchange public keys stored in the DB.
// Here we derive a session key from a shared secret or password for demonstration, 
// or generate a random key if we had a proper handshake.

export const generateKey = async (): Promise<CryptoKey> => {
  return window.crypto.subtle.generateKey(
    {
      name: "AES-GCM",
      length: 256,
    },
    true,
    ["encrypt", "decrypt"]
  );
};

export const encryptMessage = async (text: string, key: CryptoKey): Promise<{ iv: string; ciphertext: string }> => {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  
  const ciphertext = await window.crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: iv,
    },
    key,
    data
  );

  return {
    iv: Array.from(iv).map(b => b.toString(16).padStart(2, '0')).join(''),
    ciphertext: Array.from(new Uint8Array(ciphertext)).map(b => b.toString(16).padStart(2, '0')).join(''),
  };
};

// For this demo, since we don't have a PKI infrastructure set up in the provided Supabase,
// we will simulate E2E by just encoding/decoding or using a static derivation for "mock" security display.
// Real E2E requires storing public keys in the `profiles` table.

export const formatTime = (dateString: string) => {
  const date = new Date(dateString);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

export const formatDateHeader = (dateString: string) => {
  const date = new Date(dateString);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString();
};

export const formatDuration = (seconds: number) => {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
};

export const parseDurationToSeconds = (value: any): number | undefined => {
  if (typeof value === 'number' && isFinite(value) && value >= 0) return Math.floor(value);
  if (typeof value !== 'string') return undefined;
  const parts = value.split(':').map(p => parseInt(p, 10));
  if (parts.some(isNaN)) return undefined;
  if (parts.length === 2) { return parts[0] * 60 + parts[1]; }
  if (parts.length === 3) { return parts[0] * 3600 + parts[1] * 60 + parts[2]; }
  return undefined;
};

// Format last seen time (e.g., "5 minutes ago", "2 hours ago", "Yesterday at 3:45 PM")
export const formatLastSeen = (dateString: string | undefined) => {
  if (!dateString) return 'Last seen recently';
  
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  
  if (diffMins < 1) return 'Last seen just now';
  if (diffMins === 1) return 'Last seen 1 minute ago';
  if (diffMins < 60) return `Last seen ${diffMins} minutes ago`;
  if (diffHours === 1) return 'Last seen 1 hour ago';
  if (diffHours < 24) return `Last seen ${diffHours} hours ago`;
  if (diffDays === 1) return `Last seen yesterday at ${formatTime(dateString)}`;
  if (diffDays < 7) return `Last seen ${date.toLocaleDateString([], { weekday: 'long' })} at ${formatTime(dateString)}`;
  return `Last seen ${date.toLocaleDateString()} at ${formatTime(dateString)}`;
};
