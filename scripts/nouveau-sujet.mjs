#!/usr/bin/env node
/*
 * Crée le fichier d'un nouveau sujet à partir d'un gabarit, prêt à être rempli.
 *
 * Usage : node scripts/nouveau-sujet.mjs <identifiant> "<titre>"
 *   ex.  : node scripts/nouveau-sujet.mjs 2026-11-priere "La prière"
 *
 * L'identifiant devient le nom du fichier et l'adresse du sujet dans l'application : des
 * lettres minuscules, des chiffres et des tirets, en commençant de préférence par l'année et
 * le mois pour que les fichiers se rangent dans l'ordre.
 *
 * Ensuite : remplir le fichier, lancer « node scripts/generer-index.mjs », puis
 * « node scripts/verifier-contenu.mjs ».
 */
import { writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const racine = join(dirname(fileURLToPath(import.meta.url)), "..");
const [identifiant, titre] = process.argv.slice(2);

if (!identifiant || !titre) {
  console.error('Usage : node scripts/nouveau-sujet.mjs <identifiant> "<titre>"');
  process.exit(1);
}
if (!/^[a-z0-9-]+$/.test(identifiant)) {
  console.error("L'identifiant ne doit contenir que des lettres minuscules, des chiffres et des tirets.");
  process.exit(1);
}

const chemin = join(racine, "app", "contenu", "sujets", `${identifiant}.json`);
if (existsSync(chemin)) {
  console.error(`${chemin} existe déjà.`);
  process.exit(1);
}

const aujourdhui = new Date().toISOString().slice(0, 10);

const gabarit = {
  id: identifiant,
  date: aujourdhui,
  titre,
  sousTitre: "",
  resume: "Une phrase qui dit de quoi il s’agit, affichée sous le titre sur l’accueil.",
  intro: [
    {
      texte: "Quelques mots du responsable pour présenter le sujet.",
      points: ["Un premier objectif", "Un second objectif"],
    },
  ],
  avertissement: "",
  questions: [
    { id: "q1", texte: "La première question." },
    { id: "q2", texte: "La deuxième question." },
  ],
  versets: {
    titre: "Pour t’inspirer",
    traduction: "Bible Louis Segond 1910",
    textes: [{ reference: "Jean 3.16", texte: "Le texte du verset, recopié dans la traduction indiquée." }],
  },
};

writeFileSync(chemin, JSON.stringify(gabarit, null, 2) + "\n", "utf8");
console.log(`Sujet créé : app/contenu/sujets/${identifiant}.json`);
console.log("Remplis-le, puis : node scripts/generer-index.mjs && node scripts/verifier-contenu.mjs");
