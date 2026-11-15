import { useEffect, useRef, useState } from "react";
import { SkinHostProvider } from "agui-skins";
import type { SkinTuning } from "agui-skins";
import { CustomizePanel } from "./CustomizePanel";
import { buildAppQuery, sanitizeTuning } from "./urlState";
import { createStudio, type ConversationStore, type StudioBackend } from "../core/store";
import { DEFAULT_SCENARIO, isDemoScenario, type DemoScenario } from "../core/demo-scenarios";
import { getAgentEndpoint, setAgentEndpoint as persistAgentEndpoint, type AgentEndpoint } from "../core/agui";
import { checkBridge, type BridgeHealth } from "../core/pi";
import { getSkin, skins } from "agui-skins";
import type { SkinConversation } from "agui-skins";
import { setLang as setI18nLang, type Lang } from "../i18n";
import { ErrorBoundary, type FallbackProps } from "react-error-boundary";
import { Icon } from "../shared/Icon";
import { Home } from "../shell/Home";
import { BackendMenu } from "../shell/BackendMenu";
import { CommandPalette } from "./CommandPalette";
import { RunDialog } from "./RunDialog";
import "./app.css";
import "../shell/shell.css";

type Scene = "live" | "interrupted" | "done";
type Backend = StudioBackend;

const readParams = () => new URLSearchParams(window.location.search);

export default function App() {
  const params = readParams();
  const scene = (params.get("scene") as Scene) || "live";
  const [scenario, setScenario] = useState<DemoScenario>(() => {
    const value = params.get("scenario");
    return isDemoScenario(value) ? value : DEFAULT_SCENARIO;
  });
  // static hosting (GitHub Pages) only ships the scripted demo agent
  const STATIC_DEMO = import.meta.env.VITE_STATIC_DEMO === "1";
  const initialEndpoint = getAgentEndpoint();
  const initialBackend = STATIC_DEMO
    ? "mock"
    : (params.get("backend") as Backend) || (initialEndpoint ? "agui" : "mock");
  const initialLang: Lang = params.get("lang") === "zh" ? "zh" : "en";
  const [jumpToSkins] = useState(() => params.get("section") === "skins");
  // white-label injection demo: ?agent=Acme%20Copilot&model=gpt-x
  const [customBrand] = useState(() => ({ agent: params.get("agent"), model: params.get("model") }));

  const [full, setFull] = useState(params.get("full") === "1");
  const [skinId, setSkinId] = useState(() => getSkin(params.get("skin")).id);
  const [tuningBySkin, setTuningBySkin] = useState<Record<string, SkinTuning>>(() => {
    const seeded = loadTuning();
    // shareable tuning links: ?accent=%23db2777&anim=rise&density=compact
    const seededTuning = sanitizeTuning({
      accent: params.get("accent"),
      anim: params.get("anim"),
      density: params.get("density"),
      motion: params.get("motion"),
      radius: params.get("radius"),
      scale: params.get("scale"),
      theme: params.get("theme"),
    });
    if (Object.keys(seededTuning).length) seeded[skinId] = seededTuning;
    return seeded;
  });
  // the landing page shows the customizer inline and expanded by default
  const [customizeOpen, setCustomizeOpen] = useState(() => params.get("customize") !== "0" && !params.get("full"));
  const [backend, setBackend] = useState<Backend>(initialBackend);
  const [agentEndpoint, setAgentEndpointState] = useState<AgentEndpoint | null>(initialEndpoint);
  const [lang, setLang] = useState<Lang>(initialLang);
  const [health, setHealth] = useState<BridgeHealth | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(params.get("palette") === "1");
  const [runInfoOpen, setRunInfoOpen] = useState(params.get("run-info") === "1");
  const storeRef = useRef<ConversationStore | null>(null);

  setI18nLang(lang);

  if (!storeRef.current) {
    storeRef.current = createStudio({ autoplay: scene === "live" && initialBackend === "mock", scenario });
    storeRef.current.setLang(lang);
    storeRef.current.setAgentEndpoint(initialEndpoint);
  }
  const store = storeRef.current;
  const skin = getSkin(skinId);
  const SkinPage = skin.ChatPage;
  const zh = lang === "zh";

  useEffect(() => {
    if (scene !== "live") store.loadScene(scene === "done" ? "done" : "interrupted");
  }, [scene, store]);

  const previousScenario = useRef(scenario);
  useEffect(() => {
    if (previousScenario.current === scenario) return;
    previousScenario.current = scenario;
    store.setScenario(scenario);
    store.setLang(lang);
    store.prepareIdle();
    if (scene !== "live") {
      store.loadScene(scene === "done" ? "done" : "interrupted");
    } else if (store.backend === "mock") {
      store.replay();
    }
  }, [scenario, scene, lang, store]);

  useEffect(() => {
    if (STATIC_DEMO) {
      setHealth({ reachable: false, pi: false, error: "static demo" });
      store.piStatus = "unavailable";
      store.transport = "static demo";
      return;
    }
    let alive = true;
    checkBridge().then((result) => {
      if (!alive) return;
      setHealth(result);
      store.piStatus = result.reachable ? (result.pi ? "ready" : "fixture") : "unavailable";
      if (store.backend !== "agui") {
        store.transport = result.pi ? "pi rpc" : result.reachable ? "pi fixture" : "mock SSE";
      }
      store.touch();
    });
    return () => {
      alive = false;
    };
  }, [store]);

  useEffect(() => {
    if (initialBackend === "mock") return;
    store.setAgentEndpoint(agentEndpoint);
    store.setBackend(initialBackend);
    store.prepareIdle();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ?autosend=1&prompt=… — drive a real backend once (headless verification)
  const autosent = useRef(false);
  useEffect(() => {
    if (autosent.current || initialBackend === "mock") return;
    if (params.get("autosend") !== "1") return;
    autosent.current = true;
    const text =
      params.get("prompt") ||
      (initialLang === "zh"
        ? "查一下里斯本今天的天气,再给我两条打包建议。"
        : "Check today's weather in Lisbon, then give me two packing tips.");
    const timer = window.setTimeout(() => store.send(text), 1500);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // shareable URL: skin + language + backend + scene + full + current tuning
  useEffect(() => {
    const query = buildAppQuery({
      skin: skinId,
      lang,
      backend,
      scene,
      full,
      scenario,
      tuning: tuningBySkin[skinId] ?? {},
    });
    const next = new URLSearchParams(query);
    const managed = new Set([
      "skin", "lang", "backend", "scene", "full", "scenario",
      "accent", "anim", "density", "motion", "radius", "scale",
    ]);
    for (const [key, value] of new URLSearchParams(window.location.search)) {
      if (!managed.has(key)) next.set(key, value);
    }
    window.history.replaceState(null, "", "?" + next.toString());
  }, [skinId, lang, backend, scene, full, scenario, tuningBySkin]);

  // design-review hook: jump to the inline skins section
  useEffect(() => {
    if (!jumpToSkins) return;
    const id = window.setTimeout(() => {
      const scroller = document.querySelector(".home") as HTMLElement | null;
      const section = document.querySelector(".skins-section") as HTMLElement | null;
      if (scroller && section) scroller.scrollTop = section.offsetTop;
    }, 500);
    return () => window.clearTimeout(id);
  }, [jumpToSkins, full]);

  const stateJson = () =>
    JSON.stringify(
      {
        skin: skinId,
        backend,
        lang,
        threadId: store.threadId,
        runId: store.runId,
        status: store.status,
        events: store.events.length,
        tokens: store.tokens,
        sharedState: store.sharedState,
      },
      null,
      2
    );
  const copyState = () => navigator.clipboard?.writeText(stateJson());

  function chooseLang(next: Lang) {
    setLang(next);
    setI18nLang(next);
    store.setLang(next);
    store.replay();
  }

  function configureAgent() {
    const current = agentEndpoint?.url ?? "http://127.0.0.1:5180/agui";
    const url = window.prompt(
      zh
        ? "输入 AG-UI 端点 URL（POST RunAgentInput，返回 text/event-stream）："
        : "Enter an AG-UI endpoint URL (POST RunAgentInput, returns text/event-stream):",
      current
    );
    if (!url || !url.trim()) return;
    const endpoint = { url: url.trim().replace(/\/$/, "") };
    setAgentEndpointState(endpoint);
    persistAgentEndpoint(endpoint);
    store.stop();
    store.setAgentEndpoint(endpoint);
    store.setBackend("agui");
    store.prepareIdle();
    setBackend("agui");
  }

  function chooseBackend(next: Backend) {
    if (STATIC_DEMO) return;
    if (next === "agui" && !agentEndpoint) {
      configureAgent();
      return;
    }
    if (store.status === "running" || store.status === "interrupted") store.stop();
    setBackend(next);
    store.setBackend(next);
    if (next === "mock") store.replay();
    else store.prepareIdle();
  }

  function openSkin(id: string) {
    setSkinId(id);
  }

  function openFullscreen() {
    setFull(true);
    setCustomizeOpen(false);
    window.scrollTo(0, 0);
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((open) => !open);
        return;
      }
      const target = e.target as HTMLElement;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      if (e.key.toLowerCase() === "r") store.replay();
      if (e.key.toLowerCase() === "l") chooseLang(lang === "zh" ? "en" : "zh");
      const index = Number(e.key) - 1;
      if (index >= 0 && index < skins.length) openSkin(skins[index].id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [store, lang]);

  const backendName = STATIC_DEMO
    ? zh
      ? "演示模式"
      : "demo mode"
    : backend === "mock"
    ? zh
      ? "演示"
      : "mock"
    : backend === "pi"
    ? "pi · live"
    : backend === "agui"
    ? "AG-UI"
    : "pi · rec";
  const endpointNote = backend === "agui" && agentEndpoint ? `AG-UI · ${agentEndpoint.url.replace(/^https?:\/\//, "")}` : null;
  const piNote = endpointNote ?? (STATIC_DEMO
    ? zh
      ? "静态演示 · 无需后端"
      : "static demo · no backend"
    : !health
    ? "…"
    : !health.reachable
    ? "bridge offline"
    : [
        health.pi ? `pi ${health.version ?? ""}`.trim() : "pi off",
        health.deepseek?.configured ? `deepseek ${health.deepseek.model ?? ""}`.trim() : "deepseek off",
        health.deepagent?.reachable ? "deepagent on" : "deepagent off",
      ].join(" · "));

  const rows = [
    { label: "skin", value: skin.name },
    { label: "backend", value: backendName },
    { label: "thread", value: store.threadId },
    { label: "run", value: store.runId },
    { label: "status", value: store.status },
    { label: "events", value: String(store.events.length) },
    { label: "tokens", value: String(store.tokens) },
  ];

  const branding = {
    agentName: customBrand.agent ?? "AG-UI Assistant",
    modelLabel: customBrand.model ?? "gemini-2.5-flash",
  };

  const tuning = tuningBySkin[skinId] ?? {};
  const updateTuning = (next: SkinTuning) => {
    setTuningBySkin((prev) => {
      const all = { ...prev, [skinId]: next };
      try {
        localStorage.setItem(TUNING_KEY, JSON.stringify(all));
      } catch {
        /* private mode */
      }
      return all;
    });
  };

  const inlineCustomize = (
    <CustomizePanel
      variant="inline"
      open={true}
      skinId={skinId}
      skinName={getSkin(skinId).name}
      tuning={tuning}
      onChange={updateTuning}
    />
  );

  const skinStage = (
    <SkinHostProvider
      conversation={store as unknown as SkinConversation}
      lang={lang}
      branding={branding}
      tuning={tuning}
      skin={skinId}
    >
      <ErrorBoundary FallbackComponent={SkinCrash} onReset={() => store.replay()} resetKeys={[skinId, lang]}>
        <CrashProbe />
        <SkinPage />
      </ErrorBoundary>
    </SkinHostProvider>
  );

  return (
    <>
      {full ? (
        <div className={`studio-full lang-${lang} relative h-[100svh] overflow-hidden bg-(--bg-inset) font-(family-name:--font-sans) text-(--fg) antialiased`}>
          {/* the bottom strip is reserved for the dock (bottom 16px + ~40px tall):
              skins are height:100% so they shrink cleanly */}
          <div className="stage-full absolute inset-0 [&>*]:absolute [&>*]:inset-x-0 [&>*]:top-0 [&>*]:bottom-16 [&>*]:h-auto [&>*]:min-h-0">{skinStage}</div>
          <div className="dock fixed bottom-4 left-4 z-[60] flex items-center gap-1 rounded-full border border-(--hairline) bg-[rgba(255,255,255,0.78)] p-1 backdrop-blur-[18px] backdrop-saturate-[140%] max-[860px]:inset-x-2.5 max-[860px]:bottom-2.5 max-[860px]:justify-center" role="toolbar" aria-label="Studio">
            <button
              className="dock-btn dock-btn--label inline-flex h-[30px] min-w-[30px] cursor-pointer items-center justify-center gap-1.5 rounded-full border border-transparent bg-none px-2.5 font-(family-name:--font-mono) text-[10.5px] text-(--fg-secondary) transition-[background,color] duration-(--t-fast) ease-(--ease) hover:bg-[rgba(0,0,0,0.05)] hover:text-(--fg)"
             
              onClick={() => setFull(false)}
              title={zh ? "退出全屏（Esc）" : "Exit full screen (Esc)"}
            >
              <Icon name="arrow-left" size={14} />
              <span className="text-[10px] tracking-[0.06em] uppercase">{zh ? "退出" : "exit"}</span>
            </button>
            <span className="dock-sep mx-1 h-4 w-px bg-(--hairline)" />
            {skins.map((s) => (
              <button
                key={s.id}
                className={`dock-dot grid h-6 w-6 cursor-pointer place-items-center rounded-full border transition-[border-color,background,transform] duration-(--t-fast) ease-(--ease) hover:-translate-y-px hover:border-(--hairline-strong) ${s.id === skinId ? "is-active border-(--accent) bg-(--accent-dim)" : "border-(--hairline) bg-[rgba(0,0,0,0.04)]"}`}
               
                onClick={() => openSkin(s.id)}
                title={`${s.name} — ${s.tagline}`}
                aria-label={s.name}
              >
                <i className="h-2 w-2 rounded-full" style={{ background: s.swatch[2] }} />
              </button>
            ))}
            <span className="dock-sep mx-1 h-4 w-px bg-(--hairline)" />
            <button className="dock-btn inline-flex h-[30px] min-w-[30px] cursor-pointer items-center justify-center gap-2 rounded-full border border-transparent bg-none px-2 font-(family-name:--font-mono) text-[10.5px] text-(--fg-secondary) transition-[background,color] duration-(--t-fast) ease-(--ease) hover:bg-[rgba(0,0,0,0.05)] hover:text-(--fg)" onClick={() => setPaletteOpen(true)} title={zh ? "命令面板 ⌘K" : "Command palette ⌘K"}>
              <Icon name="command" size={14} />
            </button>
            <button
              className={`dock-btn inline-flex h-[30px] min-w-[30px] cursor-pointer items-center justify-center gap-2 rounded-full border px-2 font-(family-name:--font-mono) text-[10.5px] transition-[background,color] ${customizeOpen ? "border-(--accent-line) bg-(--accent-dim) text-(--accent-hover)" : "border-transparent bg-none text-(--fg-secondary) hover:bg-[rgba(0,0,0,0.05)] hover:text-(--fg)"}`}
             
              onClick={() => setCustomizeOpen((v) => !v)}
              title={zh ? "自定义外观" : "Customize"}
              data-active={customizeOpen || undefined}
            >
              <Icon name="sliders" size={14} />
            </button>
            <button className="dock-btn dock-mono inline-flex h-[30px] min-w-[30px] cursor-pointer items-center justify-center gap-2 rounded-full border border-transparent bg-none px-2 font-(family-name:--font-mono) text-[9px] tracking-[0.06em] text-(--fg-secondary) transition-[background,color] duration-(--t-fast) ease-(--ease) hover:bg-[rgba(0,0,0,0.05)] hover:text-(--fg)" onClick={() => chooseLang(zh ? "en" : "zh")} title={zh ? "切换语言" : "Language"}>
              {zh ? "中" : "EN"}
            </button>
            {!STATIC_DEMO && (
              <BackendMenu
                backend={backend}
                lang={lang}
                health={health}
                agentEndpoint={agentEndpoint?.url}
                onConfigureAgent={configureAgent}
                onBackend={(next) => chooseBackend(next)}
                triggerClassName="dock-btn dock-mono inline-flex h-[30px] min-w-[30px] cursor-pointer items-center justify-center gap-2 rounded-full border border-transparent bg-none px-2 font-(family-name:--font-mono) text-[9px] tracking-[0.06em] text-(--fg-secondary) transition-[background,color] duration-(--t-fast) ease-(--ease) hover:bg-[rgba(0,0,0,0.05)] hover:text-(--fg)"
              />
            )}
            <button className="dock-btn inline-flex h-[30px] min-w-[30px] cursor-pointer items-center justify-center gap-2 rounded-full border border-transparent bg-none px-2 font-(family-name:--font-mono) text-[10.5px] text-(--fg-secondary) transition-[background,color] duration-(--t-fast) ease-(--ease) hover:bg-[rgba(0,0,0,0.05)] hover:text-(--fg)" onClick={() => setRunInfoOpen(true)} title={zh ? "运行详情" : "Run details"}>
              <Icon name="braces" size={14} />
            </button>
            <span className="dock-sep mx-1 h-4 w-px bg-(--hairline)" />
            <span className="dock-btn dock-mono inline-flex h-[30px] min-w-[30px] items-center justify-center gap-2 rounded-full border border-transparent bg-none px-2 font-(family-name:--font-mono) text-[9px] tracking-[0.06em] text-(--fg-secondary) opacity-55" style={{ pointerEvents: "none" }}>
              {piNote}
            </span>
          </div>
        </div>
      ) : (
        <Home
          skins={skins.map((s) => ({ id: s.id, name: s.name, tagline: s.tagline, accent: s.swatch[2] }))}
          lang={lang}
          backend={backend}
          piNote={piNote}
          activeSkin={skinId}
          onSkin={openSkin}
          onPalette={() => setPaletteOpen(true)}
          onLang={() => chooseLang(zh ? "en" : "zh")}
          onBackend={chooseBackend}
          staticDemo={STATIC_DEMO}
          scenario={scenario}
          onScenario={setScenario}
          health={health}
          agentEndpoint={agentEndpoint?.url}
          onConfigureAgent={configureAgent}
          customize={inlineCustomize}
          onRunInfo={() => setRunInfoOpen(true)}
          onReplay={() => store.replay()}
          onDocs={() => window.open("https://docs.ag-ui.com/introduction", "_blank", "noreferrer")}
          onFullscreen={openFullscreen}
        >
          {skinStage}
        </Home>
      )}

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        skins={skins.map((s) => ({ id: s.id, name: s.name, tagline: s.tagline }))}
        currentSkin={skinId}
        onSkin={openSkin}
        lang={lang}
        onLang={chooseLang}
        backend={backend}
        onBackend={chooseBackend}
        staticDemo={STATIC_DEMO}
        onReplay={() => store.replay()}
        onRunInfo={() => setRunInfoOpen(true)}
        onCopyState={copyState}
      />

      {full && (
        <CustomizePanel
          variant="drawer"
          open={customizeOpen}
          skinId={skinId}
          skinName={getSkin(skinId).name}
          tuning={tuning}
          onChange={updateTuning}
          onClose={() => setCustomizeOpen(false)}
        />
      )}

      <RunDialog open={runInfoOpen} onOpenChange={setRunInfoOpen} rows={rows} onCopy={copyState} />
    </>
  );
}

/** Dev hook: ?crash-test=1 forces a throw so the boundary can be verified. */
function CrashProbe() {
  if (new URLSearchParams(window.location.search).has("crash-test")) {
    throw new Error("forced crash: error boundary self-test");
  }
  return null;
}

function SkinCrash({ error, resetErrorBoundary }: FallbackProps) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div className="crash grid h-full place-items-center bg-[radial-gradient(ellipse_60%_50%_at_50%_0%,rgba(220,38,38,0.05),transparent_70%),#f6f6f7] p-8">
      <div className="crash-card max-w-[520px] rounded-2xl border border-[rgba(220,38,38,0.25)] bg-white px-[26px] py-6 shadow-[0_30px_80px_-40px_rgba(24,24,27,0.25)]">
        <div className="crash-kicker mb-2 font-(family-name:--font-mono) text-[9px] tracking-[0.22em] text-[#dc2626] uppercase">Skin crashed</div>
        <h2 className="m-0 mb-2.5 text-[18px] tracking-[-0.01em] text-[#18181b]">这套皮肤渲染时抛错了</h2>
        <pre className="crash-msg mb-4 mt-0 max-h-[140px] overflow-auto rounded-[9px] border border-[rgba(17,17,20,0.08)] bg-[rgba(0,0,0,0.04)] px-3 py-2.5 font-(family-name:--font-mono) text-[11px] leading-[1.6] text-[#b91c1c] whitespace-pre-wrap">{message}</pre>
        <div className="crash-actions mb-3 flex gap-2.5">
          <button className="crash-btn h-8 cursor-pointer rounded-lg border-0 bg-[linear-gradient(100deg,#ff9aa6,#ffc46b)] px-3.5 text-xs text-[#120a0c]" onClick={resetErrorBoundary}>重试这张皮肤</button>
          <button
            className="crash-btn crash-btn--ghost h-8 cursor-pointer rounded-lg border border-[rgba(17,17,20,0.14)] bg-[rgba(0,0,0,0.03)] px-3.5 text-xs text-[#18181b]"
            onClick={() => navigator.clipboard?.writeText(error instanceof Error ? error.stack || message : message)}
          >
            复制错误
          </button>
        </div>
        <p className="crash-note m-0 text-[10.5px] leading-[1.6] text-[rgba(24,24,27,0.5)]">错误边界只兜住当前这一帧：其他皮肤、事件流和输入框都还能用。</p>
      </div>
    </div>
  );
}


const TUNING_KEY = "agui-studio:tuning";

function loadTuning(): Record<string, SkinTuning> {
  try {
    const raw = localStorage.getItem(TUNING_KEY);
    return raw ? (JSON.parse(raw) as Record<string, SkinTuning>) : {};
  } catch {
    return {};
  }
}
