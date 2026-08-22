const SECTION_HASHES = new Set([
  "leitura-ativo",
  "plano-ativo",
  "resumo-ativo",
  "visao-geral-ativo",
  "painel-grafico-ativo",
  "indicadores-ativo",
  "empresa-ativo",
  "demonstrativos-ativo",
  "fontes-ativo",
  "livro-ofertas",
  "sinal-atual",
]);

function migrateTerminalTheme() {
  if (typeof localStorage === "undefined") return;
  const migrationKey = "b3-score-v4-dark-theme-migrated";
  if (localStorage.getItem(migrationKey) === "1") return;
  localStorage.setItem("b3-score-theme-v1", "dark");
  localStorage.setItem(migrationKey, "1");
}

function installSectionNavigationGuard() {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  document.addEventListener("click", (event) => {
    const anchor = event.target?.closest?.('a[href^="#"]');
    if (!anchor) return;
    const href = anchor.getAttribute("href") || "";
    if (href.startsWith("#/")) return;
    const id = decodeURIComponent(href.replace(/^#/, ""));
    if (!SECTION_HASHES.has(id)) return;
    const target = document.getElementById(id);
    if (!target) return;
    event.preventDefault();
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  }, true);
}

const BUILD_KEY = "b3-score-build-sha-v1";
let checkingBuild = false;

async function checkForNewBuild() {
  if (typeof window === "undefined" || checkingBuild || !navigator.onLine) return;
  checkingBuild = true;
  try {
    const base = new URL(import.meta.env.BASE_URL, window.location.origin);
    const response = await fetch(new URL(`build.json?t=${Date.now()}`, base), { cache: "no-store" });
    if (!response.ok) return;
    const payload = await response.json();
    const nextSha = String(payload?.sha ?? "").trim();
    if (!nextSha) return;
    const currentSha = sessionStorage.getItem(BUILD_KEY);
    if (!currentSha) {
      sessionStorage.setItem(BUILD_KEY, nextSha);
      return;
    }
    if (currentSha === nextSha) return;
    sessionStorage.setItem(BUILD_KEY, nextSha);
    if ("serviceWorker" in navigator) {
      const registration = await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL);
      await registration?.update?.();
    }
    window.location.reload();
  } catch {
    // Atualização automática é best-effort; o app continua com a versão atual.
  } finally {
    checkingBuild = false;
  }
}

function installRuntimeAutoUpdate() {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const run = () => { if (!document.hidden) void checkForNewBuild(); };
  window.addEventListener("online", run);
  document.addEventListener("visibilitychange", run);
  window.setInterval(run, 5 * 60 * 1000);
  window.setTimeout(run, 15 * 1000);
}

migrateTerminalTheme();
installSectionNavigationGuard();
installRuntimeAutoUpdate();
