# Artifact Share examples

Sample projects that run as static sites on [Artifact Share](https://artifactshare.com). Each example lives under `examples/` and builds to a folder you can publish with the CLI.

| Example | What it shows |
|---|---|
| [`japan-climate`](examples/japan-climate) · [live](https://artifactshare.com/a/lxqssw989q) | 150 years of JMA climate records for 158 stations, aggregated in the browser with DuckDB-WASM and drawn with React, canvas, and SVG |

```sh
pnpm install
pnpm build
npx @artifactshare/cli share examples/<name>/dist --visibility link
```

Code is MIT licensed. Each example lists its data sources and their terms.
