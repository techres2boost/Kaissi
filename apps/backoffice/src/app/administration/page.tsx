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
import { CycleEtablissement } from '../../composants/CycleEtablissement.js'

export const dynamic = 'force-dynamic'

export default async function PageAdministration() {
  const session = await sessionObligatoire()
  const administres = session.etablissements.filter((e) => e.administrateur)
  const ouverts = session.etablissements.filter((e) => !e.ferme)
  const fermes = session.etablissements.filter((e) => e.ferme)

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
              {ouverts.map((e) => (
                <tr key={e.id}>
                  <td>{e.nom}</td>
                  <td>
                    <span className="etiquette">{e.role}</span>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <Link className="bouton discret" href={{ pathname: `/${e.id}/journee` }}>
                      Ouvrir
                    </Link>
                    <CycleEtablissement
                      etablissement={{
                        id: e.id,
                        nom: e.nom,
                        ferme: e.ferme,
                        fermeLe: e.fermeLe,
                        administrateur: e.administrateur,
                        supprimable: administres.length > 1,
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {/*
          Les FERMÉS à part, et pas masqués.
          
          On ne cache pas à quelqu'un un restaurant dont il est gérant : ses
          ventes restent consultables, et c'est souvent la raison même pour
          laquelle on est venu. Les mélanger aux actifs, en revanche, ferait
          ouvrir le mauvais un lundi matin.
        */}
        {fermes.length > 0 && (
          <section className="carte">
            <h2>Établissements fermés</h2>
            <p className="sous-titre">
              Aucune nouvelle caisse ne peut y être mise en service. Leurs
              données restent consultables, et les terminaux déjà appairés
              continuent d’envoyer ce qu’ils avaient en attente.
            </p>
            <table>
              <thead>
                <tr>
                  <th>Établissement</th>
                  <th>Fermé le</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {fermes.map((e) => (
                  <tr key={e.id}>
                    <td>{e.nom}</td>
                    <td>
                      {e.fermeLe
                        ? new Date(e.fermeLe).toLocaleDateString('fr-FR')
                        : /*
                           * Un établissement fermé AVANT la 0038 n'a pas de date.
                           * « — » dit la vérité ; inventer aujourd'hui ferait lire
                           * une fermeture du jour sur un restaurant arrêté en mars.
                           */
                          '—'}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <Link className="bouton discret" href={{ pathname: `/${e.id}/journee` }}>
                        Consulter
                      </Link>
                      <CycleEtablissement
                        etablissement={{
                          id: e.id,
                          nom: e.nom,
                          ferme: e.ferme,
                          fermeLe: e.fermeLe,
                          administrateur: e.administrateur,
                          supprimable: administres.length > 1,
                        }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        <OuvrirEtablissement
          modeles={administres
            // Un établissement FERMÉ ne sert pas de modèle : on recopierait
            // les réglages d'un restaurant qu'on vient d'arrêter.
            .filter((e) => !e.ferme)
            .map((e) => ({ id: e.id, nom: e.nom }))}
        />
      </main>
    </>
  )
}
