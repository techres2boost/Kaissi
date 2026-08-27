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
let serveur: ChildProcess | undefined

afterAll(() => {
  serveur?.kill('SIGTERM')
})

it('démarre avec la commande de production et répond à /sante', async () => {
  // EXACTEMENT le script « start » de package.json : même binaire, mêmes
  // drapeaux, même hook de résolution. Si ce test passe, le conteneur
  // Railway démarre.
  serveur = spawn(
    'node',
    [
      '--experimental-strip-types',
      '--import',
      './scripts/charger-ts.mjs',
      'src/index.ts',
    ],
    {
      cwd: racineSync,
      env: {
        ...process.env,
        DATABASE_URL: URL_TEST,
        DATABASE_SSL: 'false',
        SYNC_PORT: String(PORT),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )

  let journal = ''
  serveur.stdout?.on('data', (d) => (journal += d))
  serveur.stderr?.on('data', (d) => (journal += d))

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
        `Le serveur s'est arrêté avant de répondre. Sortie :\n${journal}`,
      )
    }
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/sante`)
      if (r.ok) {
        const corps = (await r.json()) as { etat: string; protocole: number }
        expect(corps.etat).toBe('ok')
        expect(corps.protocole).toBe(1)
        repond = true
        break
      }
    } catch {
      // Pas encore prêt : on réessaie.
    }
    await new Promise((r) => setTimeout(r, 250))
  }

  expect(repond, `Le serveur n'a pas répondu en 20 s. Sortie :\n${journal}`).toBe(true)
}, 30_000)
