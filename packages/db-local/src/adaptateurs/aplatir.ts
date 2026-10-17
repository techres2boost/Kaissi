/**
 * Met un script SQL dans la seule forme que les DEUX greffons natifs lisent
 * correctement : une instruction par ligne, chacune terminée par « ; ».
 *
 * ── La panne, sur iPhone ──────────────────────────────────────────────────
 *
 * « Échec de la migration locale 14 : near "id": syntax error ». Le SQL
 * était juste ; c'est le greffon iOS de @capacitor-community/sqlite qui le
 * réécrivait avant de l'exécuter, en deux temps (code lu dans le paquet
 * installé, version 7) :
 *
 *   1. `CapacitorSQLite.execute` coupe le script aux sauts de ligne, ÔTE les
 *      espaces de début de chaque ligne, et recolle avec « \n » ;
 *   2. `UtilsSQLCipher.execute`, SI le script contient « DELETE FROM »,
 *      supprime tous les « \n » — sans les remplacer par une espace.
 *
 * `DELETE FROM discounts\n WHERE id IN (…)` devenait donc
 * `DELETE FROM discountsWHERE id IN (…)`. La migration 14 était la première
 * à écrire un DELETE sur plusieurs lignes ; Android, lui, recolle avec une
 * espace et l'exécutait sans broncher. La même migration passait sur la
 * tablette et cassait l'iPhone au démarrage.
 *
 * ── Pourquoi corriger ICI et pas dans la migration ────────────────────────
 *
 * Une migration publiée ne se modifie jamais : elle est déjà appliquée sur
 * les tablettes Android. Et la prochaine migration multi-lignes reproduirait
 * la panne. C'est l'adaptateur qui parle au greffon ; c'est donc lui qui lui
 * présente un SQL que ses deux découpeurs ne savent pas abîmer :
 *
 *   • iOS : plus aucun saut de ligne À L'INTÉRIEUR d'une instruction — ôter
 *     les « \n » ne colle plus deux mots ;
 *   • Android : il coupe sur « ;\n » — chaque instruction est déjà seule sur
 *     sa ligne ;
 *   • les commentaires « -- » sont retirés ici, hors chaînes : Android les
 *     coupait même À L'INTÉRIEUR d'une chaîne, et sur une ligne unique un
 *     commentaire avalerait toute la suite.
 *
 * Le corps d'un déclencheur (`BEGIN … ; … END;`) reste sur UNE ligne : ses
 * « ; » intérieurs ne terminent pas l'instruction.
 */
export function aplatirScript(sql: string): string {
  const instructions: string[] = []
  let courante = ''
  let i = 0
  const n = sql.length

  /** Une espace, une seule, et jamais en tête d'instruction. */
  const espace = () => {
    if (courante.length > 0 && !courante.endsWith(' ')) courante += ' '
  }
  const terminer = () => {
    const nette = courante.trim()
    if (nette.length > 0) instructions.push(`${nette};`)
    courante = ''
  }
  const declencheur = () => /^CREATE\s+(TEMP\s+|TEMPORARY\s+)?TRIGGER\b/i.test(courante.trimStart())
  const corpsOuvert = () => {
    // Dans un déclencheur, l'instruction ne se termine qu'au « END » final.
    const mots = courante.toUpperCase().match(/\b(BEGIN|END)\b/g) ?? []
    let profondeur = 0
    for (const mot of mots) profondeur += mot === 'BEGIN' ? 1 : -1
    return profondeur > 0
  }

  while (i < n) {
    const c = sql[i]!
    const suivant = sql[i + 1]

    // Chaîne '…' ou identifiant "…" : recopiés tels quels, '' compris.
    if (c === "'" || c === '"') {
      let j = i + 1
      while (j < n) {
        if (sql[j] === c) {
          if (sql[j + 1] === c) {
            j += 2
            continue
          }
          break
        }
        j += 1
      }
      courante += sql.slice(i, j + 1)
      i = j + 1
      continue
    }

    // Commentaire de ligne.
    if (c === '-' && suivant === '-') {
      while (i < n && sql[i] !== '\n') i += 1
      espace()
      continue
    }

    // Commentaire de bloc.
    if (c === '/' && suivant === '*') {
      const fin = sql.indexOf('*/', i + 2)
      i = fin === -1 ? n : fin + 2
      espace()
      continue
    }

    if (c === ';') {
      if (declencheur() && corpsOuvert()) {
        courante += '; '
        i += 1
        continue
      }
      terminer()
      i += 1
      continue
    }

    if (/\s/.test(c)) {
      espace()
      i += 1
      continue
    }

    courante += c
    i += 1
  }
  terminer()
  return instructions.length > 0 ? `${instructions.join('\n')}\n` : ''
}
