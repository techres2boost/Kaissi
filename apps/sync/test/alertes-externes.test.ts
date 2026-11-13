/**
 * Les alertes qui sortent du service : une par TRANSITION, jamais une par
 * période ; un plafond par heure ; et l'adresse du webhook, qui est un
 * secret, n'apparaît nulle part.
 */

import { describe, expect, it } from 'vitest'
import {
  NotificateurWebhook,
  formaterAlerte,
  notificateurDepuisEnvironnement,
  type ChangementIncident,
} from '../src/alertes-externes.js'

const URL_SECRETE = 'https://api.telegram.org/bot123456:SECRET-du-canal/sendMessage?chat_id=42'
const incident = (niveau: string, transition: ChangementIncident['transition'] = 'ouvert'): ChangementIncident => ({
  transition,
  id: '01930000-0000-7000-8000-0000000000aa',
  cle: 'base.migrations',
  niveau,
  sujet: 'Migrations',
  message: 'La migration 0051 manque : toutes les ventes échouent.',
})

function capteur(statut = 200) {
  const envoyes: { url: string; corps: { text: string; content: string } }[] = []
  const f: typeof fetch = async (url, init) => {
    envoyes.push({ url: String(url), corps: JSON.parse(String(init?.body)) })
    return new Response('{}', { status: statut })
  }
  return { envoyes, f }
}

describe('le notificateur webhook', () => {
  it('envoie un critique, avec `text` ET `content` (Telegram, Slack, Discord…)', async () => {
    const { envoyes, f } = capteur()
    const n = new NotificateurWebhook({ url: URL_SECRETE, fetch: f, lien: 'https://bo.exemple.tn/editeur/supervision' })
    expect(await n.envoyer(incident('critique'))).toEqual({ envoye: true })
    expect(envoyes).toHaveLength(1)
    expect(envoyes[0]!.corps.text).toBe(envoyes[0]!.corps.content)
    expect(envoyes[0]!.corps.text).toContain('⛔ Kaissi — CRITIQUE : Migrations')
    expect(envoyes[0]!.corps.text).toContain('https://bo.exemple.tn/editeur/supervision')
  })

  it('ne sonne pas pour « attention » par défaut — sauf si on le demande', async () => {
    const { envoyes, f } = capteur()
    expect(await new NotificateurWebhook({ url: URL_SECRETE, fetch: f }).envoyer(incident('attention')))
      .toEqual({ envoye: false, raison: 'niveau' })
    expect(envoyes).toHaveLength(0)
    await new NotificateurWebhook({ url: URL_SECRETE, fetch: f, niveauMinimum: 'attention' }).envoyer(incident('attention'))
    expect(envoyes).toHaveLength(1)
  })

  it('un plafond par heure, et le message suivant dit combien ont été retenus', async () => {
    let t = 0
    const { envoyes, f } = capteur()
    const n = new NotificateurWebhook({ url: URL_SECRETE, fetch: f, plafondParHeure: 2, maintenant: () => t })
    await n.envoyer(incident('critique'))
    await n.envoyer(incident('critique'))
    expect(await n.envoyer(incident('critique'))).toEqual({ envoye: false, raison: 'plafond' })
    expect(await n.envoyer(incident('critique'))).toEqual({ envoye: false, raison: 'plafond' })
    expect(envoyes).toHaveLength(2)
    t = 3_600_001
    await n.envoyer(incident('critique', 'resolu'))
    expect(envoyes[2]!.corps.text).toContain('2 alerte(s) précédente(s) retenue(s)')
    expect(envoyes[2]!.corps.text).toContain('✅ Kaissi — résolu : Migrations')
  })

  it('un échec ne recopie JAMAIS l’adresse du webhook', async () => {
    const enPanne = new NotificateurWebhook({
      url: URL_SECRETE,
      fetch: async () => {
        throw new TypeError(`fetch failed: ${URL_SECRETE}`)
      },
    })
    const r = await enPanne.envoyer(incident('critique'))
    expect(r.envoye).toBe(false)
    expect(JSON.stringify(r)).not.toContain('SECRET')
    const refuse = await new NotificateurWebhook({ url: URL_SECRETE, fetch: capteur(403).f }).envoyer(incident('critique'))
    expect(refuse).toEqual({ envoye: false, raison: 'echec', detail: 'HTTP 403' })
  })

  it('n’accepte qu’une adresse https', () => {
    expect(notificateurDepuisEnvironnement({})).toBeNull()
    expect(notificateurDepuisEnvironnement({ SYNC_ALERTES_WEBHOOK: 'http://hooks.exemple.tn/x' })).toBeNull()
    expect(notificateurDepuisEnvironnement({ SYNC_ALERTES_WEBHOOK: 'pas une adresse' })).toBeNull()
    expect(notificateurDepuisEnvironnement({ SYNC_ALERTES_WEBHOOK: URL_SECRETE })).not.toBeNull()
  })

  it('une aggravation se dit comme telle', () => {
    expect(formaterAlerte(incident('critique', 'aggrave'), null)).toMatch(/^⛔ Kaissi — AGGRAVÉ en critique/)
  })
})
