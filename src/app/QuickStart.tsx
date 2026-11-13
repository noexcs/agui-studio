import { useEffect, useRef, useState } from "react";
import { skins } from "agui-skins";
import type { Lang } from "../i18n";
import { Icon } from "../shared/Icon";

/* ─────────────────────────────────────────────────────────────────────
   快速上手 — the "use it in your own app" section.

   Three code cards (install / minimal setup / real agent), a registry-driven
   skin list, and a "Copy for AI" dropdown that hands the full integration
   guide to an AI. Lives on the landing page right after .skins-section.
   ───────────────────────────────────────────────────────────────────── */

export const INSTALL_COMMAND = "pnpm add agui-skins";

/** Verified prefill deep links. ChatGPT is unofficial-but-working; v0 is community-documented. */
export const AI_TARGETS = [
  { id: "chatgpt", base: "https://chatgpt.com/?q=", label: "ChatGPT" },
  { id: "claude", base: "https://claude.ai/new?q=", label: "Claude" },
  { id: "v0", base: "https://v0.dev/chat?q=", label: "v0" },
] as const;

const URL_LIMIT = 8000;

/** Append ?q=<prompt> to a deep link, truncating the prompt so the URL stays under `limit`. */
export function prefillUrl(base: string, prompt: string, limit = URL_LIMIT): string {
  const fits = (text: string) => base.length + encodeURIComponent(text).length <= limit;
  if (fits(prompt)) return base + encodeURIComponent(prompt);
  const marker = "\n\n…(prompt truncated — use Copy prompt for the full text)";
  let cut = prompt;
  while (cut.length > 40 && !fits(cut + marker)) {
    cut = cut.slice(0, Math.floor(cut.length * 0.9));
  }
  return base + encodeURIComponent(cut + marker);
}

/**
 * The full integration guide, handed to an AI via copy / deep link.
 * Skin metadata is read from the registry at runtime so it never drifts.
 */
export function buildAiPrompt(): string {
  const skinList = skins.map((s) => `- ${s.name} — ${s.tagline}`).join("\n");
  return `请把 AG-UI Studio 的对话皮肤(agui-skins)接入到我的 React 网页里。以下是一份准确的接入指南,基于它的真实公开 API。

## 安装
${INSTALL_COMMAND}
peer 依赖:react >=18、react-dom >=18、react-markdown >=9、remark-gfm >=4、lucide-react >=0.4

## 皮肤清单(共 ${skins.length} 套)
${skinList}

## 最小接入代码
\`\`\`tsx
import { SkinHostProvider } from "agui-skins";
import type { SkinConversation } from "agui-skins";
import Aurora from "agui-skins/skins/aurora";

// 皮肤只通过 useConversation() 从这里取数据;先给一个最小静态实现
const conversation: SkinConversation = {
  entries: [], sharedState: {}, stateVersion: 0, touchedPaths: [], events: [],
  status: "idle", suggestions: [], threadId: "t_demo", runId: "r_demo",
  tokens: 0, transport: "demo",
  getVersion: () => 0, duration: () => 0,
  send: () => {}, stop: () => {}, replay: () => {},
  resolveInterrupt: () => {},
};

export default function App() {
  return (
    <SkinHostProvider
      conversation={conversation}
      lang="zh"
      branding={{ agentName: "My Copilot", modelLabel: "gpt-4.1" }}
      tuning={{ accent: "#5ef0c2", textAnim: "rise", density: "comfortable" }}
    >
      <Aurora.ChatPage />
    </SkinHostProvider>
  );
}
\`\`\`

## 关键契约
- 皮肤绝不解析协议事件:数据只经 useConversation() 从 SkinHostProvider 的 conversation 取,events/entries 等由宿主的 store 归约(参考 ConversationStore:dispatch(event) 把 AG-UI BaseEvent 归约成 entries 视图模型)。
- conversation 必须实现 SkinConversation(entries、sharedState、status、threadId、runId、tokens、getVersion、duration、send、stop、replay、resolveInterrupt…),类型从 "agui-skins" 的 contract 导出面拿。
- SkinHostProvider props:conversation(必填)、lang("en" | "zh")、branding({ agentName, modelLabel })、tuning(SkinTuning)、messages(字典覆盖)。
- SkinTuning 可调:accent(色值)、textAnim("none" | "fade" | "rise")、density("comfortable" | "compact")。
- 接真实 agent:HttpAgentTransport({ url, headers? }).run(input, signal?) 是异步生成器,POST 一个 RunAgentInput 并逐个 yield AG-UI BaseEvent(type 如 RUN_STARTED / TEXT_MESSAGE_START|CONTENT|END / TOOL_CALL_* / STATE_SNAPSHOT / STATE_DELTA / RUN_FINISHED)。
- 皮肤 CSS 由各自皮肤模块自带(包声明了 sideEffects),import 对应的 skins/<id> 入口即可,不要手动引内部 css。

## 常见坑
- 别把 BaseEvent 直接塞给皮肤:皮肤只认 entries 视图模型,事件必须先经 store 归约。
- RUN_FINISHED 的 outcome.type === "interrupt" 表示有审批挂起;resume 必须覆盖该 run 的所有 pending interrupt,且 interrupt 过了 expiresAt 就不能再 resume。
- STATE_DELTA 是 RFC 6902 JSON Patch,要基于 STATE_SNAPSHOT 给出的 sharedState 应用。
- 先用 status 为 idle 的静态 conversation 验证渲染,再逐步接 SSE,出问题时先把事件流 dump 出来看。`;
}

/** navigator.clipboard with a legacy textarea fallback (jsdom / http pages). */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    if (typeof document.execCommand !== "function") return false;
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

/* ── code samples (kept in sync with the real API: src/core/{context,transport,store}.ts) ── */

const MIN_SETUP_CODE = `import { SkinHostProvider } from "agui-skins";
import type { SkinConversation } from "agui-skins";
import Aurora from "agui-skins/skins/aurora";

// 皮肤只通过 useConversation() 从这里取数据;先给一个最小静态实现
const conversation: SkinConversation = {
  entries: [], sharedState: {}, stateVersion: 0, touchedPaths: [], events: [],
  status: "idle", suggestions: [], threadId: "t_demo", runId: "r_demo",
  tokens: 0, transport: "demo",
  getVersion: () => 0, duration: () => 0,
  send: () => {}, stop: () => {}, replay: () => {},
  resolveInterrupt: () => {},
};

export default function App() {
  return (
    <SkinHostProvider
      conversation={conversation}
      lang="zh"
      branding={{ agentName: "My Copilot", modelLabel: "gpt-4.1" }}
      tuning={{ accent: "#5ef0c2", textAnim: "rise", density: "comfortable" }}
    >
      <Aurora.ChatPage />
    </SkinHostProvider>
  );
}`;

const LIVE_AGENT_CODE = `// 1) SSE 适配层:复制本仓库 src/core/transport.ts(HttpAgentTransport,约 50 行零依赖)
import { HttpAgentTransport } from "./transport";

const transport = new HttpAgentTransport({ url: "/api/agent" });

// 2) 用户发消息时跑一轮:POST RunAgentInput,逐个消费 AG-UI 事件
async function runTurn(text: string, signal?: AbortSignal) {
  const input = {
    threadId: "t_demo",
    runId: crypto.randomUUID(),
    messages: [{ id: "m_1", role: "user", content: text }],
  };
  for await (const event of transport.run(input, signal)) {
    store.dispatch(event); // 归约成 entries 视图模型,参考 src/core/store.ts
  }
}`;

/* ── small pieces ──────────────────────────────────────────────────── */

function useCopyFlash(): [boolean, (ok: boolean) => void] {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
  }, []);
  const flash = (ok: boolean) => {
    if (!ok) return;
    setCopied(true);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1600);
  };
  return [copied, flash];
}

/** Per-card copy button with a short "已复制" feedback. */
function CopyButton({ text, zh }: { text: string; zh: boolean }) {
  const [copied, flash] = useCopyFlash();
  return (
    <button
      className={`qs-copy-btn ${copied ? "is-copied" : ""}`}
      onClick={async () => flash(await copyText(text))}
      title={zh ? "复制" : "Copy"}
    >
      <Icon name={copied ? "check" : "copy"} size={12} />
      {copied ? (zh ? "已复制" : "Copied") : zh ? "复制" : "Copy"}
    </button>
  );
}

/** "Copy for AI" dropdown: copy prompt / install command + prefill deep links. */
function CopyForAI({ zh }: { zh: boolean }) {
  const [open, setOpen] = useState(false);
  const [copied, flash] = useCopyFlash();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const copy = async (text: string) => {
    flash(await copyText(text));
    setOpen(false);
  };

  const prompt = buildAiPrompt();

  return (
    <div className="qs-copyai" ref={rootRef}>
      <button
        className={`qs-copyai-btn ${copied ? "is-copied" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Icon name={copied ? "check" : "copy"} size={13} />
        {copied ? (zh ? "已复制" : "Copied") : "Copy for AI"}
      </button>
      {open && (
        <div className="qs-menu" role="menu" aria-label="Copy for AI">
          <button role="menuitem" onClick={() => copy(prompt)}>
            <Icon name="sparkle" size={13} />
            {zh ? "复制接入提示词" : "Copy prompt"}
          </button>
          <button role="menuitem" onClick={() => copy(INSTALL_COMMAND)}>
            <Icon name="terminal" size={13} />
            {zh ? "复制安装命令" : "Copy install command"}
          </button>
          <div className="qs-menu-sep" role="separator" />
          {AI_TARGETS.map((target) => (
            <a
              key={target.id}
              role="menuitem"
              href={prefillUrl(target.base, prompt)}
              target="_blank"
              rel="noreferrer"
              onClick={() => setOpen(false)}
            >
              <Icon name="arrow-up-right" size={13} />
              {zh ? `在 ${target.label} 打开` : `Open in ${target.label}`}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── the section ───────────────────────────────────────────────────── */

export function QuickStart({ lang }: { lang: Lang }) {
  const zh = lang === "zh";
  const openHref = (id: string) => `?skin=${encodeURIComponent(id)}&lang=${lang}&section=skins`;

  return (
    <section className="quickstart-section" id="quickstart">
      <div className="section-head">
        <div>
          <p className="section-kicker">{zh ? "快速上手" : "Get started"}</p>
          <h2>{zh ? "用在自己的网页里" : "Use them in your own app"}</h2>
        </div>
        <CopyForAI zh={zh} />
      </div>
      <p className="qs-intro">
        {zh
          ? "三步把任意皮肤嵌进你的 React 应用:装包 → 包一层 SkinHostProvider → 接上你的 agent。也可以把完整接入指南直接交给 AI。"
          : "Three steps to embed any skin in your React app: install, wrap in a SkinHostProvider, connect your agent. Or hand the full guide to an AI."}
      </p>

      <ol className="qs-steps">
        <li className="qs-card">
          <div className="qs-card-head">
            <span className="qs-step-no">01</span>
            <strong>{zh ? "安装" : "Install"}</strong>
            <CopyButton text={INSTALL_COMMAND} zh={zh} />
          </div>
          <pre className="qs-code"><code>{INSTALL_COMMAND}</code></pre>
          <p className="qs-card-note">
            {zh
              ? "peer 依赖:react ≥18、react-dom ≥18、react-markdown ≥9、remark-gfm ≥4、lucide-react ≥0.4"
              : "peers: react >=18, react-dom >=18, react-markdown >=9, remark-gfm >=4, lucide-react >=0.4"}
          </p>
        </li>

        <li className="qs-card">
          <div className="qs-card-head">
            <span className="qs-step-no">02</span>
            <strong>{zh ? "最小可跑示例" : "Minimal setup"}</strong>
            <CopyButton text={MIN_SETUP_CODE} zh={zh} />
          </div>
          <pre className="qs-code"><code>{MIN_SETUP_CODE}</code></pre>
          <p className="qs-card-note">
            {zh
              ? "conversation 先给静态实现跑起来,再换成你的 store;皮肤换 <Aurora.ChatPage /> 为任意皮肤入口。"
              : "Start with a static conversation, then swap in your store; swap <Aurora.ChatPage /> for any skin entry."}
          </p>
        </li>

        <li className="qs-card">
          <div className="qs-card-head">
            <span className="qs-step-no">03</span>
            <strong>{zh ? "接真实 agent" : "Connect a real agent"}</strong>
            <CopyButton text={LIVE_AGENT_CODE} zh={zh} />
          </div>
          <pre className="qs-code"><code>{LIVE_AGENT_CODE}</code></pre>
          <p className="qs-card-note">
            {zh
              ? "服务端按 SSE 返回 AG-UI 事件;dispatch 的归约逻辑参考本仓库 src/core/store.ts。"
              : "The server answers with AG-UI events over SSE; see src/core/store.ts for the reducer."}
          </p>
        </li>
      </ol>

      <div className="qs-skins" role="list" aria-label={zh ? "皮肤一览" : "Skins"}>
        {skins.map((skin) => (
          <a className="qs-skin-row" role="listitem" key={skin.id} href={openHref(skin.id)} title={`${skin.name} — ${skin.tagline}`}>
            <i className="qs-swatch" style={{ background: skin.swatch[2] }} />
            <strong className="qs-skin-name">{skin.name}</strong>
            <span className="qs-skin-tagline">{skin.tagline}</span>
            <span className="qs-skin-open">
              {zh ? "打开" : "Open"}
              <Icon name="arrow-up-right" size={11} />
            </span>
          </a>
        ))}
      </div>
    </section>
  );
}
