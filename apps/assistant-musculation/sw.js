/* Service worker — cache d'abord, réseau en arrière-plan.
   L'app s'affiche instantanément, y compris sans réseau ; la nouvelle version
   est récupérée en tâche de fond et prise en compte au chargement suivant. */

const BUILD = "903df89b";
const CACHE_NAME = "assistant-musculation-" + BUILD;

// Tout ce qu'il faut pour démarrer hors-ligne. React est servi depuis le site
// (et non depuis un CDN) : une réponse d'un autre domaine est opaque et ne peut
// pas être mise en cache, ce qui cassait le mode hors-ligne.
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      // addAll échoue en bloc si un seul fichier manque : on installe fichier par fichier.
      .then((cache) => Promise.all(APP_SHELL.map((url) => cache.add(url).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  // Ressources externes (polices Google) : réseau, repli sur le cache si déjà vu.
  if (!sameOrigin) {
    event.respondWith(fetch(req).catch(() => caches.match(req)));
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(req, { ignoreSearch: false });

    if (cached) {
      // Revalidation silencieuse : on ne fait jamais attendre l'utilisateur.
      event.waitUntil((async () => {
        try {
          const fresh = await fetch(req);
          if (fresh && fresh.ok && fresh.type === "basic") {
            const cache = await caches.open(CACHE_NAME);
            await cache.put(req, fresh.clone());
          }
        } catch (e) { /* hors-ligne : on garde la version en cache */ }
      })());
      return cached;
    }

    try {
      const fresh = await fetch(req);
      if (fresh && fresh.ok && fresh.type === "basic") {
        const cache = await caches.open(CACHE_NAME);
        cache.put(req, fresh.clone());
      }
      return fresh;
    } catch (e) {
      // Navigation hors-ligne vers une URL inconnue : on sert quand même l'app.
      if (req.mode === "navigate") {
        const shell = await caches.match("./index.html");
        if (shell) return shell;
      }
      return new Response("Hors-ligne", { status: 503, statusText: "Hors-ligne" });
    }
  })());
});
