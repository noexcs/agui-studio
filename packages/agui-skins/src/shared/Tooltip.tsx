import * as RadixTooltip from "@radix-ui/react-tooltip";
import type { ReactElement, ReactNode } from "react";

export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <RadixTooltip.Provider delayDuration={280} skipDelayDuration={80}>
      {children}
    </RadixTooltip.Provider>
  );
}

/** Thin wrapper: behaviour from Radix, appearance from .tip in app.css. */
export function Tip({
  label,
  children,
  side = "right",
}: {
  label: string;
  children: ReactElement;
  side?: "top" | "right" | "bottom" | "left";
}) {
  return (
    <RadixTooltip.Root>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content className="tip" side={side} sideOffset={8} collisionPadding={8}>
          {label}
          <RadixTooltip.Arrow className="tip-arrow" width={10} height={5} />
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}
