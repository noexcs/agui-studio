import aurora from "./aurora";
import paper from "./paper";
import terminal from "./terminal";
import brutalist from "./brutalist";
import classic from "./classic";
import particle from "./particle";

import type { SkinDefinition } from "../contract";

/** Re-exported so skins import one canonical type. */
export type Skin = SkinDefinition;

export const skins: Skin[] = [aurora, paper, terminal, brutalist, classic, particle];

export const getSkin = (id: string | null | undefined): Skin =>
  skins.find((s) => s.id === id) ?? skins[0];
