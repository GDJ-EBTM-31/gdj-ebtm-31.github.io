#!/usr/bin/env node
/*
 * Contrôle du contenu de l'application.
 *
 * Ce que rien d'autre ne garantit :
 *   1. chaque fichier de contenu a la forme attendue (identifiants uniques, champs
 *      présents, dates bien écrites) ;
 *   2. l'index et les fichiers de calendrier correspondent aux fichiers présents
 *      (on a relancé generer-index.mjs après la dernière modification) ;
 *   3. tous les fichiers que le service worker promet de mettre en cache existent ;
 *   4. un sujet qui déclare une « source » (le PDF du responsable) en reprend le texte mot
 *      pour mot. Ce texte n'est pas de nous : le reformuler, même en mieux, serait le trahir.
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { racine, texteIndex, texteIcs, lireAgenda } from "./generer-index.mjs";

const contenu = join(racine, "app", "contenu");
const lireJson = (chemin) => JSON.parse(readFileSync(join(contenu, chemin), "utf8"));

const erreurs = [];
const signaler = (message) => erreurs.push(message);

// --- 1. Forme des fichiers -----------------------------------------------------------------

const ui = lireJson("interface.json");
for (const cle of ["application", "installation", "ordinateur", "accueil", "sujet", "defi", "agenda", "pratique", "aPropos", "sauvegarde", "reglages", "rappel"]) {
  if (!ui[cle]) signaler(`interface.json : la section « ${cle} » manque.`);
}

const infos = lireJson("infos.json");
if (!infos.aLaUne || !infos.aLaUne.titre) signaler("infos.json : « aLaUne.titre » manque.");
if (infos.verset && (!infos.verset.reference || !infos.verset.texte)) signaler("infos.json : verset incomplet.");
for (const raccourci of infos.raccourcis || []) {
  if (!raccourci.titre) signaler("infos.json : raccourci sans titre.");
  if (!raccourci.url && !raccourci.aller) signaler(`infos.json : le raccourci « ${raccourci.titre} » n'a ni url ni aller.`);
  if (raccourci.url && !/^https?:\/\//.test(raccourci.url)) signaler(`infos.json : adresse invalide dans le raccourci « ${raccourci.titre} ».`);
}
for (const annonce of infos.annonces || []) {
  if (!annonce.titre) signaler("infos.json : annonce sans titre.");
  if (annonce.url && !/^https?:\/\//.test(annonce.url)) signaler(`infos.json : adresse invalide dans l'annonce « ${annonce.titre} ».`);
  if (annonce.aller && !/^[a-z0-9/-]+$/.test(annonce.aller)) signaler(`infos.json : destination invalide dans l'annonce « ${annonce.titre} » (ex. agenda, pratique, sujet/<id>).`);
  if (annonce.jusquAu && !/^\d{4}-\d{2}-\d{2}$/.test(annonce.jusquAu)) signaler(`infos.json : « jusquAu » mal écrit dans l'annonce « ${annonce.titre} » (attendu AAAA-MM-JJ).`);
  if (annonce.dates && (!Array.isArray(annonce.dates) || annonce.dates.some((d) => !/^\d{4}-\d{2}-\d{2}$/.test(d)))) {
    signaler(`infos.json : « dates » mal écrites dans l'annonce « ${annonce.titre} » (une liste de jours AAAA-MM-JJ).`);
  }
}
for (const formation of infos.formations || []) {
  if (!formation.titre) signaler("infos.json : formation sans titre.");
  if (!formation.url || !/^https?:\/\//.test(formation.url)) signaler(`infos.json : la formation « ${formation.titre} » n'a pas d'adresse d'inscription valide.`);
  if (formation.jusquAu && !/^\d{4}-\d{2}-\d{2}$/.test(formation.jusquAu)) signaler(`infos.json : « jusquAu » mal écrit dans la formation « ${formation.titre} » (attendu AAAA-MM-JJ).`);
  if (formation.dates && (!Array.isArray(formation.dates) || formation.dates.some((d) => !/^\d{4}-\d{2}-\d{2}$/.test(d)))) {
    signaler(`infos.json : « dates » mal écrites dans la formation « ${formation.titre} » (une liste de jours AAAA-MM-JJ).`);
  }
}

const agenda = lireAgenda();
const idsAgenda = new Set();
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const HEURE = /^\d{2}:\d{2}$/;
for (const e of agenda.evenements || []) {
  if (!e.id || !/^[a-z0-9-]+$/.test(e.id)) signaler(`agenda.json : identifiant manquant ou invalide (${e.id}) — lettres minuscules, chiffres et tirets.`);
  if (idsAgenda.has(e.id)) signaler(`agenda.json : identifiant en double : ${e.id}`);
  idsAgenda.add(e.id);
  if (!e.titre) signaler(`agenda.json : rencontre sans titre (${e.id}).`);
  if (!DATE.test(e.date || "")) signaler(`agenda.json : date mal écrite pour ${e.id} (attendu AAAA-MM-JJ).`);
  if (e.heure && !HEURE.test(e.heure)) signaler(`agenda.json : heure mal écrite pour ${e.id} (attendu HH:MM).`);
  if (e.fin && !HEURE.test(e.fin)) signaler(`agenda.json : heure de fin mal écrite pour ${e.id} (attendu HH:MM).`);
  if (e.fin && e.heure && e.fin <= e.heure) signaler(`agenda.json : ${e.id} finit avant de commencer.`);
}

const pratique = lireJson("pratique.json");
for (const section of pratique.sections || []) {
  if (!section.titre) signaler("pratique.json : section sans titre.");
}
const liensPratique = [...(pratique.liens || []), ...(pratique.sections || []).flatMap((s) => s.liens || [])];
for (const lien of liensPratique) {
  if (!lien.titre || !/^https?:\/\//.test(lien.url || "")) signaler(`pratique.json : lien incomplet ou adresse invalide (${lien.titre || "?"}).`);
}

const sujets = [];
for (const fichier of readdirSync(join(contenu, "sujets")).filter((f) => f.endsWith(".json")).sort()) {
  const sujet = lireJson("sujets/" + fichier);
  sujets.push({ fichier, sujet });
  if (sujet.id !== fichier.replace(/\.json$/, "")) signaler(`sujets/${fichier} : l'identifiant « ${sujet.id} » doit être le nom du fichier.`);
  if (!sujet.titre) signaler(`sujets/${fichier} : titre manquant.`);
  if (!DATE.test(sujet.date || "")) signaler(`sujets/${fichier} : date mal écrite (attendu AAAA-MM-JJ).`);
  if (!Array.isArray(sujet.questions) || !sujet.questions.length) signaler(`sujets/${fichier} : aucune question.`);
  const ids = new Set();
  for (const q of sujet.questions || []) {
    if (!q.id) signaler(`sujets/${fichier} : question sans identifiant.`);
    if (ids.has(q.id)) signaler(`sujets/${fichier} : identifiant de question en double : ${q.id}`);
    ids.add(q.id);
    if (!q.texte || !q.texte.trim()) signaler(`sujets/${fichier} : question sans texte (${q.id}).`);
  }
  for (const v of (sujet.versets && sujet.versets.textes) || []) {
    if (!v.reference || !v.texte) signaler(`sujets/${fichier} : verset incomplet.`);
  }
}

const defis = [];
for (const fichier of readdirSync(join(contenu, "defis")).filter((f) => f.endsWith(".json")).sort()) {
  const defi = lireJson("defis/" + fichier);
  defis.push({ fichier, defi });
  if (defi.id !== fichier.replace(/\.json$/, "")) signaler(`defis/${fichier} : l'identifiant « ${defi.id} » doit être le nom du fichier.`);
  if (!["lecture", "defi"].includes(defi.type)) signaler(`defis/${fichier} : type inconnu « ${defi.type} » (lecture ou defi).`);
  if (!defi.titre) signaler(`defis/${fichier} : titre manquant.`);
  if (!Array.isArray(defi.etapes) || !defi.etapes.length) signaler(`defis/${fichier} : aucune étape.`);
  const ids = new Set();
  for (const e of defi.etapes || []) {
    if (!e.id) signaler(`defis/${fichier} : étape sans identifiant.`);
    if (ids.has(e.id)) signaler(`defis/${fichier} : identifiant d'étape en double : ${e.id}`);
    ids.add(e.id);
    if (!e.titre) signaler(`defis/${fichier} : étape sans titre (${e.id}).`);
  }
  if (defi.etapes && defi.etapes.some((e) => e.texte) && !defi.traduction) {
    signaler(`defis/${fichier} : des étapes citent un texte biblique, la traduction doit être indiquée.`);
  }
}

const identifiants = new Set();
for (const { sujet } of sujets) {
  if (identifiants.has(sujet.id)) signaler(`Identifiant en double entre sujets et défis : ${sujet.id}`);
  identifiants.add(sujet.id);
}
for (const { defi } of defis) {
  if (identifiants.has(defi.id)) signaler(`Identifiant en double entre sujets et défis : ${defi.id}`);
  identifiants.add(defi.id);
}

// --- 2. Index et calendrier à jour -------------------------------------------------------

const indexPresent = readFileSync(join(contenu, "index.json"), "utf8");
if (indexPresent !== texteIndex()) {
  signaler("index.json n'est plus à jour : lance « node scripts/generer-index.mjs ».");
}

const dossierAgenda = join(racine, "app", "agenda");
const fixe = new Date("2026-01-01T00:00:00Z");
const attendus = new Set();
for (const e of agenda.evenements || []) {
  const chemin = join(dossierAgenda, `${e.id}.ics`);
  attendus.add(`${e.id}.ics`);
  if (!existsSync(chemin) || readFileSync(chemin, "utf8") !== texteIcs(e, fixe)) {
    signaler(`agenda/${e.id}.ics manque ou n'est plus à jour : lance « node scripts/generer-index.mjs ».`);
  }
}
if (existsSync(dossierAgenda)) {
  for (const fichier of readdirSync(dossierAgenda)) {
    if (fichier.endsWith(".ics") && !attendus.has(fichier)) signaler(`agenda/${fichier} ne correspond à aucune rencontre : lance « node scripts/generer-index.mjs ».`);
  }
}

// --- 3. Fichiers promis par le service worker --------------------------------------------

const sw = readFileSync(join(racine, "app", "service-worker.js"), "utf8");
const listes = sw.match(/const FICHIERS = \[([\s\S]*?)\];/);
for (const [, chemin] of listes[1].matchAll(/"\.\/([^"]*)"/g)) {
  if (!chemin) continue; // "./" seul : c'est index.html, servi par le serveur
  if (!existsSync(join(racine, "app", chemin))) {
    signaler(`Le service worker met en cache « ${chemin} », qui n'existe pas.`);
  }
}

// --- 4. Fidélité au PDF du responsable ---------------------------------------------------

// Le PDF sort de Google Docs : ses puces traînent des caractères invisibles, et ses
// apostrophes ne sont pas celles du clavier. On compare des textes ramenés au même état.
function normaliser(texte) {
  return texte
    .replace(/[ ​‌‍⁠﻿]/g, " ")
    .replace(/[’‘‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

let sujetsControles = 0;
let pdfAbsent = false;
for (const { fichier, sujet } of sujets) {
  if (!sujet.source) continue;
  const pdf = join(racine, "source", sujet.source);
  if (!existsSync(pdf)) {
    // Le PDF du responsable ne quitte pas le dépôt de travail : sur le dépôt public, où tourne
    // la mise en ligne automatique, il n'existe pas. La fidélité est alors contrôlée avant
    // chaque envoi par publier.sh, qui tourne là où le PDF est. On le dit, on ne bloque pas.
    pdfAbsent = true;
    continue;
  }
  let texteDuPdf;
  try {
    texteDuPdf = normaliser(execFileSync("pdftotext", ["-layout", pdf, "-"], { encoding: "utf8" }));
  } catch {
    signaler("pdftotext est introuvable : la fidélité au PDF n'a PAS été vérifiée. Installez-le (brew install poppler) et relancez.");
    continue;
  }
  const aVerifier = [
    ...(sujet.avertissement ? [["avertissement", sujet.avertissement]] : []),
    ...(sujet.intro || []).flatMap((partie, i) => [
      [`intro ${i + 1}`, partie.texte],
      ...(partie.points || []).map((point, j) => [`intro ${i + 1}, point ${j + 1}`, point]),
    ]),
    ...sujet.questions.map((q) => [q.id, q.texte]),
  ];
  for (const [nom, texte] of aVerifier) {
    if (!texteDuPdf.includes(normaliser(texte))) {
      signaler(`sujets/${fichier} : « ${nom} » ne se retrouve pas mot pour mot dans ${sujet.source}.`);
    }
  }
  sujetsControles++;
}

// --- Verdict -----------------------------------------------------------------------------

if (erreurs.length) {
  for (const erreur of erreurs) console.error("✗ " + erreur);
  console.error(`\n${erreurs.length} problème(s).`);
  process.exit(1);
}

console.log(`OK — ${sujets.length} sujet(s), ${defis.length} lecture(s) et défi(s), ${(agenda.evenements || []).length} rencontre(s), ${liensPratique.length} lien(s).`);
if (sujetsControles) console.log(`${sujetsControles} sujet(s) conforme(s) au PDF du responsable, mot pour mot.`);
if (pdfAbsent) console.log("PDF absent (dépôt public) : la fidélité au PDF a été vérifiée avant l'envoi, pas ici.");

// Une annonce passée son dernier jour ne gêne pas (l'application ne l'affiche plus), mais
// elle encombre le fichier : on le signale, sans en faire une erreur.
const maintenant = new Date();
const deux = (n) => String(n).padStart(2, "0");
const aujourdhui = `${maintenant.getFullYear()}-${deux(maintenant.getMonth() + 1)}-${deux(maintenant.getDate())}`;
for (const annonce of infos.annonces || []) {
  const dernier = annonce.jusquAu || [...(Array.isArray(annonce.dates) ? annonce.dates : [])].sort().pop();
  if (dernier && dernier < aujourdhui) {
    console.log(`À noter : l'annonce « ${annonce.titre} » a passé son dernier jour (${dernier}) et ne s'affiche plus ; elle peut être retirée d'infos.json.`);
  }
}
for (const formation of infos.formations || []) {
  const fin = formation.jusquAu || [...(Array.isArray(formation.dates) ? formation.dates : [])].sort()[0];
  if (fin && fin < aujourdhui) {
    console.log(`À noter : la formation « ${formation.titre} » a commencé (${fin}) et ne s'affiche plus ; elle peut être retirée d'infos.json.`);
  }
}
