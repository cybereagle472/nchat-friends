import { RefObject, useEffect, useState } from 'react';

/**
 * Measures how many pixels of a screen's own bottom edge are currently
 * hidden below the real visible viewport (i.e. covered by the on-screen
 * keyboard), and returns that as a number you apply as `paddingBottom` on
 * the screen's root flex container. That eats into the flex-1 messages
 * area from the bottom, which pushes the input bar (the last flex child)
 * up by exactly that amount — right above the keyboard — regardless of
 * whether anything *above* this component (the app shell, the browser's
 * own layout-viewport resize behavior) already compensated for the
 * keyboard or not.
 *
 * This complements (not duplicates) useVisualViewportHeight, which resizes
 * the top-level app shell from the same `visualViewport` signal: that
 * hook's job is to stop the whole page from being taller than the visible
 * area in the first place, but if a particular browser/WebView doesn't
 * honor it for some reason, the chat screen would otherwise have no
 * fallback at all. Measuring *this* element's own rendered bottom edge
 * against the visible viewport (rather than assuming `window.innerHeight`
 * is still the untouched pre-keyboard height) is what keeps the two from
 * double-compensating: if the shell above already shrank correctly, this
 * element's bottom edge already lines up with the visible viewport and the
 * computed inset is ~0, so this is a true no-op in that case — it only
 * kicks in for the gap the shell-level fix missed.
 */
export function useKeyboardInset(containerRef: RefObject<HTMLElement | null>): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;

    const update = () => {
      const el = containerRef.current;
      if (!el) return;
      // No visualViewport support at all (very old WebViews) — nothing to
      // measure against, so just stay at 0 and rely on the CSS/meta-tag
      // fallback instead of guessing.
      if (!vv) {
        setInset(0);
        return;
      }
      const rect = el.getBoundingClientRect();
      const visibleBottom = vv.height + vv.offsetTop;
      const hiddenBelow = rect.bottom - visibleBottom;
      // A couple of px of noise is normal (sub-pixel layout, rounding) —
      // only treat it as a real keyboard overlap past that.
      setInset(hiddenBelow > 2 ? Math.round(hiddenBelow) : 0);
    };

    update();

    vv?.addEventListener('resize', update);
    vv?.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    // Covers the moment focus itself lands on the input, before the
    // keyboard animation (and therefore the viewport resize) has actually
    // finished — re-checked a few times over the keyboard's typical open
    // animation so the padding catches up smoothly instead of only
    // updating once the keyboard is already fully open.
    const settleTimers = [100, 250, 400, 600].map((ms) => setTimeout(update, ms));

    return () => {
      vv?.removeEventListener('resize', update);
      vv?.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
      settleTimers.forEach(clearTimeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return inset;
}
