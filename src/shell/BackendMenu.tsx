import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Icon } from "../shared/Icon";
import type { Lang } from "../i18n";
import type { BridgeHealth } from "../core/pi";
import type { StudioBackend } from "../core/store";

type BackendId = StudioBackend;

export function BackendMenu(props: {
  backend: BackendId;
  lang: Lang;
  health: BridgeHealth | null;
  onBackend: (backend: BackendId) => void;
  agentEndpoint?: string | null;
  onConfigureAgent: () => void;
  triggerClassName?: string;
}) {
  const zh = props.lang === "zh";
  const options: { id: BackendId; label: string; hint: string; disabled?: boolean }[] = [
    { id: "mock", label: zh ? "演示" : "mock", hint: zh ? "脚本化事件流" : "scripted event stream" },
    {
      id: "pi",
      label: "pi",
      hint: zh ? "pi CLI · 真实模型" : "pi CLI · real model",
      disabled: !props.health?.pi,
    },
    {
      id: "deepseek",
      label: "deepseek",
      hint: zh ? "DeepSeek API · 真实 AG-UI 流" : "DeepSeek API · live AG-UI stream",
      disabled: !props.health?.deepseek?.configured,
    },
    {
      id: "deepagent",
      label: "deep agent",
      hint: zh ? "LangGraph · 官方 AG-UI 适配器" : "LangGraph · official AG-UI adapter",
      disabled: !props.health?.deepagent?.reachable,
    },
    {
      id: "agui",
      label: zh ? "AG-UI 直连" : "direct AG-UI",
      hint: props.agentEndpoint || (zh ? "任意 POST RunAgentInput + SSE 服务" : "any POST RunAgentInput + SSE service"),
    },
  ];
  const current = options.find((option) => option.id === props.backend) ?? options[0];

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          className={`${props.triggerClassName ?? "embed-btn"} backend-trigger`}
          title={zh ? "切换后端" : "Switch backend"}
        >
          <Icon name="terminal" size={13} />
          <span>{current.label}</span>
          <Icon name="chevron" size={11} className="backend-chev" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="backend-menu" sideOffset={8} align="end">
          {options.map((option) => (
            <DropdownMenu.Item
              key={option.id}
              className="backend-item"
              data-active={option.id === props.backend || undefined}
              disabled={option.disabled}
              onSelect={() => {
                if (option.disabled) return;
                if (option.id === "agui" && !props.agentEndpoint) props.onConfigureAgent();
                else props.onBackend(option.id);
              }}
            >
              <span className="backend-item-main">
                <strong>{option.label}</strong>
                <span>{option.hint}</span>
              </span>
              {option.disabled ? (
                <span className="backend-item-off">{zh ? "不可用" : "offline"}</span>
              ) : option.id === props.backend ? (
                <Icon name="check" size={13} />
              ) : null}
            </DropdownMenu.Item>
          ))}
          <DropdownMenu.Item
            className="backend-item"
            onSelect={() => props.onConfigureAgent()}
          >
            <span className="backend-item-main">
              <strong>{zh ? "配置 AG-UI 端点" : "Configure AG-UI endpoint"}</strong>
              <span>{zh ? "填任意兼容 AG-UI 的 POST/SSE 地址" : "any AG-UI compatible POST/SSE URL"}</span>
            </span>
            <Icon name="external-link" size={12} />
          </DropdownMenu.Item>
          <p className="backend-note">
            {props.health?.deepagent?.reachable
              ? `${zh ? "deep agent" : "deep agent"} · ${props.health.deepagent.graphId} @ ${props.health.deepagent.deploymentUrl}`
              : props.health?.deepseek?.configured
              ? `${zh ? "deepseek 模型" : "model"} · ${props.health.deepseek.model}`
              : zh
              ? "deep agent 需要 langgraph dev；deepseek 需要 DEEPSEEK_API_KEY；pi 需要 pi bridge。"
              : "deep agent needs langgraph dev; deepseek needs DEEPSEEK_API_KEY; pi needs the bridge."}
          </p>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
