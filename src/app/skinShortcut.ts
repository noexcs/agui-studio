/**
 * Skin hotkeys: "1"…"9" select the first nine skins and "0" selects the
 * tenth (Orbit). One shared helper keeps App.tsx wiring and the regression
 * test honest — Number(" ") is 0, so a naive Number(e.key) - 1 maps Space to
 * the first skin and leaves "0" as index -1.
 */
export function skinShortcutIndex(key: string): number | null {
  if (!/^[0-9]$/.test(key)) return null;
  return key === "0" ? 9 : Number(key) - 1;
}
