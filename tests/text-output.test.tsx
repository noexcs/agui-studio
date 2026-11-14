import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { skins, SkinHostProvider } from "agui-skins";
import type { SkinTextAnim } from "agui-skins";
import { makeFixture } from "./fixture";

afterEach(cleanup);

const BRANDING = { agentName: "Fixture Agent", modelLabel: "fixture-model" };

function renderClassic(textAnim?: SkinTextAnim) {
  const Page = skins.find((skin) => skin.id === "classic")!.ChatPage;
  return render(
    <SkinHostProvider
      conversation={makeFixture()}
      lang="en"
      branding={BRANDING}
      tuning={textAnim ? { textAnim } : undefined}
    >
      <Page />
    </SkinHostProvider>
  );
}

describe("universal streaming text output", () => {
  it("tokenizes markdown only when an effect is selected", () => {
    const plain = renderClassic();
    expect(plain.container.querySelectorAll(".sk-text-token")).toHaveLength(0);
    plain.unmount();

    const blurred = renderClassic("blur");
    expect(blurred.container.querySelectorAll(".sk-text-token").length).toBeGreaterThan(0);
    blurred.unmount();
  });

  it("typewriter splits characters (more tokens than word mode)", () => {
    const words = renderClassic("fade");
    const wordCount = words.container.querySelectorAll(".sk-text-token").length;
    words.unmount();

    const chars = renderClassic("typewriter");
    const charCount = chars.container.querySelectorAll(".sk-text-token").length;
    expect(charCount).toBeGreaterThan(wordCount);
    chars.unmount();
  });
});
