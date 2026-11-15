import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Icon } from "../shared/Icon";
import type { Lang } from "../i18n";
import type { BridgeHealth } from "../core/pi";
import type { StudioBackend } from "../core/store";

type BackendId = StudioBackend;

/* Tailwind compounds (app.css migration, task-13). */
const T = "duration-(--t-fast) ease-(--ease)";
const DEFAULT_TRIGGER = `embed-btn inline-flex h-7 cursor-pointer items-center gap-1 rounded-[10px] border border-transparent bg-none px-3 font-(family-name:--font-mono) text-[10px] tracking-[0.04em] text-(--fg-muted) transition-[color,background,border-color,transform] hover:bg-[rgba(0,0,0,0.04)] hover:border-(--hairline) hover:text-(--fg) active:scale-[0.98] ${T}`;
/* data-[active] carries the trailing `!`: arbitrary data variants sort alphabetically
   (data-[active] < data-[highlighted]), but base CSS had the [data-active] rule AFTER
   [data-highlighted] — an item both highlighted and active must show violet */
const MENU_ITEM = "backend-item flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-[#3f3f46] outline-none hover:bg-[rgba(0,0,0,0.04)] hover:text-[#18181b] data-[highlighted]:bg-[rgba(0,0,0,0.04)] data-[highlighted]:text-[#18181b] data-[active]:bg-[rgba(124,58,237,0.1)]! data-[active]:text-[#6d28d9]! data-[disabled]:opacity-45 data-[disabled]:cursor-not-allowed";

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
          className={props.triggerClassName ? `${props.triggerClassName} backend-trigger` : `${DEFAULT_TRIGGER} backend-trigger`}
          title={zh ? "切换后端" : "Switch backend"}
        >
          <Icon name="terminal" size={13} />
          <span>{current.label}</span>
          <Icon name="chevron" size={11} className="backend-chev rotate-90 opacity-60" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="backend-menu z-[90] min-w-[236px] max-w-[min(320px,calc(100vw-32px))] rounded-xl border border-[rgba(17,17,20,0.12)] bg-[rgba(255,255,255,0.97)] p-2 shadow-[0_24px_60px_-24px_rgba(24,24,27,0.28)] backdrop-blur-[14px]"
          sideOffset={8}
          align="end"
        >
          {options.map((option) => (
            <DropdownMenu.Item
              key={option.id}
              className={MENU_ITEM}
              data-active={option.id === props.backend || undefined}
              disabled={option.disabled}
              onSelect={() => {
                if (option.disabled) return;
                if (option.id === "agui" && !props.agentEndpoint) props.onConfigureAgent();
                else props.onBackend(option.id);
              }}
            >
              <span className="backend-item-main flex min-w-0 flex-col gap-0.5">
                <strong className="text-[12.5px] font-semibold">{option.label}</strong>
                <span className="text-[10.5px] text-[#8a8a94]">{option.hint}</span>
              </span>
              {option.disabled ? (
                <span className="backend-item-off ml-auto text-[9.5px] text-[#8a8a94]">{zh ? "不可用" : "offline"}</span>
              ) : option.id === props.backend ? (
                <Icon name="check" size={13} />
              ) : null}
            </DropdownMenu.Item>
          ))}
          <DropdownMenu.Item
            className={MENU_ITEM}
            onSelect={() => props.onConfigureAgent()}
          >
            <span className="backend-item-main flex min-w-0 flex-col gap-0.5">
              <strong className="text-[12.5px] font-semibold">{zh ? "配置 AG-UI 端点" : "Configure AG-UI endpoint"}</strong>
              <span className="text-[10.5px] text-[#8a8a94]">{zh ? "填任意兼容 AG-UI 的 POST/SSE 地址" : "any AG-UI compatible POST/SSE URL"}</span>
            </span>
            <Icon name="external-link" size={12} />
          </DropdownMenu.Item>
          <p className="backend-note mx-2.5 mb-1 mt-1.5 border-t border-[rgba(17,17,20,0.08)] pt-2 text-[10px] leading-[1.5] text-[#8a8a94]">
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
