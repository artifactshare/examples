// Diverging anomaly scale: blue (cooler than normal) – neutral gray – red
// (warmer). Each arm is one hue, monotone in lightness, validated against the
// page surface #0f0e0c. Interpolation runs in OKLab so steps look even.
const COLD = ['#8fbcf2', '#3f84d8', '#2f5f9e']
const NEUTRAL = '#4d4c48'
const WARM = ['#9c3a2e', '#d9503f', '#f58a73']
export const STOPS = [...COLD, NEUTRAL, ...WARM]
export const LIMIT = 2.5 // °C at either end of the scale

type Lab = [number, number, number]

function hexToLinear(hex: string): Lab {
  const n = Number.parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }) as Lab
}

function linearToOklab([r, g, b]: Lab): Lab {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

function oklabToRgb([L, a, b]: Lab): string {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
  const to8 = (c: number) => {
    const v = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055
    return Math.round(Math.min(1, Math.max(0, v)) * 255)
  }
  return `rgb(${lin.map(to8).join(',')})`
}

const LABS = STOPS.map((h) => linearToOklab(hexToLinear(h)))
const CACHE = new Map<number, string>()

/** Color for an anomaly in °C; null renders as the empty ink. */
export function anomalyColor(anom: number | null): string {
  if (anom === null || Number.isNaN(anom)) return 'transparent'
  const key = Math.round(Math.max(-LIMIT, Math.min(LIMIT, anom)) * 50)
  const hit = CACHE.get(key)
  if (hit) return hit
  // -LIMIT → index 0 (deepest cold), +LIMIT → last (hottest)
  const t = ((key / 50 + LIMIT) / (2 * LIMIT)) * (LABS.length - 1)
  const i = Math.min(LABS.length - 2, Math.floor(t))
  const f = t - i
  const [a, b] = [LABS[i], LABS[i + 1]]
  const color = oklabToRgb([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f])
  CACHE.set(key, color)
  return color
}

export const formatAnom = (v: number | null | undefined) =>
  v === null || v === undefined ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v).toFixed(2)}℃`
