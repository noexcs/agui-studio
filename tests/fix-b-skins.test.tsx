import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { skins, SkinHostProvider, t } from "agui-skins";
import type { SkinConversation } from "agui-skins";
import { ConversationStore, type InterruptEntry, type ToolEntry } from "../src/core/store";
import { EventType } from "../src/core/events";

/* ── Fix B: edit parameters must never cross interrupts. With two pending
   cards, editing card A must not touch card B, and card B must submit its
   own args. Covered for the three skins that expose an edit flow
   (aurora / classic / paper). ──────────────────────────────────────── */

afterEach(cleanup);

const BRANDING = { agentName: "Fixture Agent", modelLabel: "fixture-model" };
const skinById = (id: string) => skins.find((s) => s.id === id)!;

const ARGS_A = { hotel: "Hotel Atlantico", nights: 2 };
const ARGS_B = { hotel: "Hotel Bairro", nights: 3 };

/** Two tool calls with distinct args, both held open by a pending interrupt. */
function makeTwoPendingStore(): ConversationStore {
  const store = new ConversationStore(false);
  const dispatch = (event: Record<string, unknown>) => store.dispatch(event as never);
  dispatch({ type: EventType.RUN_STARTED, threadId: "t1", runId: "r1" });
  const calls: [string, Record<string, unknown>][] = [
    ["tc_a", ARGS_A],
    ["tc_b", ARGS_B],
  ];
  for (const [id, args] of calls) {
    dispatch({ type: EventType.TOOL_CALL_START, toolCallId: id, toolCallName: "booking.hold" });
    dispatch({ type: EventType.TOOL_CALL_ARGS, toolCallId: id, delta: JSON.stringify(args) });
    dispatch({ type: EventType.TOOL_CALL_END, toolCallId: id });
  }
  dispatch({
    type: EventType.RUN_FINISHED,
    outcome: {
      type: "interrupt",
      interrupts: [
        { id: "i1", reason: "tool_call", toolCallId: "tc_a", message: "fixture approval one", details: [] },
        { id: "i2", reason: "tool_call", toolCallId: "tc_b", message: "fixture approval two", details: [] },
      ],
    },
  });
  return store;
}

function renderSkin(id: string, conversation: SkinConversation) {
  const Page = skinById(id).ChatPage;
  return render(
    <SkinHostProvider conversation={conversation} lang="zh" branding={BRANDING}>
      <Page />
    </SkinHostProvider>
  );
}

const CARD: Record<string, string> = {
  aurora: ".interrupt",
  classic: ".cl-approval",
  paper: ".pap-slip",
};
const EDIT_BOX: Record<string, string> = {
  aurora: ".interrupt-edit textarea",
  classic: ".cl-edit textarea",
  paper: ".pap-amend textarea",
};

function cardByMessage(container: HTMLElement, skinId: string, message: string): HTMLElement {
  const card = Array.from(container.querySelectorAll(CARD[skinId])).find((el) => el.textContent?.includes(message));
  if (!card) throw new Error(`pending card for "${message}" not found`);
  return card as HTMLElement;
}

function buttonByText(root: HTMLElement, text: string): HTMLButtonElement {
  const buttons = Array.from(root.querySelectorAll("button")) as HTMLButtonElement[];
  const button =
    buttons.find((b) => (b.textContent ?? "").trim() === text) ?? buttons.find((b) => (b.textContent ?? "").includes(text));
  if (!button) throw new Error(`button "${text}" not found`);
  return button;
}

const pendingInterrupts = (store: ConversationStore) => store.pendingInterrupts().map((i) => i.id);

/** Plain-approve / approve-with-edits button labels differ per skin.
    Resolved lazily: the provider pins the locale during render. */
const APPROVE_LABEL: Record<string, () => string> = {
  aurora: () => t("intr.approve"),
  classic: () => t("intr.approve"),
  paper: () => t("paper.sign"),
};
const APPROVE_EDITED_LABEL: Record<string, () => string> = {
  aurora: () => t("intr.approveEdited"),
  classic: () => t("intr.approveEdited"),
  paper: () => t("paper.signEdit"),
};

describe.each(["aurora", "classic", "paper"] as const)("Fix B: edit isolation in %s", (skinId) => {
  afterEach(() => {
    cleanup();
  });

  it("opens the editor only on the card being edited", () => {
    const store = makeTwoPendingStore();
    const { container } = renderSkin(skinId, store);
    expect(container.querySelectorAll(EDIT_BOX[skinId])).toHaveLength(0);

    fireEvent.click(buttonByText(cardByMessage(container, skinId, "approval one"), t("intr.edit")));

    const boxes = container.querySelectorAll(EDIT_BOX[skinId]);
    expect(boxes).toHaveLength(1);
    expect(cardByMessage(container, skinId, "approval one").querySelector("textarea")).toBeTruthy();
    expect(cardByMessage(container, skinId, "approval two").querySelector("textarea")).toBeNull();
    expect(pendingInterrupts(store)).toEqual(["i1", "i2"]);
    store.stop();
  });

  it("approving card B while card A's editor is open submits B without A's draft", () => {
    const store = makeTwoPendingStore();
    const spy = vi.spyOn(store, "resolveInterrupt");
    const { container } = renderSkin(skinId, store);

    // open card A's editor and type a draft
    const cardA = cardByMessage(container, skinId, "approval one");
    fireEvent.click(buttonByText(cardA, t("intr.edit")));
    const textarea = container.querySelector(EDIT_BOX[skinId]) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '{"hotel":"A was edited"}' } });

    // card A submits its own edited draft
    fireEvent.click(buttonByText(cardA, APPROVE_EDITED_LABEL[skinId]()));
    expect(spy).toHaveBeenCalledWith(true, { hotel: "A was edited" }, "i1");

    // card B is still pending — plain approve must NOT reuse card A's draft
    const cardB = cardByMessage(container, skinId, "approval two");
    fireEvent.click(buttonByText(cardB, APPROVE_LABEL[skinId]()));
    expect(spy).toHaveBeenLastCalledWith(true, undefined, "i2");
    expect(spy).toHaveBeenCalledTimes(2);
    expect(store.pendingInterrupts()).toHaveLength(0);

    store.stop();
    spy.mockRestore();
  });

  it("seeds and submits card B's own args", () => {
    const store = makeTwoPendingStore();
    const spy = vi.spyOn(store, "resolveInterrupt");
    const { container } = renderSkin(skinId, store);

    fireEvent.click(buttonByText(cardByMessage(container, skinId, "approval two"), t("intr.edit")));
    const textarea = container.querySelector(EDIT_BOX[skinId]) as HTMLTextAreaElement;
    expect(JSON.parse(textarea.value)).toEqual(ARGS_B);

    fireEvent.click(buttonByText(cardByMessage(container, skinId, "approval two"), APPROVE_EDITED_LABEL[skinId]()));
    expect(spy).toHaveBeenCalledWith(true, ARGS_B, "i2");
    // card A was never touched; the held tool stays paused — the run only
    // resumes once every pending interrupt is resolved
    const interrupts = store.entries.filter((e): e is InterruptEntry => e.kind === "interrupt");
    expect(interrupts.find((i) => i.id === "i1")?.status).toBe("pending");
    expect(interrupts.find((i) => i.id === "i2")?.status).toBe("approved");
    expect((store.entries.find((e) => e.kind === "tool" && (e as ToolEntry).id === "tc_b") as ToolEntry).status).toBe("interrupted");

    store.stop();
    spy.mockRestore();
  });
});
