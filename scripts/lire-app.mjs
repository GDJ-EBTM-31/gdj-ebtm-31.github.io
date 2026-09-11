// Extrait des fonctions de app.js pour les faire tourner ailleurs — contrôles et aperçu.
//
// On prend le code tel qu'il est écrit plutôt que de le recopier : une modification de
// l'application est ainsi forcément prise en compte, et rien ne peut se mettre à mentir.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const racine = join(dirname(fileURLToPath(import.meta.url)), "..");
export const source = readFileSync(join(racine, "app", "app.js"), "utf8");

// Les fonctions sont indentées de deux espaces dans l'application : leur accolade fermante
// est donc la première ligne « \n  }\n » qui suit leur début.
export function extraire(nom) {
  const debut = source.indexOf(`function ${nom}() {`);
  if (debut === -1) throw new Error(`${nom}() est introuvable dans app.js.`);
  const fin = source.indexOf("\n  }\n", debut);
  if (fin === -1) throw new Error(`La fin de ${nom}() est introuvable dans app.js.`);
  return source.slice(debut, fin + 4);
}

// Les instructions d'installation, telles que les verrait l'appareil décrit.
export function instructions({ userAgent, maxTouchPoints = 5, installationDifferee = null }) {
  const produire = new Function(
    "navigator",
    "installationDifferee",
    "PARTAGE_IOS",
    `const html = (m, ...v) => m.reduce((s, p, i) => s + p + (v[i] ?? ""), "");
     const echapper = (x) => String(x);
     ${extraire("surIPhone")}
     ${extraire("dansNavigateurIntegre")}
     ${extraire("etapesInstallation")}
     return etapesInstallation();`
  );
  const partageIOS = source.slice(source.indexOf("const PARTAGE_IOS = `") + 21, source.indexOf("</svg>`") + 6);
  return produire({ userAgent, maxTouchPoints }, installationDifferee, partageIOS);
}

export function dansNavigateurIntegre(userAgent) {
  const f = new Function("navigator", `${extraire("dansNavigateurIntegre")}\nreturn dansNavigateurIntegre();`);
  return f({ userAgent, maxTouchPoints: 5 });
}
