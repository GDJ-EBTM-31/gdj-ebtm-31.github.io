#!/usr/bin/env node
/*
 * Fabrique une page qui montre côte à côte l'écran d'installation tel que le verra chaque
 * téléphone. Sans elle, on ne peut en voir qu'une version à la fois — celle du navigateur
 * qu'on a sous la main — et l'on valide des textes que personne ne lira jamais.
 *
 * Les instructions sont produites par le code de l'application lui-même, pas recopiées :
 * ce qui est montré ici est ce qui s'affichera.
 *
 * Usage : node scripts/apercu-installation.mjs   →   docs/apercu-installation.html
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { racine, instructions } from "./lire-app.mjs";

const ui = JSON.parse(readFileSync(join(racine, "app", "contenu", "interface.json"), "utf8"));
const e = ui.installation;

const APPAREILS = [
  {
    nom: "iPhone",
    detail: "Safari. Aucun bouton d’installation n’existe : il faut montrer les gestes.",
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  },
  {
    nom: "Android",
    detail: "Chrome ou Edge. Le navigateur sait installer, on lui laisse la main.",
    userAgent:
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
    installationDifferee: {},
  },
  {
    nom: "Firefox Android",
    detail: "Le navigateur n’annonce rien : on explique par son menu.",
    userAgent: "Mozilla/5.0 (Android 14; Mobile; rv:127.0) Gecko/127.0 Firefox/127.0",
  },
  {
    nom: "Ouvert depuis WhatsApp",
    detail: "Fenêtre interne d’une application : on ne peut rien y installer, il faut en sortir.",
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
    integre: true,
  },
];

const ecrans = APPAREILS.map((appareil) => {
  const consigne = appareil.integre ? e.consigneNavigateurIntegre : e.consigne;
  return `
    <figure class="ecran">
      <figcaption class="ecran__legende">
        <strong>${appareil.nom}</strong>
        <span>${appareil.detail}</span>
      </figcaption>
      <div class="ecran__cadre">
        <main>
          <section class="orientation">
            <div class="carte-installation">
              <img class="carte-installation__icone" src="../app/icones/icone-192.png" alt="" width="192" height="192" />
              <h1 class="carte-installation__soustitre">${e.sousTitre}</h1>
              <p class="carte-installation__texte">${e.presentation}</p>
              <div class="carte-installation__action">
                <p class="orientation__consigne">${consigne}</p>
                ${instructions(appareil)}
              </div>
            </div>
            <details class="secours" open>
              <summary class="secours__titre">${e.secours.titre}</summary>
              <div class="secours__contenu">
                <p class="secours__texte">${e.secours.texte}</p>
                <p class="secours__lien">https://gdj-ebtm-31.github.io/</p>
                <button type="button" class="bouton-secondaire">${e.secours.bouton}</button>
              </div>
            </details>
          </section>
        </main>
      </div>
    </figure>`;
}).join("");

// L'ordinateur n'installe rien : il renvoie vers le téléphone, avec le QR code et le lien.
// Mêmes textes que ecranOrdinateur() dans app.js, lus dans interface.json.
const o = ui.ordinateur;
const ecranOrdinateur = `
    <figure class="ecran">
      <figcaption class="ecran__legende">
        <strong>Ordinateur</strong>
        <span>Aucune installation, aucune ouverture de l’application : l’écran renvoie vers le téléphone.</span>
      </figcaption>
      <div class="ecran__cadre">
        <main>
          <section class="orientation">
            <div class="carte-installation">
              <img class="carte-installation__icone" src="../app/icones/icone-192.png" alt="" width="192" height="192" />
              <h1 class="carte-installation__soustitre">${e.sousTitre}</h1>
              <p class="carte-installation__texte">${o.texte}</p>
              <img class="qr__image" src="../app/qr-gdj.png" alt="" width="320" height="320" />
              <p class="carte-installation__texte">${o.lien}</p>
              <p class="qr__adresse">https://gdj-ebtm-31.github.io/</p>
            </div>
          </section>
        </main>
      </div>
    </figure>`;

const page = `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Écran d’installation — chaque appareil</title>
    <link rel="stylesheet" href="../app/style.css" />
    <style>
      body { padding: 1.5rem; }
      .titre-apercu { max-width: 60rem; margin: 0 auto 0.4rem; font-size: 1.4rem; color: var(--violet-fonce); }
      .intro-apercu { max-width: 60rem; margin: 0 auto 2rem; color: var(--texte-doux); }
      .rangee { display: flex; flex-wrap: wrap; gap: 1.5rem; justify-content: center; align-items: flex-start; }
      .ecran { margin: 0; width: 375px; }
      .ecran__legende { margin-bottom: 0.6rem; }
      .ecran__legende strong { display: block; color: var(--violet-fonce); }
      .ecran__legende span { font-size: 0.9rem; color: var(--texte-doux); }
      /* Un cadre de téléphone : même largeur qu'un écran de 375 px, pour juger le vrai rendu. */
      .ecran__cadre { border: 1px solid var(--bord); border-radius: 18px; overflow: hidden; background: var(--fond); box-shadow: var(--ombre); }
      .ecran__cadre main { min-height: 420px; padding: 1rem 0.9rem 1.5rem; }
      .ecran__cadre .orientation { padding-top: 0; }
    </style>
  </head>
  <body>
    <h1 class="titre-apercu">L’écran d’installation, tel que chaque appareil le verra</h1>
    <p class="intro-apercu">
      Page de travail, produite par <code>node scripts/apercu-installation.mjs</code>. Les
      instructions viennent du code de l’application : ce qui est montré ici est ce qui
      s’affichera. Seule la partie « comment installer » change d’un téléphone à l’autre. Le
      bloc du bas est montré déplié ; sur un téléphone il est replié tant qu’on n’y touche pas.
    </p>
    <div class="rangee">${ecrans}${ecranOrdinateur}</div>
  </body>
</html>
`;

const sortie = join(racine, "docs", "apercu-installation.html");
writeFileSync(sortie, page, "utf8");
console.log(`Aperçu écrit : ${sortie}`);
console.log(`${APPAREILS.length + 1} versions : ${APPAREILS.map((a) => a.nom).join(", ")}, Ordinateur.`);
