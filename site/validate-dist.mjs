import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";

const dist = resolve("dist");
const assetsDir = resolve(dist, "assets");
const limits = {
  ".js": { raw: 750_000, gzip: 220_000 },
  ".css": { raw: 300_000, gzip: 65_000 },
};

if (!existsSync(resolve(dist, "index.html"))) throw new Error("dist/index.html ausente");
if (!existsSync(resolve(dist, "data/benchmarks.json"))) throw new Error("benchmark oficial não foi incluído no build");

for (const [extension, limit] of Object.entries(limits)) {
  const files = readdirSync(assetsDir).filter((name) => name.endsWith(extension));
  const total = files.reduce((sum, name) => sum + statSync(resolve(assetsDir, name)).size, 0);
  const compressed = files.reduce((sum, name) => sum + gzipSync(readFileSync(resolve(assetsDir, name))).length, 0);
  if (!files.length) throw new Error(`nenhum arquivo ${extension} encontrado no build`);
  if (total > limit.raw) throw new Error(`${extension} excedeu o orçamento bruto: ${total} > ${limit.raw} bytes`);
  if (compressed > limit.gzip) throw new Error(`${extension} excedeu o orçamento gzip: ${compressed} > ${limit.gzip} bytes`);
  console.log(`${extension}: ${total}/${limit.raw} bytes brutos · ${compressed}/${limit.gzip} bytes gzip`);
}

console.log("Artefato GitHub Pages auditado com dados oficiais e orçamento aprovado.");
