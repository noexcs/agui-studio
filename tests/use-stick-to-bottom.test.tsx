import { act, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useRef } from "react";
import { useStickToBottom } from "../packages/agui-skins/src/shared/useStickToBottom";

/* The shared hook is a thin wrapper over use-stick-to-bottom that keeps the
   single-ref signature the skins attach with. jsdom has no layout, so the
   scroll metrics are pinned per element; scrolls run through the library's
   rAF-driven engine, so each step flushes real timers. */
const CLIENT_H = 400;
const flush = (ms = 80) => new Promise((resolve) => setTimeout(resolve, ms));
const atBottomOf = (scrollHeight: number) => scrollHeight - 1 - CLIENT_H;
const pinGeometry = (el: HTMLElement, scrollHeight: number) => {
  Object.defineProperty(el, "clientHeight", { configurable: true, value: CLIENT_H });
  Object.defineProperty(el, "scrollHeight", { configurable: true, value: scrollHeight });
  Object.defineProperty(el, "scrollTop", { configurable: true, writable: true, value: 0 });
};

function Harness(props: { onRef?: (ref: ReturnType<typeof useStickToBottom>) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const stick = useStickToBottom<HTMLDivElement>();
  props.onRef?.(stick);
  return (
    <div ref={stick} style={{ overflowY: "auto" }}>
      <div ref={host}>first</div>
    </div>
  );
}

describe("shared useStickToBottom (use-stick-to-bottom wrapper)", () => {
  it("follows content growth while the reader is at the bottom", async () => {
    const { container } = render(<Harness />);
    const scroller = container.firstElementChild as HTMLElement;
    pinGeometry(scroller, 1000);
    scroller.dispatchEvent(new Event("scroll"));
    await flush();

    act(() => {
      scroller.appendChild(document.createElement("div"));
    });
    Object.defineProperty(scroller, "scrollHeight", { configurable: true, value: 1400 });
    await flush();

    expect(scroller.scrollTop).toBe(atBottomOf(1400));
  });

  it("stops following once the reader scrolled up, resumes near the bottom", async () => {
    const { container } = render(<Harness />);
    const scroller = container.firstElementChild as HTMLElement;
    pinGeometry(scroller, 1000);
    // arm the engine's lastScrollTop at the bottom, so the next event is
    // recognisably an upward scroll
    scroller.scrollTop = atBottomOf(1000);
    scroller.dispatchEvent(new Event("scroll"));
    await flush();

    // reader scrolls up to inspect history
    scroller.scrollTop = 100;
    scroller.dispatchEvent(new Event("scroll"));
    await flush();

    act(() => {
      scroller.appendChild(document.createElement("div"));
    });
    Object.defineProperty(scroller, "scrollHeight", { configurable: true, value: 1400 });
    await flush();
    expect(scroller.scrollTop).toBe(100);

    // scrolling back down within the near-bottom threshold re-arms the pin
    scroller.scrollTop = atBottomOf(1400);
    scroller.dispatchEvent(new Event("scroll"));
    await flush();
    act(() => {
      scroller.appendChild(document.createElement("div"));
    });
    Object.defineProperty(scroller, "scrollHeight", { configurable: true, value: 1800 });
    await flush();
    expect(scroller.scrollTop).toBe(atBottomOf(1800));
  });

  it("exposes isAtBottom / stopScroll / scrollToBottom helpers", async () => {
    let handle: ReturnType<typeof useStickToBottom> | undefined;
    const { container } = render(<Harness onRef={(ref) => (handle = ref)} />);
    const scroller = container.firstElementChild as HTMLElement;
    pinGeometry(scroller, 1000);
    expect(handle!.isAtBottom()).toBe(true);

    act(() => {
      handle!.stopScroll();
    });
    expect(handle!.isAtBottom()).toBe(false);

    scroller.scrollTop = atBottomOf(1000);
    scroller.dispatchEvent(new Event("scroll"));
    await flush();
    expect(handle!.isAtBottom()).toBe(true);

    act(() => {
      handle!.stopScroll();
      handle!.scrollToBottom();
    });
    await flush();
    expect(handle!.isAtBottom()).toBe(true);
  });
});
