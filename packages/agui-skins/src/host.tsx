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
import type { Lang, SkinBranding, SkinConversation, SkinTuning } from "./contract";
import "./tuning.css";

export interface SkinHostValue {
  conversation: SkinConversation;
  lang: Lang;
  branding: SkinBranding;
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

  const t = useCallback((key: string) => moduleT(key as never), [lang, props.messages]);
  const value = useMemo<SkinHostValue>(
    () => ({ conversation: props.conversation, lang, branding, t }),
    [props.conversation, lang, branding, t]
  );

  const tuning = props.tuning ?? {};
  const tuneStyle = tuning.accent ? ({ "--sk-accent": tuning.accent } as CSSProperties) : undefined;

  return (
    <SkinHostContext.Provider value={value}>
      <div
        className="sk-tune"
        data-skin={props.skin}
        data-sk-accent={tuning.accent ? "" : undefined}
        data-sk-text-anim={tuning.textAnim ?? "none"}
        data-sk-density={tuning.density ?? "comfortable"}
        style={tuneStyle}
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
export const useSkinLang = (): Lang => useSkinHost().lang;
export const useSkinT = (): ((key: string) => string) => useSkinHost().t;
