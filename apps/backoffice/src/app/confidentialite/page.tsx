import type { Metadata } from 'next'

/**
 * La politique de confidentialité — publique, et c'est le point.
 *
 * Google Play et l'App Store EXIGENT une URL qui réponde, et ils la testent
 * sans session. Servie derrière l'authentification, elle rendrait un écran de
 * connexion et la fiche serait rejetée pour « politique injoignable ». C'est
 * `src/serveur/routes-publiques.ts` qui l'ouvre, explicitement.
 *
 * ⚠ Deux choses à compléter avant publication, et elles sont marquées à
 *   l'écran : la raison sociale exacte et l'adresse postale de l'éditeur.
 *   Elles ne s'inventent pas depuis le code.
 *
 * ⚠ Ce texte décrit fidèlement ce que le logiciel FAIT — les données listées
 *   sont celles que le schéma porte réellement, et elles correspondent
 *   exactement au formulaire « Sécurité des données » de Play (docs/stores.md
 *   §3.5). Il ne prétend pas être un avis juridique : faites-le relire.
 */

export const metadata: Metadata = {
  title: 'Politique de confidentialité — Kaissi',
  description:
    'Quelles données Kaissi traite, pourquoi, combien de temps, et comment en demander la suppression.',
}

/** À compléter par l'éditeur — voir l'avertissement en tête de fichier. */
const EDITEUR = {
  nom: 'Res2Boost',
  contact: 'contact@res2boost.com',
}

const MAJ = '12 septembre 2026'

export default function Confidentialite() {
  return (
    <main className="enveloppe" style={{ maxWidth: '46rem' }}>
      <h1>Politique de confidentialité</h1>
      <p className="sous-titre">
        Kaissi — caisse et gestion pour restaurants · {EDITEUR.nom}
        <br />
        Dernière mise à jour : {MAJ}
      </p>

      <section className="carte">
        <h2>En une phrase</h2>
        <p>
          Kaissi enregistre les <strong>ventes d’un restaurant</strong> et les
          comptes de son équipe. Il ne collecte aucune donnée de localisation,
          n’accède ni aux contacts ni aux photos, n’affiche aucune publicité et
          ne partage rien à des fins publicitaires ou de suivi.
        </p>
      </section>

      <section className="carte">
        <h2>Qui traite les données</h2>
        <p>
          {EDITEUR.nom}, éditeur de Kaissi. Pour toute question ou demande
          relative à vos données : <a href={`mailto:${EDITEUR.contact}`}>{EDITEUR.contact}</a>.
        </p>
        <p className="indication">
          Le restaurant qui utilise Kaissi reste responsable des données de ses
          propres clients et de son équipe ; {EDITEUR.nom} les traite pour son
          compte, afin de fournir le service.
        </p>
      </section>

      <section className="carte">
        <h2>Quelles données, et pourquoi</h2>
        <table>
          <thead>
            <tr>
              <th>Donnée</th>
              <th>Pourquoi</th>
              <th>Conservation</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Adresse e-mail du gérant</td>
              <td>Ouvrir une session au back-office</td>
              <td>Tant que le compte existe</td>
            </tr>
            <tr>
              <td>Nom d’un employé et son code PIN</td>
              <td>
                Savoir <strong>qui</strong> a encaissé, annulé ou accordé une
                remise. Le PIN n’est jamais conservé en clair : seule une
                empreinte cryptographique (Argon2id) l’est.
              </td>
              <td>Tant que l’employé figure dans l’établissement</td>
            </tr>
            <tr>
              <td>Identifiant de l’appareil</td>
              <td>
                Rattacher chaque vente à la caisse qui l’a émise, et empêcher
                deux terminaux de produire le même numéro de ticket
              </td>
              <td>Tant que l’appareil est actif</td>
            </tr>
            <tr>
              <td>Ventes, tickets, encaissements</td>
              <td>
                Tenir la caisse, produire les rapports, et répondre aux
                obligations comptables du restaurant
              </td>
              <td>
                Durée légale de conservation des pièces comptables applicable
                au restaurant
              </td>
            </tr>
            <tr>
              <td>Nom et téléphone d’un client (facultatif)</td>
              <td>
                Rattacher une commande à un client, à la demande du restaurant.
                Ce champ peut rester vide — Kaissi fonctionne sans.
              </td>
              <td>Jusqu’à suppression par le restaurant</td>
            </tr>
          </tbody>
        </table>
        <p className="indication">
          Aucune autre catégorie n’est collectée : ni position, ni contacts, ni
          photos, ni micro, ni identifiants publicitaires.
        </p>
      </section>

      <section className="carte">
        <h2>Ce que Kaissi ne fait pas</h2>
        <ul>
          <li>Aucune publicité, dans l’application comme ailleurs.</li>
          <li>
            Aucun suivi publicitaire, aucun croisement de ces données avec
            celles d’autres sociétés.
          </li>
          <li>Aucune vente ni location de données à des tiers.</li>
          <li>
            Aucune collecte de données de santé, biométriques, ni d’aucune autre
            catégorie sensible.
          </li>
          <li>Aucun accès à la position de l’appareil.</li>
        </ul>
      </section>

      <section className="carte">
        <h2>Où les données sont stockées</h2>
        <p>
          Deux endroits, et c’est une caractéristique du produit :
        </p>
        <ul>
          <li>
            <strong>Sur la tablette</strong>, dans une base locale. C’est ce qui
            permet d’encaisser sans Internet. Ces données restent sur
            l’appareil.
          </li>
          <li>
            <strong>Sur nos serveurs</strong>, hébergés chez Supabase, pour la
            synchronisation entre terminaux et le back-office.
          </li>
        </ul>
        <p>
          Les échanges entre les deux sont <strong>chiffrés en transit</strong>{' '}
          (HTTPS). Chaque restaurant est isolé des autres au niveau de la base
          de données : une requête d’un établissement ne peut pas rendre les
          lignes d’un autre.
        </p>
      </section>

      <section className="carte">
        <h2>Sous-traitants</h2>
        <ul>
          <li>
            <strong>Supabase</strong> — hébergement de la base de données et
            gestion des comptes.
          </li>
          <li>
            <strong>Vercel</strong> — hébergement du back-office.
          </li>
        </ul>
        <p className="indication">
          Ces prestataires hébergent les données pour notre compte et n’en font
          aucun usage propre.
        </p>
      </section>

      <section className="carte">
        <h2>Vos droits</h2>
        <p>
          Vous pouvez demander l’<strong>accès</strong> à vos données, leur{' '}
          <strong>correction</strong>, leur <strong>suppression</strong>, ou une{' '}
          <strong>copie</strong> exportable. Écrivez à{' '}
          <a href={`mailto:${EDITEUR.contact}`}>{EDITEUR.contact}</a> ; nous
          répondons sous trente jours.
        </p>
        <p className="indication">
          Une limite à connaître : les écritures de caisse déjà enregistrées ne
          peuvent pas être effacées individuellement — c’est ce qui garantit
          qu’un chiffre d’affaires ne se réécrit pas après coup. Une annulation
          ajoute une écriture d’annulation, elle n’en retire jamais. La
          suppression d’un compte retire en revanche les données qui
          l’identifient.
        </p>
      </section>

      <section className="carte">
        <h2>Suppression du compte</h2>
        <p>
          Pour faire supprimer un compte et les données associées, envoyez la
          demande depuis l’adresse e-mail du compte à{' '}
          <a href={`mailto:${EDITEUR.contact}`}>{EDITEUR.contact}</a>, avec le
          nom de l’établissement. Nous confirmons la suppression par retour de
          courriel.
        </p>
      </section>

      <section className="carte">
        <h2>Enfants</h2>
        <p>
          Kaissi est un outil professionnel destiné au personnel d’un
          restaurant. Il ne s’adresse pas aux enfants et ne leur est pas
          proposé.
        </p>
      </section>

      <section className="carte">
        <h2>Modifications</h2>
        <p>
          Toute modification de cette politique sera publiée sur cette page,
          avec une nouvelle date de mise à jour. Les changements substantiels
          seront signalés aux gérants par courriel.
        </p>
      </section>

      <p className="indication" style={{ marginTop: '2rem' }}>
        Kaissi est édité par {EDITEUR.nom}. Contact :{' '}
        <a href={`mailto:${EDITEUR.contact}`}>{EDITEUR.contact}</a>.
      </p>
    </main>
  )
}
