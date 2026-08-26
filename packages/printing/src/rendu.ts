/**
 * Rendu ESC/POS des tickets.
 *
 * Prend un modèle PUR venu de `@kaissi/domain` et produit les octets à
 * envoyer à l'imprimante. Aucun calcul monétaire ici : si ce fichier avait
 * besoin d'additionner quoi que ce soit, ce serait le signe qu'une règle
 * métier s'est échappée du domaine.
 */

import {
  formaterTND,
  type TicketClient,
  type TicketCuisine,
  type TicketShift,
  type Millimes,
} from '@kaissi/domain'
import { assembler, COMMANDES, ligneAlignee, normaliserTexte, separateur } from './index.js'

/** Largeur du papier, en colonnes. 42 pour du 80 mm, 32 pour du 58 mm. */
export type Largeur = 32 | 42

export interface OptionsRendu {
  readonly largeur?: Largeur
  /** Nombre de lignes vierges avant la coupe, pour dégager le ticket. */
  readonly lignesAvantCoupe?: number
  /** Ouvre le tiroir-caisse en fin d'impression (ticket payé en espèces). */
  readonly ouvrirTiroir?: boolean
}

const LF = '\n'

/**
 * Coupe un texte long sur plusieurs lignes, en préservant les mots.
 * Une désignation tronquée au milieu d'un mot rend un ticket cuisine
 * illisible — « Escalope panée fri » ne dit pas ce qu'il faut préparer.
 */
function replier(texte: string, colonnes: number, retrait = 0): string[] {
  const mots = normaliserTexte(texte).split(/\s+/).filter(Boolean)
  const largeurUtile = colonnes - retrait
  const lignes: string[] = []
  let courante = ''
  for (const mot of mots) {
    if (courante === '') {
      courante = mot.length > largeurUtile ? mot.slice(0, largeurUtile) : mot
    } else if (courante.length + 1 + mot.length <= largeurUtile) {
      courante += ` ${mot}`
    } else {
      lignes.push(' '.repeat(retrait) + courante)
      courante = mot.length > largeurUtile ? mot.slice(0, largeurUtile) : mot
    }
  }
  if (courante !== '') lignes.push(' '.repeat(retrait) + courante)
  return lignes.length > 0 ? lignes : ['']
}

const mnt = (m: Millimes) => formaterTND(m, { symbole: false })

// ─── Ticket client ──────────────────────────────────────────────────────────

export function rendreTicketClient(
  ticket: TicketClient,
  options: OptionsRendu = {},
): Uint8Array {
  const c = options.largeur ?? 42
  const fragments: (Uint8Array | string)[] = [COMMANDES.initialiser]

  fragments.push(COMMANDES.aligner('centre'), COMMANDES.doubleHauteur(true), COMMANDES.gras(true))
  fragments.push(normaliserTexte(ticket.etablissement.nom) + LF)
  fragments.push(COMMANDES.doubleHauteur(false), COMMANDES.gras(false))

  // Pas de centrage manuel : ESC a 1 est déjà actif. Rembourrer d'espaces
  // en plus décalerait la ligne vers la droite sur le papier.
  for (const champ of [ticket.etablissement.adresse, ticket.etablissement.telephone]) {
    if (champ) for (const l of replier(champ, c)) fragments.push(l + LF)
  }
  if (ticket.etablissement.identifiantFiscal) {
    fragments.push(`MF : ${ticket.etablissement.identifiantFiscal}` + LF)
  }

  fragments.push(COMMANDES.aligner('gauche'), separateur(c) + LF)
  fragments.push(ligneAlignee(`Ticket ${ticket.numeroTicket}`, ticket.dateHeure, c) + LF)
  if (ticket.numeroFiscal) {
    fragments.push(`Facture n° ${ticket.numeroFiscal}` + LF)
  }
  const gauche = ticket.table ? `Table ${ticket.table}` : ticket.typeCommande
  fragments.push(ligneAlignee(gauche, ticket.employe ?? '', c) + LF)
  if (ticket.couverts) fragments.push(`${ticket.couverts} couvert(s)` + LF)
  fragments.push(separateur(c) + LF)

  for (const ligne of ticket.lignes) {
    const prefixe = `${ligne.quantite} x `
    const replie = replier(ligne.designation, c - prefixe.length - 9)
    fragments.push(
      ligneAlignee(prefixe + replie[0]!, mnt(ligne.totalMillimes), c) + LF,
    )
    for (const suite of replie.slice(1)) {
      fragments.push(' '.repeat(prefixe.length) + suite + LF)
    }
    for (const detail of ligne.details) {
      for (const l of replier(`+ ${detail}`, c, prefixe.length)) fragments.push(l + LF)
    }
    if (ligne.note) {
      for (const l of replier(`> ${ligne.note}`, c, prefixe.length)) fragments.push(l + LF)
    }
    if (ligne.remiseMillimes > 0) {
      fragments.push(
        ligneAlignee('  Remise', `-${mnt(ligne.remiseMillimes)}`, c) + LF,
      )
    }
  }

  fragments.push(separateur(c) + LF)
  fragments.push(ligneAlignee('Sous-total', mnt(ticket.sousTotalMillimes), c) + LF)
  if (ticket.remisesMillimes > 0) {
    fragments.push(ligneAlignee('Remises', `-${mnt(ticket.remisesMillimes)}`, c) + LF)
  }
  if (ticket.serviceMillimes > 0) {
    fragments.push(ligneAlignee('Service', mnt(ticket.serviceMillimes), c) + LF)
  }
  if (ticket.timbreMillimes > 0) {
    fragments.push(ligneAlignee('Timbre fiscal', mnt(ticket.timbreMillimes), c) + LF)
  }

  // Ventilation de TVA : obligatoire sur une facture, et de toute façon
  // c'est ce que le comptable du restaurant regarde en premier.
  // Le nom du taux porte déjà son pourcentage : le répéter mangerait des
  // colonnes précieuses sur un papier de 32.
  for (const v of ticket.ventilation) {
    fragments.push(
      ligneAlignee(`${v.nom} sur ${mnt(v.baseMillimes)}`, mnt(v.taxeMillimes), c) + LF,
    )
  }

  fragments.push(separateur(c, '=') + LF)
  fragments.push(COMMANDES.gras(true), COMMANDES.doubleHauteur(true))
  fragments.push(ligneAlignee('TOTAL', mnt(ticket.totalMillimes), Math.floor(c / 2)) + LF)
  fragments.push(COMMANDES.doubleHauteur(false), COMMANDES.gras(false))
  fragments.push(separateur(c, '=') + LF)

  for (const p of ticket.paiements) {
    fragments.push(ligneAlignee(p.libelle, mnt(p.montantMillimes), c) + LF)
  }
  if (ticket.renduMillimes > 0) {
    fragments.push(COMMANDES.gras(true))
    fragments.push(ligneAlignee('Rendu', mnt(ticket.renduMillimes), c) + LF)
    fragments.push(COMMANDES.gras(false))
  }

  fragments.push(LF, COMMANDES.aligner('centre'))
  for (const l of ticket.piedDePage) {
    for (const morceau of replier(l, c)) fragments.push(morceau + LF)
  }
  fragments.push(COMMANDES.aligner('gauche'))
  fragments.push(COMMANDES.sauterLignes(options.lignesAvantCoupe ?? 4))
  if (options.ouvrirTiroir) fragments.push(COMMANDES.ouvrirTiroir)
  fragments.push(COMMANDES.couper)

  return assembler(...fragments)
}

// ─── Bon de cuisine ─────────────────────────────────────────────────────────

/**
 * Le KOT est lu en trois secondes, de loin, par quelqu'un qui a les mains
 * occupées. D'où le gros caractère, l'absence totale de prix, et la mention
 * « RAPPEL » très visible quand il s'agit d'une tournée supplémentaire.
 */
export function rendreTicketCuisine(
  ticket: TicketCuisine,
  options: OptionsRendu = {},
): Uint8Array {
  const c = options.largeur ?? 42
  const fragments: (Uint8Array | string)[] = [COMMANDES.initialiser]

  fragments.push(COMMANDES.aligner('centre'), COMMANDES.gras(true), COMMANDES.doubleHauteur(true))
  fragments.push(normaliserTexte(ticket.station.toUpperCase()) + LF)
  if (ticket.rappel) fragments.push('*** RAPPEL ***' + LF)
  fragments.push(COMMANDES.doubleHauteur(false))

  const entete = ticket.table ? `TABLE ${ticket.table}` : ticket.typeCommande.toUpperCase()
  fragments.push(normaliserTexte(entete) + LF)
  fragments.push(COMMANDES.gras(false), COMMANDES.aligner('gauche'))

  fragments.push(separateur(c) + LF)
  fragments.push(ligneAlignee(ticket.numeroTicket, ticket.dateHeure, c) + LF)
  if (ticket.employe) fragments.push(`Par : ${normaliserTexte(ticket.employe)}` + LF)
  if (ticket.couverts) fragments.push(`${ticket.couverts} couvert(s)` + LF)
  fragments.push(separateur(c) + LF)

  fragments.push(COMMANDES.doubleHauteur(true))
  for (const ligne of ticket.lignes) {
    const prefixe = `${ligne.quantite} x `
    // En double hauteur, la largeur utile est divisée par deux.
    const replie = replier(ligne.designation, Math.floor(c / 2) - prefixe.length)
    fragments.push(prefixe + replie[0]! + LF)
    for (const suite of replie.slice(1)) {
      fragments.push(' '.repeat(prefixe.length) + suite + LF)
    }
    fragments.push(COMMANDES.doubleHauteur(false))
    for (const detail of ligne.details) {
      for (const l of replier(`+ ${detail}`, c, 2)) fragments.push(l + LF)
    }
    if (ligne.note) {
      fragments.push(COMMANDES.gras(true))
      for (const l of replier(`>> ${ligne.note}`, c, 2)) fragments.push(l + LF)
      fragments.push(COMMANDES.gras(false))
    }
    fragments.push(COMMANDES.doubleHauteur(true))
  }
  fragments.push(COMMANDES.doubleHauteur(false))

  fragments.push(COMMANDES.sauterLignes(options.lignesAvantCoupe ?? 4))
  fragments.push(COMMANDES.couper)
  return assembler(...fragments)
}

// ─── Rapport de shift ───────────────────────────────────────────────────────

export function rendreTicketShift(
  ticket: TicketShift,
  options: OptionsRendu = {},
): Uint8Array {
  const c = options.largeur ?? 42
  const r = ticket.resume
  const fragments: (Uint8Array | string)[] = [COMMANDES.initialiser]

  fragments.push(COMMANDES.aligner('centre'), COMMANDES.gras(true))
  fragments.push(normaliserTexte(ticket.etablissement.nom) + LF)
  fragments.push('RAPPORT DE CAISSE' + LF)
  fragments.push(COMMANDES.gras(false), COMMANDES.aligner('gauche'), separateur(c) + LF)

  if (ticket.employe) fragments.push(ligneAlignee('Employé', ticket.employe, c) + LF)
  fragments.push(ligneAlignee('Ouvert', ticket.ouvertA, c) + LF)
  fragments.push(ligneAlignee('Clôturé', ticket.closA ?? 'en cours', c) + LF)
  fragments.push(separateur(c) + LF)

  fragments.push(ligneAlignee('Commandes', String(r.nombreCommandes), c) + LF)
  fragments.push(
    ligneAlignee("Chiffre d'affaires", mnt(r.chiffreAffairesMillimes), c) + LF,
  )
  fragments.push(separateur(c) + LF)

  fragments.push(ligneAlignee('Fond de caisse', mnt(r.fondDeCaisseMillimes), c) + LF)
  fragments.push(ligneAlignee('Espèces encaissées', mnt(r.especesMillimes), c) + LF)
  if (r.entreesMillimes > 0) {
    fragments.push(ligneAlignee("Entrées d'espèces", mnt(r.entreesMillimes), c) + LF)
  }
  if (r.sortiesMillimes > 0) {
    fragments.push(ligneAlignee('Sorties', `-${mnt(r.sortiesMillimes)}`, c) + LF)
  }
  fragments.push(COMMANDES.gras(true))
  fragments.push(ligneAlignee('ATTENDU EN CAISSE', mnt(r.attenduMillimes), c) + LF)
  fragments.push(COMMANDES.gras(false))

  if (r.compteMillimes !== null) {
    fragments.push(ligneAlignee('Compté', mnt(r.compteMillimes), c) + LF)
    fragments.push(separateur(c, '=') + LF)
    fragments.push(COMMANDES.gras(true))
    const ecart = r.ecartMillimes ?? (0 as Millimes)
    // Le signe est explicite : « -4,500 » ne se confond pas avec « 4,500 ».
    fragments.push(
      ligneAlignee('ÉCART', `${ecart > 0 ? '+' : ''}${mnt(ecart)}`, c) + LF,
    )
    fragments.push(COMMANDES.gras(false))
  }

  fragments.push(separateur(c) + LF)
  if (r.carteMillimes > 0) fragments.push(ligneAlignee('Carte', mnt(r.carteMillimes), c) + LF)
  if (r.autresMillimes > 0) fragments.push(ligneAlignee('Autres', mnt(r.autresMillimes), c) + LF)

  fragments.push(COMMANDES.sauterLignes(options.lignesAvantCoupe ?? 4))
  fragments.push(COMMANDES.couper)
  return assembler(...fragments)
}

/** Impulsion seule, pour l'ouverture du tiroir hors vente (opération tracée). */
export function rendreOuvertureTiroir(): Uint8Array {
  return assembler(COMMANDES.initialiser, COMMANDES.ouvrirTiroir)
}

/** Encode une charge en base64 pour la mettre en file d'impression. */
export function versBase64(octets: Uint8Array): string {
  let binaire = ''
  for (const o of octets) binaire += String.fromCharCode(o)
  return btoa(binaire)
}

export function depuisBase64(texte: string): Uint8Array {
  const binaire = atob(texte)
  const octets = new Uint8Array(binaire.length)
  for (let i = 0; i < binaire.length; i += 1) octets[i] = binaire.charCodeAt(i)
  return octets
}

/**
 * Longueur totale, en octets, d'une séquence ESC/POS — préfixe compris.
 * Rendu nécessaire par le fait que ces séquences ont des tailles
 * DIFFÉRENTES : ESC @ fait deux octets, ESC p en fait cinq. Sauter un
 * nombre fixe laisse passer des octets de commande dans le texte.
 */
function longueurCommande(charge: Uint8Array, i: number): number {
  const introducteur = charge[i]
  const code = charge[i + 1]
  if (introducteur === 0x1b) {
    if (code === 0x40) return 2 // ESC @  — initialisation
    if (code === 0x70) return 5 // ESC p  — impulsion tiroir
    return 3 // ESC E / ESC a / ESC d — un octet de paramètre
  }
  if (introducteur === 0x1d) {
    if (code === 0x56) return 4 // GS V  — coupe
    return 3 // GS !  — taille de caractère
  }
  return 1
}

/**
 * Rend la charge lisible en texte, pour l'aperçu à l'écran et les tests.
 *
 * L'aperçu SUIT l'alignement demandé à l'imprimante (ESC a n) : sans cela,
 * il montrerait à plat un en-tête qui sortira centré du papier, et on
 * corrigerait un défaut de mise en page qui n'existe pas.
 */
export function apercuTexte(charge: Uint8Array, largeur: Largeur = 42): string {
  const lignes: string[] = []
  let courante = ''
  let alignement: 'gauche' | 'centre' | 'droite' = 'gauche'

  const poser = () => {
    const t = courante
    if (t.trim() === '' || alignement === 'gauche') {
      lignes.push(t)
    } else if (alignement === 'centre') {
      lignes.push(' '.repeat(Math.max(0, Math.floor((largeur - t.length) / 2))) + t)
    } else {
      lignes.push(' '.repeat(Math.max(0, largeur - t.length)) + t)
    }
    courante = ''
  }

  let i = 0
  while (i < charge.length) {
    const octet = charge[i]!
    if (octet === 0x1b || octet === 0x1d) {
      if (octet === 0x1b && charge[i + 1] === 0x61) {
        const mode = charge[i + 2]
        alignement = mode === 1 ? 'centre' : mode === 2 ? 'droite' : 'gauche'
      }
      i += longueurCommande(charge, i)
      continue
    }
    if (octet === 0x0a) {
      poser()
    } else if (octet >= 0x20) {
      courante += String.fromCharCode(octet)
    }
    i += 1
  }
  if (courante !== '') poser()
  return lignes.join('\n')
}
