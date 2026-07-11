"use client";

import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";

// Fixed, small internal resolution on purpose - the exported PNG's pixel
// size is set by these, not by the element's on-screen CSS size (see
// getPoint below, which rescales pointer coordinates into this fixed grid).
// Keeps every exported signature a small, consistent file (typically a few
// KB - simple black-ink line art on white compresses very well as PNG) well
// under the server's MAX_SIGNATURE_BYTES ceiling
// (lib/actions/parent-signatures.ts), regardless of how large the tablet's
// screen/canvas element is displayed. Only a Storage path for this image is
// ever persisted to Postgres - never the pixel data itself.
const CANVAS_WIDTH = 600;
const CANVAS_HEIGHT = 200;

export interface SignatureCanvasHandle {
  // "data:image/png;base64,...." or null if nothing has been drawn yet.
  toDataUrl: () => string | null;
  clear: () => void;
}

function paintWhiteBackground(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
}

export const SignatureCanvas = forwardRef<SignatureCanvasHandle, { onChange?: (hasSignature: boolean) => void }>(
  function SignatureCanvas({ onChange }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const drawingRef = useRef(false);
    const hasSignatureRef = useRef(false);
    const lastPointRef = useRef<{ x: number; y: number } | null>(null);

    const getPoint = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      return {
        x: ((e.clientX - rect.left) / rect.width) * CANVAS_WIDTH,
        y: ((e.clientY - rect.top) / rect.height) * CANVAS_HEIGHT,
      };
    }, []);

    const handlePointerDown = useCallback(
      (e: React.PointerEvent<HTMLCanvasElement>) => {
        e.preventDefault();
        canvasRef.current?.setPointerCapture(e.pointerId);
        drawingRef.current = true;
        lastPointRef.current = getPoint(e);
      },
      [getPoint]
    );

    const handlePointerMove = useCallback(
      (e: React.PointerEvent<HTMLCanvasElement>) => {
        if (!drawingRef.current) return;
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext("2d");
        if (!canvas || !ctx || !lastPointRef.current) return;
        const point = getPoint(e);
        ctx.strokeStyle = "#111827";
        ctx.lineWidth = 2.5;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.beginPath();
        ctx.moveTo(lastPointRef.current.x, lastPointRef.current.y);
        ctx.lineTo(point.x, point.y);
        ctx.stroke();
        lastPointRef.current = point;
        if (!hasSignatureRef.current) {
          hasSignatureRef.current = true;
          onChange?.(true);
        }
      },
      [getPoint, onChange]
    );

    const handlePointerUp = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
      drawingRef.current = false;
      lastPointRef.current = null;
      canvasRef.current?.releasePointerCapture(e.pointerId);
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        toDataUrl: () => {
          if (!hasSignatureRef.current || !canvasRef.current) return null;
          return canvasRef.current.toDataURL("image/png");
        },
        clear: () => {
          const canvas = canvasRef.current;
          const ctx = canvas?.getContext("2d");
          if (canvas && ctx) paintWhiteBackground(ctx);
          hasSignatureRef.current = false;
          onChange?.(false);
        },
      }),
      [onChange]
    );

    return (
      <canvas
        ref={(node) => {
          canvasRef.current = node;
          if (node) {
            const ctx = node.getContext("2d");
            if (ctx) paintWhiteBackground(ctx);
          }
        }}
        width={CANVAS_WIDTH}
        height={CANVAS_HEIGHT}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        className="h-40 w-full touch-none rounded-xl border border-border bg-white"
        aria-label="אזור חתימה - יש לחתום באצבע או בעט על המסך"
      />
    );
  }
);
