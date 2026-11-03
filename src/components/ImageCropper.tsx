import { useState, useRef, useEffect, useCallback } from 'react';
import { X, Check, ZoomIn, ZoomOut, RotateCw, Move } from 'lucide-react';

interface ImageCropperProps {
  imageUrl: string;
  onCrop: (croppedBlob: Blob) => void;
  onCancel: () => void;
}

interface Vec {
  x: number;
  y: number;
}

const FRAME_SIZE = 300; // on-screen crop frame, in CSS px
const OUTPUT_SIZE = 640; // exported image resolution, in px
const MIN_ZOOM = 1; // 1x = "cover" fit, image always fills the circle
const MAX_ZOOM = 4;

function rotatePoint(p: Vec, degrees: number): Vec {
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return { x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos };
}

function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - t, 3);
}

export function ImageCropper({ imageUrl, onCrop, onCancel }: ImageCropperProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);

  const [zoom, setZoom] = useState(MIN_ZOOM);
  const [rotation, setRotation] = useState(0);
  const [position, setPosition] = useState<Vec>({ x: 0, y: 0 });
  const [imageLoaded, setImageLoaded] = useState(false);
  const [isInteracting, setIsInteracting] = useState(false);
  const [coverScale, setCoverScale] = useState(1);

  // Keep latest values in refs so gesture handlers always read fresh state
  // without having to re-bind listeners on every render.
  const zoomRef = useRef(zoom);
  const rotationRef = useRef(rotation);
  const positionRef = useRef(position);
  const coverScaleRef = useRef(coverScale);
  zoomRef.current = zoom;
  rotationRef.current = rotation;
  positionRef.current = position;
  coverScaleRef.current = coverScale;

  const dragStateRef = useRef<{ active: boolean; start: Vec; origin: Vec }>({
    active: false,
    start: { x: 0, y: 0 },
    origin: { x: 0, y: 0 }
  });
  const pinchRef = useRef<{ active: boolean; startDist: number; startZoom: number; anchor: Vec } | null>(null);
  const lastTapRef = useRef<{ time: number; point: Vec } | null>(null);
  const animRef = useRef<number | null>(null);

  // Load the source image once.
  useEffect(() => {
    let cancelled = false;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (cancelled) return;
      imageRef.current = img;
      const cover = FRAME_SIZE / Math.min(img.width, img.height);
      setCoverScale(cover);
      setZoom(MIN_ZOOM);
      setRotation(0);
      setPosition({ x: 0, y: 0 });
      setImageLoaded(true);
    };
    img.src = imageUrl;
    return () => {
      cancelled = true;
    };
  }, [imageUrl]);

  // Clamp the pan offset so the image can never be dragged away from
  // fully covering the circular frame (no empty gaps, ever).
  const clampPosition = useCallback((pos: Vec, zoomValue: number, rotationValue: number): Vec => {
    const img = imageRef.current;
    if (!img) return pos;
    const effectiveScale = coverScaleRef.current * zoomValue;
    const swapped = Math.round(rotationValue / 90) % 2 !== 0;
    const dispW = (swapped ? img.height : img.width) * effectiveScale;
    const dispH = (swapped ? img.width : img.height) * effectiveScale;
    const maxX = Math.max(0, (dispW - FRAME_SIZE) / 2);
    const maxY = Math.max(0, (dispH - FRAME_SIZE) / 2);
    return {
      x: Math.min(Math.max(pos.x, -maxX), maxX),
      y: Math.min(Math.max(pos.y, -maxY), maxY)
    };
  }, []);

  // Core render: paints the dimmed full image plus a bright, in-focus
  // circular crop on top — the look most modern cropping UIs use.
  const paint = useCallback(
    (ctx: CanvasRenderingContext2D, size: number, dim: boolean) => {
      const img = imageRef.current;
      if (!img) return;
      const k = size / FRAME_SIZE;
      const cx = size / 2;
      const cy = size / 2;
      const effectiveScale = coverScaleRef.current * zoomRef.current * k;
      const tx = cx + positionRef.current.x * k;
      const ty = cy + positionRef.current.y * k;

      ctx.clearRect(0, 0, size, size);

      if (dim) {
        ctx.save();
        ctx.translate(tx, ty);
        ctx.rotate((rotationRef.current * Math.PI) / 180);
        ctx.scale(effectiveScale, effectiveScale);
        ctx.drawImage(img, -img.width / 2, -img.height / 2);
        ctx.restore();

        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(0, 0, size, size);
      }

      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
      ctx.clip();
      ctx.translate(tx, ty);
      ctx.rotate((rotationRef.current * Math.PI) / 180);
      ctx.scale(effectiveScale, effectiveScale);
      ctx.drawImage(img, -img.width / 2, -img.height / 2);
      ctx.restore();
    },
    []
  );

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !imageLoaded) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    if (canvas.width !== FRAME_SIZE) canvas.width = FRAME_SIZE;
    if (canvas.height !== FRAME_SIZE) canvas.height = FRAME_SIZE;
    paint(ctx, FRAME_SIZE, true);
  }, [imageLoaded, paint]);

  useEffect(() => {
    redraw();
  }, [redraw, zoom, rotation, position]);

  // Smoothly animates zoom/rotation/position toward target values.
  const animateTo = useCallback(
    (
      target: { zoom?: number; rotationDelta?: number },
      durationMs = 240
    ) => {
      if (animRef.current) cancelAnimationFrame(animRef.current);

      const startZoom = zoomRef.current;
      const startRotation = rotationRef.current;
      const startPosition = positionRef.current;
      const targetZoom = target.zoom ?? startZoom;
      const rotationDelta = target.rotationDelta ?? 0;
      const t0 = performance.now();

      const step = (now: number) => {
        const t = Math.min(1, (now - t0) / durationMs);
        const eased = easeOutCubic(t);
        const curZoom = startZoom + (targetZoom - startZoom) * eased;
        const curDelta = rotationDelta * eased;

        // Re-anchor on the frame center so zoom/rotate feel grounded, not jumpy.
        const rotatedPos = rotatePoint(startPosition, curDelta);
        const zoomRatio = curZoom / startZoom || 1;
        const nextPos = { x: rotatedPos.x * (rotationDelta ? 1 : zoomRatio), y: rotatedPos.y * (rotationDelta ? 1 : zoomRatio) };

        setZoom(curZoom);
        setRotation(startRotation + curDelta);
        setPosition(nextPos);

        if (t < 1) {
          animRef.current = requestAnimationFrame(step);
        } else {
          setPosition(clampPosition(nextPos, curZoom, startRotation + curDelta));
          animRef.current = null;
        }
      };

      animRef.current = requestAnimationFrame(step);
    },
    [clampPosition]
  );

  useEffect(() => {
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, []);

  // Zoom anchored at a specific point within the frame (keeps that point
  // visually fixed while the content scales under it) — mirrors native apps.
  const zoomAtPoint = useCallback(
    (point: Vec, newZoom: number) => {
      const clampedZoom = Math.min(Math.max(newZoom, MIN_ZOOM), MAX_ZOOM);
      const ratio = clampedZoom / zoomRef.current;
      const nextPos = {
        x: point.x - (point.x - positionRef.current.x) * ratio,
        y: point.y - (point.y - positionRef.current.y) * ratio
      };
      setZoom(clampedZoom);
      setPosition(clampPosition(nextPos, clampedZoom, rotationRef.current));
    },
    [clampPosition]
  );

  // Same as zoomAtPoint, but eased over a short animation — used for the
  // double-tap / double-click "snap zoom" gesture.
  const animateZoomAtPoint = useCallback(
    (point: Vec, targetZoom: number, durationMs = 220) => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
      const clampedTarget = Math.min(Math.max(targetZoom, MIN_ZOOM), MAX_ZOOM);
      const startZoom = zoomRef.current;
      const startPosition = positionRef.current;
      const t0 = performance.now();

      const step = (now: number) => {
        const t = Math.min(1, (now - t0) / durationMs);
        const eased = easeOutCubic(t);
        const curZoom = startZoom + (clampedTarget - startZoom) * eased;
        const ratio = curZoom / startZoom;
        const nextPos = {
          x: point.x - (point.x - startPosition.x) * ratio,
          y: point.y - (point.y - startPosition.y) * ratio
        };
        setZoom(curZoom);
        setPosition(t < 1 ? nextPos : clampPosition(nextPos, curZoom, rotationRef.current));

        if (t < 1) {
          animRef.current = requestAnimationFrame(step);
        } else {
          animRef.current = null;
        }
      };

      animRef.current = requestAnimationFrame(step);
    },
    [clampPosition]
  );

  const getRelativePoint = (clientX: number, clientY: number): Vec => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: clientX - (rect.left + rect.width / 2), y: clientY - (rect.top + rect.height / 2) };
  };

  // ---- Pointer (mouse / pen / single-touch-via-pointer) drag-to-pan ----
  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.pointerType !== 'touch') {
      (e.target as Element).setPointerCapture?.(e.pointerId);
      if (animRef.current) cancelAnimationFrame(animRef.current);
      setIsInteracting(true);
      dragStateRef.current = { active: true, start: { x: e.clientX, y: e.clientY }, origin: positionRef.current };
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (e.pointerType === 'touch' || !dragStateRef.current.active) return;
    const dx = e.clientX - dragStateRef.current.start.x;
    const dy = e.clientY - dragStateRef.current.start.y;
    const next = { x: dragStateRef.current.origin.x + dx, y: dragStateRef.current.origin.y + dy };
    setPosition(clampPosition(next, zoomRef.current, rotationRef.current));
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (e.pointerType === 'touch') return;
    dragStateRef.current.active = false;
    setIsInteracting(false);
  };

  // ---- Touch: single-finger pan, two-finger anchored pinch-zoom, double-tap ----
  const handleTouchStart = (e: React.TouchEvent) => {
    if (animRef.current) cancelAnimationFrame(animRef.current);
    setIsInteracting(true);

    if (e.touches.length === 2) {
      dragStateRef.current.active = false;
      const [a, b] = [e.touches[0], e.touches[1]];
      const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const mid = getRelativePoint((a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2);
      pinchRef.current = { active: true, startDist: dist, startZoom: zoomRef.current, anchor: mid };
    } else if (e.touches.length === 1) {
      pinchRef.current = null;
      const touch = e.touches[0];
      dragStateRef.current = { active: true, start: { x: touch.clientX, y: touch.clientY }, origin: positionRef.current };

      const now = Date.now();
      const point = getRelativePoint(touch.clientX, touch.clientY);
      if (lastTapRef.current && now - lastTapRef.current.time < 300 && Math.hypot(point.x - lastTapRef.current.point.x, point.y - lastTapRef.current.point.y) < 24) {
        // Double tap: toggle between fitted and 2.2x zoom, anchored at the tap point.
        const target = zoomRef.current > MIN_ZOOM + 0.2 ? MIN_ZOOM : Math.min(2.2, MAX_ZOOM);
        animateZoomAtPoint(point, target);
        lastTapRef.current = null;
        dragStateRef.current.active = false;
      } else {
        lastTapRef.current = { time: now, point };
      }
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && pinchRef.current?.active) {
      const [a, b] = [e.touches[0], e.touches[1]];
      const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const ratio = dist / pinchRef.current.startDist;
      const target = pinchRef.current.startZoom * ratio;
      zoomAtPoint(pinchRef.current.anchor, target);
    } else if (e.touches.length === 1 && dragStateRef.current.active) {
      const touch = e.touches[0];
      const dx = touch.clientX - dragStateRef.current.start.x;
      const dy = touch.clientY - dragStateRef.current.start.y;
      const next = { x: dragStateRef.current.origin.x + dx, y: dragStateRef.current.origin.y + dy };
      setPosition(clampPosition(next, zoomRef.current, rotationRef.current));
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (e.touches.length < 2) pinchRef.current = null;
    if (e.touches.length === 0) {
      dragStateRef.current.active = false;
      setIsInteracting(false);
    }
  };

  // ---- Wheel: zoom anchored at the cursor ----
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const point = getRelativePoint(e.clientX, e.clientY);
    const delta = e.deltaY > 0 ? -0.12 : 0.12;
    zoomAtPoint(point, zoomRef.current + delta * zoomRef.current);
  };

  const handleZoomIn = () => animateTo({ zoom: Math.min(zoomRef.current + 0.5, MAX_ZOOM) });
  const handleZoomOut = () => animateTo({ zoom: Math.max(zoomRef.current - 0.5, MIN_ZOOM) });
  const handleRotate = () => animateTo({ rotationDelta: 90 }, 320);

  const handleSliderChange = (value: number) => {
    if (animRef.current) cancelAnimationFrame(animRef.current);
    zoomAtPoint({ x: 0, y: 0 }, value);
  };

  // Crop and export at a higher resolution than the on-screen preview.
  const handleCrop = () => {
    const img = imageRef.current;
    if (!img) return;
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = OUTPUT_SIZE;
    exportCanvas.height = OUTPUT_SIZE;
    const ctx = exportCanvas.getContext('2d');
    if (!ctx) return;
    paint(ctx, OUTPUT_SIZE, false);
    exportCanvas.toBlob(
      (blob) => {
        if (blob) onCrop(blob);
      },
      'image/jpeg',
      0.92
    );
  };

  const zoomPercent = Math.round((zoom / MIN_ZOOM) * 100);

  return (
    <div className="fixed inset-0 z-50 bg-neutral-950 flex flex-col select-none">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-3 bg-gradient-to-b from-black/70 to-transparent">
        <button
          onClick={onCancel}
          className="w-10 h-10 rounded-full flex items-center justify-center text-white/90 hover:bg-white/10 active:scale-90 transition-all"
          aria-label="Cancel"
        >
          <X className="w-5 h-5" />
        </button>
        <span className="text-white font-semibold text-[15px] tracking-tight">Move and Scale</span>
        <button
          onClick={handleCrop}
          disabled={!imageLoaded}
          className="w-10 h-10 rounded-full flex items-center justify-center bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white shadow-lg shadow-violet-500/30 hover:brightness-110 active:scale-90 transition-all disabled:opacity-40"
          aria-label="Save"
        >
          <Check className="w-5 h-5" strokeWidth={3} />
        </button>
      </div>

      {/* Crop Area */}
      <div className="flex-1 flex items-center justify-center px-4 -mt-6">
        <div
          ref={containerRef}
          className="relative touch-none"
          style={{ width: FRAME_SIZE, height: FRAME_SIZE }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onPointerLeave={handlePointerUp}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={handleTouchEnd}
          onWheel={handleWheel}
          onDoubleClick={() => animateZoomAtPoint({ x: 0, y: 0 }, zoom > MIN_ZOOM + 0.2 ? MIN_ZOOM : Math.min(2.2, MAX_ZOOM))}
        >
          {!imageLoaded && (
            <div className="absolute inset-0 rounded-full bg-white/5 animate-pulse flex items-center justify-center">
              <span className="text-white/40 text-xs">Loading…</span>
            </div>
          )}

          {/* Canvas renders the dimmed full image + bright circular crop */}
          <canvas
            ref={canvasRef}
            className="rounded-full cursor-grab active:cursor-grabbing"
            style={{ width: FRAME_SIZE, height: FRAME_SIZE }}
          />

          {/* Crisp frame ring */}
          <div className="absolute inset-0 rounded-full ring-2 ring-white/80 pointer-events-none" />

          {/* Rule-of-thirds guides, shown only while actively gesturing */}
          <div
            className={`absolute inset-0 rounded-full overflow-hidden pointer-events-none transition-opacity duration-150 ${
              isInteracting ? 'opacity-100' : 'opacity-0'
            }`}
          >
            <div className="absolute left-1/3 top-0 bottom-0 w-px bg-white/35" />
            <div className="absolute left-2/3 top-0 bottom-0 w-px bg-white/35" />
            <div className="absolute top-1/3 left-0 right-0 h-px bg-white/35" />
            <div className="absolute top-2/3 left-0 right-0 h-px bg-white/35" />
          </div>
        </div>
      </div>

      {/* Instructions */}
      <div className="flex items-center justify-center gap-1.5 text-white/50 text-xs px-4 mb-3">
        <Move className="w-3.5 h-3.5" />
        <span>Drag to reposition &bull; Pinch or scroll to zoom &bull; Double-tap to snap-zoom</span>
      </div>

      {/* Controls */}
      <div className="px-5 pb-8" style={{ paddingBottom: 'max(2rem, env(safe-area-inset-bottom))' }}>
        <div className="flex items-center gap-4 mb-5">
          <button
            onClick={handleZoomOut}
            disabled={zoom <= MIN_ZOOM + 0.01}
            className="w-10 h-10 shrink-0 rounded-full bg-white/10 flex items-center justify-center text-white hover:bg-white/20 active:scale-90 transition-all disabled:opacity-30"
            aria-label="Zoom out"
          >
            <ZoomOut className="w-4 h-4" />
          </button>

          <div className="flex-1">
            <input
              type="range"
              min={MIN_ZOOM}
              max={MAX_ZOOM}
              step="0.01"
              value={zoom}
              onChange={(e) => handleSliderChange(parseFloat(e.target.value))}
              className="w-full h-1.5 bg-white/15 rounded-full appearance-none cursor-pointer accent-violet-500 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:shadow-black/40"
            />
          </div>

          <button
            onClick={handleZoomIn}
            disabled={zoom >= MAX_ZOOM - 0.01}
            className="w-10 h-10 shrink-0 rounded-full bg-white/10 flex items-center justify-center text-white hover:bg-white/20 active:scale-90 transition-all disabled:opacity-30"
            aria-label="Zoom in"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-center justify-center gap-6">
          <span className="text-white/50 text-xs font-medium tabular-nums w-10 text-center">{zoomPercent}%</span>
          <button
            onClick={handleRotate}
            className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/10 text-white text-sm font-medium hover:bg-white/20 active:scale-95 transition-all"
          >
            <RotateCw className="w-4 h-4" />
            Rotate
          </button>
          <span className="w-10" />
        </div>
      </div>
    </div>
  );
}
