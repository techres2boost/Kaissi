#!/usr/bin/env node
/**
 * Les visuels de fiche des magasins, dessinés ICI et rendus en PNG.
 *
 * ── Pourquoi un script, et pas un fichier PNG posé dans le dépôt ──────────
 *
 * Parce qu'un PNG ne se relit pas. Le jour où la charte bouge — elle vient de
 * bouger — une image binaire reste en arrière sans que rien ne le dise, et on
 * publie une icône d'une palette qui n'existe plus. Ici, les couleurs sont
 * les MÊMES littéraux que les feuilles de styles, la marque est du SVG, et
 * régénérer prend trois secondes.
 *
 * ── Ce qu'il produit ─────────────────────────────────────────────────────
 *
 *   ressources-store/icone-512.png          Google Play — icône (512 × 512)
 *   ressources-store/icone-1024.png         App Store — icône (1024 × 1024)
 *   ressources-store/banniere-1024x500.png  Google Play — image mise en avant
 *   ressources-store/icone-48-apercu.png    contrôle : l'icône à sa taille
 *                                           réelle dans une liste
 *
 * ── Les contraintes des magasins, et comment elles sont tenues ────────────
 *
 *  • PNG ou JPEG, moins de 1 Mio pour l'icône — un PNG plat de 512 pèse
 *    quelques dizaines de kio ;
 *  • AUCUNE transparence, AUCUN coin arrondi : les deux magasins masquent
 *    l'icône eux-mêmes. Un coin arrondi dessiné dedans donne un double
 *    arrondi, et un fond transparent devient noir sur certains thèmes. Le
 *    fond est donc un aplat opaque, jusqu'au bord ;
 *  • la marque tient dans les 80 % centraux : c'est la zone qu'aucun masque
 *    ne rogne, quelle que soit la forme retenue par le lanceur.
 *
 * Lancement :  node outils/generer-visuels.mjs
 */

import { chromium } from 'playwright'
import { mkdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..')
const SORTIE = join(RACINE, 'ressources-store')
mkdirSync(SORTIE, { recursive: true })

/* La Sora du build, embarquée en base64 : le rendu ne dépend d'aucun serveur
   ni d'aucune police installée sur le poste. Sans cela, la même commande
   donnerait une bannière différente selon la machine. */
const SORA = readFileSync(join(RACINE, 'outils/polices/sora-latin.woff2')).toString('base64')

/* Les couleurs — les mêmes littéraux que `apps/pos/src/styles.css`. */
const FORET = ['#0b2016', '#0f2e1f', '#123725']
const MENTHE = '#7EC694'
const IVOIRE = '#F6F3EA'
const TERRE_CLAIRE = '#E88A5E'
/* Le terracotta plein (#C4562B) n'apparaît qu'en `rgba()` dans les halos du
   fond : le lister en constante donnerait une variable inutilisée. */

const police = `
@font-face {
  font-family: 'Sora';
  src: url(data:font/woff2;base64,${SORA}) format('woff2');
  font-weight: 600 700;
  font-display: block;
}`

/**
 * La marque : un K de trois traits.
 *
 * Dessiné en TRAITS et non en texte — une lettre de police dépendrait du
 * rendu de la fonte, du crénage et de la version installée. Trois segments
 * ronds donnent exactement la même image partout, à toutes les tailles.
 *
 * La barre haute est terracotta, le reste menthe : les deux accents de la
 * charte dans un seul signe, sans décoration ajoutée.
 */
function marque(taille, opacite = 1) {
  /*
   * ⚑ `stroke-width` est en unités de VIEWBOX, pas en pixels.
   *
   * La première version le mettait à l'échelle une seconde fois — juste à
   * 512, et dix fois trop fin dès qu'on réduisait. Invisible sur la grande
   * icône, évident sur l'aperçu à 48 px : un K en fil de fer. C'est
   * exactement ce que cet aperçu existe pour attraper ; sans lui, on publiait.
   */
  return `
<svg width="${taille}" height="${taille}" viewBox="0 0 512 512" fill="none" opacity="${opacite}">
  <g stroke-linecap="round" stroke-width="62">
    <path d="M188 132 V380" stroke="${MENTHE}"/>
    <path d="M188 262 L344 132" stroke="${TERRE_CLAIRE}"/>
    <path d="M188 262 L356 380" stroke="${MENTHE}"/>
  </g>
</svg>`
}

/** Le fond des deux visuels : le forêt de la charte, plus ses deux halos. */
const FOND = `
  background:
    radial-gradient(70% 70% at 12% 8%, rgba(126,198,148,0.30), transparent 62%),
    radial-gradient(65% 70% at 96% 100%, rgba(196,86,43,0.38), transparent 60%),
    linear-gradient(150deg, ${FORET[0]} 0%, ${FORET[1]} 52%, ${FORET[2]} 100%);`

const page = (largeur, hauteur, corps) => `<!doctype html>
<meta charset="utf-8">
<style>
  ${police}
  html, body { margin: 0; padding: 0; }
  body { width: ${largeur}px; height: ${hauteur}px; overflow: hidden;
         font-family: 'Sora', system-ui, sans-serif; ${FOND} }
  .centre { width: 100%; height: 100%; display: grid; place-items: center; }
</style>
${corps}`

const VISUELS = [
  {
    fichier: 'icone-512.png',
    largeur: 512,
    hauteur: 512,
    quoi: 'Google Play — icône',
    corps: `<div class="centre">${marque(512 * 0.78)}</div>`,
  },
  {
    fichier: 'icone-1024.png',
    largeur: 1024,
    hauteur: 1024,
    quoi: 'App Store — icône',
    corps: `<div class="centre">${marque(1024 * 0.78)}</div>`,
  },
  {
    fichier: 'banniere-1024x500.png',
    largeur: 1024,
    hauteur: 500,
    quoi: 'Google Play — image mise en avant',
    /*
     * Le texte reste dans la moitié gauche et à 64 px des bords : Play
     * recadre cette image selon l'endroit où il l'affiche, et ce qui touche
     * le bord est la première chose qui saute.
     */
    corps: `
<div style="display:flex; align-items:center; height:100%; padding:0 64px; gap:40px">
  <div style="flex:1 1 auto; min-width:0">
    <div style="font-size:78px; font-weight:700; letter-spacing:-0.03em; color:${MENTHE}; line-height:1">Kaissi</div>
    <div style="margin-top:18px; font-size:31px; font-weight:600; color:${IVOIRE}; line-height:1.25">
      La caisse qui ne s’arrête<br>jamais, même sans Internet.
    </div>
    <div style="margin-top:26px; display:inline-flex; align-items:center; gap:10px;
                padding:9px 18px; border-radius:999px;
                background:rgba(196,86,43,0.22); border:1px solid rgba(196,86,43,0.45)">
      <span style="width:9px; height:9px; border-radius:50%; background:${TERRE_CLAIRE}"></span>
      <span style="font-size:19px; font-weight:600; color:#FFB694; letter-spacing:0.02em">Res2Boost · Tunisie</span>
    </div>
  </div>
  <div style="flex:0 0 auto; display:grid; place-items:center">${marque(300)}</div>
</div>`,
  },
]

const nav = await chromium.launch(
  process.env.CHROMIUM_PATH
    ? { executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] }
    : {},
)

for (const v of VISUELS) {
  const onglet = await nav.newPage({
    viewport: { width: v.largeur, height: v.hauteur },
    deviceScaleFactor: 1,
  })
  await onglet.setContent(page(v.largeur, v.hauteur, v.corps), { waitUntil: 'load' })
  await onglet.evaluate(() => document.fonts.ready)
  const chemin = join(SORTIE, v.fichier)
  await onglet.screenshot({ path: chemin, type: 'png' })
  const kio = (statSync(chemin).size / 1024).toFixed(1)
  console.log(`  ✓ ${v.fichier.padEnd(24)} ${v.largeur}×${v.hauteur}  ${kio} Kio   ${v.quoi}`)
  await onglet.close()
}

/*
 * Le contrôle qui compte : l'icône à la taille où on la voit réellement.
 *
 * Une marque « qui rend bien » en 512 peut devenir une tache en 48 — et 48,
 * c'est la taille dans la liste des applications du téléphone. On rend donc
 * la version réduite à côté, pour la regarder plutôt que l'espérer.
 */
const apercu = await nav.newPage({ viewport: { width: 380, height: 150 }, deviceScaleFactor: 4 })
await apercu.setContent(
  `<!doctype html><meta charset="utf-8">
   <style>${police} body{margin:0;background:#ECE7DC;display:flex;align-items:center;
     gap:18px;padding:20px;font-family:'Sora',sans-serif}
     .p{border-radius:22%;overflow:hidden;${FOND};display:grid;place-items:center}</style>
   <div class="p" style="width:48px;height:48px;flex:none">${marque(48 * 0.78)}</div>
   <div class="p" style="width:72px;height:72px;flex:none">${marque(72 * 0.78)}</div>
   <div class="p" style="width:112px;height:112px;flex:none">${marque(112 * 0.78)}</div>
   <div style="font-size:13px;color:#414D48">48 · 72 · 112 px</div>`,
  { waitUntil: 'load' },
)
await apercu.evaluate(() => document.fonts.ready)
await apercu.screenshot({ path: join(SORTIE, 'icone-48-apercu.png') })
console.log('  ✓ icone-48-apercu.png      contrôle de lisibilité aux petites tailles')

await nav.close()
console.log(`\n✓ Visuels écrits dans ressources-store/`)
