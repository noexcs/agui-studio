import { Icon, accentGuard, type AccentGuard } from "agui-skins";
import { isZh } from "../i18n";
import type { SkinDensity, SkinTextAnim, SkinTuning } from "agui-skins";

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
];

const DENSITIES: { value: SkinDensity; zh: string; en: string }[] = [
  { value: "comfortable", zh: "宽松", en: "Comfortable" },
  { value: "compact", zh: "紧凑", en: "Compact" },
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
    (a.density ?? "comfortable") === (b.density ?? "comfortable")
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

        <div className="customize-tile">
          <div className="customize-label">
            <span>{zh ? "文字动画" : "Text animation"}</span>
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
            <span>{zh ? "预设" : "Presets"}</span>
            <em>{zh ? "一键套用" : "one click"}</em>
          </div>
          <div className="customize-presets">
            {PRESETS.map((preset) => (
              <button
                key={preset.en}
                className={`customize-preset ${sameTuning(props.tuning, preset.tuning) ? "is-active" : ""}`}
                onClick={() => props.onChange(preset.tuning)}
              >
                {zh ? preset.zh : preset.en}
              </button>
            ))}
          </div>
        </div>
      </div>

      {inline ? (
        <p className="customize-hint customize-hint--inline">
          {zh ? "改动实时生效，按皮肤单独保存；可直接分享当前链接。" : "Changes apply live, saved per skin. The URL captures the current tuning."}
        </p>
      ) : (
        <p className="customize-hint customize-hint--inline">{zh ? "改动实时生效，按皮肤单独保存" : "Live, saved per skin"}</p>
      )}
    </section>
  );
}
