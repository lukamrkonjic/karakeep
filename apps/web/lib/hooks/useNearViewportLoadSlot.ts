import { useEffect, useRef, useState } from "react";

import type { LoadGate } from "@/lib/assetLoadGate";

/**
 * Combines "is this element near the viewport" (IntersectionObserver) with a
 * shared concurrency gate, so a tile only starts loading once it's both near
 * the viewport AND has been granted a slot. See assetLoadGate.ts for why the
 * gate exists.
 */
export function useNearViewportLoadSlot(
  gate: LoadGate,
  opts: { disabled?: boolean; rootMargin?: string } = {},
) {
  const { disabled = false, rootMargin = "300px" } = opts;
  const containerRef = useRef<HTMLDivElement>(null);
  const [nearViewport, setNearViewport] = useState(disabled);
  const [granted, setGranted] = useState(disabled);
  const releaseRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (nearViewport) return;
    const el = containerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNearViewport(true);
          observer.disconnect();
        }
      },
      { rootMargin },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [nearViewport, rootMargin]);

  useEffect(() => {
    if (!nearViewport || granted) return;
    const release = gate.acquire(() => setGranted(true));
    releaseRef.current = release;
    return () => {
      release();
      releaseRef.current = null;
    };
  }, [nearViewport, granted, gate]);

  const release = () => {
    releaseRef.current?.();
    releaseRef.current = null;
  };

  return { containerRef, granted, release };
}
