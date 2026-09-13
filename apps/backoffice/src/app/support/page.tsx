import type { Metadata } from 'next'

/**
 * La page d'assistance — publique, et exigée par l'App Store.
 *
 * App Store Connect impose une « Support URL » sur la fiche, et Apple la
 * VISITE pendant la revue. Trois façons de se faire refuser dessus, et elles
 * sont toutes évitables :
 *
 *   • l'URL ne répond pas, ou répond un écran de connexion — c'est pourquoi
 *     ce chemin est ouvert explicitement dans `routes-publiques.ts`, comme
 *     `/confidentialite` ;
 *   • la page est une page d'accueil commerciale, sans moyen de contact.
 *     Apple attend une page D'ASSISTANCE : un humain joignable, et de quoi
 *     se débrouiller sans lui ;
 *   • le moyen de contact est un formulaire qui exige un compte. Le client
 *     qui écrit est justement celui qui n'arrive pas à entrer.
 *
 * D'où une adresse e-mail en clair, et des réponses aux pannes réelles —
 * celles que ce dépôt a rencontrées en clientèle, pas des généralités.
 *
 * ⚠ À compléter avant publication : le numéro de téléphone d'assistance et
 *   les horaires réels. Ils sont marqués à l'écran tant qu'ils manquent —
 *   une page qui promet une hotline inexistante est pire que pas de hotline.
 */

export const metadata: Metadata = {
  title: 'Assistance — Kaissi',
  description:
    'Comment obtenir de l’aide sur Kaissi : nous joindre, et les réponses aux questions les plus fréquentes.',
}

/** À compléter par l'éditeur — voir l'avertissement en tête de fichier. */
const EDITEUR = {
  nom: 'Res2Boost',
  contact: 'contact@res2boost.com',
  /** Laisser vide tant qu'aucune ligne n'est réellement tenue. */
  telephone: '',
  /** Idem : `''` affiche « nous répondons sous un jour ouvré » à la place. */
  horaires: '',
}

const MAJ = '13 septembre 2026'

/**
 * Les pannes qui reviennent, avec ce qu'il faut FAIRE.
 *
 * Elles viennent du terrain, pas d'un modèle de page d'aide : le bandeau
 * rouge de synchronisation, le PIN refusé, la caisse qui ne voit pas un
 * nouveau produit. Une FAQ qui répond « contactez-nous » à tout ne fait
 * gagner de temps à personne.
 */
const QUESTIONS: { q: string; r: React.ReactNode }[] = [
  {
    q: 'La caisse fonctionne-t-elle sans Internet ?',
    r: (
      <>
        <strong>Oui, entièrement.</strong> C’est la raison d’être de Kaissi :
        prendre une commande, encaisser, rendre la monnaie et imprimer se font
        hors ligne. Les ventes sont enregistrées sur la tablette, puis remontent
        d’elles-mêmes dès que la connexion revient. Aucune vente n’est perdue et
        aucune n’est comptée deux fois.
      </>
    ),
  },
  {
    q: 'Le bandeau de synchronisation est rouge. Que faire ?',
    r: (
      <>
        <strong>Continuez d’encaisser</strong> — c’est prévu, et rien n’est
        perdu. Le bandeau indique que les ventes attendent d’être envoyées, pas
        qu’elles sont en danger. Ouvrez l’écran <em>Sync</em> : il dit combien
        d’opérations sont en attente et pourquoi. Si le rouge persiste après le
        retour du réseau, écrivez-nous en nous envoyant une capture de l’écran{' '}
        <em>Diagnostic</em>.
      </>
    ),
  },
  {
    q: 'Une vente n’apparaît pas dans le back-office.',
    r: (
      <>
        Vérifiez d’abord que la tablette est en ligne et que l’écran{' '}
        <em>Sync</em> n’affiche aucune opération en attente. Le back-office
        n’affiche que ce qui lui est parvenu ; une tablette restée hors ligne
        toute la journée remonte tout d’un coup le soir. Si l’attente est vide
        et que la vente manque toujours, écrivez-nous avec le numéro de ticket.
      </>
    ),
  },
  {
    q: 'Un code PIN est refusé.',
    r: (
      <>
        Le PIN est vérifié sur la tablette, sans réseau. S’il vient d’être
        modifié au back-office, la tablette doit d’abord recevoir la mise à
        jour : connectez-la quelques secondes. Un employé{' '}
        <strong>suspendu</strong> est refusé même avec le bon code — c’est
        voulu.
      </>
    ),
  },
  {
    q: 'Un produit ajouté au back-office n’apparaît pas sur la caisse.',
    r: (
      <>
        La carte descend par la synchronisation, comme les prix. Connectez la
        tablette et attendez un cycle. Si le produit est marqué{' '}
        <em>indisponible</em>, il reste visible sur la caisse mais refuse la
        vente en disant pourquoi — rupture de stock, ou retrait manuel.
      </>
    ),
  },
  {
    q: 'J’ai perdu l’accès au back-office.',
    r: (
      <>
        Le gérant de votre établissement peut réinitialiser un mot de passe
        depuis <em>Administration → Employés</em>. Si personne ne peut plus
        entrer, écrivez-nous depuis l’adresse e-mail du compte concerné.
      </>
    ),
  },
  {
    q: 'Comment supprimer mes données ?',
    r: (
      <>
        Écrivez-nous depuis l’adresse du compte : la procédure et les délais
        sont décrits dans la{' '}
        <a href="/confidentialite">politique de confidentialité</a>.
      </>
    ),
  },
]

export default function Support() {
  return (
    <main className="enveloppe" style={{ maxWidth: '46rem' }}>
      <h1>Assistance</h1>
      <p className="sous-titre">
        Kaissi — caisse et gestion pour restaurants · {EDITEUR.nom}
        <br />
        Dernière mise à jour : {MAJ}
      </p>

      <section className="carte">
        <h2>Nous joindre</h2>
        <p>
          Par e-mail :{' '}
          <a href={`mailto:${EDITEUR.contact}`}>{EDITEUR.contact}</a>
          {EDITEUR.telephone ? (
            <>
              <br />
              Par téléphone : <a href={`tel:${EDITEUR.telephone.replace(/\s/g, '')}`}>{EDITEUR.telephone}</a>
            </>
          ) : null}
        </p>
        <p className="indication">
          {EDITEUR.horaires
            ? EDITEUR.horaires
            : 'Nous répondons sous un jour ouvré. Le service se fait en français et en arabe.'}
        </p>
        <p className="indication">
          Pour aller plus vite, indiquez le <strong>nom de votre
          établissement</strong>, l’écran concerné, et — si la caisse est en
          cause — ce qu’affiche l’écran <em>Diagnostic</em> de la tablette.
        </p>
      </section>

      <section className="carte">
        <h2>Questions fréquentes</h2>
        <dl className="faq">
          {QUESTIONS.map(({ q, r }) => (
            <div key={q}>
              <dt>{q}</dt>
              <dd>{r}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="carte">
        <h2>Vos données</h2>
        <p>
          Kaissi enregistre les ventes d’un restaurant et les comptes de son
          équipe. Aucune localisation, aucun accès aux contacts ou aux photos,
          aucune publicité. Le détail est dans la{' '}
          <a href="/confidentialite">politique de confidentialité</a>.
        </p>
      </section>
    </main>
  )
}
