/**
 * La limitation de débit, et surtout ce qu'elle ne limite PAS.
 *
 * ── Pourquoi ces tests existent ───────────────────────────────────────────
 *
 * `POST /appairage` est le seul endroit du produit où l'on peut essayer un
 * mot de passe. Sans limite, deux choses sont ouvertes : le bourrage
 * d'identifiants, et — moins évident, plus grave — l'épuisement du quota
 * GoTrue de Supabase, qui est PAR PROJET. Un attaquant n'a alors pas besoin
 * de trouver un mot de passe : il lui suffit de saturer, et les vrais
 * gérants ne peuvent plus appairer.
 *
 * Le test qui compte le plus est pourtant le dernier : `/sync/*` n'est
 * JAMAIS freiné. Un garde-fou qui retarderait un encaissement serait une
 * régression, pas une protection.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import {
  adresseClient,
  Limiteur,
  QUOTA_APPAIRAGE_PAR_COMPTE,
  type Quota,
} from '../src/limiteur.js'
import { creerServeur } from '../src/serveur.js'
import type { DepotSync } from '../src/depot.js'

describe('le limiteur, en isolation', () => {
  const QUOTA: Quota = { coups: 3, fenetreMs: 1000 }
  let temps = 0
  let limiteur: Limiteur

  beforeEach(() => {
    temps = 1_000_000
    limiteur = new Limiteur(QUOTA, () => temps)
  })

  it('laisse passer le quota, puis refuse', () => {
    expect(limiteur.verifier('a').autorise).toBe(true)
    expect(limiteur.verifier('a').autorise).toBe(true)
    expect(limiteur.verifier('a').autorise).toBe(true)
    const refus = limiteur.verifier('a')
    expect(refus.autorise).toBe(false)
    expect(refus.restants).toBe(0)
  })

  it('annonce un délai d’attente EXPLOITABLE — jamais zéro', () => {
    // Annoncer « réessayez dans 0 seconde » ferait réessayer tout de suite,
    // et le client conclurait que l'en-tête ment.
    for (let i = 0; i < 3; i += 1) limiteur.verifier('a')
    const refus = limiteur.verifier('a')
    expect(refus.attendreSecondes).toBeGreaterThanOrEqual(1)
    expect(refus.attendreSecondes).toBeLessThanOrEqual(1)
  })

  it('rouvre quand la fenêtre est passée', () => {
    for (let i = 0; i < 3; i += 1) limiteur.verifier('a')
    expect(limiteur.verifier('a').autorise).toBe(false)
    temps += 1001
    expect(limiteur.verifier('a').autorise).toBe(true)
  })

  it('compte par CLÉ — bloquer l’un ne bloque pas l’autre', () => {
    for (let i = 0; i < 4; i += 1) limiteur.verifier('a')
    expect(limiteur.verifier('b').autorise).toBe(true)
  })

  it('une réussite rend ses essais au distrait', () => {
    // Un gérant qui se trompe deux fois puis retrouve son mot de passe ne
    // doit pas rester bloqué par ses propres essais : sinon la limite punit
    // surtout ceux qui hésitent.
    limiteur.verifier('a')
    limiteur.verifier('a')
    limiteur.reussite('a')
    expect(limiteur.verifier('a').autorise).toBe(true)
    expect(limiteur.verifier('a').autorise).toBe(true)
    expect(limiteur.verifier('a').autorise).toBe(true)
  })

  it('ne grossit pas indéfiniment — le limiteur n’est pas une faille', () => {
    /*
     * Sans plafond, il suffirait d'envoyer un million d'adresses distinctes
     * pour faire tomber le processus : on protégerait le mot de passe en
     * offrant l'épuisement mémoire.
     */
    const large = new Limiteur({ coups: 1, fenetreMs: 60_000 }, () => temps)
    for (let i = 0; i < 25_000; i += 1) large.verifier(`cle-${i}`)
    expect(large.taille).toBeLessThanOrEqual(20_000)
  })

  it('les quotas de production laissent passer un humain', () => {
    // Cinq essais ratés par quart d'heure : assez pour quiconque connaît son
    // mot de passe, très loin de ce qu'il faut à un script.
    const reel = new Limiteur(QUOTA_APPAIRAGE_PAR_COMPTE, () => temps)
    for (let i = 0; i < 5; i += 1) expect(reel.verifier('gerant').autorise).toBe(true)
    expect(reel.verifier('gerant').autorise).toBe(false)
  })
})

describe('l’adresse du client, derrière un proxy', () => {
  const entetes = (valeurs: Record<string, string>) => new Headers(valeurs)

  it('prend la PREMIÈRE adresse de x-forwarded-for', () => {
    // Railway et Vercel ajoutent leur propre adresse à la suite : garder la
    // dernière reviendrait à compter tout le trafic sur une seule clé.
    expect(adresseClient(entetes({ 'x-forwarded-for': '41.2.3.4, 10.0.0.1' }))).toBe('41.2.3.4')
  })

  it('retombe sur les autres en-têtes connus', () => {
    expect(adresseClient(entetes({ 'x-real-ip': '41.2.3.5' }))).toBe('41.2.3.5')
    expect(adresseClient(entetes({ 'cf-connecting-ip': '41.2.3.6' }))).toBe('41.2.3.6')
  })

  it('ne rend jamais une chaîne vide', () => {
    // Une clé vide regrouperait tous les appelants anonymes sous la même
    // limite — ce qui est ici le comportement prudent, mais doit être
    // explicite plutôt que subi.
    expect(adresseClient(entetes({}))).toBe('inconnue')
  })
})

describe('sur le serveur', () => {
  /** Un dépôt qui refuse tout : on ne teste QUE la limitation. */
  const depotMuet = {
    appareilParJeton: async () => null,
    verifier: async () => undefined,
  } as unknown as DepotSync

  const appairer = (app: ReturnType<typeof creerServeur>, ip: string, email = 'a@b.tn') =>
    app.request('http://test/appairage', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
      body: JSON.stringify({ email, motDePasse: 'mauvais-mot-de-passe' }),
    })

  it('finit par répondre 429, avec Retry-After', async () => {
    const app = creerServeur({ depot: depotMuet })
    let derniere: Response | null = null
    // 25 tentatives : au-delà du quota par IP (20).
    for (let i = 0; i < 25; i += 1) derniere = await appairer(app, '41.9.9.9', `x${i}@b.tn`)
    expect(derniere?.status).toBe(429)
    // L'en-tête EXISTE : un 429 sans Retry-After laisse le client deviner,
    // et un client qui devine réessaie tout de suite.
    expect(Number(derniere?.headers.get('retry-after'))).toBeGreaterThan(0)
  })

  it('ne bloque PAS un voisin qui a une autre adresse', async () => {
    const app = creerServeur({ depot: depotMuet })
    for (let i = 0; i < 25; i += 1) await appairer(app, '41.9.9.9', `x${i}@b.tn`)
    const voisin = await appairer(app, '41.8.8.8', 'autre@b.tn')
    expect(voisin.status).not.toBe(429)
  })

  it('NE LIMITE JAMAIS le chemin de la caisse', async () => {
    /*
     * LE test de ce fichier.
     *
     * Une caisse qui rattrape trois semaines hors ligne envoie des dizaines
     * de lots à la suite. La freiner retarderait des encaissements DÉJÀ
     * FAITS — c'est-à-dire que notre garde-fou casserait la promesse du
     * produit. Le jeton d'appareil fait 32 octets aléatoires : il n'y a rien
     * à protéger contre la force brute de ce côté.
     */
    const app = creerServeur({ depot: depotMuet })
    const codes = new Set<number>()
    for (let i = 0; i < 100; i += 1) {
      const r = await app.request('http://test/sync/pull', {
        headers: { authorization: 'Bearer jeton-quelconque', 'x-forwarded-for': '41.9.9.9' },
      })
      codes.add(r.status)
    }
    // 401 parce que le jeton est inconnu — jamais 429.
    expect(codes.has(429)).toBe(false)
    expect(codes).toEqual(new Set([401]))
  })

  it('ne limite pas non plus le contrôle de santé', async () => {
    // C'est ce que sonde l'hébergeur, plusieurs fois par minute. Le limiter
    // ferait redémarrer le service en boucle.
    const app = creerServeur({ depot: depotMuet })
    for (let i = 0; i < 50; i += 1) {
      const r = await app.request('http://test/sante', {
        headers: { 'x-forwarded-for': '41.9.9.9' },
      })
      expect(r.status).not.toBe(429)
    }
  })
})
