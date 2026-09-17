import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";

/**
 * Frame time, reported to a callback outside the canvas.
 *
 * PLAN.md asks for r3f-perf, but that package still depends on drei 9, which
 * wants React 18 — it cannot be installed alongside the stack this milestone
 * pins. This measures the two numbers that actually matter for the 60 fps budget
 * and costs one exponential moving average per frame.
 */
export interface FrameStats {
  readonly fps: number;
  readonly frameMs: number;
  readonly drawCalls: number;
  readonly triangles: number;
}

export function FrameMeter({
  onSample,
  intervalMs = 500,
}: {
  readonly onSample: (stats: FrameStats) => void;
  readonly intervalMs?: number;
}): null {
  const gl = useThree((state) => state.gl);
  const average = useRef(16.7);
  const lastReport = useRef(0);
  const lastFrame = useRef(0);

  useEffect(() => {
    lastFrame.current = performance.now();
  }, []);

  useFrame(() => {
    const now = performance.now();
    const delta = now - lastFrame.current;
    lastFrame.current = now;

    // Ignore the first frame and any tab-switch gap, which would otherwise
    // poison the average with a multi-second "frame".
    if (delta > 0 && delta < 500) {
      average.current = average.current * 0.9 + delta * 0.1;
    }

    if (now - lastReport.current < intervalMs) return;
    lastReport.current = now;

    onSample({
      fps: Math.round(1000 / average.current),
      frameMs: Math.round(average.current * 10) / 10,
      drawCalls: gl.info.render.calls,
      triangles: gl.info.render.triangles,
    });
  });

  return null;
}
