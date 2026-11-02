/**
 * Small, call-UI-agnostic WebRTC <audio>/<video> element helpers shared by
 * CallModal.tsx (1:1 calls) and GroupCallModal.tsx (group calls) — pulled
 * out of CallModal.tsx so both call surfaces apply the exact same
 * hard-won, real-device-tested playback/output-routing behavior instead
 * of one of them drifting from or re-deriving it.
 */

// Setting `srcObject` plus the `autoPlay` attribute is usually enough, but
// on some mobile browsers a stream attached asynchronously well after the
// gesture that started the call (which is exactly when a WebRTC track
// shows up — it depends on signaling/ICE finishing, not on anything the
// user just tapped) doesn't reliably auto-start: the element just sits
// there attached but never actually playing, with no visible error. This
// is the one documented case of a real-device test where the far side's
// video (and possibly audio) looked connected but never actually rendered.
// Explicitly calling .play() covers that gap; the rejection is swallowed
// since autoPlay already covers the common case and a thrown/rejected
// promise here would otherwise surface as an unhandled rejection for
// something that isn't actually fatal to the call.
export function playSafely(el: HTMLMediaElement | null) {
  el?.play().catch(() => {
    /* Autoplay can still be blocked in rare cases; nothing actionable to
       do about it here, and the call itself isn't broken by it. */
  });
}

// The Speaker button used to only toggle its own highlighted look — it
// never actually changed where audio played, so audio calls always came
// out of the loud external speaker regardless of the button's state.
//
// IMPORTANT, confirmed platform limitation: on Android, Chrome (and every
// Chromium-based browser) does not expose any way for a web page to pick
// the earpiece — Google's own Chromium team closed this exact feature
// request as "Won't Fix" (the platform doesn't let a web app route
// different audio streams to different outputs independently; see
// issues.chromium.org/issues/41276355). enumerateDevices() on Android
// Chrome returns at most a single generic "Default" audiooutput entry, so
// there is nothing to actually switch to — audio/video calls in ANY
// browser on Android always play through the loud speaker, full stop.
// This is a dead end that cannot be fixed from this codebase; the only
// way around it is a native app (or a wrapped app with a native WebRTC
// plugin) that can call Android's AudioManager directly.
//
// iOS Safari/WebKit takes a different, genuinely usable approach: it
// doesn't support setSinkId either, but exposes navigator.audioSession
// (iOS 16.4+) to declare the page as doing a voice call, which is what
// actually makes the OS prefer the earpiece; setSinkId to the specific
// "receiver" device (once that session type is active) then picks
// between the two. Desktop Chrome/Edge/Firefox have real, distinct
// output devices (e.g. headphones vs. built-in speakers) where
// setSinkId works as documented.
export async function applyAudioOutput(el: HTMLMediaElement | null, speakerOn: boolean) {
  // iOS: this is what actually flips the OS's preferred route — setSinkId
  // alone does nothing there without it first. Safe to call
  // unconditionally; it's a no-op on every other platform.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const audioSession = (navigator as any).audioSession;
  if (audioSession) {
    try {
      audioSession.type = speakerOn ? 'auto' : 'play-and-record';
    } catch {
      /* Unsupported iOS/Safari version — ignore. */
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (!el || typeof (el as any).setSinkId !== 'function') return;
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const outputs = devices.filter((d) => d.kind === 'audiooutput');
    const earpiece = outputs.find((d) => /ear.?piece|receiver|handset/i.test(d.label));
    const speaker = outputs.find((d) => /speaker/i.test(d.label));
    const target = speakerOn ? speaker : earpiece;
    if (target) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (el as any).setSinkId(target.deviceId);
    } else if (speakerOn) {
      // Couldn't positively identify a named speaker device — the system
      // default output is the loud speaker on virtually every platform,
      // so that still satisfies "speaker on".
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (el as any).setSinkId('');
    }
    // If earpiece couldn't be identified (the normal case on Android —
    // see above), leave the current output as-is rather than guess wrong.
  } catch {
    // enumerateDevices()/setSinkId() unsupported or blocked — nothing more
    // that can be done from here; the call itself still works fine.
  }
}
