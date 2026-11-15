import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Icon } from "../shared/Icon";
import type { Lang } from "../i18n";
import { SCENARIOS, scenarioDetail, scenarioName, type DemoScenario } from "../core/demo-scenarios";

/* Tailwind compounds (app.css migration, task-13). */
const T = "duration-(--t-fast) ease-(--ease)";
const EMBED_TRIGGER = `embed-btn scenario-trigger inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-[10px] border border-transparent bg-none px-3 font-(family-name:--font-mono) text-[10px] tracking-[0.04em] text-(--fg-muted) transition-[color,background,border-color,transform] hover:bg-[rgba(0,0,0,0.04)] hover:border-(--hairline) hover:text-(--fg) active:scale-[0.98] ${T}`;
const MENU_ITEM = "scenario-item flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-[#3f3f46] outline-none hover:bg-[rgba(0,0,0,0.04)] hover:text-[#18181b] data-[highlighted]:bg-[rgba(0,0,0,0.04)] data-[highlighted]:text-[#18181b] data-[active]:bg-[rgba(124,58,237,0.1)] data-[active]:text-[#6d28d9]";

/** Demo-scenario picker (which scripted AG-UI run the mock backend replays). */
export function ScenarioMenu(props: {
  scenario: DemoScenario;
  lang: Lang;
  onScenario: (scenario: DemoScenario) => void;
}) {
  const zh = props.lang === "zh";
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button className={EMBED_TRIGGER} title={zh ? "切换演示场景" : "Switch demo scenario"}>
          <Icon name="layers" size={13} />
          <span className="scenario-trigger-label">{scenarioName(props.scenario, props.lang)}</span>
          <Icon name="chevron" size={11} className="scenario-chev rotate-90 opacity-65" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="scenario-menu z-[90] min-w-[248px] max-w-[min(340px,calc(100vw-32px))] rounded-xl border border-[rgba(17,17,20,0.12)] bg-[rgba(255,255,255,0.97)] p-2 shadow-[0_24px_60px_-24px_rgba(24,24,27,0.28)] backdrop-blur-[14px] animate-[qs-menu-in_120ms_var(--ease,ease)]"
          sideOffset={8}
          align="end"
        >
          {SCENARIOS.map((item) => (
            <DropdownMenu.Item
              key={item.id}
              className={MENU_ITEM}
              data-active={item.id === props.scenario || undefined}
              onSelect={() => props.onScenario(item.id)}
            >
              <span className="scenario-item-main flex min-w-0 flex-col gap-0.5">
                <strong className="text-[12.5px] font-semibold">{scenarioName(item.id, props.lang)}</strong>
                <span className="text-[10.5px] text-[#8a8a94]">{scenarioDetail(item.id, props.lang)}</span>
              </span>
              {item.id === props.scenario && <Icon name="check" size={13} />}
            </DropdownMenu.Item>
          ))}
          <p className="scenario-note mx-2.5 mb-1 mt-1.5 border-t border-[rgba(17,17,20,0.08)] pt-2 text-[10px] leading-[1.5] text-[#8a8a94]">
            {zh
              ? "每个场景是一段真实 AG-UI 事件流：切换后模拟后端会重放对应事件。"
              : "Each scenario is a real AG-UI event stream replayed by the mock backend."}
          </p>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
