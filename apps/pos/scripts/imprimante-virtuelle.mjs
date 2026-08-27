#!/usr/bin/env node
/**
 * Une imprimante thermique qui n'existe pas.
 *
 * Elle écoute le port 9100 en TCP — exactement comme une Epson TM-T20 ou une
 * Xprinter du marché tunisien — accepte la charge ESC/POS que lui envoie le
 * plugin natif, et l'affiche dans le terminal telle qu'elle sortirait sur le
 * papier.
 *
 * Pourquoi elle existe : la chaîne « ticket → octets ESC/POS → socket →
 * papier » est le seul morceau du produit qu'aucun test ne couvre, et acheter
 * une imprimante pour découvrir qu'on s'est trompé de trois octets est un
 * détour coûteux. Ceci en couvre TOUT sauf le dernier maillon.
 *
 * Ce qu'elle NE prouve PAS : qu'une vraie imprimante accepte ces octets. Les
 * modèles diffèrent sur le jeu de caractères, la coupe et le tiroir-caisse.
 * Le papier reste le juge.
 *
 *   node apps/pos/scripts/imprimante-virtuelle.mjs           # port 9100
 *   node apps/pos/scripts/imprimante-virtuelle.mjs --port 9101
 *   node apps/pos/scripts/imprimante-virtuelle.mjs --brut    # + octets bruts
 */

import { createServer } from 'node:net'
import { networkInterfaces } from 'node:os'

/*
 * Le décodeur est écrit ICI, et non importé de @kaissi/printing.
 *
 * Un outil de débogage doit démarrer d'une seule commande, sans build et sans
 * résolution d'espace de travail. Les paquets du dépôt sont consommés en
 * source TypeScript, ce qu'un « node » nu ne sait pas charger — importer
 * `rendu.ts` échouait sur « Cannot find module …/monnaie.js ».
 *
 * La contrepartie est une duplication : ce décodeur doit suivre COMMANDES
 * dans packages/printing/src/index.ts. Elle est assumée parce qu'il ne
 * calcule RIEN — il affiche. Aucun montant ne passe par lui, donc aucun écart
 * de caisse ne peut en naître (règle 7).
 */

/** Longueur totale des séquences ESC/POS, en octets, y compris l'introducteur. */
const SEQUENCES = new Map([
  ['1b40', 2], // ESC @  initialiser
  ['1b45', 3], // ESC E  gras
  ['1b61', 3], // ESC a  alignement
  ['1b64', 3], // ESC d  sauter n lignes
  ['1b74', 3], // ESC t  jeu de caractères
  ['1b70', 5], // ESC p  impulsion tiroir-caisse
  ['1d21', 3], // GS  !  taille de caractère
  ['1d56', 4], // GS  V  coupe
])

/** Rend la charge telle qu'elle sortirait sur le papier. */
function apercuTexte(charge, largeur = 42) {
  const lignes = []
  let courante = ''
  let alignement = 'gauche'

  const poser = () => {
    if (courante.trim() === '' || alignement === 'gauche') {
      lignes.push(courante)
    } else if (alignement === 'centre') {
      lignes.push(' '.repeat(Math.max(0, Math.floor((largeur - courante.length) / 2))) + courante)
    } else {
      lignes.push(' '.repeat(Math.max(0, largeur - courante.length)) + courante)
    }
    courante = ''
  }

  for (let i = 0; i < charge.length; i += 1) {
    const octet = charge[i]

    if (octet === 0x1b || octet === 0x1d) {
      const cle = octet.toString(16).padStart(2, '0') + charge[i + 1].toString(16).padStart(2, '0')
      const longueur = SEQUENCES.get(cle)
      if (longueur === undefined) {
        // Séquence inconnue : sauter l'introducteur seul plutôt que d'avaler
        // du texte au hasard. Un octet de trop se voit ; du texte mangé, non.
        continue
      }
      if (cle === '1b61') alignement = ['gauche', 'centre', 'droite'][charge[i + 2]] ?? 'gauche'
      if (cle === '1b64') for (let n = 0; n < charge[i + 2]; n += 1) poser()
      i += longueur - 1
      continue
    }

    if (octet === 0x0a) {
      poser()
      continue
    }
    // CP858 : les octets < 128 sont de l'ASCII ; au-delà, on rend l'octet tel
    // quel plutôt que d'inventer une table — l'aperçu sert à VOIR la mise en
    // page, pas à valider un jeu de caractères.
    courante += String.fromCharCode(octet)
  }
  if (courante !== '') poser()

  return lignes.join('\n')
}

const arguments_ = process.argv.slice(2)
const port = Number(arguments_[arguments_.indexOf('--port') + 1]) || 9100
const brut = arguments_.includes('--brut')

/** Les adresses IPv4 locales, pour que l'appareil sache où viser. */
function adressesLocales() {
  return Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address)
}

let compteur = 0

const serveur = createServer((socket) => {
  const morceaux = []
  const debut = Date.now()
  const source = `${socket.remoteAddress}:${socket.remotePort}`

  socket.on('data', (morceau) => morceaux.push(morceau))

  socket.on('end', () => {
    compteur += 1
    const charge = Buffer.concat(morceaux)

    console.log(`\n${'═'.repeat(46)}`)
    console.log(`TICKET #${compteur} — ${charge.length} octets — ${source} — ${Date.now() - debut} ms`)
    console.log('═'.repeat(46))

    try {
      console.log(apercuTexte(new Uint8Array(charge)))
    } catch (erreur) {
      console.log(`⚠ charge illisible : ${erreur.message}`)
    }

    console.log('─'.repeat(46))

    // Ce que ferait la mécanique, et qu'un aperçu texte ne montre pas.
    const octets = [...charge]
    const contient = (motif) =>
      octets.some((_, i) => motif.every((o, j) => octets[i + j] === o))

    // GS V — coupe du papier.
    if (contient([0x1d, 0x56])) console.log('✂  coupe du papier')
    // ESC p — impulsion vers le tiroir-caisse.
    if (contient([0x1b, 0x70])) console.log('💰 ouverture du tiroir-caisse')
    // ESC t — sélection du jeu de caractères.
    const jeu = octets.findIndex((_, i) => octets[i] === 0x1b && octets[i + 1] === 0x74)
    if (jeu >= 0) {
      const page = octets[jeu + 2]
      // 19 = CP858, celle que kaissi utilise pour les accents et l'euro.
      console.log(`🔤 jeu de caractères : page ${page}${page === 19 ? ' (CP858)' : ''}`)
    }

    if (brut) {
      console.log('\noctets bruts :')
      console.log(charge.toString('hex').replace(/(.{64})/g, '$1\n'))
    }
    console.log('')
  })

  // Une imprimante réelle ne dit rien : elle avale les octets et imprime.
  socket.on('error', (erreur) => console.log(`⚠ socket : ${erreur.message}`))
})

serveur.on('error', (erreur) => {
  if (erreur.code === 'EADDRINUSE') {
    console.error(`\n✗ Le port ${port} est déjà pris.`)
    console.error('  Une autre imprimante virtuelle tourne peut-être déjà.')
    console.error(`  Sinon : node apps/pos/scripts/imprimante-virtuelle.mjs --port ${port + 1}\n`)
    process.exit(1)
  }
  throw erreur
})

// 0.0.0.0 et non 127.0.0.1 : l'émulateur Android et une vraie tablette du
// réseau doivent pouvoir l'atteindre. Sur 127.0.0.1, seul ce PC le pourrait.
serveur.listen(port, '0.0.0.0', () => {
  console.log(`\n🖨  Imprimante virtuelle Kaissi — port ${port}`)
  console.log('   En attente de tickets. Ctrl+C pour arrêter.\n')
  console.log('   À renseigner dans le POS (écran Diagnostic → Imprimante) :')
  console.log(`     • émulateur Android  →  10.0.2.2:${port}`)
  for (const adresse of adressesLocales()) {
    console.log(`     • tablette du réseau →  ${adresse}:${port}`)
  }
  console.log('')
})
