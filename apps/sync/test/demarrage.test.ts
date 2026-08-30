/**
 * Le serveur DÉMARRE-T-IL vraiment ?
 *
 * Les autres tests importent les modules via Vitest, qui résout lui-même les
 * imports « .js » → « .ts » et transforme entièrement le TypeScript. Ils ne
 * disent donc RIEN de ce qui se passe quand Node exécute la source telle
 * quelle en production — le mode réel du Dockerfile.
 *
 * Ce trou a laissé passer une régression totale : les 63 tests étaient verts
 * pendant que « node --experimental-strip-types src/index.ts » échouait dès
 * le premier import, et le service n'aurait pas démarré une seconde une fois
 * déployé. Ce test lance la COMMANDE DE PRODUCTION et vérifie /sante.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { afterAll, expect, it } from 'vitest'
import { URL_TEST } from './aide.js'

const racineSync = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = 8799
const processus: ChildProcess[] = []

afterAll(() => {
  for (const p of processus) p.kill('SIGTERM')
})

/** Lance EXACTEMENT le script « start », avec l'environnement donné. */
function lancer(env: Record<string, string>): {
  processus: ChildProcess
  journal: () => string
} {
  const p = spawn(
    'node',
    [
      '--env-file-if-exists=.env',
      '--experimental-strip-types',
      '--import',
      './scripts/charger-ts.mjs',
      'src/index.ts',
    ],
    {
      cwd: racineSync,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  processus.push(p)
  let journal = ''
  p.stdout?.on('data', (d) => (journal += d))
  p.stderr?.on('data', (d) => (journal += d))
  return { processus: p, journal: () => journal }
}

it('démarre avec la commande de production et répond à /sante', async () => {
  // EXACTEMENT le script « start » de package.json : même binaire, mêmes
  // drapeaux, même hook de résolution. Si ce test passe, le conteneur
  // Railway démarre.
  const lance = lancer({
    DATABASE_URL: URL_TEST,
    DATABASE_SSL: 'false',
    SYNC_PORT: String(PORT),
  })
  const serveur = lance.processus

  // Le process ne doit pas mourir au démarrage (résolution de modules,
  // syntaxe non transformable…). On le détecte tôt pour un message utile.
  let mort = false
  serveur.on('exit', (code) => {
    if (code) mort = true
  })

  const debut = Date.now()
  let repond = false
  while (Date.now() - debut < 20_000) {
    if (mort) {
      throw new Error(
        `Le serveur s'est arrêté avant de répondre. Sortie :\n${lance.journal()}`,
      )
    }
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/sante`)
      if (r.ok) {
        const corps = (await r.json()) as {
          etat: string
          protocole: number
          base: string
        }
        expect(corps.etat).toBe('ok')
        expect(corps.protocole).toBe(1)
        // /sante doit avoir JOINT la base, pas seulement constaté que Node
        // tourne : c'est ce contrôle qui décide si une plateforme redémarre
        // le service ou le laisse dans un état inutilisable.
        expect(corps.base).toBe('joignable')
        repond = true
        break
      }
    } catch {
      // Pas encore prêt : on réessaie.
    }
    await new Promise((r) => setTimeout(r, 250))
  }

  expect(repond, `Le serveur n'a pas répondu en 20 s. Sortie :\n${lance.journal()}`).toBe(
    true,
  )
}, 30_000)

it('écoute sur PORT quand la plateforme l’injecte, sans SYNC_PORT', async () => {
  // Railway, Render et Fly posent `PORT` et routent le domaine public
  // dessus. Un service qui n'écoute que `SYNC_PORT` tourne alors très bien
  // derrière un domaine qui répond 404 : les journaux du conteneur sont
  // verts, et rien n'indique où chercher. Ce test fige la convention.
  const port = PORT + 2
  const lance = lancer({
    DATABASE_URL: URL_TEST,
    DATABASE_SSL: 'false',
    PORT: String(port),
    // Explicitement vidée : sans cela, un `.env` local la fournirait et le
    // test passerait sans rien prouver.
    SYNC_PORT: '',
  })

  const debut = Date.now()
  let repond = false
  while (Date.now() - debut < 20_000) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/sante`)
      if (r.ok) {
        repond = true
        break
      }
    } catch {
      // Pas encore prêt.
    }
    await new Promise((r) => setTimeout(r, 250))
  }

  expect(
    repond,
    `Le serveur n'a pas écouté sur PORT=${port}. Sortie :\n${lance.journal()}`,
  ).toBe(true)
}, 30_000)

it('accepte MOT2PASSE dans l’URL quand DATABASE_PASSWORD est renseigné', async () => {
  // Laisser « MOT2PASSE » dans l'URL et mettre le vrai mot de passe dans
  // DATABASE_PASSWORD est la marche à suivre RECOMMANDÉE : c'est elle qui
  // évite d'avoir à encoder quoi que ce soit. Le garde-fou anti-modèle a
  // refusé de démarrer dans ce cas exact — il barrait la seule solution
  // correcte.
  const urlTest = new URL(URL_TEST)
  // Le cluster de test est en authentification « trust » : il ne réclame
  // aucun mot de passe. Ce qu'on vérifie ici n'est pas l'authentification,
  // c'est que le garde-fou LAISSE DÉMARRER.
  const motDePasse = decodeURIComponent(urlTest.password) || 'peu-importe'
  urlTest.password = 'MOT2PASSE'

  const lance = lancer({
    DATABASE_URL: urlTest.toString(),
    DATABASE_PASSWORD: motDePasse,
    DATABASE_SSL: 'false',
    SYNC_PORT: String(PORT + 1),
  })

  const debut = Date.now()
  let repond = false
  while (Date.now() - debut < 20_000) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT + 1}/sante`)
      if (r.ok) {
        repond = true
        break
      }
    } catch {
      // Pas encore prêt.
    }
    await new Promise((r) => setTimeout(r, 250))
  }

  expect(repond, `Le serveur a refusé de démarrer. Sortie :\n${lance.journal()}`).toBe(
    true,
  )
}, 30_000)
