import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Icon } from "../shared/Icon";
import type { Lang } from "../i18n";
import type { BridgeHealth } from "../core/pi";

type BackendId = "mock" | "pi" | "deepseek";

export function BackendMenu(props: {
  backend: BackendId;
  lang: Lang;
  health: BridgeHealth | null;
  onBackend: (backend: BackendId) => void;
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
                if (!option.disabled) props.onBackend(option.id);
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
          <p className="backend-note">
            {props.health?.deepseek?.configured
              ? `${zh ? "deepseek 模型" : "model"} · ${props.health.deepseek.model}`
              : zh
              ? "deepseek 需要 DEEPSEEK_API_KEY 或 pi 的 deepseek-api 配置；pi 需要 pi bridge。"
              : "deepseek needs DEEPSEEK_API_KEY or pi's deepseek-api config; pi needs the bridge."}
          </p>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
