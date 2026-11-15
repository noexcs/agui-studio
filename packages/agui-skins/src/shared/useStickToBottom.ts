import { useCallback, useEffect, useRef } from "react";
import { useStickToBottom as useStickToBottomLibrary } from "use-stick-to-bottom";

/** Escape hatch helpers layered onto the returned ref (all optional to use). */
export interface StickToBottomHelpers {
  /** Force a scroll to the bottom (respects the escape state by default). */
  scrollToBottom: () => void;
  /** Release the stick lock until the reader scrolls back down. */
  stopScroll: () => void;
  /** True while the reader has not scrolled away from the bottom. */
  isAtBottom: () => boolean;
}

/**
 * Keeps a scroll container pinned to the newest content, unless the reader
 * has scrolled up. Skins share this so scroll behaviour stays identical.
 *
 * Thin wrapper over use-stick-to-bottom (samdenty) that keeps the shared
 * single-ref signature every skin consumes: the returned value is a ref
 * callback to attach on the scroll container. The library wants its
 * contentRef on one content element so its ResizeObserver can see growth —
 * but the skins' scrollers hold fragment children (empty states, "load
 * earlier" buttons, entry lists), and adding wrapper elements would ripple
 * through nine skins' CSS. So both library refs are pointed at the scroller
 * itself (the target-height getters require both), and growth detection is
 * done here instead: the scroller's direct children are observed with a
 * ResizeObserver, re-observed on childList changes via a MutationObserver,
 * and each growth is handed to the library's scroll engine
 * (`scrollToBottom({ wait: true, preserveScrollPosition: true })` — scroll
 * only while the reader is at the bottom, queue behind running scrolls).
 *
 * `resize`/`initial` are pinned to "instant": streaming growth keeps the
 * previous jump-to-bottom feel, and the spring animation the library
 * defaults to would visibly lag behind the studio's 20fps demo replay.
 * Escape-on-scroll-up, re-stick on scroll-down and content-shrink handling
 * come from the library's state machine (its near-bottom threshold is ~70px
 * versus the hand-rolled 140px).
 */
export function useStickToBottom<T extends HTMLElement>() {
  const library = useStickToBottomLibrary({ resize: "instant", initial: "instant" });
  // The library object is recreated each render; callbacks and the observer
  // effect must stay stable, so they read the latest one through a ref.
  const latest = useRef(library);
  latest.current = library;
  const node = useRef<T | null>(null);

  useEffect(() => {
    const scroller = node.current;
    if (!scroller) return;
    if (typeof ResizeObserver === "undefined" || typeof MutationObserver === "undefined") return;

    const growth = () => {
      void latest.current.scrollToBottom({
        wait: true,
        preserveScrollPosition: true,
        animation: "instant",
      });
    };
    const resizeObserver = new ResizeObserver(growth);
    const observeChildren = () => {
      for (const child of Array.from(scroller.children)) {
        resizeObserver.observe(child);
      }
    };
    const mutationObserver = new MutationObserver(() => {
      // observing an already-observed element is a no-op, so this is cheap
      observeChildren();
      growth();
    });

    observeChildren();
    mutationObserver.observe(scroller, { childList: true });
    return () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
  }, []);

  const attach = useCallback((value: T | null) => {
    node.current = value;
    // The library's scroll state machine (scroll/wheel listeners, escape
    // handling) lives on scrollRef; its height getters refuse to compute a
    // target while contentRef is unset, so both point at the scroller.
    latest.current.scrollRef(value);
    latest.current.contentRef(value);
  }, []);

  return Object.assign(attach, {
    scrollToBottom: () => void latest.current.scrollToBottom(),
    stopScroll: () => latest.current.stopScroll(),
    isAtBottom: () => latest.current.isAtBottom,
  }) as unknown as ((value: T | null) => void) & StickToBottomHelpers;
}
