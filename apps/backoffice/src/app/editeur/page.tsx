/**
 * Éditeur → les clients et leur formule.
 *
 * Réservé aux comptes listés dans `KAISSI_EDITEURS` (service de
 * synchronisation). Pour tout autre compte, la page n'existe pas (404) : un
 * client n'a pas à apprendre qu'un écran transversal existe.
 */

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { sessionObligatoire } from '../../serveur/session.js'
import { BarreCompte } from '../../composants/BarreCompte.js'
import { FORMULES, PLANS, type Plan } from '@kaissi/domain'
import { FormuleClient } from '../../composants/FormuleClient.js'
import { listerClients } from './actions.js'
import { traduction } from '../../i18n/serveur.js'

export const dynamic = 'force-dynamic'

function nomFormule(plan: string): string {
  return (PLANS as readonly string[]).includes(plan) ? FORMULES[plan as Plan].nom : plan
}

export default async function PageEditeur() {
  const t = await traduction()
  const session = await sessionObligatoire()
  const clients = await listerClients()
  if (clients === null) notFound()

  return (
    <>
      <BarreCompte session={session} />
      <main className="enveloppe">
        <h1>{t('Clients et formules')}</h1>
        <p className="sous-titre">{t('Écran de l’éditeur. Changer une formule s’applique à toute l’organisation du client, aussitôt. La caisse n’est jamais concernée.')}</p>
        <p>
          <Link className="bouton discret" href="/editeur/surveillance">{t('Surveillance du service ›')}</Link>
        </p>

        <section className="carte">
          <div className="tableau-defilant">
            <table>
              <thead>
                <tr>
                  <th>{t('Client')}</th>
                  <th>{t('Établissements')}</th>
                  <th>{t('Formule')}</th>
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
                              {e.ferme && <span className="etiquette inactif">{' '}{t('fermé')}</span>}
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
