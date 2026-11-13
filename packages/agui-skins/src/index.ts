export { SkinHostProvider, useSkinHost, useConversation, useSkinConversation, useSkinBranding, useSkinLang, useSkinT } from "./host";
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
  Lang,
} from "./contract";

export { skins, getSkin } from "./skins/registry";
export type { Skin } from "./skins/registry";

export { Icon } from "./shared/Icon";
export { Markdown, timeOf, clock } from "./shared/Markdown";
export { useStickToBottom } from "./shared/useStickToBottom";
export { t, setLang, getLang, isZh, getDict, setOverrides } from "./i18n";
