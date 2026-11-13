/**
 * Construction de la configuration PostgreSQL, à partir de l'environnement.
 *
 * Un seul endroit, partagé par le service et le script d'appairage : deux
 * façons de se connecter, c'est un chemin testé et un chemin qui ne l'est
 * pas.
 *
 * ── Pourquoi DATABASE_PASSWORD existe ──────────────────────────────────
 * Un mot de passe glissé dans une URL doit être percent-encodé, et
 * Supabase EXIGE un caractère spécial. Deux pièges se referment alors, et
 * les deux rendent la MÊME erreur illisible — « password authentication
 * failed » :
 *
 *   • `@ : / ? # %` et l'espace changent le sens de l'URL. Encodés à la
 *     main, une faute est invisible ; `%21` juste ou faux se ressemblent.
 *   • dans un fichier .env non entouré de guillemets, un `#` ouvre un
 *     commentaire : `A=mot#depasse` vaut « mot ». Silencieusement.
 *
 * Renseigner DATABASE_PASSWORD à part supprime les deux d'un coup : la
 * valeur n'est jamais analysée comme une URL, donc jamais à encoder. Elle
 * l'emporte sur celle de DATABASE_URL.
 */

import { sslDepuisEnvironnement, type ReglageSsl } from './ssl.js'

export interface ConfigurationPg {
  readonly connectionString?: string
  readonly host?: string
  readonly port?: number
  readonly database?: string
  readonly user?: string
  readonly password?: string
  readonly ssl: ReglageSsl
}

export class ErreurConfiguration extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ErreurConfiguration'
  }
}

export function configurationPg(env: NodeJS.ProcessEnv = process.env): ConfigurationPg {
  const url = env['DATABASE_URL']
  if (!url) throw new ErreurConfiguration('DATABASE_URL est absente.')

  const ssl = sslDepuisEnvironnement(env)
  const motDePasse = env['DATABASE_PASSWORD']

  // Sans DATABASE_PASSWORD, on laisse `pg` analyser l'URL : c'est le
  // chemin habituel, et il marche tant que le mot de passe est simple.
  if (motDePasse === undefined || motDePasse === '') {
    return { connectionString: url, ssl }
  }

  // Avec, on décompose NOUS-MÊMES l'URL et on passe le mot de passe à part.
  // `pg` ré-analyse toujours `connectionString` et écrase ce qu'on lui
  // donne à côté : il faut donc l'écarter complètement, pas le compléter.
  let analysee: URL
  try {
    analysee = new URL(url)
  } catch {
    throw new ErreurConfiguration(
      `DATABASE_URL n'est pas une URL valide : ${url.slice(0, 40)}…`,
    )
  }

  return {
    host: decodeURIComponent(analysee.hostname),
    port: analysee.port ? Number(analysee.port) : 5432,
    database: decodeURIComponent(analysee.pathname.replace(/^\//, '')) || 'postgres',
    user: decodeURIComponent(analysee.username),
    // BRUT, jamais encodé : c'est tout l'intérêt.
    password: motDePasse,
    ssl,
  }
}

/**
 * La taille du pool de connexions — `SYNC_POOL_MAX`, 10 par défaut.
 *
 * L'AUDIT DE LANCEMENT (11 novembre) l'a montré : sous mille envois
 * simultanés, tout le temps de réponse est de l'ATTENTE d'une connexion —
 * ni le service ni PostgreSQL ne sont à bout, c'est la file devant le pool
 * qui s'allonge. La taille était écrite en dur ; il fallait redéployer du
 * code pour la changer.
 *
 * Le plafond n'est pas libre pour autant : chaque connexion du pool en
 * occupe une chez PostgreSQL, et l'offre Supabase en limite le nombre
 * (pooler de session et connexions directes). Monter ce réglage au-delà de
 * ce que la base accorde transforme une file d'attente en refus de
 * connexion. Borné à 1–100, et une valeur illisible retombe sur 10 :
 * un réglage mal tapé ne doit jamais empêcher le service de démarrer.
 */
export function taillePoolDepuisEnvironnement(env: NodeJS.ProcessEnv = process.env): number {
  const brut = Number(env['SYNC_POOL_MAX'] ?? '')
  if (!Number.isInteger(brut) || brut < 1) return 10
  return Math.min(100, brut)
}

/** L'hôte, pour les messages. Jamais le mot de passe. */
export function hoteDe(config: ConfigurationPg): string {
  if (config.host) return config.host
  try {
    return new URL(config.connectionString ?? '').hostname
  } catch {
    return 'inconnu'
  }
}
