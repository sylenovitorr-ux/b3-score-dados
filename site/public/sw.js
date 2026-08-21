const CACHE = "b3-score-github-pages-v44";
const APP_SHELL = ["./", "./index.html", "./manifest.webmanifest", "./favicon.svg", "./app-icon.svg"];

const isSameOrigin = (request) => new URL(request.url).origin === self.location.origin;
const isAsset = (request) => {
  const url = new URL(request.url);
  return isSameOrigin(request) && (url.pathname.includes("/assets/") || /\.(?:js|css|svg|png|jpg|jpeg|webp|woff2?)$/i.test(url.pathname));
};
const isMarketData = (request) => {
  const url = new URL(request.url);
  return (url.hostname === "raw.githubusercontent.com" && url.pathname.includes("/sylenovitorr-ux/b3-score-dados/") && url.pathname.includes("/data/")) ||
    (isSameOrigin(request) && url.pathname.includes("/data/"));
};

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request, { cache: "no-store" });
    if (response.ok || response.type === "opaque") await cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request);
    return cached || new Response("", { status: 503, statusText: "Offline" });
  }
}

async function navigationResponse(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request, { cache: "no-store" });
    if (response?.ok) await cache.put("./index.html", response.clone());
    return response;
  } catch {
    return (await cache.match("./index.html")) || fetch(request);
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  if (event.request.mode === "navigate") {
    event.respondWith(navigationResponse(event.request));
    return;
  }
  if (isAsset(event.request) || isMarketData(event.request)) {
    event.respondWith(networkFirst(event.request));
    return;
  }
  event.respondWith(
    fetch(event.request, { cache: "no-store" }).catch(() => caches.match(event.request).then((cached) => cached || caches.match("./index.html"))),
  );
});
