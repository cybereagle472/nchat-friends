import type { CapacitorConfig } from '@capacitor/cli';

// This wraps the already-deployed web app (built to `dist/`) in a native
// Android shell — it does not run its own backend or dev server; the app
// talks to the same Cloudflare Worker API (VITE_API_URL) the website uses.
//
// appId follows Android's reverse-domain convention and, once set, should
// be treated as permanent — changing it later is effectively a different
// app as far as Android/Google Play are concerned (different signing
// identity, no seamless update path for anyone who already installed it).
const config: CapacitorConfig = {
  appId: 'com.nchat.friends',
  appName: 'NChat',
  webDir: 'dist',
  // Debug builds load fine from the bundled dist/ assets; nothing here
  // points at a live-reload dev server, so this config is already in its
  // "production-ish" shape.
  android: {
    // Lets the WebView's own audio/video <video>/<audio> elements keep
    // playing correctly when the call screen is the active page — matches
    // how the website behaves today.
    allowMixedContent: false,
  },
};

export default config;
