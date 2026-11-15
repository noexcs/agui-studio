import { Command } from "cmdk";
import { Icon } from "../shared/Icon";
import { t, type Lang } from "../i18n";

import type { StudioBackend } from "../core/store";

export type ShellBackend = StudioBackend;
export interface PaletteSkin {
  id: string;
  name: string;
  tagline: string;
}

/* Tailwind compounds (app.css cmdk migration, task-13). */
const KBD = "font-(--font-mono) text-[9px] text-[#8a8a94] rounded border border-[rgba(17,17,20,0.14)] px-1 py-px";
const ITEM = "cmdk-item flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-[12.5px] text-[#3f3f46] data-[selected=true]:text-[#6d28d9] data-[selected=true]:bg-[linear-gradient(100deg,rgba(124,58,237,0.1),rgba(124,58,237,0.05))]";
const GROUP_HEAD = "[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pt-[9px] [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-[9px] [&_[cmdk-group-heading]]:tracking-[0.16em] [&_[cmdk-group-heading]]:text-[#8a8a94] [&_[cmdk-group-heading]]:uppercase";
const HINT = "cmdk-hint ml-auto text-[10px] text-[#8a8a94] font-(--font-mono)";

/**
 * ⌘K palette. Behaviour (filtering, keyboard, focus, portal) comes from cmdk +
 * Radix Dialog; the visual layer is the utilities below. cmdk generates the
 * [cmdk-group-heading] elements and the selected item's [data-active] at
 * runtime, so those two are reached with arbitrary variants / descendant
 * selectors instead of per-element classes.
 */
export function CommandPalette(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  skins: PaletteSkin[];
  currentSkin: string;
  onSkin: (id: string) => void;
  lang: Lang;
  onLang: (lang: Lang) => void;
  backend: ShellBackend;
  onBackend: (backend: ShellBackend) => void;
  onReplay: () => void;
  onRunInfo: () => void;
  onCopyState: () => void;
  staticDemo?: boolean;
}) {
  const { open, onOpenChange } = props;
  const run = (fn: () => void) => () => {
    fn();
    onOpenChange(false);
  };

  return (
    <Command.Dialog
      open={open}
      onOpenChange={onOpenChange}
      label={t("palette.label")}
      className="cmdk-dialog"
      overlayClassName="cmdk-overlay fixed inset-0 z-[70] bg-[rgba(24,24,27,0.28)] backdrop-blur-[6px] animate-[fade_0.18s]"
      contentClassName="cmdk-content fixed left-1/2 top-[13vh] z-[71] flex max-h-[70vh] w-[min(620px,calc(100vw-32px))] -translate-x-1/2 flex-col overflow-hidden rounded-2xl border border-[rgba(17,17,20,0.12)] bg-white shadow-[0_50px_120px_-40px_rgba(24,24,27,0.3)] animate-[float-in_0.18s_cubic-bezier(0.16,1,0.3,1)]"
    >
      <div className="cmdk-search flex items-center gap-2.5 border-b border-[rgba(17,17,20,0.07)] px-4 py-3.5 text-[#8a8a94]">
        <Icon name="search" size={15} />
        <Command.Input className="cmdk-input flex-1 border-0 bg-none text-sm text-[#18181b] outline-none placeholder:text-[#8a8a94]" placeholder={t("palette.placeholder")} autoFocus />
        <kbd className={`cmdk-esc ${KBD}`}>esc</kbd>
      </div>

      <Command.List className="cmdk-list min-h-0 flex-1 overflow-y-auto p-1.5">
        <Command.Empty className="cmdk-empty p-[26px] text-center text-xs text-[#8a8a94]">{t("palette.empty")}</Command.Empty>

        <Command.Group heading={t("palette.skins")} className={`cmdk-group ${GROUP_HEAD}`}>
          {props.skins.map((skin, index) => (
            <Command.Item
              key={skin.id}
              value={`skin ${skin.name} ${skin.tagline}`}
              onSelect={run(() => props.onSkin(skin.id))}
              className={ITEM}
              data-active={skin.id === props.currentSkin || undefined}
            >
              <Icon name="layers" size={14} />
              <span className="cmdk-label after:ml-1.5 after:text-[#7c3aed] [.cmdk-item[data-active=true]_&]:after:content-['•']">{skin.name}</span>
              <span className={HINT}>{skin.tagline}</span>
              <kbd className={KBD}>{index + 1}</kbd>
            </Command.Item>
          ))}
        </Command.Group>

        <Command.Group heading={t("palette.language")} className={`cmdk-group ${GROUP_HEAD}`}>
          <Command.Item value="language zh 中文" onSelect={run(() => props.onLang("zh"))} className={ITEM} data-active={props.lang === "zh" || undefined}>
            <Icon name="globe" size={14} />
            <span className="cmdk-label after:ml-1.5 after:text-[#7c3aed] [.cmdk-item[data-active=true]_&]:after:content-['•']">中文</span>
            <span className={HINT}>zh</span>
          </Command.Item>
          <Command.Item value="language en english" onSelect={run(() => props.onLang("en"))} className={ITEM} data-active={props.lang === "en" || undefined}>
            <Icon name="globe" size={14} />
            <span className="cmdk-label after:ml-1.5 after:text-[#7c3aed] [.cmdk-item[data-active=true]_&]:after:content-['•']">English</span>
            <span className={HINT}>en</span>
          </Command.Item>
        </Command.Group>

        {!props.staticDemo && (
        <Command.Group heading={t("palette.backend")} className={`cmdk-group ${GROUP_HEAD}`}>
          <Command.Item value="backend mock 演示" onSelect={run(() => props.onBackend("mock"))} className={ITEM} data-active={props.backend === "mock" || undefined}>
            <Icon name="terminal" size={14} />
            <span className="cmdk-label after:ml-1.5 after:text-[#7c3aed] [.cmdk-item[data-active=true]_&]:after:content-['•']">{t("palette.backendMock")}</span>
            <span className={HINT}>mock</span>
          </Command.Item>
          <Command.Item value="backend pi live" onSelect={run(() => props.onBackend("pi"))} className={ITEM} data-active={props.backend === "pi" || undefined}>
            <Icon name="terminal" size={14} />
            <span className="cmdk-label after:ml-1.5 after:text-[#7c3aed] [.cmdk-item[data-active=true]_&]:after:content-['•']">{t("palette.backendPi")}</span>
            <span className={HINT}>rpc</span>
          </Command.Item>
          <Command.Item value="backend pi recorded fixture" onSelect={run(() => props.onBackend("fixture"))} className={ITEM} data-active={props.backend === "fixture" || undefined}>
            <Icon name="play" size={14} />
            <span className="cmdk-label after:ml-1.5 after:text-[#7c3aed] [.cmdk-item[data-active=true]_&]:after:content-['•']">{t("palette.backendRec")}</span>
            <span className={HINT}>rec</span>
          </Command.Item>
        </Command.Group>
        )}

        <Command.Group heading={t("palette.actions")} className={`cmdk-group ${GROUP_HEAD}`}>
          <Command.Item value="replay run 重播" onSelect={run(props.onReplay)} className={ITEM}>
            <Icon name="refresh" size={14} />
            <span className="cmdk-label after:ml-1.5 after:text-[#7c3aed] [.cmdk-item[data-active=true]_&]:after:content-['•']">{t("palette.replay")}</span>
            <kbd className={KBD}>R</kbd>
          </Command.Item>
          <Command.Item value="run details info 运行信息" onSelect={run(props.onRunInfo)} className={ITEM}>
            <Icon name="braces" size={14} />
            <span className="cmdk-label after:ml-1.5 after:text-[#7c3aed] [.cmdk-item[data-active=true]_&]:after:content-['•']">{t("palette.runInfo")}</span>
          </Command.Item>
          <Command.Item value="copy run state json 复制状态" onSelect={run(props.onCopyState)} className={ITEM}>
            <Icon name="copy" size={14} />
            <span className="cmdk-label after:ml-1.5 after:text-[#7c3aed] [.cmdk-item[data-active=true]_&]:after:content-['•']">{t("palette.copy")}</span>
          </Command.Item>
          <Command.Item
            value="docs ag-ui pi documentation"
            onSelect={run(() => window.open("https://docs.ag-ui.com/introduction", "_blank", "noreferrer"))}
            className={ITEM}
          >
            <Icon name="external-link" size={14} />
            <span className="cmdk-label after:ml-1.5 after:text-[#7c3aed] [.cmdk-item[data-active=true]_&]:after:content-['•']">{t("palette.docs")}</span>
          </Command.Item>
        </Command.Group>
      </Command.List>

      <div className="cmdk-foot flex items-center gap-3.5 border-t border-[rgba(17,17,20,0.07)] px-3.5 py-[9px] text-[10px] text-[#8a8a94]">
        <span><kbd className={KBD}>↑</kbd><kbd className={KBD}>↓</kbd> {t("palette.nav")}</span>
        <span><kbd className={KBD}>⏎</kbd> {t("palette.select")}</span>
        <span className="cmdk-brand ml-auto font-(--font-mono) text-[9px] tracking-[0.14em] text-[#a1a1aa] uppercase">AG-UI Studio</span>
      </div>
    </Command.Dialog>
  );
}
