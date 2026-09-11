#!/usr/bin/env node
/*
 * Contrôle des détections dont dépend ce que chaque personne verra en ouvrant le lien :
 *   - surTelephone(), qui renvoie un ordinateur vers le téléphone ;
 *   - surIPhone(), qui décide des instructions d'installation montrées ;
 *   - dansNavigateurIntegre(), qui décide d'avertir que les réponses ne seront pas gardées.
 *
 * Elles ne peuvent pas être essayées ici faute d'iPhone : ce script prend donc les fonctions
 * telles qu'elles sont écrites dans app.js — sans les recopier, pour qu'une modification de
 * l'application soit forcément prise en compte — et les fait tourner sur des signatures de
 * navigateurs réelles. Il vérifie la règle, pas le rendu : un essai sur un vrai téléphone
 * reste nécessaire avant diffusion.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const racine = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(join(racine, "app", "app.js"), "utf8");

// Les fonctions sont indentées de deux espaces dans l'application : leur accolade fermante
// est donc la première ligne « \n  }\n » qui suit leur début.
function extraire(nom) {
  const debut = source.indexOf(`function ${nom}() {`);
  if (debut === -1) throw new Error(`${nom}() est introuvable dans app.js.`);
  const fin = source.indexOf("\n  }\n", debut);
  if (fin === -1) throw new Error(`La fin de ${nom}() est introuvable dans app.js.`);
  return source.slice(debut, fin + 4);
}

const corps = [extraire("surTelephone"), extraire("surIPhone"), extraire("dansNavigateurIntegre")].join("\n");
const detecter = new Function(
  "navigator",
  `${corps}\nreturn { surTelephone: surTelephone(), surIPhone: surIPhone(), dansNavigateurIntegre: dansNavigateurIntegre() };`
);

// Signatures de navigateurs, dans leur forme standard. Ce qui est mis à l'épreuve ici est la
// présence ou l'absence des marqueurs sur lesquels les fonctions s'appuient — « Safari/ »,
// « CriOS », « wv », « FBAV » — et non le détail des numéros de version.
const CAS = [
  {
    nom: "iPhone, Safari",
    ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
    tactile: 5,
    iPhone: true,
    integre: false,
  },
  {
    nom: "iPhone, Chrome",
    ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1",
    tactile: 5,
    iPhone: true,
    integre: false,
  },
  {
    nom: "iPhone, fenêtre interne d’une application",
    ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
    tactile: 5,
    iPhone: true,
    integre: true,
  },
  {
    nom: "iPhone, Instagram",
    ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 300.0.0.29.110",
    tactile: 5,
    iPhone: true,
    integre: true,
  },
  {
    nom: "iPad, Safari (iPadOS se présente comme un Mac)",
    ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
    tactile: 5,
    iPhone: true,
    integre: false,
  },
  {
    nom: "Mac, Safari",
    ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
    tactile: 0,
    ordinateur: true,
    iPhone: false,
    integre: false,
  },
  {
    nom: "Android, Chrome",
    ua: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
    tactile: 5,
    iPhone: false,
    integre: false,
  },
  {
    nom: "Android, Firefox",
    ua: "Mozilla/5.0 (Android 14; Mobile; rv:127.0) Gecko/127.0 Firefox/127.0",
    tactile: 5,
    iPhone: false,
    integre: false,
  },
  {
    nom: "Android, vue web embarquée",
    ua: "Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/UQ1A.240205.004; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.0.0 Mobile Safari/537.36",
    tactile: 5,
    iPhone: false,
    integre: true,
  },
  {
    nom: "Android, Facebook",
    ua: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/470.0.0.34.109;]",
    tactile: 5,
    iPhone: false,
    integre: true,
  },
  {
    nom: "Windows, Chrome",
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    tactile: 0,
    ordinateur: true,
    iPhone: false,
    integre: false,
  },
];

let echecs = 0;
for (const cas of CAS) {
  const obtenu = detecter({ userAgent: cas.ua, maxTouchPoints: cas.tactile });
  const telephone = !cas.ordinateur;
  const ok = obtenu.surTelephone === telephone && obtenu.surIPhone === cas.iPhone && obtenu.dansNavigateurIntegre === cas.integre;
  if (!ok) echecs++;
  const oui = (b) => (b ? "oui" : "non");
  const detail = `téléphone ${oui(obtenu.surTelephone)}, iPhone ${oui(obtenu.surIPhone)}, intégré ${oui(obtenu.dansNavigateurIntegre)}`;
  const attendu = `attendu : téléphone ${oui(telephone)}, iPhone ${oui(cas.iPhone)}, intégré ${oui(cas.integre)}`;
  console.log(`${ok ? "  " : "✗ "}${cas.nom.padEnd(46)} ${detail}${ok ? "" : "  —  " + attendu}`);
}


// --- Les instructions réellement affichées -------------------------------------------------
//
// Savoir reconnaître un iPhone ne sert à rien si les gestes montrés sont les mauvais. On
// prend donc etapesInstallation() telle qu'elle est écrite et on lit ce qu'elle produit,
// dans chacune des situations où quelqu'un peut ouvrir le lien.

const produire = new Function(
  "navigator",
  "installationDifferee",
  "PARTAGE_IOS",
  "tactile",
  `const html = (m, ...v) => m.reduce((s, p, i) => s + p + (v[i] ?? ""), "");
   const echapper = (x) => String(x);
   const appareilTactile = () => tactile;
   ${extraire("surIPhone")}
   ${extraire("dansNavigateurIntegre")}
   ${extraire("etapesInstallation")}
   return etapesInstallation();`
);

const parUA = (nom) => CAS.find((c) => c.nom === nom).ua;

const INSTRUCTIONS = [
  {
    nom: "iPhone, Safari",
    rendu: produire({ userAgent: parUA("iPhone, Safari"), maxTouchPoints: 5 }, null, "<svg></svg>", true),
    doitContenir: ["Sur l’écran d’accueil", "Ajouter", "•••"],
    neDoitPasContenir: ["Ouvre le menu de ton navigateur"],
  },
  {
    nom: "Android, Chrome sait installer",
    rendu: produire({ userAgent: parUA("Android, Chrome"), maxTouchPoints: 5 }, { prompt() {} }, "", true),
    doitContenir: ['data-invite="installer"', "Installer"],
    neDoitPasContenir: ["Sur l’écran d’accueil"],
  },
  {
    nom: "Android, Firefox n’annonce rien",
    rendu: produire({ userAgent: parUA("Android, Firefox"), maxTouchPoints: 5 }, null, "", true),
    doitContenir: ["Ouvre le menu de ton navigateur", "Ajouter à l’écran d’accueil"],
    neDoitPasContenir: ["Sur l’écran d’accueil"],
  },
  {
    nom: "iPhone, fenêtre interne d’une application",
    rendu: produire({ userAgent: parUA("iPhone, fenêtre interne d’une application"), maxTouchPoints: 5 }, null, "", true),
    doitContenir: ["Ouvrir dans le navigateur"],
    neDoitPasContenir: ["Sur l’écran d’accueil", 'data-invite="installer"'],
  },
  {
    nom: "Android, Facebook",
    rendu: produire({ userAgent: parUA("Android, Facebook"), maxTouchPoints: 5 }, { prompt() {} }, "", true),
    doitContenir: ["Ouvrir dans le navigateur"],
    neDoitPasContenir: ['data-invite="installer"'],
  },
];

console.log("");
for (const cas of INSTRUCTIONS) {
  const manquants = cas.doitContenir.filter((m) => !cas.rendu.includes(m));
  const parasites = cas.neDoitPasContenir.filter((m) => cas.rendu.includes(m));
  const ok = !manquants.length && !parasites.length;
  if (!ok) echecs++;
  console.log(`${ok ? "  " : "✗ "}${cas.nom.padEnd(46)} instructions justes`);
  for (const m of manquants) console.log(`     manque : ${m}`);
  for (const p of parasites) console.log(`     en trop : ${p}`);
}

// --- L'ordinateur --------------------------------------------------------------------------
//
// Sur un ordinateur, afficher() doit renvoyer vers le téléphone avant même de regarder si
// l'application est installée : ni instructions d'installation, ni ouverture par « ?app ».
// Décidé par Sébastien le 11 septembre 2026.

const afficherSource = source.slice(source.indexOf("async function afficher() {"));
const posOrdinateur = afficherSource.indexOf("if (!surTelephone())");
const posInstallee = afficherSource.indexOf("if (!dejaInstallee())");
const ordinateurOk =
  posOrdinateur !== -1 &&
  posInstallee !== -1 &&
  posOrdinateur < posInstallee &&
  afficherSource.slice(posOrdinateur, posInstallee).includes("ecranOrdinateur()");
if (!ordinateurOk) echecs++;
console.log(`${ordinateurOk ? "  " : "✗ "}${"Ordinateur : renvoyé vers le téléphone".padEnd(46)} ${ordinateurOk ? "avant tout le reste" : "ce n'est plus le cas dans afficher()"}`);

console.log(
  echecs
    ? `\n${echecs} contrôle(s) en échec.`
    : "\nDétections justes sur onze navigateurs, instructions conformes dans les cinq situations\n" +
      "d'un téléphone, et l'ordinateur renvoyé vers le téléphone."
);
if (echecs) process.exit(1);
