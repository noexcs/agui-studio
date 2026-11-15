import { lazy, Suspense, useRef, type CSSProperties, type ReactNode } from "react";
import { GridMotion } from "./GridMotion";
import { skinSwatches } from "../shared/skin-swatches";
import { Icon } from "../shared/Icon";
import { LazyMount } from "../shared/LazyMount";
import { ScenarioMenu } from "./ScenarioMenu";
import { BackendMenu } from "./BackendMenu";
import type { BridgeHealth } from "../core/pi";
import type { StudioBackend } from "../core/store";
import type { DemoScenario } from "../core/demo-scenarios";
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
  particle: "粒子场 · 实时协议",
  workbench: "石墨工作台 · 轮次即文件",
  dash: "运营仪表盘 · 指标条",
  bubble: "移动聊天 · 气泡尾巴",
};

/** Hero copy must track the registry: "Four skins" drifted once a fifth skin
    shipped, so the count is now derived from skins.length. */
const NUM_EN = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const NUM_ZH = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
const QuickStart = lazy(() =>
  import("./quickstart/QuickStart").then((module) => ({ default: module.QuickStart }))
);

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

/* ── Tailwind utility compounds (shell.css migration, task-13) ────────
   Values reference the shell :root tokens in shell.css via arbitrary
   var shorthand — the token block stays the single source of truth.
   The shell motion pair (--t-fast 150ms / --t-slow 250ms, --ease) is
   consumed inline so "exactly two durations" survives the migration. */
const T = "duration-(--t-fast) ease-(--ease)";

const EMBED_BTN = `embed-btn inline-flex h-7 cursor-pointer items-center gap-1 rounded-[10px] border border-transparent bg-none px-3 font-(--font-mono) text-[10px] tracking-[0.04em] text-(--fg-muted) transition-[color,background,border-color,transform] hover:bg-[rgba(0,0,0,0.04)] hover:border-(--hairline) hover:text-(--fg) active:scale-[0.98] ${T}`;
const QUICK_BTN = `quick-btn inline-flex h-8 cursor-pointer items-center gap-2 rounded-full border border-(--hairline-subtle) bg-transparent px-3 text-[11.5px] text-(--fg-secondary) [font-family:inherit] transition-[background,border-color,color,transform] hover:bg-[rgba(0,0,0,0.04)] hover:border-(--hairline) hover:text-(--fg) active:scale-[0.98] ${T}`;
const QUICK_KBD = "font-(--font-mono) text-[9.5px] not-italic text-(--fg-muted)";

/**
 * Landing page: Grid Motion hero (light lavender colorway), skin cards with
 * palette dots, and an inline, interactive stage — switching skins never
 * leaves this page.
 */
export function Home(props: {
  skins: HomeSkin[];
  lang: Lang;
  backend: StudioBackend;
  piNote: string;
  staticDemo?: boolean;
  activeSkin: string;
  onSkin: (id: string) => void;
  onPalette: () => void;
  onLang: () => void;
  onBackend: (backend: StudioBackend) => void;
  onRunInfo: () => void;
  onReplay: () => void;
  onDocs: () => void;
  onFullscreen: () => void;
  customize?: ReactNode;
  scenario: DemoScenario;
  onScenario: (scenario: DemoScenario) => void;
  health: BridgeHealth | null;
  agentEndpoint?: string | null;
  onConfigureAgent: () => void;
  children: ReactNode;
}) {
  const zh = props.lang === "zh";
  const homeRef = useRef<HTMLDivElement>(null);
  const skinsRef = useRef<HTMLElement>(null);
  const active = props.skins.find((s) => s.id === props.activeSkin) ?? props.skins[0];
  const tagline = (skin: HomeSkin) => (zh ? TAGLINE_ZH[skin.id] ?? skin.tagline : skin.tagline);

  const scrollToSkins = () => {
    const home = homeRef.current;
    const section = skinsRef.current;
    if (!home || !section) return;
    home.scrollTo({ top: section.offsetTop, behavior: "smooth" });
  };

  return (
    <div
      className={`home ${zh ? "home--zh" : ""} h-[100svh] overflow-x-hidden overflow-y-auto bg-(--bg-base) font-(--font-sans) text-(--fg) antialiased [scrollbar-width:thin] [scrollbar-color:#d4d4d8_transparent]`}
      ref={homeRef}
    >
      <section className="home-hero relative isolate flex h-[100svh] min-h-[620px] items-center overflow-hidden">
        <div className="absolute inset-0 z-0">
          <GridMotion items={GRID_ITEMS} rows={5} aspectRatio={1.35} gap={18} radius={16} angle={-14} speed={22} dim={0.5} spotlight={0.75} fade={0.55} />
        </div>
        {/* left text legibility + bottom settle + feather-light corner vignette —
            neutral grays only, so dark ink copy keeps its contrast */}
        <div
          className="hero-shade pointer-events-none absolute inset-0 z-[1] bg-[linear-gradient(90deg,rgba(246,246,247,0.92)_0%,rgba(246,246,247,0.6)_42%,rgba(246,246,247,0.16)_72%,rgba(246,246,247,0.04)_100%),radial-gradient(140%_105%_at_50%_44%,rgba(246,246,247,0)_40%,rgba(236,236,242,0.45)_88%,rgba(233,233,239,0.6)_100%),linear-gradient(0deg,var(--bg-base)_0%,rgba(246,246,247,0.66)_14%,rgba(246,246,247,0)_42%),linear-gradient(180deg,rgba(246,246,247,0.58)_0%,rgba(246,246,247,0)_22%)]"
          aria-hidden="true"
        />

        <header className="home-top absolute inset-x-0 top-0 z-[6] flex items-center justify-between py-5 px-[clamp(24px,4vw,56px)] max-[860px]:py-4 max-[860px]:px-5">
          <a
            className="home-brand inline-flex items-center gap-2 text-[14.5px] font-medium tracking-[-0.01em] text-(--fg) no-underline"
            href="#"
            onClick={(e) => e.preventDefault()}
          >
            <svg viewBox="0 0 30 26" width="26" height="23" aria-hidden="true" className="-translate-y-px shrink-0">
              <path
                fill="#18181b"
                fillRule="evenodd"
                d="M3.2 19.6C.4 15.8 1.3 8.6 6.6 4.7 11.3 1.2 18.9.9 23.9 4.1c4.7 3 6.3 9 3.6 13.9-2.9 5.3-9.4 7.7-15.4 7-3.8-.4-6.9-2.4-8.9-5.4ZM9.5 17.2l4.3-6.4 2.6 3.6 1.7-2.2 3.4 5z"
              />
            </svg>
            <span>
              AG-UI<em className="not-italic ml-1 font-normal text-(--fg-muted) max-[860px]:hidden">Studio</em>
            </span>
          </a>
          {/* glass pill — the only glass surface on the page (small floating widget) */}
          <div className="home-top-actions flex items-center gap-1 rounded-full border border-[rgba(17,17,20,0.1)] bg-[rgba(255,255,255,0.65)] p-1 backdrop-blur-[12px]">
            <button
              className={`home-lang inline-flex h-[30px] cursor-pointer items-center gap-2 rounded-full border-0 bg-none px-3 text-[12.5px] text-(--fg-secondary) [font-family:inherit] transition-[background,color,transform] hover:bg-[rgba(0,0,0,0.04)] hover:text-(--fg) active:scale-[0.98] ${T}`}
              onClick={props.onLang}
            >
              {zh ? "EN" : "中文"}
            </button>
            <button
              className={`home-cta inline-flex h-[30px] cursor-pointer items-center gap-2 rounded-full border-0 bg-none px-3 text-[12.5px] bg-[rgba(0,0,0,0.05)] text-(--fg) [font-family:inherit] transition-[background,color,transform] hover:bg-[rgba(0,0,0,0.09)] active:scale-[0.98] ${T}`}
              onClick={props.onPalette}
            >
              <kbd className="font-(--font-mono) text-[10px] text-[rgba(24,24,27,0.5)]">⌘K</kbd>
              {zh ? "命令" : "Commands"}
            </button>
          </div>
        </header>

        <div className="hero-copy relative z-[3] max-w-[880px] px-[clamp(24px,6vw,92px)] animate-[hero-rise_var(--t-slow)_var(--ease)_0.1s_backwards]">
          <p className="hero-kicker mt-0 mb-5 inline-flex items-center gap-2 font-(--font-mono) text-[11.5px] tracking-[0.14em] text-(--fg-muted) uppercase before:h-px before:w-6 before:bg-(--hairline-strong) before:content-['']">
            AG-UI Studio — {zh ? "对话界面设计套件" : "conversation skins for AG-UI"}
          </p>
          <h1 className={`m-0 mb-6 text-[clamp(48px,6vw,68px)] leading-[1.04] [font-weight:640] text-(--fg) ${zh ? "tracking-[-0.02em]" : "tracking-[-0.04em]"}`}>
            {zh ? (
              <>
                多套皮肤，
                <br />
                一个<em className="hero-serif-zh italic font-normal tracking-normal font-[Songti_SC,STSong,Noto_Serif_SC,Georgia,serif]">协议</em>。
              </>
            ) : (
              <>
                Multiple skins,
                <br />
                one <em className="hero-serif italic font-normal tracking-[-0.015em] font-[Instrument_Serif,Georgia,Times_New_Roman,serif]">protocol.</em>
              </>
            )}
          </h1>
          <p className="hero-sub mt-0 mb-8 max-w-[34em] text-[16px] leading-[1.65] text-(--fg-secondary)">
            {zh
              ? "为 AG-UI 协议设计的对话界面：深色玻璃、编辑排版、荧光终端、硬边框、中性经典、粒子场、石墨工作台、运营仪表盘，以及移动聊天气泡。往下滚，就地切换、直接交互。"
              : "Conversation surfaces for the AG-UI protocol: dark glass, editorial print, phosphor CLI, hard borders, neutral classic, particle field, graphite workbench, ops dashboard, and mobile chat. Scroll down — switch and use them right here."}
          </p>
          <div className="hero-actions flex flex-wrap items-center gap-3">
            <button
              className={`hero-primary inline-flex h-11 cursor-pointer items-center gap-2 rounded-[var(--r-sm)] border-0 bg-[#18181b] px-6 text-sm font-medium text-white [font-family:inherit] transition-[background,transform] hover:bg-[#27272a] active:scale-[0.98] ${T}`}
              onClick={scrollToSkins}
            >
              {zh ? "直接体验" : "Try them inline"}
              <Icon name="arrow-right" size={15} />
            </button>
            <button
              className={`hero-ghost inline-flex h-11 cursor-pointer items-center gap-2 rounded-[var(--r-sm)] border border-(--hairline) bg-[rgba(0,0,0,0.02)] px-5 text-[13.5px] text-(--fg-secondary) [font-family:inherit] transition-[border-color,background,color,transform] hover:border-(--hairline-strong) hover:bg-[rgba(0,0,0,0.04)] hover:text-(--fg) active:scale-[0.98] ${T}`}
              onClick={props.onPalette}
            >
              <kbd className="font-(--font-mono) text-[10.5px] text-(--fg-muted)">⌘K</kbd>
              {zh ? "打开命令面板" : "Open commands"}
            </button>
          </div>
        </div>

        <div
          className="hero-hint absolute bottom-6 left-1/2 z-[4] flex -translate-x-1/2 flex-col items-center gap-2 font-(--font-mono) text-[10px] tracking-[0.14em] text-(--fg-muted) uppercase"
          aria-hidden="true"
        >
          <span>{zh ? "向下，直接开始用" : "Scroll — everything is live"}</span>
          <i className="h-[26px] w-px bg-[linear-gradient(to_bottom,var(--hairline-strong),transparent)] animate-[hint-drop_2s_var(--ease)_infinite]" />
        </div>
      </section>

      <section
        className="skins-section relative scroll-mt-[72px] border-t border-(--hairline-subtle) bg-(--bg-base) px-[clamp(24px,6vw,92px)] pt-[clamp(64px,9vw,128px)] pb-16"
        ref={skinsRef}
        id="skins"
      >
        <div className="section-head mb-12 flex items-end justify-between gap-8 max-[1180px]:flex-col max-[1180px]:items-start max-[1180px]:gap-4">
          <div>
            <p className="section-kicker mt-0 mb-3 font-(--font-mono) text-[11px] tracking-[0.14em] text-(--fg-muted) uppercase">{zh ? "皮肤" : "Skins"}</p>
            <h2 className={`m-0 text-[clamp(28px,3.2vw,40px)] leading-[1.12] font-medium ${zh ? "tracking-[-0.02em]" : "tracking-[-0.03em]"}`}>
              {zh ? "选一种界面，就在上面用" : "Pick a surface and use it right here"}
            </h2>
          </div>
          <p className="section-note m-0 max-w-[340px] pb-1 text-[14px] leading-[1.65] text-(--fg-muted) text-balance">
            {zh ? "同一段对话、同一个状态；切换皮肤不会离开这个页面。" : "Same conversation, same state. Switching never leaves this page."}
          </p>
        </div>

        <div className="skin-tabs mb-4 grid grid-cols-[repeat(auto-fit,minmax(210px,1fr))] gap-3 max-[1180px]:grid-cols-2 max-[860px]:grid-cols-1" role="group" aria-label={zh ? "皮肤" : "Skins"}>
          {props.skins.map((skin, index) => {
            const isCurrent = skin.id === props.activeSkin;
            return (
              <button
                key={skin.id}                aria-pressed={isCurrent}
                className={`skin-tab flex flex-col cursor-pointer rounded-[var(--r-md)] border p-4 text-left [font-family:inherit] transition-[transform,border-color,background,box-shadow] active:translate-y-0 active:scale-[0.98] ${T} ${
                  isCurrent
                    ? "is-active border-(--accent-line) bg-[linear-gradient(180deg,rgba(124,58,237,0.07),rgba(124,58,237,0)_55%),var(--bg-elevated)]"
                    : "border-(--hairline) bg-(--bg-surface) hover:-translate-y-0.5 hover:border-(--hairline-strong) hover:bg-(--bg-elevated) hover:shadow-(--shadow-hover)"
                }`}
                style={{ "--skin-accent": skin.accent } as CSSProperties}
                onClick={() => props.onSkin(skin.id)}
              >
                <span className="skin-tab-meta mb-3 flex items-center justify-between gap-2 font-(--font-mono) text-[10.5px] tracking-[0.08em] text-(--fg-muted)">
                  <span className="skin-tab-slug lowercase">{skin.id}</span>
                  {isCurrent ? (
                    <span className="skin-tab-status rounded-full border border-[rgba(124,58,237,0.35)] bg-(--accent-dim) px-2 py-1 text-[9px] tracking-[0.12em] text-(--accent-hover) uppercase">
                      {zh ? "当前" : "current"}
                    </span>
                  ) : (
                    <span className="skin-tab-no [font-variant-numeric:tabular-nums]">0{index + 1}</span>
                  )}
                </span>
                <span className="skin-tab-name mb-1 flex items-center gap-2 text-[15px] font-medium tracking-[-0.01em] text-(--fg)">
                  {skin.name}
                  <i className="inline-block h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: skin.accent }} />
                </span>
                <span className="skin-tab-tagline mb-4 text-xs leading-[1.55] text-(--fg-secondary)">{tagline(skin)}</span>
                <span className="skin-tab-swatches mt-auto flex items-center gap-1" aria-hidden="true">
                  {skinSwatches(skin.id, skin.accent).map((color, i) => (
                    <i key={i} className="h-3 w-3 shrink-0 rounded-full shadow-[inset_0_0_0_1px_rgba(17,17,20,0.14)]" style={{ background: color }} />
                  ))}
                </span>
              </button>
            );
          })}
        </div>

        <div className="embed-shell overflow-hidden rounded-[var(--r-lg)] border border-(--hairline) bg-(--bg-surface)">
          <div className="embed-toolbar flex h-12 items-center justify-between gap-4 border-b border-(--hairline-subtle) bg-(--bg-elevated) px-4">
            <div className="embed-current flex min-w-0 items-center gap-2 text-[12.5px]">
              <i className="embed-live h-1.5 w-1.5 shrink-0 rounded-full bg-(--accent) shadow-[0_0_0_3px_var(--accent-dim)] animate-[embed-pulse_2s_ease-in-out_infinite]" />
              <strong className="font-medium text-(--fg)">{active.name}</strong>
              <span className="embed-tagline truncate text-[11.5px] text-(--fg-muted)">{tagline(active)}</span>
            </div>
            <div className="embed-actions flex items-center gap-1">
              <ScenarioMenu scenario={props.scenario} lang={props.lang} onScenario={props.onScenario} />
              {props.staticDemo ? (
                <span className="embed-chip whitespace-nowrap rounded-full border border-[rgba(124,58,237,0.35)] bg-(--accent-dim) px-2 py-1 font-(--font-mono) text-[8.5px] tracking-[0.12em] text-(--accent-hover) uppercase">
                  {zh ? "演示模式" : "demo mode"}
                </span>
              ) : (
                <BackendMenu
                  backend={props.backend}
                  lang={props.lang}
                  health={props.health}
                  agentEndpoint={props.agentEndpoint}
                  onConfigureAgent={props.onConfigureAgent}
                  onBackend={props.onBackend}
                />
              )}
              <button className={EMBED_BTN} onClick={props.onLang} title={zh ? "语言" : "Language"}>
                <Icon name="globe" size={13} />
                {zh ? "中" : "EN"}
              </button>
              {(props.staticDemo || props.backend === "mock") && (
                <button className={EMBED_BTN} onClick={props.onReplay} title={zh ? "从头开始演示" : "Replay from the start"}>
                  <Icon name="refresh" size={13} />
                  {zh ? "重播" : "replay"}
                </button>
              )}
              <button className={EMBED_BTN} onClick={props.onRunInfo} title={zh ? "运行详情" : "Run details"}>
                <Icon name="braces" size={13} />
                {zh ? "详情" : "details"}
              </button>
            </div>
          </div>
          <div className="embed-stage relative h-[clamp(560px,76svh,900px)] bg-(--bg-surface) [&>*]:absolute [&>*]:inset-0 [&>*]:h-auto [&>*]:min-h-0">{props.children}</div>
        </div>

        <div className="custom-zone mt-6 rounded-[var(--r-lg)] border border-(--hairline-subtle) bg-(--bg-surface) p-6">{props.customize}</div>

        <div className="quick-bar mt-8 flex flex-wrap items-center gap-2">
          <span className="quick-label mr-1 font-(--font-mono) text-[10px] tracking-[0.14em] text-(--fg-muted) uppercase">{zh ? "更多" : "More"}</span>
          <button className={QUICK_BTN} onClick={props.onPalette}><Icon name="command" size={14} />{zh ? "命令面板" : "Command palette"}<kbd className={QUICK_KBD}>⌘K</kbd></button>
          <button className={QUICK_BTN} onClick={props.onLang}><Icon name="globe" size={14} />{zh ? "切换语言" : "Switch language"}<em className={QUICK_KBD}>{zh ? "中 / EN" : "EN / 中文"}</em></button>
          <button className={QUICK_BTN} onClick={props.onRunInfo}><Icon name="braces" size={14} />{zh ? "运行详情" : "Run details"}</button>
          <button className={QUICK_BTN} onClick={props.onDocs}><Icon name="external-link" size={14} />{zh ? "协议文档" : "Protocol docs"}</button>
          <button
            className={QUICK_BTN}
            onClick={() => document.getElementById("quickstart")?.scrollIntoView({ behavior: "smooth", block: "start" })}
          >
            <Icon name="arrow-right" size={14} />
            {zh ? "快速上手" : "Get started"}
          </button>
          <span className="quick-note ml-auto font-(--font-mono) text-[9px] tracking-[0.06em] text-(--fg-muted)">{props.piNote}</span>
        </div>

        <LazyMount minHeight={420}>
          <Suspense fallback={<div className="qs-skeleton min-h-[420px] rounded-[var(--r-lg)] border border-(--hairline-subtle) bg-[linear-gradient(180deg,rgba(17,17,20,0.03),rgba(17,17,20,0.015))]" aria-hidden="true" />}>
            <QuickStart lang={props.lang} activeSkin={props.activeSkin} />
          </Suspense>
        </LazyMount>

        <footer className="home-foot mt-[clamp(64px,8vw,96px)] flex items-center justify-between gap-5 border-t border-(--hairline-subtle) pt-6 font-(--font-mono) text-[10.5px] tracking-[0.06em] text-(--fg-muted) max-[860px]:flex-col max-[860px]:items-start max-[860px]:gap-2">
          <span>AG-UI Studio · protocol 1.0</span>
          <span>React · Vite · pi · DeepSeek</span>
        </footer>
      </section>
    </div>
  );
}
