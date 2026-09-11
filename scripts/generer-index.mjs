#!/usr/bin/env node
/*
 * Fabrique ce que l'application ne peut pas déduire seule :
 *
 *   1. app/contenu/index.json — la liste des sujets et des lectures et défis, chargée au
 *      démarrage. On ne la tient pas à la main : il suffit de déposer un fichier dans
 *      contenu/sujets/ ou contenu/defis/ et de relancer ce script.
 *
 *   2. app/agenda/<id>.ics — un fichier de calendrier par rencontre, pour le bouton
 *      « Ajouter à mon calendrier ». Un lien vers un vrai fichier .ics est ce que tous les
 *      téléphones savent ouvrir ; le fabriquer dans l'application au moment du clic ne
 *      marche pas partout, notamment dans une application installée sur iPhone.
 *
 * Le contrôle de contenu (verifier-contenu.mjs) refuse un index ou un agenda qui ne
 * correspondent plus aux fichiers présents.
 *
 * Usage : node scripts/generer-index.mjs
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const racine = join(dirname(fileURLToPath(import.meta.url)), "..");
const contenu = join(racine, "app", "contenu");

function lireDossier(nom) {
  return readdirSync(join(contenu, nom))
    .filter((fichier) => fichier.endsWith(".json"))
    .sort()
    .map((fichier) => {
      const donnees = JSON.parse(readFileSync(join(contenu, nom, fichier), "utf8"));
      return { fichier: `${nom}/${fichier}`, donnees };
    });
}

// --- L'index ------------------------------------------------------------------------------

export function construireIndex() {
  // Les sujets, du plus récent au plus ancien : c'est l'ordre de l'onglet Sujets.
  const sujets = lireDossier("sujets")
    .map(({ fichier, donnees }) => ({
      id: donnees.id,
      date: donnees.date,
      titre: donnees.titre,
      sousTitre: donnees.sousTitre || "",
      resume: donnees.resume || "",
      questions: donnees.questions.length,
      fichier,
    }))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  // Les lectures et défis, dans l'ordre voulu par le responsable (champ « ordre »).
  const defis = lireDossier("defis")
    .map(({ fichier, donnees }) => ({
      id: donnees.id,
      type: donnees.type,
      ordre: donnees.ordre ?? 999,
      titre: donnees.titre,
      resume: donnees.resume || "",
      etapes: donnees.etapes.length,
      fichier,
    }))
    .sort((a, b) => a.ordre - b.ordre || a.titre.localeCompare(b.titre, "fr"));

  return { sujets, defis };
}

export function texteIndex() {
  return JSON.stringify(construireIndex(), null, 2) + "\n";
}

// --- Les fichiers de calendrier ----------------------------------------------------------

// Dans un .ics, virgules, points-virgules et retours à la ligne s'échappent.
function echapperIcs(texte) {
  return String(texte).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

// Une ligne ne dépasse pas 75 octets ; la suite se replie sur la ligne suivante, précédée
// d'une espace. On compte des octets, pas des caractères : les accents en prennent deux.
function replier(ligne) {
  const octets = Buffer.from(ligne, "utf8");
  if (octets.length <= 75) return ligne;
  const morceaux = [];
  let reste = ligne;
  let limite = 75;
  while (Buffer.byteLength(reste, "utf8") > limite) {
    let coupe = limite;
    while (Buffer.byteLength(reste.slice(0, coupe), "utf8") > limite) coupe--;
    morceaux.push(reste.slice(0, coupe));
    reste = reste.slice(coupe);
    limite = 74; // l'espace de continuation compte
  }
  morceaux.push(reste);
  return morceaux.join("\r\n ");
}

function horodatage(date, heure) {
  return date.replace(/-/g, "") + "T" + (heure || "00:00").replace(":", "") + "00";
}

export function texteIcs(evenement, maintenant = new Date()) {
  const lignes = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//GDJ EBTM//Agenda//FR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${evenement.id}@gdj-ebtm`,
    `DTSTAMP:${maintenant.toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`,
  ];
  if (evenement.heure) {
    lignes.push(`DTSTART;TZID=Europe/Paris:${horodatage(evenement.date, evenement.heure)}`);
    lignes.push(`DTEND;TZID=Europe/Paris:${horodatage(evenement.date, evenement.fin || ajouterHeures(evenement.heure, 2))}`);
  } else {
    // Sans heure : un événement sur la journée.
    lignes.push(`DTSTART;VALUE=DATE:${evenement.date.replace(/-/g, "")}`);
  }
  lignes.push(`SUMMARY:${echapperIcs(evenement.titre)}`);
  if (evenement.lieu) lignes.push(`LOCATION:${echapperIcs(evenement.lieu)}`);
  if (evenement.detail) lignes.push(`DESCRIPTION:${echapperIcs(evenement.detail)}`);
  lignes.push("END:VEVENT", "END:VCALENDAR");
  return lignes.map(replier).join("\r\n") + "\r\n";
}

function ajouterHeures(hhmm, n) {
  const [h, m] = hhmm.split(":").map(Number);
  return `${String(Math.min(h + n, 23)).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function lireAgenda() {
  return JSON.parse(readFileSync(join(contenu, "agenda.json"), "utf8"));
}

// --- Écriture -----------------------------------------------------------------------------

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const index = construireIndex();
  writeFileSync(join(contenu, "index.json"), JSON.stringify(index, null, 2) + "\n", "utf8");
  console.log(`Index écrit : ${index.sujets.length} sujet(s), ${index.defis.length} lecture(s) et défi(s).`);

  const dossierAgenda = join(racine, "app", "agenda");
  mkdirSync(dossierAgenda, { recursive: true });
  const agenda = lireAgenda();
  const attendus = new Set();
  // Un horodatage fixe par fichier : le contenu ne change que si la rencontre change, et
  // le contrôle peut comparer octet pour octet.
  const fixe = new Date("2026-01-01T00:00:00Z");
  for (const evenement of agenda.evenements || []) {
    const nom = `${evenement.id}.ics`;
    attendus.add(nom);
    writeFileSync(join(dossierAgenda, nom), texteIcs(evenement, fixe), "utf8");
  }
  // Les rencontres retirées de l'agenda ne laissent pas de fichier derrière elles.
  for (const fichier of readdirSync(dossierAgenda)) {
    if (fichier.endsWith(".ics") && !attendus.has(fichier)) unlinkSync(join(dossierAgenda, fichier));
  }
  console.log(`Calendrier : ${attendus.size} fichier(s) .ics dans app/agenda/.`);
  if (!existsSync(join(dossierAgenda, ".gitkeep"))) writeFileSync(join(dossierAgenda, ".gitkeep"), "", "utf8");
}
