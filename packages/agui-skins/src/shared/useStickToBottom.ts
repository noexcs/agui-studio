import { useEffect, useRef } from "react";

/**
 * Keeps a scroll container pinned to the newest content, unless the reader
 * has scrolled up. Re-runs on every render, which is exactly what streaming
 * text needs. Skins share this so scroll behaviour stays identical.
 */
export function useStickToBottom<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const stick = useRef(true);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => {
      stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el || !stick.current) return;
    el.scrollTop = el.scrollHeight;
  });

  return ref;
}
