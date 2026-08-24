const APP_CACHE_VERSION = "v6";
const DATA_CACHE_VERSION = "v1";
const APP_CACHE = `fsrs-sudoku-app-${APP_CACHE_VERSION}`;
const DATA_CACHE = `fsrs-sudoku-data-${DATA_CACHE_VERSION}`;
const META_CACHE = `fsrs-sudoku-meta-${DATA_CACHE_VERSION}`;
const SUDOKU_CACHE_PREFIX = "fsrs-sudoku-";

const PUZZLE_ORIGIN = "https://json.sudoku.darksabun.club";
const DAILY_PATH_PATTERN = /^\/ds_\d{8}\.json$/;
const UNLIMITED_PATH_PATTERN = /^\/unlimited\/Lv\d{2}\.txt$/;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const appUrl = (path) => new URL(path, self.location).href;
const SUDOKU_URL = appUrl("./sudoku.html");
const APP_SHELL = [
  "./sudoku.html",
  "./sudoku/bruteforce.svg",
  "./sudoku/sudoku.css",
  "./sudoku/custom.css",
  "./sudoku/sudoku_i18n.js",
  "./sudoku/sudoku_constants.js",
  "./sudoku/sudoku_teks.js",
  "./sudoku/sudoku_solver.js",
  "./sudoku/skfr.js",
  "./sudoku/skfr_runner.js",
  "./sudoku/sefast_runner.js",
  "./sudoku/sefast_worker.js",
  "./sudoku/sefast_runtime.js",
  "./sudoku/sefast_native.js",
  "./sudoku/sudoku_ui.js",
  "./sudoku/sudoku_main.js",
  "./sudoku/sudoku_blossom_worker.js",
  "./sudoku/skfr.wasm",
  "./sudoku/sefast.wasm",
  "./sudoku/sefast_native.wasm",
  "./assets/css/pretendardvariable-jp.css",
  "./assets/css/woff2/PretendardJPVariable.woff2",
  "./assets/favicon/manifest.json",
  "./assets/favicon/favicon-32x32.png",
  "./assets/favicon/apple-icon-180x180.png",
  "./assets/favicon/android-icon-192x192.png",
  "./assets/favicon/android-icon-512x512.png",
  "./assets/favicon/android-icon-maskable-512x512.png",
].map(appUrl);
const APP_SHELL_URLS = new Set(APP_SHELL);

let puzzleRefreshPromise = null;

function getKstDateKey(timestamp = Date.now()) {
  return new Date(timestamp + KST_OFFSET_MS).toISOString().slice(0, 10);
}

function getRecentDailyUrls(count = 7) {
  return Array.from({ length: count }, (_, index) => {
    const date = getKstDateKey(Date.now() - index * DAY_MS).replaceAll("-", "");
    return `${PUZZLE_ORIGIN}/ds_${date}.json`;
  });
}

function getUnlimitedUrls() {
  return Array.from({ length: 11 }, (_, level) => {
    const fileIndex = String(level).padStart(2, "0");
    return `${PUZZLE_ORIGIN}/unlimited/Lv${fileIndex}.txt`;
  });
}

function getMetaUrl(key) {
  return appUrl(`./__sudoku_pwa_meta__/${key}`);
}

async function readMeta(key) {
  const cache = await caches.open(META_CACHE);
  const response = await cache.match(getMetaUrl(key));
  return response ? response.text() : null;
}

async function writeMeta(key, value) {
  const cache = await caches.open(META_CACHE);
  await cache.put(
    getMetaUrl(key),
    new Response(value, { headers: { "Content-Type": "text/plain" } }),
  );
}

async function fetchAndCacheData(url, cache) {
  try {
    const response = await fetch(
      new Request(url, { cache: "no-cache", mode: "cors" }),
    );
    if (!response.ok) return false;
    await cache.put(url, response.clone());
    return true;
  } catch {
    return false;
  }
}

async function cacheContainsAll(urls, cache) {
  for (const url of urls) {
    if (!(await cache.match(url))) return false;
  }

  return true;
}

async function refreshAndVerifyData(urls, cache) {
  let allFetched = true;

  for (const url of urls) {
    if (!(await fetchAndCacheData(url, cache))) allFetched = false;
  }

  return allFetched && cacheContainsAll(urls, cache);
}

async function refreshRecentDailyIfNeeded() {
  const today = getKstDateKey();
  const cache = await caches.open(DATA_CACHE);
  const urls = getRecentDailyUrls();
  if (
    (await readMeta("daily-refresh-date")) === today &&
    (await cacheContainsAll(urls, cache))
  ) {
    return true;
  }

  const refreshed = await refreshAndVerifyData(urls, cache);
  if (refreshed) {
    await writeMeta("daily-refresh-date", today);
  }
  return refreshed;
}

async function refreshUnlimitedIfNeeded() {
  const today = getKstDateKey();
  const cache = await caches.open(DATA_CACHE);
  const urls = getUnlimitedUrls();
  if (
    (await readMeta("unlimited-refresh-date")) === today &&
    (await cacheContainsAll(urls, cache))
  ) {
    return true;
  }

  const refreshed = await refreshAndVerifyData(urls, cache);
  if (refreshed) {
    await writeMeta("unlimited-refresh-date", today);
  }
  return refreshed;
}

function refreshPuzzleDataIfNeeded() {
  if (!puzzleRefreshPromise) {
    puzzleRefreshPromise = Promise.allSettled([
      refreshRecentDailyIfNeeded(),
      refreshUnlimitedIfNeeded(),
    ])
      .then(([daily, unlimited]) => ({
        dailyReady: daily.status === "fulfilled" && daily.value === true,
        unlimitedReady:
          unlimited.status === "fulfilled" && unlimited.value === true,
      }))
      .then((status) => ({
        ...status,
        ready: status.dailyReady && status.unlimitedReady,
      }))
      .finally(() => {
        puzzleRefreshPromise = null;
      });
  }
  return puzzleRefreshPromise;
}

async function networkFirstStatic(request) {
  const cache = await caches.open(APP_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw new Error("A required Sudoku asset is not available offline yet.");
  }
}

async function networkFirstNavigation(request) {
  const cache = await caches.open(APP_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(SUDOKU_URL, response.clone());
    return response;
  } catch {
    const cached = await cache.match(SUDOKU_URL);
    if (cached) return cached;
    throw new Error("Sudoku is not available offline yet.");
  }
}

async function networkFirstData(request) {
  const cache = await caches.open(DATA_CACHE);
  try {
    const response = await fetch(new Request(request, { cache: "no-cache" }));
    if (response.ok) await cache.put(request.url, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request.url);
    if (cached) return cached;
    throw new Error("Puzzle data is not available offline yet.");
  }
}

async function cacheFirstData(request) {
  const cache = await caches.open(DATA_CACHE);
  const cached = await cache.match(request.url);
  return cached || networkFirstData(request);
}

async function getUnlimitedResponse(request) {
  const refreshedToday =
    (await readMeta("unlimited-refresh-date")) === getKstDateKey();
  if (!refreshedToday) return networkFirstData(request);

  const cache = await caches.open(DATA_CACHE);
  const cached = await cache.match(request.url);
  return cached || networkFirstData(request);
}

async function cacheFirstRuntime(request) {
  const cache = await caches.open(APP_CACHE);
  const cached = await cache.match(request);
  const isIncompatibleOpaqueResponse =
    request.mode === "cors" && cached?.type === "opaque";
  if (cached && !isIncompatibleOpaqueResponse) return cached;
  if (isIncompatibleOpaqueResponse) await cache.delete(request);

  const response = await fetch(request);
  if (
    response.ok ||
    (request.mode === "no-cors" && response.type === "opaque")
  ) {
    await cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(APP_CACHE);
      await cache.addAll(APP_SHELL);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const currentCaches = new Set([APP_CACHE, DATA_CACHE, META_CACHE]);
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames
          .filter(
            (name) =>
              name.startsWith(SUDOKU_CACHE_PREFIX) && !currentCaches.has(name),
          )
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "refresh-puzzle-data") {
    event.waitUntil(
      (async () => {
        const status = await refreshPuzzleDataIfNeeded();
        event.source?.postMessage({
          type: "puzzle-data-cache-status",
          date: getKstDateKey(),
          ...status,
        });
      })(),
    );
  }
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  if (
    request.mode === "navigate" &&
    url.origin === self.location.origin &&
    url.pathname.endsWith("/sudoku.html")
  ) {
    event.respondWith(networkFirstNavigation(request));
    event.waitUntil(refreshPuzzleDataIfNeeded());
    return;
  }

  if (APP_SHELL_URLS.has(url.href)) {
    event.respondWith(networkFirstStatic(request));
    return;
  }

  if (url.origin === PUZZLE_ORIGIN && DAILY_PATH_PATTERN.test(url.pathname)) {
    event.respondWith(cacheFirstData(request));
    return;
  }

  if (
    url.origin === PUZZLE_ORIGIN &&
    UNLIMITED_PATH_PATTERN.test(url.pathname)
  ) {
    event.respondWith(getUnlimitedResponse(request));
    event.waitUntil(refreshPuzzleDataIfNeeded());
    return;
  }

  if (
    url.origin === "https://fonts.googleapis.com" ||
    url.origin === "https://fonts.gstatic.com"
  ) {
    event.respondWith(cacheFirstRuntime(request));
  }
});
