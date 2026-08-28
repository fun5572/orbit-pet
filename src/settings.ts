import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";

export const PET_MIN_SIZE = 72;
export const PET_MAX_SIZE = 210;
export const PET_DEFAULT_SIZE = 105;
export const PET_WINDOW_PADDING = 10;

export const PET_PALETTES = [
  {
    id: "obsidian",
    name: "曜石黑",
    preview: "#090a0f",
    fill: ["#252938", "#090a0f", "#020204"],
    rim: ["#7e87ff", "#3c4268", "#8a5cff"],
    spark: "#a99fff",
    accentRgb: "126, 135, 255",
  },
  {
    id: "ocean",
    name: "深海蓝",
    preview: "#0b2945",
    fill: ["#315d82", "#0b2945", "#04131f"],
    rim: ["#55c8ff", "#174363", "#3974ff"],
    spark: "#7ee4ff",
    accentRgb: "85, 200, 255",
  },
  {
    id: "plum",
    name: "星云紫",
    preview: "#2c1534",
    fill: ["#70477e", "#2c1534", "#120917"],
    rim: ["#e37bff", "#593264", "#8e55ff"],
    spark: "#f0a2ff",
    accentRgb: "227, 123, 255",
  },
  {
    id: "ember",
    name: "余烬红",
    preview: "#471a15",
    fill: ["#a05243", "#471a15", "#1b0806"],
    rim: ["#ff9d68", "#6d3027", "#ff5d4a"],
    spark: "#ffd09e",
    accentRgb: "255, 121, 85",
  },
  {
    id: "forest",
    name: "森林绿",
    preview: "#17372a",
    fill: ["#47755f", "#17372a", "#071811"],
    rim: ["#77e1ad", "#275a44", "#42aa79"],
    spark: "#a7f4cc",
    accentRgb: "105, 218, 163",
  },
] as const;

export type PetPalette = (typeof PET_PALETTES)[number];
export type PetColorId = PetPalette["id"];
export const PET_VARIANTS = [
  { id: "classic", name: "经典款" },
  { id: "bow", name: "蝴蝶结款" },
] as const;
export type PetVariant = (typeof PET_VARIANTS)[number]["id"];

export interface PetEffectColor {
  accentRgb: string;
  spark: string;
}

export const BOW_BUBBLE_COLOR: PetEffectColor = {
  accentRgb: "255, 112, 174",
  spark: "#ffd2e4",
};

export interface PetSettings {
  size: number;
  color: PetColorId;
  variant: PetVariant;
  codexIntegration: boolean;
}

export const DEFAULT_PET_SETTINGS: PetSettings = {
  size: PET_DEFAULT_SIZE,
  color: "obsidian",
  variant: "classic",
  codexIntegration: false,
};

const STORAGE_KEY = "orbit-pet:settings:v1";
const SETTINGS_EVENT = "pet-settings-changed";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export const isPetColorId = (value: unknown): value is PetColorId =>
  typeof value === "string" && PET_PALETTES.some((palette) => palette.id === value);

export const isPetVariant = (value: unknown): value is PetVariant =>
  typeof value === "string" && PET_VARIANTS.some((variant) => variant.id === value);

export const normalizePetSettings = (value: unknown): PetSettings => {
  const record = isRecord(value) ? value : {};
  const rawSize = typeof record.size === "number" && Number.isFinite(record.size)
    ? record.size
    : PET_DEFAULT_SIZE;

  return {
    size: Math.round(Math.min(PET_MAX_SIZE, Math.max(PET_MIN_SIZE, rawSize))),
    color: isPetColorId(record.color) ? record.color : DEFAULT_PET_SETTINGS.color,
    variant: isPetVariant(record.variant) ? record.variant : DEFAULT_PET_SETTINGS.variant,
    codexIntegration: record.codexIntegration === true,
  };
};

export const getPetPalette = (color: PetColorId): PetPalette =>
  PET_PALETTES.find((palette) => palette.id === color) ?? PET_PALETTES[0];

export const getPetBubbleColor = (settings: PetSettings, palette: PetPalette): PetEffectColor =>
  settings.variant === "bow" ? BOW_BUBBLE_COLOR : palette;

export const loadPetSettings = (): PetSettings => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? normalizePetSettings(JSON.parse(stored) as unknown) : { ...DEFAULT_PET_SETTINGS };
  } catch {
    return { ...DEFAULT_PET_SETTINGS };
  }
};

export const savePetSettings = (settings: PetSettings): PetSettings => {
  const normalized = normalizePetSettings(settings);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
};

const isTauriRuntime = (): boolean => "__TAURI_INTERNALS__" in window;

export const publishPetSettings = async (settings: PetSettings): Promise<PetSettings> => {
  const normalized = savePetSettings(settings);
  if (isTauriRuntime()) {
    await emit(SETTINGS_EVENT, normalized);
  } else if ("BroadcastChannel" in window) {
    const channel = new BroadcastChannel(SETTINGS_EVENT);
    channel.postMessage(normalized);
    channel.close();
  }
  return normalized;
};

export const subscribePetSettings = async (
  onSettings: (settings: PetSettings) => void,
): Promise<UnlistenFn> => {
  if (isTauriRuntime()) {
    return listen<PetSettings>(SETTINGS_EVENT, (event) => onSettings(normalizePetSettings(event.payload)));
  }

  const channel = "BroadcastChannel" in window ? new BroadcastChannel(SETTINGS_EVENT) : null;
  const onMessage = (event: MessageEvent<unknown>): void => onSettings(normalizePetSettings(event.data));
  channel?.addEventListener("message", onMessage);

  const onStorage = (event: StorageEvent): void => {
    if (event.key === STORAGE_KEY && event.newValue) {
      try {
        onSettings(normalizePetSettings(JSON.parse(event.newValue) as unknown));
      } catch {
        // Ignore incomplete writes from another browsing context.
      }
    }
  };
  window.addEventListener("storage", onStorage);

  return () => {
    channel?.removeEventListener("message", onMessage);
    channel?.close();
    window.removeEventListener("storage", onStorage);
  };
};
