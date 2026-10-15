/**
 * La notification de test dit QUEL maillon manque.
 *
 * PANNE SIGNALÉE : un produit passe en rupture, les alertes sont « activées »,
 * rien ne sonne. Quatre causes possibles, quatre endroits différents où
 * corriger — et rien ne permettait de les distinguer. Chaque cas doit donc
 * produire un message qui envoie au BON endroit.
 */

import { describe, expect, it } from 'vitest'
import { notificationDeTest } from '../src/alertes.js'

const VAPID = { clePublique: 'BCLE-PUBLIQUE-DU-SERVICE', clePrivee: 'privee', sujet: 'mailto:test@exemple.tn' }
const RESTO = '01930000-0000-7000-8000-000000000002'
const ABONNEMENT = { id: 'a', endpoint: 'https://push.exemple/abc', p256dh: 'x', auth: 'y' }

describe('notificationDeTest', () => {
  it('sans clés VAPID sur le service : le dit, et nomme les variables', async () => {
    const r = await notificationDeTest(ABONNEMENT, { vapid: null, restaurantId: RESTO })
    expect(r.ok).toBe(false)
    expect(r.message).toContain('VAPID_PRIVATE_KEY')
  })

  it('clé du back-office différente de celle du service : le dit AVANT d’essayer', async () => {
    const r = await notificationDeTest(ABONNEMENT, {
      vapid: VAPID,
      clePubliqueBackoffice: 'BUNE-AUTRE-CLE',
      restaurantId: RESTO,
    })
    expect(r.ok).toBe(false)
    expect(r.message).toContain('ne forment pas une paire')
  })

  it('navigateur inconnu côté serveur : demande de réactiver', async () => {
    const r = await notificationDeTest(null, {
      vapid: VAPID,
      clePubliqueBackoffice: VAPID.clePublique,
      restaurantId: RESTO,
    })
    expect(r.ok).toBe(false)
    expect(r.message).toContain('réactive')
  })
})
