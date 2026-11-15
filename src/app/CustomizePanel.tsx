import { Icon, accentGuard, getSkin, type AccentGuard } from "agui-skins";
import { isZh } from "../i18n";
import type { SkinDensity, SkinMotion, SkinRadius, SkinTextAnim, SkinTextScale, SkinTheme, SkinTuning } from "agui-skins";

/* Tailwind compounds (app.css + shell.css .custom-zone overrides migration,
   task-13). The old parent-scoped overrides (.custom-zone .customize …) are
   folded into the inline variant — the panel knows its variant, so the
   parent no longer reaches into it. */
const T = "duration-(--t-fast) ease-(--ease)";
const LABEL_SPAN = "font-(family-name:--font-mono) text-[11px] tracking-[0.12em] text-(--fg-muted) uppercase";
const LABEL_EM = "not-italic font-(family-name:--font-mono) text-[10.5px] text-(--fg-muted)";
const SEG = "customize-seg flex gap-1 rounded-[10px] bg-[rgba(0,0,0,0.045)] p-[3px]";
/* segbtn state branches are mutually exclusive: bg/color live only in SEGBTN_ON/OFF —
   the base string carries neither (one unconditional utility per CSS property, so
   Tailwind's fixed utility sort can never decide the active state's winner) */
const SEGBTN = `customize-segbtn flex-1 cursor-pointer rounded-[7px] border-none px-2 py-1.5 text-[12px] [font-family:inherit] transition-[background,color] hover:text-(--fg) ${T}`;
const SEGBTN_ON = "is-active bg-white text-[#18181b] shadow-[0_1px_2px_rgba(24,24,27,0.14)]";
const SEGBTN_OFF = "bg-transparent text-[#52525b]";
const TILE = "customize-tile min-w-0";
const LABEL = "customize-label mb-2 flex items-baseline justify-between text-[12px] text-[#3f3f46]";

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
    <section
      className={`customize rounded-[14px] ${
        inline
          ? "customize--inline relative mt-0 border-0 bg-transparent p-0 text-[13px] leading-[1.45] backdrop-blur-none font-[inherit] text-(--fg-secondary)"
          : "customize--drawer fixed top-[86px] right-5 z-[70] w-[320px] max-h-[calc(100vh-120px)] overflow-auto border border-[rgba(17,17,20,0.1)] bg-[rgba(255,255,255,0.92)] p-4 shadow-[0_24px_70px_rgba(24,24,27,0.18)] backdrop-blur-[18px] backdrop-saturate-[140%] text-[#18181b] [font:13px/1.45_system-ui,-apple-system,Segoe_UI,sans-serif] max-[720px]:inset-x-3 max-[720px]:top-[70px] max-[720px]:w-auto"
      }`}
      aria-label={zh ? "皮肤自定义" : "Customize skin"}
    >
      <header className={`customize-head flex items-start justify-between gap-2.5 border-b ${inline ? "pb-4 border-(--hairline-subtle)" : "pb-3 border-[rgba(17,17,20,0.08)]"}`}>
        <div>
          <div className="customize-kicker font-(family-name:--font-mono) text-[11px] tracking-[0.14em] text-(--fg-muted) uppercase">{zh ? "自定义" : "Customize"}</div>
          <h3 className={`mt-0.5 mb-0 text-[15px] font-semibold ${inline ? "text-(--fg)" : ""}`}>{props.skinName}</h3>
        </div>
        <div className="customize-head-actions flex items-center gap-2">
          <button
            className={`customize-reset inline-flex cursor-pointer items-center gap-1.5 rounded-[9px] border border-[rgba(17,17,20,0.14)] bg-transparent px-2.5 py-[7px] text-[12px] text-[#3f3f46] [font-family:inherit] transition-[background,color,transform] hover:bg-[rgba(0,0,0,0.04)] active:scale-[0.98] ${T}`}
            onClick={() => props.onChange({})}
          >
            <Icon name="rotate" size={13} />
            {zh ? "恢复默认" : "Reset"}
          </button>
          {props.onClose && (
            <button
              className={`customize-close grid h-[26px] w-[26px] cursor-pointer place-items-center rounded-[10px] border border-[rgba(17,17,20,0.14)] bg-transparent text-[#3f3f46] transition-[background,color,transform] hover:bg-[rgba(0,0,0,0.04)] hover:text-(--fg) active:scale-[0.98] ${T}`}
              onClick={props.onClose}
              aria-label={zh ? "收起" : "Collapse"}
            >
              <Icon name={inline ? "chevron" : "x"} size={16} />
            </button>
          )}
        </div>
      </header>

      <div className="customize-grid grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-x-[26px] gap-y-[18px] pt-[15px]">
        <div className={TILE}>
          <div className={LABEL}>
            <span className={LABEL_SPAN}>{zh ? "主题色" : "Accent color"}</span>
            <em className={LABEL_EM}>{accent ?? (zh ? "皮肤默认" : "skin default")}</em>
          </div>
          <div className="customize-swatches flex flex-wrap gap-[7px]">
            <button
              className={`customize-swatch relative h-[26px] w-[26px] cursor-pointer rounded-lg border border-[rgba(17,17,20,0.16)] p-0 ${!accent ? "is-active shadow-[0_0_0_2px_var(--bg-surface),0_0_0_3.5px_var(--accent)]" : ""}`}
              onClick={() => set({ accent: undefined })}
              title={zh ? "皮肤默认色" : "Skin default"}
              aria-label={zh ? "默认" : "Default"}
            >
              <span className="customize-swatch-auto block h-full w-full rounded-[inherit] bg-[conic-gradient(#2563eb_0_25%,#db2777_0_50%,#059669_0_75%,#d97706_0)]" />
            </button>
            {ACCENTS.map((item) => (
              <button
                key={item.hex}
                className={`customize-swatch relative h-[26px] w-[26px] cursor-pointer rounded-lg border border-[rgba(17,17,20,0.16)] p-0 ${accent === item.hex ? "is-active shadow-[0_0_0_2px_var(--bg-surface),0_0_0_3.5px_var(--accent)]" : ""}`}
                style={{ background: item.hex }}
                onClick={() => set({ accent: item.hex })}
                title={zh ? item.zh : item.en}
                aria-label={zh ? item.zh : item.en}
              />
            ))}
            <label
              className="customize-swatch customize-swatch--pick grid h-[26px] w-[26px] cursor-pointer place-items-center overflow-hidden rounded-lg border border-[rgba(17,17,20,0.16)] bg-[#efeff1]"
              title={zh ? "自定义颜色" : "Custom color"}
            >
              <input className="h-[150%] w-[150%] cursor-pointer border-none bg-transparent p-0" type="color" value={accent ?? "#2563eb"} onChange={(event) => set({ accent: event.target.value })} />
            </label>
          </div>
          {hint && (
            <p className="customize-hint text-right text-[10px] text-[#8a8a94]" role="note">
              {hint}
            </p>
          )}
        </div>

        {themeSupported && (
          <div className={TILE} data-testid="theme-tile">
            <div className={LABEL}>
              <span className={LABEL_SPAN}>{zh ? "主题" : "Theme"}</span>
              <em className={LABEL_EM}>{THEMES.find((item) => item.value === theme)?.[zh ? "zh" : "en"]}</em>
            </div>
            <div className={SEG}>
              {THEMES.map((item) => (
                <button
                  key={item.value}
                  className={`${SEGBTN} ${theme === item.value ? SEGBTN_ON : SEGBTN_OFF}`}
                  onClick={() => set({ theme: item.value })}
                >
                  {zh ? item.zh : item.en}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className={TILE}>
          <div className={LABEL}>
            <span className={LABEL_SPAN}>{zh ? "文字输出" : "Text output"}</span>
            <em className={LABEL_EM}>{TEXT_ANIMS.find((item) => item.value === anim)?.[zh ? "zh" : "en"]}</em>
          </div>
          <div className={SEG}>
            {TEXT_ANIMS.map((item) => (
              <button
                key={item.value}
                className={`${SEGBTN} ${anim === item.value ? SEGBTN_ON : SEGBTN_OFF}`}
                onClick={() => set({ textAnim: item.value })}
              >
                {zh ? item.zh : item.en}
              </button>
            ))}
          </div>
        </div>

        <div className={TILE}>
          <div className={LABEL}>
            <span className={LABEL_SPAN}>{zh ? "信息密度" : "Density"}</span>
            <em className={LABEL_EM}>{DENSITIES.find((item) => item.value === density)?.[zh ? "zh" : "en"]}</em>
          </div>
          <div className={SEG}>
            {DENSITIES.map((item) => (
              <button
                key={item.value}
                className={`${SEGBTN} ${density === item.value ? SEGBTN_ON : SEGBTN_OFF}`}
                onClick={() => set({ density: item.value })}
              >
                {zh ? item.zh : item.en}
              </button>
            ))}
          </div>
        </div>

        <div className={TILE}>
          <div className={LABEL}>
            <span className={LABEL_SPAN}>{zh ? "动效速度" : "Motion speed"}</span>
            <em className={LABEL_EM}>{MOTIONS.find((item) => item.value === motion)?.[zh ? "zh" : "en"]}</em>
          </div>
          <div className={SEG}>
            {MOTIONS.map((item) => (
              <button
                key={item.value}
                className={`${SEGBTN} ${motion === item.value ? SEGBTN_ON : SEGBTN_OFF}`}
                onClick={() => set({ motion: item.value })}
              >
                {zh ? item.zh : item.en}
              </button>
            ))}
          </div>
        </div>

        <div className={TILE}>
          <div className={LABEL}>
            <span className={LABEL_SPAN}>{zh ? "圆角" : "Corners"}</span>
            <em className={LABEL_EM}>{radius ? RADII.find((item) => item.value === radius)?.[zh ? "zh" : "en"] : zh ? "皮肤默认" : "skin default"}</em>
          </div>
          <div className={SEG}>
            {RADII.map((item) => (
              <button
                key={item.value}
                className={`${SEGBTN} ${radius === item.value ? SEGBTN_ON : SEGBTN_OFF}`}
                onClick={() => set({ radius: radius === item.value ? undefined : item.value })}
              >
                {zh ? item.zh : item.en}
              </button>
            ))}
          </div>
        </div>

        <div className={TILE}>
          <div className={LABEL}>
            <span className={LABEL_SPAN}>{zh ? "阅读字号" : "Reading size"}</span>
            <em className={LABEL_EM}>{SCALES.find((item) => item.value === textScale)?.[zh ? "zh" : "en"]}</em>
          </div>
          <div className={SEG}>
            {SCALES.map((item) => (
              <button
                key={item.value}
                className={`${SEGBTN} ${textScale === item.value ? SEGBTN_ON : SEGBTN_OFF}`}
                onClick={() => set({ textScale: item.value })}
              >
                {zh ? item.zh : item.en}
              </button>
            ))}
          </div>
        </div>

        <div className={TILE}>
          <div className={LABEL}>
            <span className={LABEL_SPAN}>{zh ? "预设" : "Presets"}</span>
            <em className={LABEL_EM}>{zh ? "一键套用" : "one click"}</em>
          </div>
          <div className="customize-presets flex flex-wrap gap-1.5">
            {PRESETS.map((preset) => (
              // state branches are mutually exclusive: bg/border-color/color (+ hover)
              // exist only in the branches — base carries none of them (one unconditional
              // utility per CSS property; Tailwind's fixed sort must never pick the winner)
              <button
                key={preset.en}
                className={`customize-preset cursor-pointer rounded-[var(--r-sm)] border px-3 py-1.5 text-[12px] [font-family:inherit] transition-[background,border-color,color,transform] active:scale-[0.98] ${T} ${sameTuning(props.tuning, preset.tuning) ? "is-active border-(--accent-line) bg-(--accent-dim) text-(--accent-hover)" : "border-[rgba(17,17,20,0.14)] bg-transparent text-[#3f3f46] hover:bg-[rgba(0,0,0,0.04)] hover:text-(--fg)"}`}
                onClick={() => props.onChange({ ...preset.tuning, theme: props.tuning.theme })}
              >
                {zh ? preset.zh : preset.en}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* hint stays text-RIGHT in both variants: base CSS had `.customize-hint--inline
          { text-align:left }` (line 625) but `.customize-hint { text-align:right }` (line
          789) later — same (0,1,0) specificity, later wins, so left was always dead */}
      {inline ? (
        <p className="customize-hint customize-hint--inline mt-3.5 mb-0 text-right text-[10px] text-[#8a8a94]">
          {zh ? "改动实时生效，按皮肤单独保存；链接会自动同步当前调参，可直接分享。" : "Changes apply live, saved per skin, and the URL syncs the current tuning — shareable."}
        </p>
      ) : (
        <p className="customize-hint customize-hint--inline mt-3.5 mb-0 text-right text-[10px] text-[#8a8a94]">{zh ? "改动实时生效，按皮肤单独保存；链接同步调参" : "Live, saved per skin, URL-synced"}</p>
      )}
    </section>
  );
}
