import { useEffect, useState } from 'react';

/**
 * Tracks the real, currently-visible viewport height in px — i.e. the
 * height that's actually free of the on-screen keyboard — instead of the
 * static `100vh`/`100dvh` layout height.
 *
 * Why this is needed: this app's screens are built as a `height: 100%`
 * flex column with the chat input pinned as the last child, which is
 * exactly the right structure for the input to sit above the keyboard —
 * *if* the browser actually shrinks the layout viewport when the keyboard
 * opens. Chrome on Android defaults to NOT doing that (`interactive-widget:
 * resizes-visual`, the on-screen keyboard just overlays on top of an
 * unchanged layout) unless the page opts in via the `interactive-widget`
 * viewport meta directive, which index.html now does — but that directive
 * alone isn't honored everywhere (older WebViews, some in-app browsers),
 * and when it isn't, a `100vh`/`h-screen` container keeps its full
 * pre-keyboard height and the input bar at its bottom ends up rendered
 * *behind* the keyboard instead of pushed up above it.
 *
 * `window.visualViewport` has been reliably available on both Android
 * Chrome and iOS Safari for years and *always* reports the actual visible
 * area regardless of how the layout viewport directive is handled, so
 * driving the shell's height from it directly is a belt-and-suspenders
 * fix that works even where the CSS-only fix doesn't quite land.
 */
export function useVisualViewportHeight(): number | null {
  const [height, setHeight] = useState<number | null>(() =>
    typeof window !== 'undefined' && window.visualViewport
      ? window.visualViewport.height
      : null
  );

  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!vv) return;

    const update = () => setHeight(vv.height);
    update();

    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);

  return height;
}
