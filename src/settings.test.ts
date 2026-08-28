import { describe, expect, it } from "vitest";
import {
  DEFAULT_PET_SETTINGS,
  PET_MAX_SIZE,
  PET_MIN_SIZE,
  BOW_BUBBLE_COLOR,
  getPetBubbleColor,
  getPetPalette,
  normalizePetSettings,
} from "./settings";

describe("normalizePetSettings", () => {
  it("uses the compact default for missing data", () => {
    expect(normalizePetSettings(null)).toEqual(DEFAULT_PET_SETTINGS);
  });

  it("clamps and rounds the requested size", () => {
    expect(normalizePetSettings({ size: PET_MIN_SIZE - 30, color: "ocean" })).toEqual({
      size: PET_MIN_SIZE,
      color: "ocean",
      variant: "classic",
      codexIntegration: false,
    });
    expect(normalizePetSettings({ size: PET_MAX_SIZE + 30, color: "plum" }).size).toBe(PET_MAX_SIZE);
    expect(normalizePetSettings({ size: 104.6, color: "forest" }).size).toBe(105);
  });

  it("rejects unknown palette ids", () => {
    expect(normalizePetSettings({ size: 120, color: "neon-yellow" })).toEqual({
      size: 120,
      color: DEFAULT_PET_SETTINGS.color,
      variant: "classic",
      codexIntegration: false,
    });
  });

  it("keeps old saved settings compatible and accepts the bow variant", () => {
    expect(normalizePetSettings({ size: 105, color: "plum" }).variant).toBe("classic");
    expect(normalizePetSettings({ size: 105, color: "plum", variant: "bow" }).variant).toBe("bow");
    expect(normalizePetSettings({ size: 105, color: "plum", variant: "unknown" }).variant).toBe("classic");
  });

  it("keeps Codex integration opt-in", () => {
    expect(normalizePetSettings({ codexIntegration: true }).codexIntegration).toBe(true);
    expect(normalizePetSettings({ codexIntegration: false }).codexIntegration).toBe(false);
    expect(normalizePetSettings({ codexIntegration: "yes" }).codexIntegration).toBe(false);
  });

  it("uses pink bubbles only for the bow variant", () => {
    const palette = getPetPalette("ocean");
    expect(
      getPetBubbleColor(
        { size: 105, color: "ocean", variant: "classic", codexIntegration: false },
        palette,
      ),
    ).toBe(palette);
    expect(
      getPetBubbleColor(
        { size: 105, color: "ocean", variant: "bow", codexIntegration: false },
        palette,
      ),
    ).toBe(BOW_BUBBLE_COLOR);
  });
});
