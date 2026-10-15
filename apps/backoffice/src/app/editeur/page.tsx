/**
 * Éditeur → les clients et leur formule.
 *
 * Réservé aux comptes listés dans `KAISSI_EDITEURS` (service de
 * synchronisation). Pour tout autre compte, la page n'existe pas (404) : un
 * client n'a pas à apprendre qu'un écran transversal existe.
 */

import { notFound } from 'next/navigation'
import { sessionObligatoire } from '../../serveur/session.js'
import { BarreCompte } from '../../composants/BarreCompte.js'
import { FORMULES, PLANS, type Plan } from '@kaissi/domain'
import { FormuleClient } from '../../composants/FormuleClient.js'
import { listerClients } from './actions.js'

export const dynamic = 'force-dynamic'

function nomFormule(plan: string): string {
  return (PLANS as readonly string[]).includes(plan) ? FORMULES[plan as Plan].nom : plan
}

export default async function PageEditeur() {
  const session = await sessionObligatoire()
  const clients = await listerClients()
  if (clients === null) notFound()

  return (
    <>
      <BarreCompte session={session} />
      <main className="enveloppe">
        <h1>Clients et formules</h1>
        <p className="sous-titre">
          Écran de l’éditeur. Changer une formule s’applique à toute
          l’organisation du client, aussitôt. La caisse n’est jamais concernée.
        </p>

        <section className="carte">
          <div className="tableau-defilant">
            <table>
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Établissements</th>
                  <th>Formule</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {clients.map((c) => (
                  <tr key={c.organizationId}>
                    <td>
                      <strong>{c.nom}</strong>
                      {c.note && <div className="indication">{c.note}</div>}
                    </td>
                    <td>
                      {c.etablissements.length === 0
                        ? '—'
                        : c.etablissements.map((e) => (
                            <div key={e.nom}>
                              {e.nom}
                              {e.ferme && <span className="etiquette inactif"> fermé</span>}
                            </div>
                          ))}
                    </td>
                    <td>
                      <span className="etiquette">{nomFormule(c.plan)}</span>
                    </td>
                    <td>
                      <FormuleClient organizationId={c.organizationId} planActuel={c.plan} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </>
  )
}
