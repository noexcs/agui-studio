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
