#!/usr/bin/env node
// Contrôle les contrastes de l'application selon le critère WCAG AA : 4,5 pour du texte
// ordinaire, 3 pour les bordures des éléments avec lesquels on interagit. Toute couleur
// ajoutée à la feuille de style passe par ce contrôle avant d'être mise en ligne.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const racine = join(dirname(fileURLToPath(import.meta.url)), "..");
const css = readFileSync(join(racine, "app", "style.css"), "utf8");

const jetons = {};
for (const [, nom, valeur] of css.match(/^:root \{([\s\S]*?)\n\}/m)[1].matchAll(/--([a-z-]+):\s*([^;]+);/g)) {
  jetons[nom] = valeur.trim();
}
// Le blanc des textes posés sur un aplat de couleur n'est pas un jeton : il est écrit en clair
// dans la feuille de style, il faut donc le nommer ici pour pouvoir le mesurer.
jetons["blanc"] = "#ffffff";
// Sur le bandeau « À la une », tout le texte est en blanc pur : un blanc translucide sur le
// magenta vif passait sous le seuil (4,18). La hiérarchie s'y fait par la taille et la
// graisse, pas par la transparence. Ne pas y remettre de blanc à moins de 100 %.

function hexVersRvb(hex) {
  const n = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16));
}

function canal(v) {
  v /= 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function luminance(hex) {
  const [r, g, b] = hexVersRvb(hex);
  return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b);
}

const contraste = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

const PAIRES = [
  ["texte courant", "encre", "fond", 4.5],
  ["texte courant sur carte", "encre", "carte", 4.5],
  ["texte courant sur teinte", "encre", "teinte", 4.5],
  ["texte adouci", "texte-doux", "fond", 4.5],
  ["texte adouci sur carte", "texte-doux", "carte", 4.5],
  ["titres", "violet-fonce", "fond", 4.5],
  ["titres sur carte", "violet-fonce", "carte", 4.5],
  ["titres sur teinte", "violet-fonce", "teinte", 4.5],
  ["liens et références", "violet", "fond", 4.5],
  ["liens et références sur carte", "violet", "carte", 4.5],
  ["référence d’un verset", "violet", "teinte", 4.5],
  ["sous-titre magenta sur fond", "magenta", "fond", 4.5],
  ["sous-titre magenta sur carte", "magenta", "carte", 4.5],
  ["texte du bouton principal", "blanc", "violet", 4.5],
  ["texte du bouton principal, côté magenta", "blanc", "magenta", 4.5],
  ["à la une, côté sombre", "blanc", "violet-fonce", 4.5],
  ["à la une, côté clair", "blanc", "magenta-vif", 4.5],
  ["avertissement", "attention", "attention-fond", 4.5],
  ["bandeau du navigateur intégré", "attention", "attention-fond", 4.5],
  ["mention « Enregistré »", "ok", "carte", 4.5],
  ["effacement des réponses", "danger", "carte", 4.5],
  ["bordure d’une zone de saisie", "bord-actif", "fond", 3],
  ["bordure d’une zone de saisie sur carte", "bord-actif", "carte", 3],
  ["case à cocher vide sur carte", "bord-actif", "carte", 3],
];

let echecs = 0;
for (const [nom, avant, arriere, seuil] of PAIRES) {
  const rapport = contraste(jetons[avant], jetons[arriere]);
  const ok = rapport >= seuil;
  if (!ok) echecs++;
  console.log(`${ok ? "  " : "✗ "}${nom.padEnd(46)} ${rapport.toFixed(2)} (min ${seuil})`);
}

console.log(
  echecs ? `\n${echecs} contraste(s) sous le seuil.` : "\nTous les contrastes atteignent le seuil WCAG AA."
);
if (echecs) process.exit(1);
