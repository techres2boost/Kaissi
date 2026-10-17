/**
 * La langue, côté serveur : lue dans le cookie, une fois par requête.
 *
 * `cache()` de React mémorise le résultat le temps d'UNE requête : vingt
 * composants qui demandent la langue ne relisent pas vingt fois le cookie,
 * et deux requêtes ne se la partagent jamais.
 *
 *   • composant `async` : `const t = await traduction()`
 *   • composant synchrone : `const t = use(traduction())`
 */

import { cache } from 'react'
import { cookies } from 'next/headers'
import { COOKIE_LANGUE, creerTraduction, langueDuCookie, type Traduction } from './commun.js'

export const langueCourante = cache(async () => {
  const jar = await cookies()
  return langueDuCookie(jar.get(COOKIE_LANGUE)?.value)
})

export const traduction = cache(async (): Promise<Traduction> => creerTraduction(await langueCourante()))
