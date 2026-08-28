import { describe, expect, it } from 'vitest'
import { expliquerErreurImpression, formaterErreurImpression } from './diagnostic.js'

// Messages relevés sur un vrai appareil Android, recopiés tels quels.
const ANDROID_REFUSE =
  'failed to connect to /10.0.2.2 (port 9100) from /10.0.2.16 (port 58972) ' +
  'after 4000ms: isConnected failed: ECONNREFUSED (Connection refused)'
const ANDROID_TIMEOUT =
  'failed to connect to /192.168.1.50 (port 9100) from /192.168.1.22 (port 41022) ' +
  'after 4000ms: isConnected failed: ETIMEDOUT (Connection timed out)'

describe('expliquerErreurImpression', () => {
  it('distingue « rien n’écoute » de « personne ne répond »', () => {
    // Les deux appellent un geste DIFFÉRENT : rallumer l'imprimante d'un
    // côté, vérifier l'adresse et le réseau de l'autre. Les confondre sous
    // un « erreur d'impression » ferait chercher au mauvais endroit.
    const refuse = expliquerErreurImpression(ANDROID_REFUSE)
    const timeout = expliquerErreurImpression(ANDROID_TIMEOUT)

    expect(refuse.explication).toMatch(/rien n'écoute/i)
    expect(timeout.explication).toMatch(/personne ne répond/i)
    expect(refuse.explication).not.toBe(timeout.explication)
  })

  it('conserve toujours le message d’origine', () => {
    // Sans lui, un cas non prévu devient indiagnosticable au téléphone.
    for (const message of [ANDROID_REFUSE, ANDROID_TIMEOUT, 'panne inédite']) {
      expect(expliquerErreurImpression(message).origine).toBe(message)
      expect(formaterErreurImpression(message)).toContain(message)
    }
  })

  it('reconnaît un nom d’hôte non résolu', () => {
    expect(
      expliquerErreurImpression('Unable to resolve host "imprimante-cuisine"').explication,
    ).toMatch(/adresse IP/i)
  })

  it('reconnaît une connexion coupée en cours d’envoi', () => {
    expect(expliquerErreurImpression('sendto failed: EPIPE (Broken pipe)').explication).toMatch(
      /coupée/i,
    )
  })

  it('n’invente rien sur un message inconnu', () => {
    // Une explication fausse est pire que pas d'explication : elle envoie
    // chercher la panne au mauvais endroit.
    const r = expliquerErreurImpression('Erreur 0x8007 du pilote')
    expect(r.explication).toBe('')
    expect(formaterErreurImpression('Erreur 0x8007 du pilote')).toBe('Erreur 0x8007 du pilote')
  })
})
