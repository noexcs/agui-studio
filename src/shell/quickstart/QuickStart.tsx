import { useEffect, useMemo, useRef, useState } from "react";
import { getSkin, skins } from "agui-skins";
import hljs from "highlight.js/lib/core";
import typescript from "highlight.js/lib/languages/typescript";
import bash from "highlight.js/lib/languages/bash";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import type { Lang } from "../../i18n";
import { Icon } from "../../shared/Icon";
import { skinSwatches } from "../../shared/skin-swatches";

/* ─────────────────────────────────────────────────────────────────────
   快速上手 — the "use it in your own app" section.

   Three code cards (install / minimal setup / real agent), a registry-driven
   skin list, and a "Copy for AI" menu that hands the full integration guide
   to an AI. Lives inside .skins-section, right before .home-foot.

   Code highlighting uses highlight.js core + only the two grammars the cards
   need. The menu is a Radix DropdownMenu (keyboard + focus management), not a
   hand-rolled popup. The minimal-setup card and the AI prompt are generated
   from the currently selected skin / language.
   ───────────────────────────────────────────────────────────────────── */

/** `npm publish` is still pending; document the local tarball path honestly. */
export const NPM_INSTALL = "pnpm add agui-skins";
export const INSTALL_COMMAND = `# 尚未发布到 npm：先本地打包,再按 tarball 安装
npm pack ./packages/agui-skins
pnpm add ./agui-skins-0.1.0.tgz`;

const INSTALL_COMMAND_EN = `# not on npm yet — pack locally, then install the tarball
npm pack ./packages/agui-skins
pnpm add ./agui-skins-0.1.0.tgz`;

/** Deep links with a prefilled prompt. Best-effort: providers may change. */
export const AI_TARGETS = [
  { id: "chatgpt", base: "https://chatgpt.com/?q=", label: "ChatGPT" },
  { id: "claude", base: "https://claude.ai/new?q=", label: "Claude" },
] as const;

const URL_LIMIT = 8000;

hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("bash", bash);

export function highlightCode(code: string, grammar: string): string {
  try {
    if (!hljs.getLanguage(grammar)) return "";
    return hljs.highlight(code, { language: grammar, ignoreIllegals: true }).value;
  } catch {
    return "";
  }
}

/** "brutalist" -> "Brutalist" — used as `<X.ChatPage />`. */
export function skinComponentName(id: string): string {
  const name = id
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join("");
  return name || "Skin";
}

/** Append ?q=<prompt> to a deep link, truncating so the URL stays under `limit`. */
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

/** The minimal-setup snippet: import path + component name + CSS + accent. */
export function minSetupCode(skinId: string, lang: Lang = "zh"): string {
  const Comp = skinComponentName(skinId);
  const accent = getSkin(skinId).swatch[2];
  const zh = lang === "zh";
  return `import { SkinHostProvider } from "agui-skins";
import type { SkinConversation } from "agui-skins";
import ${Comp} from "agui-skins/skins/${skinId}";
import "agui-skins/index.css"; // ${zh ? "样式随包分发，必须显式引入" : "styles ship with the package — import explicitly"}

// ${zh ? "皮肤只通过 useConversation() 取数据;先给一个最小静态实现" : "skins only read through useConversation(); start with a static model"}
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
      lang="${lang}"
      branding={{ agentName: "My Copilot", modelLabel: "gpt-4.1" }}
      tuning={{ accent: "${accent}", textAnim: "rise", density: "comfortable" }}
    >
      <${Comp}.ChatPage />
    </SkinHostProvider>
  );
}`;
}

/**
 * The full integration guide handed to an AI via copy / deep link.
 * Skin metadata is read from the registry at runtime so it never drifts.
 */
export function buildAiPrompt(skinId: string = "aurora", lang: Lang = "zh"): string {
  const skin = getSkin(skinId);
  const zh = lang === "zh";
  const skinList = skins.map((s) => `- ${s.name} — ${s.tagline}`).join("\n");
  const install = zh ? INSTALL_COMMAND : INSTALL_COMMAND_EN;

  if (!zh) {
    return `Please integrate AG-UI Studio's conversation skins (agui-skins) into my React app. This guide reflects its real public API. The minimal example targets the selected skin "${skin.name}" (id: ${skin.id}).

## Install
${install}
Not published on npm yet; after publishing: ${NPM_INSTALL}
peer deps: react >=18, react-dom >=18, react-markdown >=9, remark-gfm >=4, lucide-react >=0.4
optional peers (Aurora inspector only): @radix-ui/react-tabs >=1.2, react-json-view-lite >=2

## Skins (${skins.length})
${skinList}

## Minimal integration
\`\`\`tsx
${minSetupCode(skin.id, "en")}
\`\`\`
Swap the last import + component name for another skin.

## Contract
- Skins never parse protocol events: they read the normalized view model from useConversation() (entries, sharedState, status, threadId, runId, tokens, getVersion, duration, send, stop, replay, resolveInterrupt). The host store reduces AG-UI events into that model (see ConversationStore.dispatch).
- SkinHostProvider props: conversation (required), lang ("en" | "zh"), branding ({ agentName, modelLabel }), tuning (SkinTuning), messages (dictionary overrides). tuning.accent is consumed by each skin's own CSS — no skin prop needed.
- SkinTuning: accent, textAnim ("none" | "fade" | "rise"), density ("comfortable" | "compact").
- CSS is shipped separately and is NOT auto-injected: import "agui-skins/index.css" (all skins) or "agui-skins/skins/<id>.css" (one skin).
- Real agent: the reference SSE transport is not part of the package — copy HttpAgentTransport (~50 lines) from this repo's src/core/transport.ts, then consume AG-UI BaseEvents (RUN_STARTED / TEXT_MESSAGE_* / TOOL_CALL_* / STATE_SNAPSHOT / STATE_DELTA / RUN_FINISHED).

## Pitfalls
- Never pass raw BaseEvents to a skin; reduce them into entries first.
- RUN_FINISHED with outcome.type === "interrupt" means approvals are pending; a resume must cover every open interrupt of that run, and an expired interrupt (expiresAt) must not be resumed.
- STATE_DELTA is RFC 6902 JSON Patch applied on top of the last STATE_SNAPSHOT.
- Validate rendering with a static idle conversation first, then wire SSE and dump the event stream when debugging.`;
  }

  return `请把 AG-UI Studio 的对话皮肤(agui-skins)接入到我的 React 网页里。以下是一份准确的接入指南,基于它的真实公开 API。示例代码按当前选中的皮肤「${skin.name}」(id: ${skin.id})生成。

## 安装
${install}
尚未发布到 npm;发布后可用:${NPM_INSTALL}
peer 依赖:react >=18、react-dom >=18、react-markdown >=9、remark-gfm >=4、lucide-react >=0.4
可选 peer(仅 Aurora 事件检查器):@radix-ui/react-tabs >=1.2、react-json-view-lite >=2

## 皮肤清单(共 ${skins.length} 套)
${skinList}

## 最小接入代码
\`\`\`tsx
${minSetupCode(skin.id, "zh")}
\`\`\`
换其它皮肤只需改最后一行 import 与组件名(<X.ChatPage />)。

## 关键契约
- 皮肤绝不解析协议事件:数据只经 useConversation() 从 SkinHostProvider 的 conversation 取,events/entries 等由宿主的 store 归约(参考 ConversationStore:dispatch(event) 把 AG-UI BaseEvent 归约成 entries 视图模型)。
- conversation 必须实现 SkinConversation(entries、sharedState、status、threadId、runId、tokens、getVersion、duration、send、stop、replay、resolveInterrupt…),类型从 "agui-skins" 的 contract 导出面拿。
- SkinHostProvider props:conversation(必填)、lang("en" | "zh")、branding({ agentName, modelLabel })、tuning(SkinTuning)、messages(字典覆盖)。tuning.accent 由各皮肤自己的 CSS 消费,无需额外 skin prop。
- SkinTuning 可调:accent(色值)、textAnim("none" | "fade" | "rise")、density("comfortable" | "compact")。
- CSS 随包分发但不会自动注入:必须显式 import "agui-skins/index.css"(整包)或按皮肤 import "agui-skins/skins/<id>.css"。
- 接真实 agent:参考实现不在包内 —— 复制本仓库 src/core/transport.ts 的 HttpAgentTransport(约 50 行),逐个消费 AG-UI BaseEvent(type 如 RUN_STARTED / TEXT_MESSAGE_START|CONTENT|END / TOOL_CALL_* / STATE_SNAPSHOT / STATE_DELTA / RUN_FINISHED)。

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

/* ── code sample: real agent (kept in sync with src/core/{transport,store}.ts) ── */

const LIVE_AGENT_CODE = `// 1) SSE 适配层:复制本仓库 src/core/transport.ts(HttpAgentTransport,约 50 行零依赖,不在 npm 包内)
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

function HighlightedCode({ code, grammar }: { code: string; grammar: string }) {
  const html = useMemo(() => highlightCode(code, grammar), [code, grammar]);
  return (
    <pre className="qs-code">
      {html ? (
        <code className={`hljs language-${grammar}`} dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <code>{code}</code>
      )}
    </pre>
  );
}

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

function CopyButton({ text, zh }: { text: string; zh: boolean }) {
  const [copied, flash] = useCopyFlash();
  return (
    <>
      <button
        className={`qs-copy-btn ${copied ? "is-copied" : ""}`}
        onClick={async () => flash(await copyText(text))}
        title={zh ? "复制" : "Copy"}
      >
        <Icon name={copied ? "check" : "copy"} size={12} />
        {copied ? (zh ? "已复制" : "Copied") : zh ? "复制" : "Copy"}
      </button>
      <span className="sr-only" role="status" aria-live="polite">
        {copied ? (zh ? "已复制" : "Copied") : ""}
      </span>
    </>
  );
}

/** "Copy for AI" menu: Radix DropdownMenu — keyboard navigation + focus return. */
function CopyForAI({ zh, lang, skinId }: { zh: boolean; lang: Lang; skinId: string }) {
  const [copied, flash] = useCopyFlash();
  const prompt = buildAiPrompt(skinId, lang);

  const copy = async (text: string) => {
    flash(await copyText(text));
  };

  return (
    <div className="qs-copyai">
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button className={`qs-copyai-btn ${copied ? "is-copied" : ""}`} aria-haspopup="menu">
            <Icon name={copied ? "check" : "copy"} size={13} />
            {copied ? (zh ? "已复制" : "Copied") : "Copy for AI"}
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="qs-menu" sideOffset={8} align="end">
            <DropdownMenu.Item className="qs-menu-item" onSelect={() => copy(prompt)}>
              <Icon name="sparkle" size={13} />
              {zh ? "复制接入提示词" : "Copy prompt"}
            </DropdownMenu.Item>
            <DropdownMenu.Item className="qs-menu-item" onSelect={() => copy(INSTALL_COMMAND)}>
              <Icon name="terminal" size={13} />
              {zh ? "复制安装命令" : "Copy install command"}
            </DropdownMenu.Item>
            <DropdownMenu.Separator className="qs-menu-sep" />
            {AI_TARGETS.map((target) => (
              <DropdownMenu.Item key={target.id} className="qs-menu-item" asChild>
                <a href={prefillUrl(target.base, prompt)} target="_blank" rel="noreferrer">
                  <Icon name="arrow-up-right" size={13} />
                  {zh ? `在 ${target.label} 打开` : `Open in ${target.label}`}
                </a>
              </DropdownMenu.Item>
            ))}
            <p className="qs-menu-note">
              {zh ? "预填链接为 best-effort,可能随服务商变化" : "Prefilled links are best-effort and may change."}
            </p>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      <span className="sr-only" role="status" aria-live="polite">
        {copied ? (zh ? "已复制" : "Copied") : ""}
      </span>
    </div>
  );
}

/* ── the section ───────────────────────────────────────────────────── */

export function QuickStart({ lang, activeSkin }: { lang: Lang; activeSkin: string }) {
  const zh = lang === "zh";
  const skin = getSkin(activeSkin);
  const setupCode = minSetupCode(skin.id, lang);
  const Comp = skinComponentName(skin.id);
  const installCommand = zh ? INSTALL_COMMAND : INSTALL_COMMAND_EN;
  const openHref = (id: string) => `?skin=${encodeURIComponent(id)}&lang=${lang}&section=skins`;

  return (
    <section className="quickstart-section" id="quickstart">
      <div className="section-head">
        <div>
          <p className="section-kicker">{zh ? "快速上手" : "Get started"}</p>
          <h2>{zh ? "用在自己的网页里" : "Use them in your own app"}</h2>
        </div>
        <CopyForAI zh={zh} lang={lang} skinId={skin.id} />
      </div>
      <p className="qs-intro">
        {zh
          ? "三步把任意皮肤嵌进你的 React 应用:装包 → 包一层 SkinHostProvider → 接上你的 agent。示例代码跟随上面选中的皮肤,也可以把完整接入指南直接交给 AI。"
          : "Three steps to embed any skin in your React app: install, wrap in a SkinHostProvider, connect your agent. Examples follow the skin selected above — or hand the full guide to an AI."}
      </p>

      <ol className="qs-steps">
        <li className="qs-card">
          <div className="qs-code-zone">
            <HighlightedCode code={installCommand} grammar="bash" />
            <p className="qs-card-note">
              {zh
                ? `尚未发布到 npm:先在仓库内打包再安装;发布后可直接 ${NPM_INSTALL}。peer 依赖:react ≥18、react-dom ≥18、react-markdown ≥9、remark-gfm ≥4、lucide-react ≥0.4`
                : `Not on npm yet: pack locally and install the tarball; once published use ${NPM_INSTALL}. Peers: react >=18, react-dom >=18, react-markdown >=9, remark-gfm >=4, lucide-react >=0.4`}
            </p>
          </div>
          <div className="qs-card-foot">
            <span className="qs-step-no">01</span>
            <strong>{zh ? "安装" : "Install"}</strong>
            <span className="qs-lang">bash</span>
            <CopyButton text={installCommand} zh={zh} />
          </div>
        </li>

        <li className="qs-card">
          <div className="qs-code-zone">
            <HighlightedCode code={setupCode} grammar="tsx" />
            <p className="qs-card-note">
              {zh
                ? `conversation 先给静态实现跑起来,再换成你的 store;皮肤换 <${Comp}.ChatPage /> 为任意皮肤入口。`
                : `Start with a static conversation, then swap in your store; swap <${Comp}.ChatPage /> for any skin entry.`}
            </p>
          </div>
          <div className="qs-card-foot">
            <span className="qs-step-no">02</span>
            <strong>{zh ? "最小可跑示例" : "Minimal setup"}</strong>
            <span className="qs-lang">tsx</span>
            <CopyButton text={setupCode} zh={zh} />
          </div>
        </li>

        <li className="qs-card">
          <div className="qs-code-zone">
            <HighlightedCode code={LIVE_AGENT_CODE} grammar="tsx" />
            <p className="qs-card-note">
              {zh
                ? "服务端按 SSE 返回 AG-UI 事件;transport 参考实现不在包内,从本仓库 src/core/transport.ts 复制。"
                : "The server streams AG-UI events over SSE; the transport reference is not in the package — copy it from this repo's src/core/transport.ts."}
            </p>
          </div>
          <div className="qs-card-foot">
            <span className="qs-step-no">03</span>
            <strong>{zh ? "接真实 agent" : "Connect a real agent"}</strong>
            <span className="qs-lang">tsx</span>
            <CopyButton text={LIVE_AGENT_CODE} zh={zh} />
          </div>
        </li>
      </ol>

      <ul className="qs-skins" aria-label={zh ? "皮肤一览" : "Skins"}>
        {skins.map((s) => {
          const isCurrent = s.id === skin.id;
          return (
            <li className="qs-skin-item" key={s.id}>
              <a
                className={`qs-skin-row ${isCurrent ? "is-current" : ""}`}
                href={openHref(s.id)}
                title={`${s.name} — ${s.tagline}`}
                aria-current={isCurrent ? "true" : undefined}
              >
                <span className="qs-swatch-row" aria-hidden="true">
                  {skinSwatches(s.id, s.swatch[2]).map((color, i) => (
                    <i key={i} style={{ background: color }} />
                  ))}
                </span>
                <strong className="qs-skin-name">{s.name}</strong>
                {isCurrent && <span className="qs-skin-current">{zh ? "当前" : "current"}</span>}
                <span className="qs-skin-tagline">{s.tagline}</span>
                <span className="qs-skin-open">
                  {zh ? "打开" : "Open"}
                  <Icon name="arrow-up-right" size={11} />
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
