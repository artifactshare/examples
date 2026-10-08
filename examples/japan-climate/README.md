# 日本は、どこから暑くなったか / Where did Japan start getting hotter?

気象庁の 158 地点・約 150 年分の月別値（20 万行）を、ブラウザの中の DuckDB-WASM で集計するインタラクティブな可視化です。サーバーはなく、Parquet を同梱した静的サイトとして [Artifact Share](https://artifactshare.com) で公開しています。

An interactive visualization of 150 years of monthly climate records from 158 Japan Meteorological Agency stations (200,000 rows), aggregated in the browser with DuckDB-WASM. There is no server: it is a static site with bundled Parquet files, published on [Artifact Share](https://artifactshare.com).

## What it shows

- **Archipelago timeline** — every station drawn at its latitude and longitude over a wireframe map, colored by its annual anomaly against 1961–1990. Each frame of the 1891→2025 playback is a real SQL query (about 1 ms).
- **Stripes wall** — all stations, north to south, one row each and one stripe per year.
- **Station spiral** — the trailing 12-month anomaly drawn as a climate spiral, with warming rate, hottest month, hottest year, and snowfall change.
- **Ask the data** — preset questions and an editable SQL box over the `stations`, `monthly`, `annual`, `normals`, and `anomalies` tables.

## Run it

```sh
pnpm install
pnpm --filter @artifactshare-examples/japan-climate dev
```

Build and publish as a static site:

```sh
pnpm --filter @artifactshare-examples/japan-climate build
npx @artifactshare/cli share examples/japan-climate/dist --visibility link
```

## How DuckDB-WASM is loaded

- The engine comes from jsDelivr (`getJsDelivrBundles()`); a blob worker calls `importScripts()` on the jsDelivr worker script, so the page needs no cross-origin `Worker`.
- The Parquet files are fetched from the same origin and registered with `registerFileBuffer()`.
- Reading Parquet needs DuckDB's `parquet` extension, which DuckDB loads from `extensions.duckdb.org`. If a host's content policy blocks that origin, the app falls back to a copy under `ext/`; `pnpm data:ext` downloads it (`node scripts/fetch-extensions.mjs`).
- Vite emits `.js`, not `.mjs`, and every asset path is relative (`base: './'`).

## Data

| Script | Output |
|---|---|
| `node scripts/fetch-jma.mjs` | Caches the JMA "past weather data" monthly tables under `.cache/` (polite, resumable) |
| `node scripts/build-data.mjs` | `public/data/stations.parquet`, `public/data/monthly.parquet` (needs the `duckdb` CLI) |
| `node scripts/build-map.mjs` | `public/data/japan-map.json` (coastlines and prefecture borders) |

Each measure keeps a quality flag (0 normal, 1 quasi-normal, 2 insufficient). Annual means use only complete years without insufficient months. Anomalies are against each station's 1961–1990 mean; station relocations are not homogenized.

## Sources and license

- Climate data: 気象庁ホームページ「過去の気象データ検索」をもとに加工して作成 (processed from the Japan Meteorological Agency website).
- Map: [Natural Earth](https://www.naturalearthdata.com/) 1:10m admin-1, public domain.
- Code: MIT.
