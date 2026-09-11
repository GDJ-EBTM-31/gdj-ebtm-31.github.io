#!/bin/sh
# Génère le QR code d'une adresse et vérifie, en le relisant, qu'il pointe bien dessus.
# Usage : sh scripts/generer-qr.sh https://gdj-ebtm-31.github.io/ [sortie.png]
set -e
[ $# -ge 1 ] || { echo "Usage : sh scripts/generer-qr.sh <adresse> [sortie.png]" >&2; exit 1; }
adresse="$1"
sortie="${2:-app/qr-gdj.png}"
dossier=$(dirname "$0")

# -s 14 : 14 pixels par module, lisible même imprimé en petit format.
# -m 4  : marge blanche de 4 modules, exigée par la norme pour que les lecteurs accrochent.
# -l H  : correction d'erreur maximale, le code reste lisible même abîmé ou partiellement masqué.
qrencode -o "$sortie" -s 14 -m 4 -l H "$adresse"

relu=$(swift "$dossier/lire-qr.swift" "$sortie")
if [ "$relu" = "$adresse" ]; then
  echo "QR code écrit et vérifié : $sortie"
  echo "  pointe bien vers : $relu"
else
  echo "ÉCHEC : le QR code relu donne « $relu » au lieu de « $adresse »." >&2
  exit 1
fi
