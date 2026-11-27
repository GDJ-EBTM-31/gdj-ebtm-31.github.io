/*
 * Service worker : permet d'utiliser l'application sans connexion.
 *
 * Tout est demandé au réseau d'abord, avec le cache en secours : le contenu (sujets,
 * défis, agenda, infos) comme le code (page, style, app.js). Une nouvelle version, contenu
 * ou code, s'affiche donc dès la première ouverture quand le téléphone est connecté ;
 * hors connexion, ou si le réseau ne répond pas en DELAI_RESEAU, on relit la dernière
 * version reçue. Recommandé pour ce qui doit être à jour en ligne et lisible hors ligne
 * (https://developer.chrome.com/docs/workbox/caching-strategies-overview, « Network first,
 * falling back to cache »). Jusqu'à la 1.4.1, le code était servi depuis le cache et
 * rafraîchi en arrière-plan : il n'arrivait qu'à la deuxième ouverture, et le défi Gospel
 * Street Moment s'est montré sans son lien (12 novembre 2026).
 *
 * Changer VERSION force le renouvellement complet du cache : c'est scripts/publier.sh qui
 * l'avance, jamais la main.
 */

const VERSION = "2.1.2";
const CACHE = `gdj-${VERSION}`;

const FICHIERS = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.webmanifest",
  "./contenu/interface.json",
  "./contenu/index.json",
  "./contenu/infos.json",
  "./contenu/agenda.json",
  "./contenu/pratique.json",
  "./qr-gdj.png",
  "./polices/bricolage-grotesque-latin.woff2",
  "./polices/bricolage-grotesque-latin-ext.woff2",
  "./icones/icone.svg",
  "./icones/icone-180.png",
  "./icones/icone-192.png",
  "./icones/icone-512.png",
  "./icones/icone-maskable-512.png",
];

// Au-delà de ce délai, un réseau qui ne répond pas est traité comme absent et l'on sert le
// cache : l'accueil ne doit jamais rester blanc parce qu'une antenne est lente.
const DELAI_RESEAU = 4000;

// Les téléphones qui avaient une version antérieure à celle-ci affichent encore l'ancien
// code à l'ouverture où ce service worker s'installe. Pour eux seuls, on recharge l'écran
// une fois, dès qu'il prend la main : sans cela, il faudrait rouvrir l'application. Une
// réponse en cours d'écriture ne se perd pas, elle est enregistrée à chaque lettre.
// WindowClient.navigate : iOS 16 et suivants, Chrome, Firefox (MDN, compatibilité relue
// le 12 novembre 2026).
const RECHARGER_AVANT = [1, 4, 2];

function versionDuCache(nom) {
  const trouve = /^gdj-(\d+)\.(\d+)\.(\d+)$/.exec(nom);
  return trouve ? trouve.slice(1).map(Number) : null;
}

function plusAncienne(version, reference) {
  for (let i = 0; i < reference.length; i++) {
    if (version[i] !== reference[i]) return version[i] < reference[i];
  }
  return false;
}

self.addEventListener("install", (evenement) => {
  evenement.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // « reload » : chaque fichier est redemandé au serveur, sans passer par la mémoire du
      // navigateur. Sinon, un téléphone qui a ouvert l'application dans les dix minutes
      // précédant une mise en ligne (GitHub Pages fait garder les fichiers dix minutes)
      // remplirait la nouvelle version avec les anciens fichiers. Vu le 11 septembre 2026.
      await cache.addAll(FICHIERS.map((fichier) => new Request(fichier, { cache: "reload" })));
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (evenement) => {
  const preparation = (async () => {
    const noms = await caches.keys();
    const anciens = noms.filter((nom) => nom !== CACHE);
    const venaitDeLAncienRegime = anciens.some((nom) => {
      const version = versionDuCache(nom);
      return version && plusAncienne(version, RECHARGER_AVANT);
    });
    await Promise.all(anciens.map((nom) => caches.delete(nom)));
    await self.clients.claim();
    return venaitDeLAncienRegime;
  })();
  evenement.waitUntil(preparation);
  // Le rechargement part après l'activation, hors de waitUntil : la page rechargée passe par
  // ce service worker, qui doit donc avoir fini de s'activer. L'attendre dans waitUntil
  // bloque tout (vu dans Safari, simulateur iOS, 12 novembre 2026 : navigate() ne rendait
  // jamais la main et rien n'était redemandé au serveur).
  preparation.then(async (recharger) => {
    if (!recharger) return;
    const fenetres = await self.clients.matchAll({ type: "window" });
    fenetres.forEach((fenetre) => fenetre.navigate(fenetre.url).catch(() => null));
  });
});

function avecDelai(promesse, delai) {
  return new Promise((resoudre, rejeter) => {
    const minuterie = setTimeout(() => rejeter(new Error("délai dépassé")), delai);
    promesse.then(
      (valeur) => {
        clearTimeout(minuterie);
        resoudre(valeur);
      },
      (erreur) => {
        clearTimeout(minuterie);
        rejeter(erreur);
      }
    );
  });
}

self.addEventListener("fetch", (evenement) => {
  const requete = evenement.request;
  const url = new URL(requete.url);
  if (requete.method !== "GET" || url.origin !== self.location.origin) return;

  evenement.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);

      // Réseau d'abord, cache en secours. « no-cache » : le navigateur redemande au serveur
      // si le fichier a changé au lieu de resservir sa propre copie ; sans cela, GitHub
      // Pages fait garder un fichier jusqu'à dix minutes, et une nouvelle version n'apparaît
      // pas à l'ouverture. Si rien n'a changé, le serveur répond « inchangé », sans octets.
      let reponse = null;
      try {
        reponse = await avecDelai(fetch(requete, { cache: "no-cache" }), DELAI_RESEAU);
        if (reponse && reponse.ok) {
          cache.put(requete, reponse.clone());
          return reponse;
        }
      } catch {
        // Réseau absent ou trop lent : on passe au cache.
      }
      const enCache = await cache.match(requete, { ignoreSearch: true });
      if (enCache) return enCache;
      // Hors connexion et jamais visitée : on renvoie la page pour une navigation.
      if (requete.mode === "navigate") {
        const page = await cache.match("./index.html");
        if (page) return page;
      }
      return reponse || new Response("Hors connexion", {
        status: 503,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    })()
  );
});
