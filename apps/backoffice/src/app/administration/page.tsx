/**
 * « Administration » — ouvrir un établissement, et voir ceux qu'on gère.
 *
 * Un seul écran, réservé au rôle `admin`. La frontière posée par la migration
 * 0024 vaut ici comme ailleurs : **un gérant exploite, un administrateur
 * distribue les pouvoirs**. Ouvrir un restaurant, c'est en distribuer.
 *
 * Le refus est CÔTÉ SERVEUR — masquer un lien n'interdit rien, et l'action
 * elle-même est revérifiée par le service de synchronisation, qui relit les
 * droits en base.
 */

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { sessionObligatoire } from '../../serveur/session.js'
import { BarreCompte } from '../../composants/BarreCompte.js'
import { OuvrirEtablissement } from '../../composants/OuvrirEtablissement.js'

export const dynamic = 'force-dynamic'

export default async function PageAdministration() {
  const session = await sessionObligatoire()
  const administres = session.etablissements.filter((e) => e.administrateur)

  /*
   * `notFound()` plutôt qu'un message « accès refusé ».
   *
   * Un gérant n'a pas à apprendre que cet écran existe : lui dire qu'il est
   * refusé, c'est lui apprendre qu'il y a quelque chose derrière, et
   * l'inviter à demander pourquoi. La page n'existe pas pour lui.
   */
  if (administres.length === 0) notFound()

  return (
    <>
      <BarreCompte session={session} />
      <main className="enveloppe">
        <h1>Administration</h1>
        <p className="sous-titre">
          Ouvrir un établissement, et voir ceux que vous administrez. Réservé au
          rôle <strong>administrateur</strong> : un gérant exploite le sien, il
          n’en ouvre pas un second.
        </p>

        <section className="carte">
          <h2>Vos établissements</h2>
          <table>
            <thead>
              <tr>
                <th>Établissement</th>
                <th>Votre rôle</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {session.etablissements.map((e) => (
                <tr key={e.id}>
                  <td>{e.nom}</td>
                  <td>
                    <span className="etiquette">{e.role}</span>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <Link className="bouton discret" href={{ pathname: `/${e.id}/journee` }}>
                      Ouvrir
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <OuvrirEtablissement
          modeles={administres.map((e) => ({ id: e.id, nom: e.nom }))}
        />
      </main>
    </>
  )
}
