import { Command } from "cmdk";
import { Icon } from "../shared/Icon";
import { t, type Lang } from "../i18n";

export type ShellBackend = "mock" | "pi" | "fixture";
export interface PaletteSkin {
  id: string;
  name: string;
  tagline: string;
}

/**
 * ⌘K palette. Behaviour (filtering, keyboard, focus, portal) comes from cmdk +
 * Radix Dialog; the visual layer is `.cmdk-*` in app.css.
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
      overlayClassName="cmdk-overlay"
      contentClassName="cmdk-content"
    >
      <div className="cmdk-search">
        <Icon name="search" size={15} />
        <Command.Input className="cmdk-input" placeholder={t("palette.placeholder")} autoFocus />
        <kbd className="cmdk-esc">esc</kbd>
      </div>

      <Command.List className="cmdk-list">
        <Command.Empty className="cmdk-empty">{t("palette.empty")}</Command.Empty>

        <Command.Group heading={t("palette.skins")} className="cmdk-group">
          {props.skins.map((skin, index) => (
            <Command.Item
              key={skin.id}
              value={`skin ${skin.name} ${skin.tagline}`}
              onSelect={run(() => props.onSkin(skin.id))}
              className="cmdk-item"
              data-active={skin.id === props.currentSkin || undefined}
            >
              <Icon name="layers" size={14} />
              <span className="cmdk-label">{skin.name}</span>
              <span className="cmdk-hint">{skin.tagline}</span>
              <kbd>{index + 1}</kbd>
            </Command.Item>
          ))}
        </Command.Group>

        <Command.Group heading={t("palette.language")} className="cmdk-group">
          <Command.Item value="language zh 中文" onSelect={run(() => props.onLang("zh"))} className="cmdk-item" data-active={props.lang === "zh" || undefined}>
            <Icon name="globe" size={14} />
            <span className="cmdk-label">中文</span>
            <span className="cmdk-hint">zh</span>
          </Command.Item>
          <Command.Item value="language en english" onSelect={run(() => props.onLang("en"))} className="cmdk-item" data-active={props.lang === "en" || undefined}>
            <Icon name="globe" size={14} />
            <span className="cmdk-label">English</span>
            <span className="cmdk-hint">en</span>
          </Command.Item>
        </Command.Group>

        {!props.staticDemo && (
        <Command.Group heading={t("palette.backend")} className="cmdk-group">
          <Command.Item value="backend mock 演示" onSelect={run(() => props.onBackend("mock"))} className="cmdk-item" data-active={props.backend === "mock" || undefined}>
            <Icon name="terminal" size={14} />
            <span className="cmdk-label">{t("palette.backendMock")}</span>
            <span className="cmdk-hint">mock</span>
          </Command.Item>
          <Command.Item value="backend pi live" onSelect={run(() => props.onBackend("pi"))} className="cmdk-item" data-active={props.backend === "pi" || undefined}>
            <Icon name="terminal" size={14} />
            <span className="cmdk-label">{t("palette.backendPi")}</span>
            <span className="cmdk-hint">rpc</span>
          </Command.Item>
          <Command.Item value="backend pi recorded fixture" onSelect={run(() => props.onBackend("fixture"))} className="cmdk-item" data-active={props.backend === "fixture" || undefined}>
            <Icon name="play" size={14} />
            <span className="cmdk-label">{t("palette.backendRec")}</span>
            <span className="cmdk-hint">rec</span>
          </Command.Item>
        </Command.Group>
        )}

        <Command.Group heading={t("palette.actions")} className="cmdk-group">
          <Command.Item value="replay run 重播" onSelect={run(props.onReplay)} className="cmdk-item">
            <Icon name="refresh" size={14} />
            <span className="cmdk-label">{t("palette.replay")}</span>
            <kbd>R</kbd>
          </Command.Item>
          <Command.Item value="run details info 运行信息" onSelect={run(props.onRunInfo)} className="cmdk-item">
            <Icon name="braces" size={14} />
            <span className="cmdk-label">{t("palette.runInfo")}</span>
          </Command.Item>
          <Command.Item value="copy run state json 复制状态" onSelect={run(props.onCopyState)} className="cmdk-item">
            <Icon name="copy" size={14} />
            <span className="cmdk-label">{t("palette.copy")}</span>
          </Command.Item>
          <Command.Item
            value="docs ag-ui pi documentation"
            onSelect={run(() => window.open("https://docs.ag-ui.com/introduction", "_blank", "noreferrer"))}
            className="cmdk-item"
          >
            <Icon name="external-link" size={14} />
            <span className="cmdk-label">{t("palette.docs")}</span>
          </Command.Item>
        </Command.Group>
      </Command.List>

      <div className="cmdk-foot">
        <span><kbd>↑</kbd><kbd>↓</kbd> {t("palette.nav")}</span>
        <span><kbd>⏎</kbd> {t("palette.select")}</span>
        <span className="cmdk-brand">AG-UI Studio</span>
      </div>
    </Command.Dialog>
  );
}
