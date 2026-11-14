import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Defer mounting expensive below-the-fold sections until they approach the
 * viewport. Falls back to immediate mount when IntersectionObserver is absent
 * (jsdom / very old browsers).
 */
export function LazyMount({
  children,
  minHeight = 320,
  rootMargin = "600px 0px",
}: {
  children: ReactNode;
  minHeight?: number;
  rootMargin?: string;
}) {
  const [active, setActive] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (active) return;
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setActive(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setActive(true);
          observer.disconnect();
        }
      },
      { rootMargin }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [active, rootMargin]);

  return (
    <div className="lazy-mount" ref={ref} style={active ? undefined : { minHeight }}>
      {active ? children : null}
    </div>
  );
}
