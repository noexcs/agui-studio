import { Icon, accentGuard, getSkin, type AccentGuard } from "agui-skins";
import { isZh } from "../i18n";
import type { SkinDensity, SkinMotion, SkinRadius, SkinTextAnim, SkinTextScale, SkinTheme, SkinTuning } from "agui-skins";

const ACCENTS = [
  { hex: "#2563eb", zh: "经典蓝", en: "Blue" },
  { hex: "#7c3aed", zh: "紫罗兰", en: "Violet" },
  { hex: "#0891b2", zh: "青色", en: "Cyan" },
  { hex: "#059669", zh: "翡翠绿", en: "Emerald" },
  { hex: "#d97706", zh: "琥珀", en: "Amber" },
  { hex: "#dc2626", zh: "朱红", en: "Red" },
  { hex: "#db2777", zh: "玫红", en: "Pink" },
  { hex: "#0f172a", zh: "墨黑", en: "Ink" },
];

const TEXT_ANIMS: { value: SkinTextAnim; zh: string; en: string }[] = [
  { value: "none", zh: "无", en: "None" },
  { value: "fade", zh: "渐显", en: "Fade" },
  { value: "rise", zh: "上浮", en: "Rise" },
  { value: "blur", zh: "聚焦", en: "Blur" },
  { value: "typewriter", zh: "打字机", en: "Typewriter" },
];

const DENSITIES: { value: SkinDensity; zh: string; en: string }[] = [
  { value: "comfortable", zh: "宽松", en: "Comfortable" },
  { value: "compact", zh: "紧凑", en: "Compact" },
];

const MOTIONS: { value: SkinMotion; zh: string; en: string }[] = [
  { value: "slow", zh: "慢", en: "Slow" },
  { value: "normal", zh: "标准", en: "Normal" },
  { value: "fast", zh: "快", en: "Fast" },
];

const RADII: { value: SkinRadius; zh: string; en: string }[] = [
  { value: "sharp", zh: "直角", en: "Sharp" },
  { value: "soft", zh: "微圆", en: "Soft" },
  { value: "round", zh: "圆润", en: "Round" },
];

const SCALES: { value: SkinTextScale; zh: string; en: string }[] = [
  { value: "compact", zh: "小", en: "Small" },
  { value: "normal", zh: "标准", en: "Normal" },
  { value: "large", zh: "大", en: "Large" },
];

const THEMES: { value: SkinTheme; zh: string; en: string }[] = [
  { value: "dark", zh: "深色", en: "Dark" },
  { value: "light", zh: "浅色", en: "Light" },
];

const PRESETS: { zh: string; en: string; tuning: SkinTuning }[] = [
  { zh: "原始", en: "Default", tuning: {} },
  { zh: "冷调", en: "Cool", tuning: { accent: "#0891b2", textAnim: "fade", density: "comfortable" } },
  { zh: "暖调", en: "Warm", tuning: { accent: "#d97706", textAnim: "fade", density: "comfortable" } },
  { zh: "紧凑", en: "Compact", tuning: { accent: undefined, textAnim: "none", density: "compact" } },
];

function sameTuning(a: SkinTuning, b: SkinTuning) {
  return (
    (a.accent ?? undefined) === (b.accent ?? undefined) &&
    (a.textAnim ?? "none") === (b.textAnim ?? "none") &&
    (a.density ?? "comfortable") === (b.density ?? "comfortable") &&
    (a.motion ?? "normal") === (b.motion ?? "normal") &&
    (a.radius ?? undefined) === (b.radius ?? undefined) &&
    (a.textScale ?? "normal") === (b.textScale ?? "normal")
  );
}

/** Fix E: non-blocking readability note for extreme accent picks. */
function contrastHint(guard: AccentGuard, zh: boolean): string {
  const onLight = guard.asTextRatio.toFixed(1);
  const onDark = guard.onDarkRatio.toFixed(1);
  if (guard.tooLight && guard.tooDark) {
    return zh
      ? `对比度偏低（白底 ${onLight}:1、深底 ${onDark}:1）：浅色皮肤的链接与按钮文字已自动改用深色前景；深色皮肤建议换更亮的颜色。`
      : `Low contrast (${onLight}:1 on white, ${onDark}:1 on dark): link and button text on light skins switch to a dark foreground automatically; pick a brighter color for dark skins.`;
  }
  if (guard.tooLight) {
    return zh
      ? `该颜色在浅色皮肤上对比度偏低（${onLight}:1）：链接与按钮文字已自动改用深色前景。`
      : `Low contrast on light skins (${onLight}:1): link and button text switch to a dark foreground automatically.`;
  }
  return zh
    ? `该颜色在深色皮肤上对比度偏低（${onDark}:1）：Aurora / Terminal 的文字可能不清晰，建议换更亮的颜色。`
    : `Low contrast on dark skins (${onDark}:1): text on Aurora / Terminal may be hard to read — pick a brighter color.`;
}

export function CustomizePanel(props: {
  open: boolean;
  variant?: "inline" | "drawer";
  /** skin id, drives per-skin control gating via the skin's tuningSupport */
  skinId?: string;
  skinName: string;
  tuning: SkinTuning;
  onChange: (next: SkinTuning) => void;
  onClose?: () => void;
}) {
  const zh = isZh();
  if (!props.open) return null;

  const set = (patch: Partial<SkinTuning>) => props.onChange({ ...props.tuning, ...patch });
  const accent = props.tuning.accent;
  const anim = props.tuning.textAnim ?? "none";
  const density = props.tuning.density ?? "comfortable";
  const motion = props.tuning.motion ?? "normal";
  const radius = props.tuning.radius;
  const textScale = props.tuning.textScale ?? "normal";
  const theme = props.tuning.theme ?? "dark";
  // Theme is a per-skin capability: only skins declaring tuningSupport.theme
  // (see SkinDefinition) get the segmented control — the registry stays the
  // single source of truth for what a skin supports.
  const themeSupported = props.skinId ? getSkin(props.skinId).tuningSupport?.theme === true : false;
  const inline = props.variant === "inline";
  // Fix E: guard the custom accent; hint only — rendering is auto-adjusted by
  // the skin host (--sk-accent-fg / --sk-accent-ink), never blocked here.
  const guard = accent ? accentGuard(accent) : null;
  const hint = guard && (guard.tooLight || guard.tooDark) ? contrastHint(guard, zh) : null;

  return (
    <section className={`customize ${inline ? "customize--inline" : "customize--drawer"}`} aria-label={zh ? "皮肤自定义" : "Customize skin"}>
      <header className="customize-head">
        <div>
          <div className="customize-kicker">{zh ? "自定义" : "Customize"}</div>
          <h3>{props.skinName}</h3>
        </div>
        <div className="customize-head-actions">
          <button className="customize-reset" onClick={() => props.onChange({})}>
            <Icon name="rotate" size={13} />
            {zh ? "恢复默认" : "Reset"}
          </button>
          {props.onClose && (
            <button className="customize-close" onClick={props.onClose} aria-label={zh ? "收起" : "Collapse"}>
              <Icon name={inline ? "chevron" : "x"} size={16} />
            </button>
          )}
        </div>
      </header>

      <div className="customize-grid">
        <div className="customize-tile">
          <div className="customize-label">
            <span>{zh ? "主题色" : "Accent color"}</span>
            <em>{accent ?? (zh ? "皮肤默认" : "skin default")}</em>
          </div>
          <div className="customize-swatches">
            <button
              className={`customize-swatch ${!accent ? "is-active" : ""}`}
              onClick={() => set({ accent: undefined })}
              title={zh ? "皮肤默认色" : "Skin default"}
              aria-label={zh ? "默认" : "Default"}
            >
              <span className="customize-swatch-auto" />
            </button>
            {ACCENTS.map((item) => (
              <button
                key={item.hex}
                className={`customize-swatch ${accent === item.hex ? "is-active" : ""}`}
                style={{ background: item.hex }}
                onClick={() => set({ accent: item.hex })}
                title={zh ? item.zh : item.en}
                aria-label={zh ? item.zh : item.en}
              />
            ))}
            <label className="customize-swatch customize-swatch--pick" title={zh ? "自定义颜色" : "Custom color"}>
              <input type="color" value={accent ?? "#2563eb"} onChange={(event) => set({ accent: event.target.value })} />
            </label>
          </div>
          {hint && (
            <p className="customize-hint" role="note">
              {hint}
            </p>
          )}
        </div>

        {themeSupported && (
          <div className="customize-tile" data-testid="theme-tile">
            <div className="customize-label">
              <span>{zh ? "主题" : "Theme"}</span>
              <em>{THEMES.find((item) => item.value === theme)?.[zh ? "zh" : "en"]}</em>
            </div>
            <div className="customize-seg">
              {THEMES.map((item) => (
                <button
                  key={item.value}
                  className={`customize-segbtn ${theme === item.value ? "is-active" : ""}`}
                  onClick={() => set({ theme: item.value })}
                >
                  {zh ? item.zh : item.en}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="customize-tile">
          <div className="customize-label">
            <span>{zh ? "文字输出" : "Text output"}</span>
            <em>{TEXT_ANIMS.find((item) => item.value === anim)?.[zh ? "zh" : "en"]}</em>
          </div>
          <div className="customize-seg">
            {TEXT_ANIMS.map((item) => (
              <button
                key={item.value}
                className={`customize-segbtn ${anim === item.value ? "is-active" : ""}`}
                onClick={() => set({ textAnim: item.value })}
              >
                {zh ? item.zh : item.en}
              </button>
            ))}
          </div>
        </div>

        <div className="customize-tile">
          <div className="customize-label">
            <span>{zh ? "信息密度" : "Density"}</span>
            <em>{DENSITIES.find((item) => item.value === density)?.[zh ? "zh" : "en"]}</em>
          </div>
          <div className="customize-seg">
            {DENSITIES.map((item) => (
              <button
                key={item.value}
                className={`customize-segbtn ${density === item.value ? "is-active" : ""}`}
                onClick={() => set({ density: item.value })}
              >
                {zh ? item.zh : item.en}
              </button>
            ))}
          </div>
        </div>

        <div className="customize-tile">
          <div className="customize-label">
            <span>{zh ? "动效速度" : "Motion speed"}</span>
            <em>{MOTIONS.find((item) => item.value === motion)?.[zh ? "zh" : "en"]}</em>
          </div>
          <div className="customize-seg">
            {MOTIONS.map((item) => (
              <button
                key={item.value}
                className={`customize-segbtn ${motion === item.value ? "is-active" : ""}`}
                onClick={() => set({ motion: item.value })}
              >
                {zh ? item.zh : item.en}
              </button>
            ))}
          </div>
        </div>

        <div className="customize-tile">
          <div className="customize-label">
            <span>{zh ? "圆角" : "Corners"}</span>
            <em>{radius ? RADII.find((item) => item.value === radius)?.[zh ? "zh" : "en"] : zh ? "皮肤默认" : "skin default"}</em>
          </div>
          <div className="customize-seg">
            {RADII.map((item) => (
              <button
                key={item.value}
                className={`customize-segbtn ${radius === item.value ? "is-active" : ""}`}
                onClick={() => set({ radius: radius === item.value ? undefined : item.value })}
              >
                {zh ? item.zh : item.en}
              </button>
            ))}
          </div>
        </div>

        <div className="customize-tile">
          <div className="customize-label">
            <span>{zh ? "阅读字号" : "Reading size"}</span>
            <em>{SCALES.find((item) => item.value === textScale)?.[zh ? "zh" : "en"]}</em>
          </div>
          <div className="customize-seg">
            {SCALES.map((item) => (
              <button
                key={item.value}
                className={`customize-segbtn ${textScale === item.value ? "is-active" : ""}`}
                onClick={() => set({ textScale: item.value })}
              >
                {zh ? item.zh : item.en}
              </button>
            ))}
          </div>
        </div>

        <div className="customize-tile">
          <div className="customize-label">
            <span>{zh ? "预设" : "Presets"}</span>
            <em>{zh ? "一键套用" : "one click"}</em>
          </div>
          <div className="customize-presets">
            {PRESETS.map((preset) => (
              <button
                key={preset.en}
                className={`customize-preset ${sameTuning(props.tuning, preset.tuning) ? "is-active" : ""}`}
                onClick={() => props.onChange({ ...preset.tuning, theme: props.tuning.theme })}
              >
                {zh ? preset.zh : preset.en}
              </button>
            ))}
          </div>
        </div>
      </div>

      {inline ? (
        <p className="customize-hint customize-hint--inline">
          {zh ? "改动实时生效，按皮肤单独保存；链接会自动同步当前调参，可直接分享。" : "Changes apply live, saved per skin, and the URL syncs the current tuning — shareable."}
        </p>
      ) : (
        <p className="customize-hint customize-hint--inline">{zh ? "改动实时生效，按皮肤单独保存；链接同步调参" : "Live, saved per skin, URL-synced"}</p>
      )}
    </section>
  );
}
