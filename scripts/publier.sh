#!/bin/sh
# Met l'application en ligne, sans jamais publier ce qui doit rester privé.
#
# Le dépôt de travail contient le PDF du responsable et le journal de projet ; le dépôt
# public, lui, ne reçoit que l'application, ses contrôles et le fichier de mise en ligne.
# Passer par ce script plutôt que par un « git push » direct est ce qui garantit cette
# séparation.
#
# Usage : sh scripts/publier.sh [--mineure | --majeure] "ce qui a changé"
#   sans option : le dernier chiffre de la version monte (1.0.0 → 1.0.1) : corrections, contenu ;
#   --mineure   : nouvelle fonctionnalité (1.0.3 → 1.1.0) ;
#   --majeure   : refonte (1.4.2 → 2.0.0).
# La version s'affiche dans les réglages de l'application (« Version 1.0.0 »).
set -e

# Organisation GitHub GDJ-EBTM-31, créée le 11 septembre 2026 ; le dépôt est en minuscules,
# comme l'exige GitHub Pages. Adresse de l'application : https://gdj-ebtm-31.github.io/
depot="${DEPOT_PUBLIC:-https://github.com/GDJ-EBTM-31/gdj-ebtm-31.github.io.git}"
racine=$(cd "$(dirname "$0")/.." && pwd)
travail="$racine/.publication"

niveau="correctif"
case "${1:-}" in
  --mineure) niveau="mineure"; shift ;;
  --majeure) niveau="majeure"; shift ;;
esac

# Apostrophe typographique (’) et non droite ('), exprès : dans "${1:-…}", le sh de macOS
# prend une apostrophe droite pour une citation jamais fermée, et le script entier est
# refusé (constaté le 11 septembre 2026 avec « sh -n »).
message="${1:-Mise à jour de l’application}"

# Les contrôles d'abord : rien ne part en ligne sur un contenu qui ne passe pas.
node "$racine/scripts/generer-index.mjs" > /dev/null
node "$racine/scripts/verifier-contenu.mjs"
node "$racine/scripts/verifier-detection.mjs" > /dev/null
node "$racine/scripts/verifier-contrastes.mjs" > /dev/null

# Le numéro de version du service worker est ce qui dit aux téléphones déjà équipés de tout
# recharger. L'oublier, c'est publier dans le vide : ils garderaient l'ancienne version sans
# que personne s'en aperçoive. Il est donc avancé ici, jamais à la main.
# Numérotation à trois chiffres depuis le 11 septembre 2026, à la demande de Sébastien ; la
# précédente, par date (2026-09-11-5), est convertie une fois en 1.0.0.
python3 - "$racine/app/service-worker.js" "$niveau" <<'PYTHON'
import re, sys

chemin, niveau = sys.argv[1], sys.argv[2]
source = open(chemin, encoding="utf-8").read()
motif = re.compile(r'const VERSION = "([^"]+)";')
trouve = motif.search(source)
if not trouve:
    sys.exit("VERSION introuvable dans le service worker.")

ancienne = trouve.group(1)
trois = re.fullmatch(r"(\d+)\.(\d+)\.(\d+)", ancienne)
if not trois:
    nouvelle = "1.0.0"
else:
    majeure, mineure, correctif = (int(n) for n in trois.groups())
    if niveau == "majeure":
        nouvelle = f"{majeure + 1}.0.0"
    elif niveau == "mineure":
        nouvelle = f"{majeure}.{mineure + 1}.0"
    else:
        nouvelle = f"{majeure}.{mineure}.{correctif + 1}"
open(chemin, "w", encoding="utf-8").write(motif.sub(f'const VERSION = "{nouvelle}";', source, count=1))
print(f"  version : {ancienne} → {nouvelle}")
PYTHON

if [ ! -d "$travail/.git" ]; then
  git clone "$depot" "$travail"
fi
git -C "$travail" fetch --quiet origin
git -C "$travail" checkout --quiet -B main origin/main 2>/dev/null || git -C "$travail" checkout --quiet -B main

# --delete retire du dépôt public ce qui a été supprimé ici ; les fichiers non listés
# n'y arrivent jamais.
rsync -a --delete "$racine/app/" "$travail/app/"
rsync -a --delete "$racine/scripts/" "$travail/scripts/"
mkdir -p "$travail/.github/workflows"
rsync -a --delete "$racine/.github/workflows/" "$travail/.github/workflows/"
cp "$racine/README.md" "$travail/README.md"

# Ceintures et bretelles : on refuse de publier si l'un de ces chemins s'est glissé là.
for interdit in source docs CLAUDE.md .publication; do
  if [ -e "$travail/$interdit" ]; then
    echo "ARRÊT : « $interdit » ne doit jamais être publié." >&2
    exit 1
  fi
done

if git -C "$travail" diff --quiet && git -C "$travail" diff --cached --quiet && [ -z "$(git -C "$travail" status --porcelain)" ]; then
  echo "Rien de nouveau à publier."
  exit 0
fi

git -C "$travail" add -A
git -C "$travail" commit -q -m "$message"
git -C "$travail" push -q origin main
echo "Publié. La mise en ligne prend une minute ou deux."
