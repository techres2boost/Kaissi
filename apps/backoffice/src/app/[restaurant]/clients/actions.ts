'use server'

/**
 * Le carnet d'adresses des clients (migration 0031).
 *
 * ── Ce qu'on écrit, et ce qu'on n'écrit PAS ───────────────────────────────
 *
 * Un nom, un téléphone, un e-mail, une note de service. Ni le nombre de
 * visites ni le total dépensé : ils se calculent sur `orders`, et une colonne
 * qui les stockerait dériverait à la première commande annulée.
 *
 * ── Archiver plutôt que supprimer ─────────────────────────────────────────
 *
 * Les ventes portent `customer_id`. Supprimer une fiche ferait perdre au
 * rapport le lien entre une commande et son client — pour gagner une ligne
 * dans une liste. La fiche archivée disparaît de l'écran et des propositions
 * de la caisse ; l'historique, lui, reste entier.
 */

import { revalidatePath } from 'next/cache'
import { uuidV7 } from '@kaissi/domain'
import { etablissementObligatoire, exigerGestionnaire } from '../../../serveur/session.js'
import { supabaseServeur } from '../../../serveur/supabase.js'
import { ErreurSaisie, texteFacultatif, texteObligatoire } from '../../../serveur/formulaire.js'
/*
 * Les deux fonctions PURES vivent ailleurs, et ce n'est pas un rangement.
 *
 * Un fichier « use server » ne peut exporter que des fonctions asynchrones :
 * tout ce qu'il exporte devient une route appelable depuis le navigateur.
 * L'analyseur CSV et la normalisation de téléphone n'ont rien à y faire — et
 * chez elles, elles sont testables sans monter de serveur.
 */
import { analyserCsv, comparerTelephone } from '../../../serveur/clients-csv.js'

export interface Resultat {
  erreur?: string
  succes?: string
}

async function agir(
  restaurantId: string,
  travail: (contexte: {
    supabase: Awaited<ReturnType<typeof supabaseServeur>>
    organizationId: string
  }) => Promise<string>,
): Promise<Resultat> {
  try {
    const { etablissement } = await etablissementObligatoire(restaurantId)
    exigerGestionnaire(etablissement)
    const succes = await travail({
      supabase: await supabaseServeur(),
      organizationId: etablissement.organizationId,
    })
    revalidatePath(`/${restaurantId}/clients`)
    return { succes }
  } catch (erreur) {
    if (erreur instanceof ErreurSaisie) return { erreur: erreur.message }
    if (erreur && typeof erreur === 'object' && 'digest' in erreur) throw erreur
    return { erreur: erreur instanceof Error ? erreur.message : 'Échec inattendu.' }
  }
}

/** Les champs communs à la création et à la modification. */
function champs(donnees: FormData) {
  const nom = texteObligatoire(donnees, 'nom', 'Le nom du client', 120)
  const telephone = texteFacultatif(donnees, 'telephone', 30)
  const email = texteFacultatif(donnees, 'email', 160)
  const note = texteFacultatif(donnees, 'note', 500)

  if (telephone && comparerTelephone(telephone).length < 6) {
    throw new ErreurSaisie('telephone', 'Ce numéro de téléphone semble trop court.')
  }
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new ErreurSaisie('email', 'Cette adresse e-mail n’est pas valide.')
  }
  return { name: nom, phone: telephone, email, note }
}

/**
 * Traduit l'erreur de l'index unique en une phrase utile.
 *
 * « duplicate key value violates unique constraint
 * "customers_telephone_idx" » est exact et illisible. Ce qu'il faut dire,
 * c'est qu'une fiche existe déjà avec ce numéro — et que la bonne action est
 * de la modifier.
 */
function traduire(message: string): string {
  if (message.includes('customers_telephone_idx')) {
    return (
      'Un client porte déjà ce numéro de téléphone dans cet établissement. ' +
      'Ouvrez sa fiche plutôt que d’en créer une seconde : deux fiches pour la ' +
      'même personne partageraient ses visites en deux.'
    )
  }
  return message
}

export async function creerClient(
  restaurantId: string,
  _precedent: Resultat | null,
  donnees: FormData,
): Promise<Resultat> {
  return agir(restaurantId, async ({ supabase, organizationId }) => {
    const fiche = champs(donnees)
    const { error } = await supabase.from('customers').insert({
      // RÈGLE 2 : l'identifiant vient du client, jamais d'un « serial ». Une
      // fiche se crée aussi bien ici que sur une tablette hors ligne.
      id: uuidV7(),
      organization_id: organizationId,
      restaurant_id: restaurantId,
      ...fiche,
    })
    if (error) throw new Error(traduire(error.message))
    return `Client « ${fiche.name} » ajouté.`
  })
}

export async function modifierClient(
  restaurantId: string,
  clientId: string,
  _precedent: Resultat | null,
  donnees: FormData,
): Promise<Resultat> {
  return agir(restaurantId, async ({ supabase }) => {
    const fiche = champs(donnees)
    const { error } = await supabase
      .from('customers')
      .update(fiche)
      .eq('id', clientId)
      .eq('restaurant_id', restaurantId)
    if (error) throw new Error(traduire(error.message))
    return (
      `Fiche de « ${fiche.name} » enregistrée. Les reçus déjà émis gardent le ` +
      'nom qu’ils portaient : un reçu qui change après coup n’est plus un reçu.'
    )
  })
}

export async function archiverClient(
  restaurantId: string,
  clientId: string,
  archiver: boolean,
): Promise<Resultat> {
  return agir(restaurantId, async ({ supabase }) => {
    const { error } = await supabase
      .from('customers')
      .update({ archived_at: archiver ? new Date().toISOString() : null })
      .eq('id', clientId)
      .eq('restaurant_id', restaurantId)
    if (error) throw new Error(traduire(error.message))
    return archiver
      ? 'Client archivé. Ses commandes passées restent rattachées à lui.'
      : 'Client réactivé.'
  })
}

/** Le compte rendu d'un import : ce qui est entré, ce qui ne l'est pas. */
export interface BilanImport extends Resultat {
  ajoutes?: number
  doublons?: number
  refuses?: string[]
}

/**
 * Importe un CSV de clients.
 *
 * ── Ce que cet import NE fait PAS ─────────────────────────────────────────
 *
 * Il n'écrase JAMAIS une fiche existante. Un fichier exporté de Loyverse, ré
 * -importé après quelques corrections locales, effacerait sinon en silence
 * tout ce qu'on vient de saisir. Les lignes dont le téléphone est déjà connu
 * sont comptées comme doublons et laissées telles quelles — le gérant décide
 * ensuite, fiche par fiche.
 *
 * ── Et pourquoi il ne s'arrête pas à la première erreur ───────────────────
 *
 * Un fichier de trois cents clients contient toujours une ligne bancale. Tout
 * refuser pour elle obligerait à la trouver à l'œil dans un tableur. On entre
 * donc ce qui est valide, et on RAPPORTE le reste, ligne par ligne.
 */
export async function importerClients(
  restaurantId: string,
  _precedent: BilanImport | null,
  donnees: FormData,
): Promise<BilanImport> {
  try {
    const { etablissement } = await etablissementObligatoire(restaurantId)
    exigerGestionnaire(etablissement)
    const supabase = await supabaseServeur()

    const fichier = donnees.get('fichier')
    const texte =
      fichier instanceof File && fichier.size > 0
        ? await fichier.text()
        : String(donnees.get('colle') ?? '')
    if (texte.trim() === '') {
      return { erreur: 'Choisissez un fichier CSV, ou collez son contenu.' }
    }
    if (texte.length > 1_000_000) {
      return { erreur: 'Fichier trop volumineux : importez-le par tranches de quelques milliers de lignes.' }
    }

    const lignes = analyserCsv(texte)
    if (lignes.length === 0) {
      return { erreur: 'Aucune ligne exploitable. La première ligne doit porter les en-têtes.' }
    }

    // Les numéros DÉJÀ connus, comparés sous leur forme normalisée.
    const { data: existants } = await supabase
      .from('customers')
      .select('phone')
      .eq('restaurant_id', restaurantId)
      .not('phone', 'is', null)
    const connus = new Set(
      (existants ?? []).map((c) => comparerTelephone(String(c.phone ?? ''))).filter(Boolean),
    )

    /*
     * Le type vient du schéma écrit à la main (`serveur/schema.ts`).
     *
     * Un `Record<string, unknown>` compilerait et laisserait passer une
     * colonne mal orthographiée jusqu'à l'exécution — sur un import de trois
     * cents lignes, l'erreur n'apparaîtrait qu'au premier envoi.
     */
    const aInserer: {
      id: string
      organization_id: string
      restaurant_id: string
      name: string
      phone: string | null
      email: string | null
      note: string | null
    }[] = []
    const refuses: string[] = []
    let doublons = 0

    lignes.forEach((ligne, index) => {
      const numeroLigne = index + 2 // +1 pour l'en-tête, +1 pour partir de 1
      const nom = (ligne['nom'] ?? ligne['client'] ?? ligne['name'] ?? '').trim()
      const telephone = (ligne['telephone'] ?? ligne['téléphone'] ?? ligne['phone'] ?? '').trim()
      const email = (ligne['email'] ?? ligne['e-mail'] ?? '').trim()
      const note = (ligne['note'] ?? ligne['notes'] ?? '').trim()

      if (nom === '') {
        refuses.push(`Ligne ${numeroLigne} : nom vide.`)
        return
      }
      const cle = comparerTelephone(telephone)
      if (cle && connus.has(cle)) {
        doublons += 1
        return
      }
      // Le doublon peut aussi être DANS le fichier : deux lignes, un numéro.
      if (cle) connus.add(cle)

      aInserer.push({
        id: uuidV7(),
        organization_id: etablissement.organizationId,
        restaurant_id: restaurantId,
        name: nom.slice(0, 120),
        phone: telephone === '' ? null : telephone.slice(0, 30),
        email: email === '' || !email.includes('@') ? null : email.slice(0, 160),
        note: note === '' ? null : note.slice(0, 500),
      })
    })

    // Par paquets : une insertion de trois mille lignes d'un coup expire.
    for (let i = 0; i < aInserer.length; i += 200) {
      const { error } = await supabase.from('customers').insert(aInserer.slice(i, i + 200))
      if (error) throw new Error(traduire(error.message))
    }

    revalidatePath(`/${restaurantId}/clients`)
    return {
      ajoutes: aInserer.length,
      doublons,
      refuses: refuses.slice(0, 20),
      succes:
        `${aInserer.length} client(s) ajouté(s)` +
        (doublons > 0 ? `, ${doublons} déjà connu(s) et laissé(s) intact(s)` : '') +
        (refuses.length > 0 ? `, ${refuses.length} ligne(s) refusée(s)` : '') +
        '.',
    }
  } catch (erreur) {
    if (erreur && typeof erreur === 'object' && 'digest' in erreur) throw erreur
    return { erreur: erreur instanceof Error ? erreur.message : 'Import impossible.' }
  }
}
