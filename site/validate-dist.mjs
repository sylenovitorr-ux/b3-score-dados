import { existsSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

const dist = resolve("dist");
const assetsDir = resolve(dist, "assets");
const limits = { ".js": 600_000, ".css": 230_000 };

if (!existsSync(resolve(dist, "index.html"))) throw new Error("dist/index.html ausente");
if (!existsSync(resolve(dist, "data/benchmarks.json"))) throw new Error("benchmark oficial não foi incluído no build");

for (const [extension, limit] of Object.entries(limits)) {
  const files = readdirSync(assetsDir).filter((name) => name.endsWith(extension));
  const total = files.reduce((sum, name) => sum + statSync(resolve(assetsDir, name)).size, 0);
  if (!files.length) throw new Error(`nenhum arquivo ${extension} encontrado no build`);
  if (total > limit) throw new Error(`${extension} excedeu o orçamento: ${total} > ${limit} bytes`);
  console.log(`${extension}: ${total} bytes de ${limit} permitidos`);
}

console.log("Artefato GitHub Pages auditado com dados oficiais e orçamento aprovado.");
