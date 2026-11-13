import { Icon } from "agui-skins";
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

export function CustomizePanel(props: {
  open: boolean;
  skinName: string;
  tuning: SkinTuning;
  onChange: (next: SkinTuning) => void;
  onClose: () => void;
}) {
  const zh = isZh();
  if (!props.open) return null;

  const set = (patch: Partial<SkinTuning>) => props.onChange({ ...props.tuning, ...patch });
  const accent = props.tuning.accent;
  const anim = props.tuning.textAnim ?? "none";
  const density = props.tuning.density ?? "comfortable";

  return (
    <aside className="customize" role="dialog" aria-label={zh ? "皮肤自定义" : "Customize skin"}>
      <header className="customize-head">
        <div>
          <div className="customize-kicker">{zh ? "自定义" : "Customize"}</div>
          <h3>{props.skinName}</h3>
        </div>
        <button className="customize-close" onClick={props.onClose} aria-label={zh ? "关闭" : "Close"}>
          <Icon name="x" size={16} />
        </button>
      </header>

      <section className="customize-section">
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
      </section>

      <section className="customize-section">
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
      </section>

      <section className="customize-section">
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
      </section>

      <footer className="customize-foot">
        <button className="customize-reset" onClick={() => props.onChange({})}>
          <Icon name="rotate" size={13} />
          {zh ? "恢复默认" : "Reset"}
        </button>
        <span className="customize-hint">{zh ? "改动实时生效，按皮肤单独保存" : "Live, saved per skin"}</span>
      </footer>
    </aside>
  );
}
