import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from "react";
import { getDict, setLang as setModuleLang, setOverrides, t as moduleT } from "./i18n";
import { accentGuard, safeAccent } from "./contrast";
import type { Lang, SkinBranding, SkinConversation, SkinPlugins, SkinTuning } from "./contract";
import "./tuning.css";

export interface SkinHostValue {
  conversation: SkinConversation;
  lang: Lang;
  branding: SkinBranding;
  plugins: SkinPlugins;
  t: (key: string) => string;
}

const SkinHostContext = createContext<SkinHostValue | null>(null);

/**
 * The only integration point. Wrap a skin page with this provider:
 *
 *   <SkinHostProvider
 *     conversation={model}
 *     lang="zh"
 *     branding={{ agentName: "Acme Copilot", modelLabel: "gpt-4.1" }}
 *   >
 *     <ClassicPage />
 *   </SkinHostProvider>
 */
export function SkinHostProvider(props: {
  conversation: SkinConversation;
  lang?: Lang;
  branding?: Partial<SkinBranding>;
  /** shallow dictionary overrides, e.g. { "chat.send": "提交" } */
  messages?: Record<string, string>;
  /** host-level renderer overrides (e.g. custom CUSTOM-entry views) */
  plugins?: SkinPlugins;
  /** per-skin visual tuning (accent / text animation / density) */
  tuning?: SkinTuning;
  /** skin id, used to scope accent overrides */
  skin?: string;
  children: ReactNode;
}) {
  const lang = props.lang ?? "en";
  const branding: SkinBranding = useMemo(
    () => ({
      agentName: props.branding?.agentName ?? "AG-UI Assistant",
      modelLabel: props.branding?.modelLabel ?? "gemini-2.5-flash",
      workspaceName: props.branding?.workspaceName,
      threadTitle: props.branding?.threadTitle,
    }),
    [props.branding?.agentName, props.branding?.modelLabel, props.branding?.workspaceName, props.branding?.threadTitle]
  );

  // pin the active locale + overrides before children render
  setModuleLang(lang);
  setOverrides({ ...getDict(lang), ...(props.messages ?? {}) });

  const plugins = props.plugins ?? {};
  const t = useCallback((key: string) => moduleT(key as never), [lang, props.messages]);
  const value = useMemo<SkinHostValue>(
    () => ({ conversation: props.conversation, lang, branding, plugins, t }),
    [props.conversation, lang, branding, plugins, t]
  );

  const tuning = props.tuning ?? {};
  // Validate before injecting: a malformed ?accent= must not turn the skin's
  // accent variables into invalid CSS (which silently drops the skin color).
  // Derived guard variables (computed by color2k):
  //   --sk-accent-fg      foreground for text placed ON the accent
  //   --sk-accent-ink     accent darkened for text on light surfaces (when needed)
  //   --sk-accent-on-dark accent lightened for text on dark surfaces (when needed)
  const normalized = tuning.accent ? safeAccent(tuning.accent) : null;
  const motionFactor: Record<string, number> = { slow: 1.6, normal: 1, fast: 0.6 };
  const radiusPx: Record<string, number> = { sharp: 2, soft: 8, round: 16 };
  const tuneStyle: Record<string, string> = {};
  if (normalized) {
    const guard = accentGuard(normalized);
    Object.assign(tuneStyle, {
      "--sk-accent": normalized,
      "--sk-accent-fg": guard.onAccentFg,
      ...(guard.inkOnLight ? { "--sk-accent-ink": guard.inkOnLight } : {}),
      ...(guard.brightOnDark ? { "--sk-accent-on-dark": guard.brightOnDark } : {}),
    });
  }
  if (tuning.motion) tuneStyle["--sk-motion"] = String(motionFactor[tuning.motion] ?? 1);
  if (tuning.radius) tuneStyle["--sk-radius"] = String(radiusPx[tuning.radius] ?? 8) + "px";
  const hasStyle = Object.keys(tuneStyle).length > 0;

  return (
    <SkinHostContext.Provider value={value}>
      <div
        className="sk-tune"
        data-skin={props.skin}
        data-sk-accent={normalized ? "" : undefined}
        data-sk-text-anim={tuning.textAnim ?? "none"}
        data-sk-density={tuning.density ?? "comfortable"}
        data-sk-motion={tuning.motion}
        data-sk-radius={tuning.radius}
        style={hasStyle ? (tuneStyle as CSSProperties) : undefined}
      >
        {props.children}
      </div>
    </SkinHostContext.Provider>
  );
}

export function useSkinHost(): SkinHostValue {
  const host = useContext(SkinHostContext);
  if (!host) throw new Error("useSkinHost() must be used inside <SkinHostProvider>");
  return host;
}

const noopSubscribe = () => () => {};

/**
 * Every skin reads the conversation through this hook. It subscribes to the
 * host's conversation so streamed tokens repaint as they arrive.
 */
export function useConversation(): SkinConversation {
  const { conversation } = useSkinHost();
  useSyncExternalStore(
    conversation.subscribe ?? noopSubscribe,
    conversation.getVersion ?? (() => 0),
    conversation.getVersion ?? (() => 0)
  );
  return conversation;
}
export const useSkinConversation = useConversation;
export const useSkinBranding = (): SkinBranding => useSkinHost().branding;
export const useSkinPlugins = (): SkinPlugins => useSkinHost().plugins;
export const useSkinLang = (): Lang => useSkinHost().lang;
export const useSkinT = (): ((key: string) => string) => useSkinHost().t;
