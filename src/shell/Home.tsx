import { useRef, type CSSProperties, type ReactNode } from "react";
import { GridMotion } from "./GridMotion";
import { Icon } from "../shared/Icon";
import { QuickStart } from "../app/QuickStart";
import type { Lang } from "../i18n";

export interface HomeSkin {
  id: string;
  name: string;
  tagline: string;
  accent: string;
}

const TAGLINE_ZH: Record<string, string> = {
  aurora: "深色玻璃 · 协议薄荷",
  paper: "编辑浅色 · 页边注",
  terminal: "荧光 CLI · 事件流",
  brutalist: "硬边框 · 强审批",
  classic: "中性经典 · 企业稳妥",
};

/** Hero copy must track the registry: "Four skins" drifted once a fifth skin
    shipped, so the count is now derived from skins.length. */
const NUM_EN = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const NUM_ZH = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
export const skinCountWord = (n: number, zh: boolean): string => {
  if (n >= 0 && n <= 10) return zh ? NUM_ZH[n] : NUM_EN[n];
  return String(n);
};

const BASE = import.meta.env.BASE_URL;
const asset = (path: string) => `${BASE}${path.replace(/^\//, "")}`;

const GRID_ITEMS = [
  "previews/aurora.png",
  "media/agent-pi.jpg",
  "previews/paper.png",
  "media/agent-mock.jpg",
  "previews/terminal.png",
  "previews/brutalist.png",
  "previews/classic.png",
].map(asset);

/**
 * Landing page: Grid Motion hero, then skin buttons and an inline, interactive
 * stage — switching skins never leaves this page.
 */
export function Home(props: {
  skins: HomeSkin[];
  lang: Lang;
  backend: "mock" | "pi" | "fixture";
  piNote: string;
  staticDemo?: boolean;
  activeSkin: string;
  onSkin: (id: string) => void;
  onPalette: () => void;
  onLang: () => void;
  onBackend: (backend: "mock" | "pi") => void;
  onRunInfo: () => void;
  onDocs: () => void;
  onFullscreen: () => void;
  onCustomize: () => void;
  customizing?: boolean;
  customize?: ReactNode;
  children: ReactNode;
}) {
  const zh = props.lang === "zh";
  const homeRef = useRef<HTMLDivElement>(null);
  const skinsRef = useRef<HTMLElement>(null);
  const active = props.skins.find((s) => s.id === props.activeSkin) ?? props.skins[0];
  const tagline = (skin: HomeSkin) => (zh ? TAGLINE_ZH[skin.id] ?? skin.tagline : skin.tagline);
  const countWord = skinCountWord(props.skins.length, zh);

  const scrollToSkins = () => {
    const home = homeRef.current;
    const section = skinsRef.current;
    if (!home || !section) return;
    home.scrollTo({ top: section.offsetTop, behavior: "smooth" });
  };

  return (
    <div className="home" ref={homeRef}>
      <section className="home-hero">
        <GridMotion items={GRID_ITEMS} rows={5} aspectRatio={1.35} gap={18} radius={16} angle={-14} speed={22} dim={0.5} spotlight={0.7} fade={0.55} />
        <div className="hero-shade" aria-hidden="true" />

        <header className="home-top">
          <a className="home-brand" href="#" onClick={(e) => e.preventDefault()}>
            <svg viewBox="0 0 30 26" width="26" height="23" aria-hidden="true">
              <path
                fill="#fff"
                fillRule="evenodd"
                d="M3.2 19.6C.4 15.8 1.3 8.6 6.6 4.7 11.3 1.2 18.9.9 23.9 4.1c4.7 3 6.3 9 3.6 13.9-2.9 5.3-9.4 7.7-15.4 7-3.8-.4-6.9-2.4-8.9-5.4ZM9.5 17.2l4.3-6.4 2.6 3.6 1.7-2.2 3.4 5z"
              />
            </svg>
            <span>AG-UI<em>Studio</em></span>
          </a>
          <div className="home-top-actions">
            <button className="home-lang" onClick={props.onLang}>{zh ? "EN" : "中文"}</button>
            <button className="home-cta" onClick={props.onPalette}>
              <kbd>⌘K</kbd>
              {zh ? "命令" : "Commands"}
            </button>
          </div>
        </header>

        <div className="hero-copy">
          <p className="hero-kicker">AG-UI Studio — {zh ? "对话界面设计套件" : "conversation skins for AG-UI"}</p>
          <h1>
            {zh ? (
              <>
                {countWord}种皮肤，
                <br />
                一个协议。
              </>
            ) : (
              <>
                {countWord.charAt(0).toUpperCase() + countWord.slice(1)} skins,
                <br />
                one protocol.
              </>
            )}
          </h1>
          <p className="hero-sub">
            {zh
              ? "为 AG-UI 协议设计的对话界面：深色玻璃、编辑排版、荧光终端、硬边框、中性经典。往下滚，就地切换、直接交互。"
              : "Conversation surfaces for the AG-UI protocol: dark glass, editorial print, phosphor CLI, hard borders, neutral classic. Scroll down — switch and use them right here."}
          </p>
          <div className="hero-actions">
            <button className="hero-primary" onClick={scrollToSkins}>
              {zh ? "直接体验" : "Try them inline"}
              <Icon name="arrow-right" size={15} />
            </button>
            <button className="hero-ghost" onClick={props.onPalette}>
              <kbd>⌘K</kbd>
              {zh ? "打开命令面板" : "Open commands"}
            </button>
          </div>
        </div>

        <div className="hero-hint" aria-hidden="true">
          <span>{zh ? "向下，直接开始用" : "Scroll — everything is live"}</span>
          <i />
        </div>
      </section>

      <section className="skins-section" ref={skinsRef} id="skins">
        <div className="section-head">
          <div>
            <p className="section-kicker">{zh ? "皮肤" : "Skins"}</p>
            <h2>{zh ? "选一种界面，就在上面用" : "Pick a surface and use it right here"}</h2>
          </div>
          <p className="section-note">
            {zh ? "同一段对话、同一个状态；切换皮肤不会离开这个页面。" : "Same conversation, same state. Switching never leaves this page."}
          </p>
        </div>

        <div className="skin-tabs" role="tablist" aria-label={zh ? "皮肤" : "Skins"}>
          {props.skins.map((skin, index) => (
            <button
              key={skin.id}
              role="tab"
              aria-selected={skin.id === props.activeSkin}
              className={`skin-tab ${skin.id === props.activeSkin ? "is-active" : ""}`}
              style={{ "--accent": skin.accent } as CSSProperties}
              onClick={() => props.onSkin(skin.id)}
            >
              <span className="skin-tab-no">0{index + 1}</span>
              <span className="skin-tab-body">
                <span className="skin-tab-name">
                  {skin.name}
                  <i style={{ background: skin.accent }} />
                </span>
                <span className="skin-tab-tagline">{tagline(skin)}</span>
              </span>
            </button>
          ))}
        </div>

        <div className="embed-shell">
          <div className="embed-toolbar">
            <div className="embed-current">
              <i className="embed-live" />
              <strong>{active.name}</strong>
              <span className="embed-tagline">{tagline(active)}</span>
              <span className="embed-chip">{zh ? "实时嵌入" : "live embed"}</span>
            </div>
            <div className="embed-actions">
              {props.staticDemo ? (
                <span className="embed-chip">{zh ? "演示模式" : "demo mode"}</span>
              ) : (
                <button className="embed-btn" onClick={() => props.onBackend(props.backend === "mock" ? "pi" : "mock")} title={zh ? "切换后端" : "Backend"}>
                  <Icon name="terminal" size={13} />
                  {props.backend === "mock" ? (zh ? "演示" : "mock") : "pi"}
                </button>
              )}
              <button className="embed-btn" onClick={props.onLang} title={zh ? "语言" : "Language"}>
                <Icon name="globe" size={13} />
                {zh ? "中" : "EN"}
              </button>
              <button className="embed-btn" onClick={props.onRunInfo} title={zh ? "运行详情" : "Run details"}>
                <Icon name="braces" size={13} />
                {zh ? "运行" : "run"}
              </button>
              <button
              className="embed-btn"
              onClick={props.onCustomize}
              title={zh ? "自定义外观" : "Customize"}
              data-active={props.customizing || undefined}
            >
              <Icon name="sliders" size={13} />
              {zh ? "自定义" : "Customize"}
            </button>
            <button className="embed-btn" onClick={props.onFullscreen} title={zh ? "全屏打开" : "Open full screen"}>
                <Icon name="arrow-up-right" size={13} />
                {zh ? "全屏" : "full"}
              </button>
            </div>
          </div>
          <div className="embed-stage">{props.children}</div>
        </div>

        {props.customize}

        <div className="quick-bar">
          <span className="quick-label">{zh ? "更多" : "More"}</span>
          <button className="quick-btn" onClick={props.onPalette}><Icon name="command" size={14} />{zh ? "命令面板" : "Command palette"}<kbd>⌘K</kbd></button>
          <button className="quick-btn" onClick={props.onLang}><Icon name="globe" size={14} />{zh ? "切换语言" : "Switch language"}<em>{zh ? "中 / EN" : "EN / 中文"}</em></button>
          <button className="quick-btn" onClick={props.onRunInfo}><Icon name="braces" size={14} />{zh ? "运行详情" : "Run details"}</button>
          <button className="quick-btn" onClick={props.onDocs}><Icon name="external-link" size={14} />{zh ? "协议文档" : "Protocol docs"}</button>
          <span className="quick-note">{props.piNote}</span>
        </div>

        <QuickStart lang={props.lang} activeSkin={props.activeSkin} />

        <footer className="home-foot">
          <span>AG-UI Studio · protocol 1.0</span>
          <span>React · Vite · pi · DeepSeek</span>
        </footer>
      </section>
    </div>
  );
}
