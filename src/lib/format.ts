// Pure formatting/display helpers shared across the UI.
// Extracted from App.tsx so they can be unit-tested in isolation (see src/__tests__/format.test.ts).
// Keep these free of side effects and React — plain in → plain out.

// Palette for generated avatars (deterministic per name/string).
export const AV = ["#6366f1", "#e0872b", "#22a06b", "#e2483d", "#2aabee", "#a855f7", "#ec4899", "#14b8a6"]

// Stable color for a string (name/id): hashes char codes into the palette.
export const colorOf = (s: string) => AV[[...(s || "?")].reduce((a, c) => a + c.charCodeAt(0), 0) % AV.length]

// Up to 2 uppercase initials from a name ("Juan Perez" → "JP").
export const initials = (n: string) => (n || "?").split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase()

// Local HH:MM (es locale) for a timestamp; "" when missing.
export const hhmm = (ts?: number) => ts ? new Date(ts).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" }) : ""

// Duration in seconds → "m:ss" (e.g. 75 → "1:15"); "" for empty/non-finite.
export const fmtDur = (s?: number) => { if (!s || !isFinite(s)) return ""; s = Math.round(s); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0") }

// Relative time: today → HH:MM, yesterday → "Ayer", older → "12 mar".
export const ago = (ts?: number) => { if (!ts) return ""; const d = (Date.now() - ts) / 86400000; if (d < 1) return hhmm(ts); if (d < 2) return "Ayer"; return new Date(ts).toLocaleDateString("es", { day: "numeric", month: "short" }) }
