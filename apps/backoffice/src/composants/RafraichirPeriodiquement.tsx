'use client'

/**
 * Rejoue le composant serveur de la page toutes les `secondes`.
 *
 * `router.refresh()` et non un rechargement : la page garde son défilement,
 * et un écran de surveillance laissé ouvert sur un second écran ne doit pas
 * sauter en haut toutes les quinze secondes.
 */

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useT } from '../i18n/client.js'

export function RafraichirPeriodiquement({ secondes }: { secondes: number }) {
  const t = useT()
  const router = useRouter()
  useEffect(() => {
    const minuteur = setInterval(() => router.refresh(), secondes * 1000)
    return () => clearInterval(minuteur)
  }, [router, secondes])
  return <span className="indication">{t('Actualisé toutes les {n} s.', { n: secondes })}</span>
}
