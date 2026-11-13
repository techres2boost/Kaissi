#!/usr/bin/env bash
#
# Icônes et écrans de démarrage de la caisse, depuis UNE source.
#
# ── Pourquoi ce script existe ─────────────────────────────────────────────
#
# Apple a refusé la version 1.0 (60) au titre de la règle 2.3.8 : « les
# icônes de l'application semblent être des icônes provisoires ». C'était
# vrai : `cap add ios` et `cap add android` posent l'icône et l'écran de
# démarrage PAR DÉFAUT de Capacitor (une croix bleue), et personne ne les
# avait remplacés. La fiche du magasin, elle, montrait le « K » de Kaissi —
# deux icônes différentes pour la même application, exactement ce que la
# règle refuse.
#
# Toutes les icônes viennent désormais de `ressources-store/icone-1024.png`,
# celle de la fiche. Changer l'icône, c'est changer ce fichier et relancer :
#
#   bash apps/pos/scripts/generer-icones.sh
#
# Exige ImageMagick (`convert`). Le résultat est versionné : la CI ne
# régénère rien, elle vérifie (`verifier-icones.mjs`).
#
# ⚑ L'icône iOS ne doit porter AUCUN canal alpha : App Store Connect refuse
#   le téléversement d'une icône transparente. D'où `-alpha off` et PNG24.

set -euo pipefail

ICI="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE="$ICI/../../ressources-store/icone-1024.png"
# Le vert le plus sombre de l'icône : le fond de l'écran de démarrage et du
# calque arrière de l'icône adaptative Android.
FOND='#102A1D'
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

[ -f "$SOURCE" ] || { echo "✗ Source introuvable : $SOURCE" >&2; exit 1; }

# L'icône, aux coins arrondis (rayon 22 %, celui d'iOS), sur fond transparent.
arrondie() { # $1 taille, $2 sortie
  local n=$1 r
  r=$(( n * 22 / 100 ))
  convert "$SOURCE" -resize "${n}x${n}" \
    \( -size "${n}x${n}" xc:none -fill white -draw "roundrectangle 0,0,$((n-1)),$((n-1)),$r,$r" \) \
    -alpha set -compose DstIn -composite -strip "PNG32:$2"
}

# ── iOS : une seule icône 1024, opaque ──────────────────────────────────────
IOS="$ICI/ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png"
convert "$SOURCE" -resize 1024x1024 -background "$FOND" -alpha remove -alpha off -strip "PNG24:$IOS"

# ── Android ─────────────────────────────────────────────────────────────────
RES="$ICI/android/app/src/main/res"
declare -A LANCEUR=([mdpi]=48 [hdpi]=72 [xhdpi]=96 [xxhdpi]=144 [xxxhdpi]=192)
declare -A AVANT=([mdpi]=108 [hdpi]=162 [xhdpi]=216 [xxhdpi]=324 [xxxhdpi]=432)
for d in mdpi hdpi xhdpi xxhdpi xxxhdpi; do
  n=${LANCEUR[$d]}
  arrondie "$n" "$RES/mipmap-$d/ic_launcher.png"
  convert "$SOURCE" -resize "${n}x${n}" \
    \( -size "${n}x${n}" xc:none -fill white -draw "circle $((n/2)),$((n/2)) $((n/2)),0" \) \
    -alpha set -compose DstIn -composite -strip "PNG32:$RES/mipmap-$d/ic_launcher_round.png"
  # Icône ADAPTATIVE (Android 8+) : le lanceur découpe la zone centrale
  # (72 dp sur 108). Le « K » de la source tient dans cette zone ; seul le
  # dégradé des bords est rogné.
  f=${AVANT[$d]}
  convert "$SOURCE" -resize "${f}x${f}" -strip "PNG32:$RES/mipmap-$d/ic_launcher_foreground.png"
done
cat > "$RES/values/ic_launcher_background.xml" <<XML
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">$FOND</color>
</resources>
XML

# ── Écrans de démarrage : l'icône au centre, sur le vert de Kaissi ────────
demarrage() { # $1 fichier existant (on garde sa taille)
  local taille w h s
  taille=$(identify -format '%wx%h' "$1")
  w=${taille%x*}; h=${taille#*x}
  s=$(( (w < h ? w : h) * 28 / 100 ))
  arrondie "$s" "$TMP/logo.png"
  convert -size "${w}x${h}" "xc:$FOND" "$TMP/logo.png" -gravity center -composite \
    -alpha off -strip "PNG24:$1"
}
while IFS= read -r f; do demarrage "$f"; done < <(find "$RES" -name splash.png)
for f in "$ICI"/ios/App/App/Assets.xcassets/Splash.imageset/*.png; do demarrage "$f"; done

echo "✓ Icônes et écrans de démarrage générés depuis ressources-store/icone-1024.png"
