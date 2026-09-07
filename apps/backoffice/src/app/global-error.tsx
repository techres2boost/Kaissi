'use client'

/**
 * Le dernier filet : une erreur dans la mise en page RACINE.
 *
 * `error.tsx` est rendu À L'INTÉRIEUR du layout. Si c'est le layout lui-même
 * qui casse — une police introuvable, une feuille de style absente, une
 * variable d'environnement manquante au démarrage — il ne peut rien afficher.
 * Ce fichier-ci remplace le document ENTIER, `<html>` compris, et c'est
 * pourquoi il redéclare ces balises.
 *
 * Il ne dépend d'AUCUNE feuille de style : ses couleurs sont en ligne. Une
 * page de secours qui a besoin du CSS pour s'afficher n'est pas une page de
 * secours — c'est précisément le CSS qui peut manquer.
 */

export default function ErreurGlobale({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang="fr">
      <body
        style={{
          background: '#08120E',
          color: '#E8F0EA',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          margin: 0,
          padding: '3rem 1.5rem',
        }}
      >
        <main style={{ maxWidth: '34rem', margin: '0 auto' }}>
          <h1 style={{ fontSize: '1.4rem' }}>Kaissi n’a pas pu démarrer</h1>
          <p>
            <strong>Vos données sont intactes.</strong> C’est l’application qui
            n’a pas pu s’afficher — rien n’a été modifié.
          </p>
          <p>
            La caisse, elle, continue de fonctionner : elle ne dépend pas de cet
            écran.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              background: '#5FD39B',
              color: '#08120E',
              border: 0,
              borderRadius: 8,
              padding: '0.6rem 1.1rem',
              fontSize: '1rem',
              cursor: 'pointer',
            }}
          >
            Réessayer
          </button>
          {error.digest && (
            <p style={{ color: '#8FA79A', fontSize: '0.85rem', marginTop: '1.5rem' }}>
              Code à communiquer au support : <code>{error.digest}</code>
            </p>
          )}
        </main>
      </body>
    </html>
  )
}
