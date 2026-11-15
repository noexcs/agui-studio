import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CustomizePanel } from "../src/app/CustomizePanel";

const renderPanel = (tuning = {}) => {
  const onChange = vi.fn();
  const utils = render(
    <CustomizePanel open variant="inline" skinName="Classic" tuning={tuning} onChange={onChange} />
  );
  return { onChange, ...utils };
};

describe("inline customize panel", () => {
  it("is rendered expanded with all controls", () => {
    const { container } = renderPanel();
    const panel = container.querySelector(".customize--inline");
    expect(panel).toBeTruthy();
    expect(panel?.textContent).toContain("Customize");
    expect(panel?.textContent).toContain("Accent color");
    expect(panel?.textContent).toContain("Text output");
    expect(panel?.textContent).toContain("Density");
    expect(panel?.textContent).toContain("Presets");
  });

  it("applies a preset in one click", () => {
    const { onChange, getByText } = renderPanel();
    fireEvent.click(getByText("Warm"));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ accent: "#d97706", textAnim: "fade", density: "comfortable" })
    );
  });

  it("resets to skin defaults", () => {
    const { onChange, getByText } = renderPanel({ accent: "#db2777", textAnim: "rise" });
    fireEvent.click(getByText("Reset"));
    expect(onChange).toHaveBeenCalledWith({});
  });
});

describe("theme control gating", () => {
  const renderPanel = (tuning: Parameters<typeof CustomizePanel>[0]["tuning"], skinId?: string) => {
    const onChange = vi.fn();
    const utils = render(<CustomizePanel open variant="inline" skinId={skinId} skinName="Skin" tuning={tuning} onChange={onChange} />);
    return { onChange, ...utils };
  };

  it("shows the theme segment only for skins declaring tuningSupport.theme", () => {
    const wb = renderPanel({}, "workbench");
    expect(wb.container.querySelector('[data-testid="theme-tile"]')).toBeTruthy();
    expect(wb.container.textContent).toContain("Theme");
    wb.unmount();
    const aurora = renderPanel({}, "aurora");
    expect(aurora.container.querySelector('[data-testid="theme-tile"]')).toBeNull();
    aurora.unmount();
    const unknown = renderPanel({});
    expect(unknown.container.querySelector('[data-testid="theme-tile"]')).toBeNull();
  });

  it("switching the theme calls onChange with the picked value", () => {
    const { onChange, getByText } = renderPanel({}, "workbench");
    fireEvent.click(getByText("Light"));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ theme: "light" }));
  });

  it("presets never rewrite an explicit theme choice", () => {
    const { onChange, getByText } = renderPanel({ theme: "light", density: "compact" }, "workbench");
    fireEvent.click(getByText("Warm"));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ accent: "#d97706", theme: "light" }));
  });
});
