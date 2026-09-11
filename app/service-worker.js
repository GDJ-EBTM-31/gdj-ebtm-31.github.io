/*
 * Service worker : permet d'utiliser l'application sans connexion.
 *
 * Deux régimes, selon ce qui est demandé :
 *
 *   - Le contenu (dossier contenu/ : sujets, défis, agenda, infos) est demandé au réseau
 *     d'abord, avec le cache en secours. Un nouveau sujet déposé par le responsable
 *     apparaît donc dès la première ouverture de l'application, quand le téléphone est
 *     connecté ; hors connexion, on relit la dernière version reçue.
 *
 *   - Le reste (page, style, code, icônes) est servi depuis le cache immédiatement, puis
 *     rafraîchi en arrière-plan (« stale-while-revalidate »). Changer VERSION force le
 *     renouvellement complet du cache à la prochaine visite : c'est scripts/publier.sh qui
 *     l'avance, jamais la main. Une modification du code arrive donc sur les téléphones à
 *     la deuxième ouverture ; une modification du contenu, à la première.
 */

const VERSION = "1.0.0";
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
  "./icones/icone.svg",
  "./icones/icone-180.png",
  "./icones/icone-192.png",
  "./icones/icone-512.png",
  "./icones/icone-maskable-512.png",
];

// Au-delà de ce délai, un réseau qui ne répond pas est traité comme absent et l'on sert le
// cache : l'accueil ne doit jamais rester blanc parce qu'une antenne est lente.
const DELAI_RESEAU = 4000;

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
  evenement.waitUntil(
    (async () => {
      const noms = await caches.keys();
      await Promise.all(noms.filter((nom) => nom !== CACHE).map((nom) => caches.delete(nom)));
      await self.clients.claim();
    })()
  );
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

  const estDuContenu = url.pathname.includes("/contenu/");

  evenement.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);

      if (estDuContenu) {
        // Réseau d'abord, cache en secours. « no-cache » : le navigateur redemande au serveur
        // si le fichier a changé au lieu de resservir sa propre copie ; sans cela, GitHub
        // Pages fait garder un contenu jusqu'à dix minutes, et un nouveau sujet n'apparaît
        // pas à l'ouverture. Si rien n'a changé, le serveur répond « inchangé », sans octets.
        try {
          const reponse = await avecDelai(fetch(requete, { cache: "no-cache" }), DELAI_RESEAU);
          if (reponse && reponse.ok) {
            cache.put(requete, reponse.clone());
            return reponse;
          }
          const enCache = await cache.match(requete, { ignoreSearch: true });
          return enCache || reponse;
        } catch {
          const enCache = await cache.match(requete, { ignoreSearch: true });
          if (enCache) return enCache;
          return new Response("Hors connexion", {
            status: 503,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          });
        }
      }

      // Cache d'abord, rafraîchi en arrière-plan.
      const enCache = await cache.match(requete, { ignoreSearch: true });
      const depuisReseau = fetch(requete)
        .then((reponse) => {
          if (reponse && reponse.ok) cache.put(requete, reponse.clone());
          return reponse;
        })
        .catch(() => null);

      if (enCache) {
        evenement.waitUntil(depuisReseau);
        return enCache;
      }
      const reponse = await depuisReseau;
      if (reponse) return reponse;
      // Hors connexion et jamais visitée : on renvoie la page pour une navigation.
      if (requete.mode === "navigate") return cache.match("./index.html");
      return new Response("Hors connexion", {
        status: 503,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    })()
  );
});
