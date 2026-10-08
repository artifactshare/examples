export type Station = { block: string; name: string; kana: string; lat: number; lon: number; elev: number }
export type NationalYear = { year: number; anom: number | null; stations: number }
/** anomalies.get(block)?.get(year) → °C relative to the station's 1961–1990 mean */
export type AnomalyGrid = Map<string, Map<number, number>>
export type JapanMap = { coast: [number, number][][]; borders: [number, number][][] }
