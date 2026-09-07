/**
 * L'import de clients, côté ANALYSE : lire un CSV, reconnaître un numéro.
 *
 * Ces deux fonctions sont pures et vivent hors des actions serveur — non par
 * goût du rangement, mais parce qu'un fichier « use server » ne peut exporter
 * que des fonctions asynchrones : chacun de ses exports devient une route
 * appelable depuis le navigateur. Ici, elles se testent sans rien monter.
 */

/**
 * Normalise un numéro de téléphone tunisien pour la COMPARAISON.
 *
 * On garde les chiffres, et on retire l'indicatif +216 quand il est là : le
 * même client saisi « 20 123 456 », « +216 20 123 456 » et « 0021620123456 »
 * ne doit pas produire trois fiches. C'est le seul champ sur lequel on
 * dédoublonne — deux « Salem » ne se distinguent que par leur numéro.
 *
 * Ce qui est STOCKÉ reste ce que le gérant a tapé : réécrire sa saisie lui
 * ferait perdre ses repères, et un numéro étranger n'a pas la même forme.
 */
export function comparerTelephone(brut: string): string {
  const chiffres = brut.replace(/\D+/g, '')
  if (chiffres.startsWith('00216')) return chiffres.slice(5)
  if (chiffres.startsWith('216') && chiffres.length > 8) return chiffres.slice(3)
  return chiffres
}

/**
 * Un analyseur CSV minimal, mais qui tient les guillemets.
 *
 * Se contenter d'un `split(',')` casse sur « Ben Salah, Ahmed » — et c'est
 * exactement la forme qu'un export de logiciel de caisse produit. Le
 * séparateur est deviné sur l'en-tête : les tableurs francophones exportent
 * en points-virgules, et l'utilisateur ne sait pas lequel il a.
 */
export function analyserCsv(texte: string): Record<string, string>[] {
  const sansBom = texte.replace(/^﻿/, '')
  const premiereLigne = sansBom.split(/\r?\n/, 1)[0] ?? ''
  const separateur =
    (premiereLigne.match(/;/g)?.length ?? 0) > (premiereLigne.match(/,/g)?.length ?? 0) ? ';' : ','

  const rangees: string[][] = []
  let champ = ''
  let rangee: string[] = []
  let entreGuillemets = false

  for (let i = 0; i < sansBom.length; i += 1) {
    const c = sansBom[i]!
    if (entreGuillemets) {
      if (c === '"') {
        // Deux guillemets d'affilée : un guillemet littéral.
        if (sansBom[i + 1] === '"') {
          champ += '"'
          i += 1
        } else entreGuillemets = false
      } else champ += c
      continue
    }
    if (c === '"') entreGuillemets = true
    else if (c === separateur) {
      rangee.push(champ)
      champ = ''
    } else if (c === '\n') {
      rangee.push(champ.replace(/\r$/, ''))
      rangees.push(rangee)
      rangee = []
      champ = ''
    } else champ += c
  }
  if (champ !== '' || rangee.length > 0) {
    rangee.push(champ.replace(/\r$/, ''))
    rangees.push(rangee)
  }

  const pleines = rangees.filter((r) => r.some((v) => v.trim() !== ''))
  const entetes = (pleines.shift() ?? []).map((e) =>
    e
      .trim()
      .toLowerCase()
      // « Téléphone » et « telephone » doivent tomber sur la même clé : les
      // accents d'un export ne doivent pas décider si la colonne est lue.
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, ''),
  )

  return pleines.map((r) =>
    Object.fromEntries(entetes.map((entete, i) => [entete, (r[i] ?? '').trim()])),
  )
}
