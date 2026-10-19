/** Bystrouš, the mascot: its states and sizes, as in docs/prototyp/maskot. No I/O. */

export const MASCOT_MOODS = [
  "idle",
  "wave",
  "joy",
  "think",
  "alert",
  "sad",
  "sleep",
  "party",
] as const;
export type MascotMood = (typeof MASCOT_MOODS)[number];

/**
 * What a screen reader hears. The text next to the mascot always says the same in words;
 * the mascot only adds the mood. When each state appears (from the design):
 * - idle: default · wave: first sign-in, onboarding, morning brief
 * - joy: an invoice got paid · think: syncing, computing, the assistant answering
 * - alert: something needs attention · sad: a connection or an action failed
 * - sleep: empty states, nothing to do · party: everything for today is done
 */
const LABELS: Record<MascotMood, string> = {
  idle: "Bystrouš",
  wave: "Bystrouš mává",
  joy: "Bystrouš se raduje",
  think: "Bystrouš přemýšlí",
  alert: "Bystrouš hlídá",
  sad: "Bystrouš je smutný",
  sleep: "Bystrouš spí",
  party: "Bystrouš slaví",
};

/** Sizes used in the design: notification 56 px, morning brief 88 px, empty state 160 px. */
export const MASCOT_SIZES = { sm: 56, md: 88, lg: 160 } as const;
export type MascotSize = keyof typeof MASCOT_SIZES;

export function mascotLabel(mood: MascotMood): string {
  return LABELS[mood];
}

/** Width and height in pixels; the drawing is 200 × 220. */
export function mascotDimensions(size: MascotSize): { width: number; height: number } {
  const width = MASCOT_SIZES[size];
  return { width, height: Math.round((width * 220) / 200) };
}
