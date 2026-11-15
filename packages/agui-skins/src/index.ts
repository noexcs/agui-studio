export { SkinHostProvider, useSkinHost, useConversation, useSkinConversation, useSkinBranding, useSkinLang, useSkinT, useSkinPlugins } from "./host";
export type { SkinHostValue } from "./host";
export type {
  BaseEvent,
  Entry,
  LoggedEvent,
  StudioStatus,
  SkinBranding,
  SkinConversation,
  SkinDefinition,
  SkinTuning,
  SkinTextAnim,
  SkinDensity,
  SkinMotion,
  SkinRadius,
  SkinTextScale,
  SkinTheme,
  StepEntry,
  CustomEntry,
  SkinPlugins,
  Lang,
} from "./contract";

export { skins, getSkin } from "./skins/registry";
export type { Skin } from "./skins/registry";

export {
  accentGuard,
  safeAccent,
  AA_NORMAL_TEXT,
  LIGHT_SURFACE_REF,
  DARK_SURFACE_REF,
  DARK_INK,
} from "./contrast";
export type { AccentGuard, AccentFgTier } from "./contrast";

export { Icon } from "./shared/Icon";
export { Markdown, timeOf, clock } from "./shared/Markdown";
export { useStickToBottom } from "./shared/useStickToBottom";
export { t, setLang, getLang, isZh, getDict, setOverrides } from "./i18n";

export { toolStage } from "./shared/toolStatus";
export type { ToolStage } from "./shared/toolStatus";
export {
  conversationGroups,
  foldGroupOpen,
  foldGroupFailures,
  foldGroupStats,
  foldGroupDuration,
} from "./shared/conversationGroups";
export type { ConversationItem, FoldFailure } from "./shared/conversationGroups";
export { pendingInterrupts, firstPendingInterrupt } from "./shared/interrupts";
export { windowEntries, useVisibleEntries, HistoryMore } from "./shared/history";
