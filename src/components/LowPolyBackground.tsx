import { useMemo } from 'react';

/**
 * Animated low-poly mesh background for the opened 1:1 and group chat
 * screens — replaces the old plain white/slate chat background with a
 * faceted triangle mesh in the app's own violet/purple/fuchsia palette,
 * gently drifting and twinkling behind the messages.
 *
 * Deliberately built from cheap, GPU-friendly primitives only:
 *   - the whole mesh is ONE <svg>, slowly panned/rotated/scaled via a
 *     single CSS transform animation (lowpoly-drift, see globals.css) —
 *     one composited layer, not per-triangle JS animation.
 *   - each triangle's gentle "twinkle" is a native SVG SMIL <animate> on
 *     its own opacity, which the browser's rendering engine drives
 *     directly — no requestAnimationFrame polling, nothing that competes
 *     with message-list scroll performance.
 * This matters because it sits behind an actively-scrolling chat on
 * mobile; a canvas/WebGL mesh re-animated every frame would be massive
 * overkill (and a real battery/perf cost) for what's just a decorative
 * backdrop.
 */

// Deterministic seeded RNG (mulberry32) — the mesh is generated once and
// should look the same, carefully "designed" way on every load, rather
// than risking an awkward/sparse layout from plain Math.random() on an
// unlucky run.
function mulberry32(seed: number) {
  let s = seed;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Triangle {
  points: string;
  fill: string;
  baseOpacity: number;
  peakOpacity: number;
  delay: number;
  dur: number;
}

// Theme palette — the exact violet/purple/fuchsia family already used for
// the header gradient and "own message" bubbles everywhere else in the
// app, plus a little white to keep the mesh from reading as muddy/flat.
const THEME_FILLS = [
  '#a78bfa', // violet-400
  '#8b5cf6', // violet-500
  '#7c3aed', // violet-600
  '#c084fc', // purple-400
  '#a855f7', // purple-500
  '#e879f9', // fuchsia-400
  '#d946ef', // fuchsia-500
  '#ffffff',
];

const COLS = 10;
const ROWS = 8;
const WIDTH = 800;
const HEIGHT = 640;

function buildMesh(seed: number): Triangle[] {
  const rand = mulberry32(seed);
  const cellW = WIDTH / COLS;
  const cellH = HEIGHT / ROWS;

  // Jittered grid of vertices: a perfectly regular grid of triangles reads
  // as a mechanical repeating pattern, not "low poly" — nudging every
  // interior point randomly within a fraction of its own cell is the
  // trick that makes the facets look irregular and hand-crafted instead.
  // Edge points are left un-jittered so the mesh tiles cleanly to a clean
  // rectangle with no gaps at the border.
  const points: { x: number; y: number }[][] = [];
  for (let r = 0; r <= ROWS; r++) {
    const row: { x: number; y: number }[] = [];
    for (let c = 0; c <= COLS; c++) {
      const onEdge = r === 0 || r === ROWS || c === 0 || c === COLS;
      const jitterX = onEdge ? 0 : (rand() - 0.5) * cellW * 0.75;
      const jitterY = onEdge ? 0 : (rand() - 0.5) * cellH * 0.75;
      row.push({ x: c * cellW + jitterX, y: r * cellH + jitterY });
    }
    points.push(row);
  }

  const triangles: Triangle[] = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const p1 = points[r][c];
      const p2 = points[r][c + 1];
      const p3 = points[r + 1][c];
      const p4 = points[r + 1][c + 1];
      // Alternate the diagonal that splits each quad into two triangles
      // randomly, so neighboring cells don't all share the same crease
      // direction — another small thing that keeps the mesh from reading
      // as an obviously generated grid.
      const flip = rand() > 0.5;
      const triA = flip ? [p1, p2, p3] : [p1, p2, p4];
      const triB = flip ? [p2, p4, p3] : [p1, p4, p3];

      for (const tri of [triA, triB]) {
        const fill = THEME_FILLS[Math.floor(rand() * THEME_FILLS.length)];
        const baseOpacity = 0.07 + rand() * 0.16;
        triangles.push({
          points: tri.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '),
          fill,
          baseOpacity,
          peakOpacity: Math.min(0.4, baseOpacity + 0.16 + rand() * 0.12),
          delay: rand() * 9,
          dur: 6 + rand() * 7,
        });
      }
    }
  }
  return triangles;
}

export default function LowPolyBackground({ seed = 7 }: { seed?: number }) {
  const triangles = useMemo(() => buildMesh(seed), [seed]);

  return (
    <div
      className="absolute inset-0 overflow-hidden pointer-events-none select-none"
      // Fade the mesh out before it reaches the message input bar at the
      // bottom of the screen. Without this, a triangle facet happening to
      // land directly behind the input pill reads as an unwanted flat
      // "container" stuck to it rather than the pill floating on its own
      // — the input area should always sit on a clean, untextured patch
      // of the background, regardless of how the mesh above it is seeded.
      style={{
        WebkitMaskImage: 'linear-gradient(to bottom, black 0%, black 76%, transparent 94%)',
        maskImage: 'linear-gradient(to bottom, black 0%, black 76%, transparent 94%)',
      }}
      aria-hidden="true"
    >
      <svg
        className="lowpoly-bg-mesh"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="xMidYMid slice"
        xmlns="http://www.w3.org/2000/svg"
      >
        {triangles.map((t, i) => (
          <polygon key={i} points={t.points} fill={t.fill} opacity={t.baseOpacity}>
            <animate
              attributeName="opacity"
              values={`${t.baseOpacity};${t.peakOpacity};${t.baseOpacity}`}
              dur={`${t.dur}s`}
              begin={`${t.delay}s`}
              repeatCount="indefinite"
            />
          </polygon>
        ))}
      </svg>
    </div>
  );
}
