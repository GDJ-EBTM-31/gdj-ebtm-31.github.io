// Refait les quatre images de l'icône à partir de app/icones/icone.svg :
//   icone-512.png, icone-192.png (Android, écran d'installation), icone-180.png (iPhone),
//   icone-maskable-512.png (Android, quand il découpe lui-même l'icône en rond ou en carré
//   arrondi : le dessin y est réduit pour tenir dans le cercle central, 80 % de la largeur,
//   https://www.w3.org/TR/appmanifest/#icon-masks).
// Le dessin est rendu par Chrome sans fenêtre (il applique aussi les filtres SVG, que
// l'aperçu de macOS ignore, si l'icône en reprend un jour), deux fois plus grand, puis
// réduit par sips.
// Usage : node scripts/generer-icones.mjs
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const racine = join(dirname(fileURLToPath(import.meta.url)), "..");
const icones = join(racine, "app", "icones");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
// Part du dessin gardée dans l'icône à découper : ses coins restent dans le cercle sûr.
const REDUCTION = 0.8;

const source = readFileSync(join(icones, "icone.svg"), "utf8");
for (const repere of [' rx="112"', '<g id="dessin">']) {
  if (source.split(repere).length !== 2) {
    console.error(`icone.svg : le repère ${repere} doit y figurer une fois, et une seule.`);
    process.exit(1);
  }
}
const carre = source.replace(' rx="112"', "");
const aDecouper = carre.replace(
  '<g id="dessin">',
  `<g id="dessin" transform="translate(256 256) scale(${REDUCTION}) translate(-256 -256)">`
);

const travail = mkdtempSync(join(tmpdir(), "gdj-icones-"));
try {
  const rendre = (svg, nom) => {
    const page = join(travail, nom + ".html");
    const image = join(travail, nom + ".png");
    writeFileSync(page, `<!doctype html><meta charset="utf-8"><style>html, body { margin: 0; } svg { display: block; }</style>${svg}`);
    execFileSync(
      CHROME,
      ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=2", "--window-size=512,512",
        `--user-data-dir=${join(travail, "profil")}`, `--screenshot=${image}`, pathToFileURL(page).href],
      { stdio: "ignore" }
    );
    return image;
  };
  const reduire = (image, cote, nom) =>
    execFileSync("sips", ["-s", "format", "png", "-z", String(cote), String(cote), image, "--out", join(icones, nom)], { stdio: "ignore" });

  const grande = rendre(carre, "carre");
  reduire(grande, 512, "icone-512.png");
  reduire(grande, 192, "icone-192.png");
  reduire(grande, 180, "icone-180.png");
  reduire(rendre(aDecouper, "a-decouper"), 512, "icone-maskable-512.png");
  console.log("Icônes refaites : icone-512.png, icone-192.png, icone-180.png, icone-maskable-512.png");
} finally {
  rmSync(travail, { recursive: true, force: true });
}
