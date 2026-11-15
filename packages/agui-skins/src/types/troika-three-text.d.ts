/* Minimal local typings for troika-three-text. The package ships no .d.ts
   (checked at 0.53.1); Orbit v2 only touches this small, stable surface. */
declare module "troika-three-text" {
  import type { Mesh, ShaderMaterial } from "three";

  export interface TextOptions {
    text?: string;
    font?: string | null;
    fontSize?: number;
    maxWidth?: number;
    lineHeight?: number | "normal";
    letterSpacing?: number;
    textAlign?: "left" | "center" | "right" | "justify";
    anchorX?: number | "left" | "center" | "right";
    anchorY?: number | "top" | "top-baseline" | "middle" | "bottom-baseline" | "bottom";
    color?: string | number;
    fillOpacity?: number;
    outlineWidth?: number | string;
    outlineColor?: string | number;
    outlineOpacity?: number;
    outlineBlur?: number | string;
    outlineOffsetX?: number | string;
    outlineOffsetY?: number | string;
    depthOffset?: number;
    sdfGlyphSize?: number;
  }

  export class Text extends Mesh {
    constructor(options?: TextOptions);
    text: string;
    font: string | null;
    fontSize: number;
    maxWidth: number;
    lineHeight: number | "normal";
    letterSpacing: number;
    textAlign: "left" | "center" | "right" | "justify";
    anchorX: number | "left" | "center" | "right";
    anchorY: number | "top" | "top-baseline" | "middle" | "bottom-baseline" | "bottom";
    color: string | number;
    fillOpacity: number;
    outlineWidth: number | string;
    outlineColor: string | number;
    outlineOpacity: number;
    outlineBlur: number | string;
    outlineOffsetX: number | string;
    outlineOffsetY: number | string;
    depthOffset: number;
    material: ShaderMaterial;
    sync(callback?: () => void): void;
    dispose(): void;
  }
}
