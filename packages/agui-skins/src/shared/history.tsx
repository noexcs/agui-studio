import { useCallback, useMemo, useState } from "react";
import type { Entry } from "../contract";
import { t } from "../i18n";

/**
 * Long-session windowing: render only the newest `limit` entries, with an
 * explicit "show earlier" affordance. This keeps the DOM bounded for thousand-
 * message transcripts without pretending to be full virtualization (skins have
 * wildly different row heights, so a simple tail window is the robust option).
 */
export function windowEntries(entries: Entry[], limit: number): { visible: Entry[]; hidden: number } {
  if (!Number.isFinite(limit) || limit >= entries.length) return { visible: entries, hidden: 0 };
  const safe = Math.max(1, Math.floor(limit));
  return { visible: entries.slice(-safe), hidden: entries.length - safe };
}

export function useVisibleEntries(entries: Entry[], initial = 60, step = 60) {
  const [limit, setLimit] = useState(initial);
  const { visible, hidden } = useMemo(() => windowEntries(entries, limit), [entries, limit]);
  const showEarlier = useCallback(() => setLimit((current) => current + step), [step]);
  return { visible, hidden, showEarlier };
}

/** Neutral, skin-agnostic "show earlier" button (inherits the skin's text color). */
export function HistoryMore({ hidden, onClick }: { hidden: number; onClick: () => void }) {
  if (hidden <= 0) return null;
  return (
    <button type="button" className="sk-history-more" onClick={onClick}>
      {t("history.more")} · {hidden}
    </button>
  );
}
