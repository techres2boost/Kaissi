/**
 * Les erreurs de la caisse — notées ici, remontées par le cycle de sync.
 *
 * ── Pourquoi `localStorage` et pas la base SQLite ─────────────────────────
 *
 * L'erreur qu'on veut voir est souvent celle qui empêche la caisse de
 * démarrer — y compris quand c'est la base locale qui casse. Un collecteur
 * qui écrirait dans SQLite perdrait exactement ces erreurs-là. `localStorage`
 * est synchrone, survit au rechargement qui suit un plantage, et une erreur
 * n'est pas une donnée métier : si le navigateur l'évince, on perd un
 * diagnostic, jamais une vente.
 *
 * ── Ce qui reste petit ────────────────────────────────────────────────────
 *
 * Une SIGNATURE par erreur (type, message aux nombres effacés, première
 * ligne de pile) : la même erreur mille fois est UNE entrée avec un compte.
 * Au plus vingt entrées ; au-delà, les plus anciennes cèdent la place. Rien
 * ne part tant qu'il n'y a rien, et quand il y a quelque chose, c'est le
 * cycle de synchronisation qui l'emporte — APRÈS les ventes.
 *
 * ── Ce qui n'y entre pas ──────────────────────────────────────────────────
 *
 * Aucune donnée de la commande, aucun nom : un message et une pile d'appel,
 * bornés. Le service nettoie de toute façon ce qu'il reçoit (jetons,
 * adresses e-mail).
 */

import type { CollecteurErreursSync, ErreurClientSynchronisee } from '@kaissi/sync-client'
import { BUILD_COMMIT, BUILD_DATE } from '../config.js'

const CLE = 'kaissi.erreurs.v1'
const ENTREES_MAX = 20

/** Bruit connu des WebView, sans conséquence pour la caisse. */
const IGNOREES = [/ResizeObserver loop/i, /^Script error\.?$/i]

type TypeErreur = ErreurClientSynchronisee['type']

interface Stockage {
  getItem(cle: string): string | null
  setItem(cle: string, valeur: string): void
}

function empreinte(texte: string): string {
  // djb2 — une empreinte de dédoublonnage, pas une fonction de sécurité.
  let h = 5381
  for (let i = 0; i < texte.length; i += 1) h = ((h << 5) + h + texte.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

export class CollecteurErreurs implements CollecteurErreursSync {
  private readonly stockage: Stockage | null
  private readonly version: string
  private readonly maintenant: () => Date
  /** Repli en mémoire quand `localStorage` est indisponible ou plein. */
  private memoire: ErreurClientSynchronisee[] = []

  constructor(stockage: Stockage | null, version: string, maintenant: () => Date = () => new Date()) {
    this.stockage = stockage
    this.version = version
    this.maintenant = maintenant
  }

  noter(erreur: unknown, contexte: { type?: TypeErreur; ecran?: string | null } = {}): void {
    const type = contexte.type ?? 'erreur'
    const message = (
      erreur instanceof Error ? `${erreur.name}: ${erreur.message}` : typeof erreur === 'string' ? erreur : safeJson(erreur)
    ).slice(0, 300)
    if (!message.trim() || IGNOREES.some((r) => r.test(message))) return
    const pile = erreur instanceof Error && erreur.stack ? erreur.stack.slice(0, 1_500) : null
    const premiereLigne = (pile ?? '').split('\n').find((l) => /\bat\b|@/.test(l))?.trim() ?? ''
    const signature = empreinte(`${type}|${message.replace(/\d+/g, '#')}|${premiereLigne}`)
    const instant = this.maintenant().toISOString()

    const liste = this.lire()
    const existante = liste.find((e) => e.signature === signature)
    const suivante: ErreurClientSynchronisee = existante
      ? { ...existante, nombre: existante.nombre + 1, derniere: instant }
      : {
          signature,
          type,
          message,
          pile,
          ecran: contexte.ecran ?? null,
          version: this.version,
          nombre: 1,
          premiere: instant,
          derniere: instant,
        }
    const autres = liste.filter((e) => e.signature !== signature)
    this.ecrire([...autres, suivante].slice(-ENTREES_MAX))
  }

  aEnvoyer(limite: number): readonly ErreurClientSynchronisee[] {
    return this.lire().slice(0, limite)
  }

  /**
   * Retire ce qui est parti. Une erreur revenue PENDANT l'envoi garde la
   * différence : on retranche le compte envoyé, on n'efface pas l'entrée.
   */
  accuser(envoyees: readonly ErreurClientSynchronisee[]): void {
    const parSignature = new Map(envoyees.map((e) => [e.signature, e.nombre]))
    const restantes = this.lire().flatMap((e) => {
      const parti = parSignature.get(e.signature)
      if (parti === undefined) return [e]
      return e.nombre > parti ? [{ ...e, nombre: e.nombre - parti, premiere: e.derniere }] : []
    })
    this.ecrire(restantes)
  }

  private lire(): ErreurClientSynchronisee[] {
    if (!this.stockage) return this.memoire
    try {
      const brut = this.stockage.getItem(CLE)
      const liste = brut ? (JSON.parse(brut) as unknown) : []
      return Array.isArray(liste) ? (liste as ErreurClientSynchronisee[]) : []
    } catch {
      return this.memoire
    }
  }

  private ecrire(liste: ErreurClientSynchronisee[]): void {
    this.memoire = liste
    if (!this.stockage) return
    try {
      this.stockage.setItem(CLE, JSON.stringify(liste))
    } catch {
      // Stockage plein ou interdit : la mémoire suffit jusqu'au prochain envoi.
    }
  }
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v) ?? String(v)
  } catch {
    return String(v)
  }
}

function stockageNavigateur(): Stockage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    return null
  }
}

const VERSION = BUILD_COMMIT.slice(0, 7) || BUILD_DATE.slice(0, 10) || 'dev'

/** Le collecteur de CETTE caisse — un seul, partagé par le moteur de sync. */
export const collecteurErreurs = new CollecteurErreurs(stockageNavigateur(), VERSION)

/**
 * Les erreurs que personne n'a attrapées. Installé une fois, au démarrage,
 * AVANT le premier rendu : une erreur au démarrage est la plus précieuse.
 */
export function installerCollecteurErreurs(cible: Window = window): void {
  cible.addEventListener('error', (e) => collecteurErreurs.noter(e.error ?? e.message))
  cible.addEventListener('unhandledrejection', (e) => collecteurErreurs.noter(e.reason, { type: 'promesse' }))
}
