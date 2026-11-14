import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Icon } from "../shared/Icon";
import type { Lang } from "../i18n";
import { SCENARIOS, scenarioDetail, scenarioName, type DemoScenario } from "../core/demo-scenarios";

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
        <button className="embed-btn scenario-trigger" title={zh ? "切换演示场景" : "Switch demo scenario"}>
          <Icon name="layers" size={13} />
          <span className="scenario-trigger-label">{scenarioName(props.scenario, props.lang)}</span>
          <Icon name="chevron" size={11} className="scenario-chev" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="scenario-menu" sideOffset={8} align="end">
          {SCENARIOS.map((item) => (
            <DropdownMenu.Item
              key={item.id}
              className="scenario-item"
              data-active={item.id === props.scenario || undefined}
              onSelect={() => props.onScenario(item.id)}
            >
              <span className="scenario-item-main">
                <strong>{scenarioName(item.id, props.lang)}</strong>
                <span>{scenarioDetail(item.id, props.lang)}</span>
              </span>
              {item.id === props.scenario && <Icon name="check" size={13} />}
            </DropdownMenu.Item>
          ))}
          <p className="scenario-note">
            {zh
              ? "每个场景是一段真实 AG-UI 事件流：切换后模拟后端会重放对应事件。"
              : "Each scenario is a real AG-UI event stream replayed by the mock backend."}
          </p>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
