import type { Metadata } from 'next'
import { traduction } from '../../i18n/serveur.js'
import { use } from 'react'
import { aTraduire } from '@kaissi/i18n'

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

export async function generateMetadata(): Promise<Metadata> {
  const t = await traduction()
  return {
    title: t('Politique de confidentialité — Kaissi'),
    description: t('Quelles données Kaissi traite, pourquoi, combien de temps, et comment en demander la suppression.'),
  }
}

/** À compléter par l'éditeur — voir l'avertissement en tête de fichier. */
const EDITEUR = {
  nom: aTraduire('Res2Boost'),
  contact: 'contact@res2boost.com',
}

const MAJ = aTraduire('12 septembre 2026')

export default function Confidentialite() {
  const t = use(traduction())
  return (
    <main className="enveloppe" style={{ maxWidth: '46rem' }}>
      <h1>{t('Politique de confidentialité')}</h1>
      <p className="sous-titre">{t('Kaissi — caisse et gestion pour restaurants ·')}{' '}{EDITEUR.nom}
        <br />{t('Dernière mise à jour :')}{' '}{t(MAJ)}
      </p>

      <section className="carte">
        <h2>{t('En une phrase')}</h2>
        <p>{t('Kaissi enregistre les')}{' '}<strong>{t('ventes d’un restaurant')}</strong>{' '}{t('et les comptes de son équipe. Il ne collecte aucune donnée de localisation, n’accède ni aux contacts ni aux photos, n’affiche aucune publicité et ne partage rien à des fins publicitaires ou de suivi.')}</p>
      </section>

      <section className="carte">
        <h2>{t('Qui traite les données')}</h2>
        <p>
          {EDITEUR.nom}{t(', éditeur de Kaissi. Pour toute question ou demande relative à vos données :')}{' '}<a href={`mailto:${EDITEUR.contact}`}>{EDITEUR.contact}</a>.
        </p>
        <p className="indication">{t('Le restaurant qui utilise Kaissi reste responsable des données de ses propres clients et de son équipe ;')}{' '}{EDITEUR.nom}{' '}{t('les traite pour son compte, afin de fournir le service.')}</p>
      </section>

      <section className="carte">
        <h2>{t('Quelles données, et pourquoi')}</h2>
        <table>
          <thead>
            <tr>
              <th>{t('Donnée')}</th>
              <th>{t('Pourquoi')}</th>
              <th>{t('Conservation')}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{t('Adresse e-mail du gérant')}</td>
              <td>{t('Ouvrir une session au back-office')}</td>
              <td>{t('Tant que le compte existe')}</td>
            </tr>
            <tr>
              <td>{t('Nom d’un employé et son code PIN')}</td>
              <td>{t('Savoir')}{' '}<strong>{t('qui')}</strong>{' '}{t('a encaissé, annulé ou accordé une remise. Le PIN n’est jamais conservé en clair : seule une empreinte cryptographique (Argon2id) l’est.')}</td>
              <td>{t('Tant que l’employé figure dans l’établissement')}</td>
            </tr>
            <tr>
              <td>{t('Identifiant de l’appareil')}</td>
              <td>{t('Rattacher chaque vente à la caisse qui l’a émise, et empêcher deux terminaux de produire le même numéro de ticket')}</td>
              <td>{t('Tant que l’appareil est actif')}</td>
            </tr>
            <tr>
              <td>{t('Ventes, tickets, encaissements')}</td>
              <td>{t('Tenir la caisse, produire les rapports, et répondre aux obligations comptables du restaurant')}</td>
              <td>{t('Durée légale de conservation des pièces comptables applicable au restaurant')}</td>
            </tr>
            <tr>
              <td>{t('Nom et téléphone d’un client (facultatif)')}</td>
              <td>{t('Rattacher une commande à un client, à la demande du restaurant. Ce champ peut rester vide — Kaissi fonctionne sans.')}</td>
              <td>{t('Jusqu’à suppression par le restaurant')}</td>
            </tr>
          </tbody>
        </table>
        <p className="indication">{t('Aucune autre catégorie n’est collectée : ni position, ni contacts, ni photos, ni micro, ni identifiants publicitaires.')}</p>
      </section>

      <section className="carte">
        <h2>{t('Ce que Kaissi ne fait pas')}</h2>
        <ul>
          <li>{t('Aucune publicité, dans l’application comme ailleurs.')}</li>
          <li>{t('Aucun suivi publicitaire, aucun croisement de ces données avec celles d’autres sociétés.')}</li>
          <li>{t('Aucune vente ni location de données à des tiers.')}</li>
          <li>{t('Aucune collecte de données de santé, biométriques, ni d’aucune autre catégorie sensible.')}</li>
          <li>{t('Aucun accès à la position de l’appareil.')}</li>
        </ul>
      </section>

      <section className="carte">
        <h2>{t('Où les données sont stockées')}</h2>
        <p>{t('Deux endroits, et c’est une caractéristique du produit :')}</p>
        <ul>
          <li>
            <strong>{t('Sur la tablette')}</strong>{t(', dans une base locale. C’est ce qui permet d’encaisser sans Internet. Ces données restent sur l’appareil.')}</li>
          <li>
            <strong>{t('Sur nos serveurs')}</strong>{t(', hébergés chez Supabase, pour la synchronisation entre terminaux et le back-office.')}</li>
        </ul>
        <p>{t('Les échanges entre les deux sont')}{' '}<strong>{t('chiffrés en transit')}</strong>{' '}{t('(HTTPS). Chaque restaurant est isolé des autres au niveau de la base de données : une requête d’un établissement ne peut pas rendre les lignes d’un autre.')}</p>
      </section>

      <section className="carte">
        <h2>{t('Sous-traitants')}</h2>
        <ul>
          <li>
            <strong>{t('Supabase')}</strong>{' '}{t('— hébergement de la base de données et gestion des comptes.')}</li>
          <li>
            <strong>{t('Vercel')}</strong>{' '}{t('— hébergement du back-office.')}</li>
        </ul>
        <p className="indication">{t('Ces prestataires hébergent les données pour notre compte et n’en font aucun usage propre.')}</p>
      </section>

      <section className="carte">
        <h2>{t('Vos droits')}</h2>
        <p>{t('Vous pouvez demander l’')}<strong>{t('accès')}</strong>{' '}{t('à vos données, leur')}{' '}
          <strong>{t('correction')}</strong>{t(', leur')}{' '}<strong>{t('suppression')}</strong>{t(', ou une')}{' '}
          <strong>{t('copie')}</strong>{' '}{t('exportable. Écrivez à')}{' '}
          <a href={`mailto:${EDITEUR.contact}`}>{EDITEUR.contact}</a>{' '}{t('; nous répondons sous trente jours.')}</p>
        <p className="indication">{t('Une limite à connaître : les écritures de caisse déjà enregistrées ne peuvent pas être effacées individuellement — c’est ce qui garantit qu’un chiffre d’affaires ne se réécrit pas après coup. Une annulation ajoute une écriture d’annulation, elle n’en retire jamais. La suppression d’un compte retire en revanche les données qui l’identifient.')}</p>
      </section>

      <section className="carte">
        <h2>{t('Suppression du compte')}</h2>
        <p>{t('Pour faire supprimer un compte et les données associées, envoyez la demande depuis l’adresse e-mail du compte à')}{' '}
          <a href={`mailto:${EDITEUR.contact}`}>{EDITEUR.contact}</a>{t(', avec le nom de l’établissement. Nous confirmons la suppression par retour de courriel.')}</p>
      </section>

      <section className="carte">
        <h2>{t('Enfants')}</h2>
        <p>{t('Kaissi est un outil professionnel destiné au personnel d’un restaurant. Il ne s’adresse pas aux enfants et ne leur est pas proposé.')}</p>
      </section>

      <section className="carte">
        <h2>{t('Modifications')}</h2>
        <p>{t('Toute modification de cette politique sera publiée sur cette page, avec une nouvelle date de mise à jour. Les changements substantiels seront signalés aux gérants par courriel.')}</p>
      </section>

      <p className="indication" style={{ marginTop: '2rem' }}>{t('Kaissi est édité par')}{' '}{EDITEUR.nom}{t('. Contact :')}{' '}
        <a href={`mailto:${EDITEUR.contact}`}>{EDITEUR.contact}</a>.
      </p>
    </main>
  )
}
