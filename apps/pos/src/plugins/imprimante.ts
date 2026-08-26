/**
 * Interface JavaScript du plugin natif d'impression réseau.
 *
 * Côté Android, `ImprimanteReseau.java` ouvre un socket TCP vers le port
 * 9100 de l'imprimante. Côté navigateur (développement), il n'y a pas de
 * socket brut : la mise en œuvre web se contente de refuser proprement,
 * et l'aperçu texte du ticket tient lieu de vérification.
 */

import { registerPlugin } from '@capacitor/core'

export interface ArgumentsImpression {
  hote: string
  port?: number
  /** Charge ESC/POS déjà rendue, en base64. */
  charge: string
}

export interface ResultatImpression {
  octets: number
}

export interface ResultatTest {
  joignable: boolean
  dureeMs: number
  erreur?: string
}

export interface PluginImprimanteReseau {
  imprimer(options: ArgumentsImpression): Promise<ResultatImpression>
  tester(options: { hote: string; port?: number }): Promise<ResultatTest>
}

export const ImprimanteReseau = registerPlugin<PluginImprimanteReseau>('ImprimanteReseau', {
  // Repli web : `pnpm dev` n'a pas de socket TCP. On échoue avec un message
  // explicite plutôt que de laisser croire que le ticket est parti.
  web: async () => ({
    async imprimer(): Promise<ResultatImpression> {
      throw new Error(
        "L'impression réseau n'existe que dans l'application Android. " +
          "En développement, utilisez l'aperçu du ticket.",
      )
    },
    async tester(): Promise<ResultatTest> {
      return {
        joignable: false,
        dureeMs: 0,
        erreur: 'Socket TCP indisponible dans un navigateur.',
      }
    },
  }),
})
