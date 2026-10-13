import type { ReactNode } from 'react'
import { Inter, Sora } from 'next/font/google'
import './styles.css'

/*
 * Les polices de la marque, chargées par `next/font`.
 *
 * Next les télécharge AU BUILD et les sert depuis notre propre domaine : la
 * page n'émet aucune requête vers un tiers à l'exécution. Ce n'est pas qu'une
 * question de performance — une balise <link> vers un CDN de polices révèle
 * chaque visite du back-office à ce tiers.
 *
 * `display: 'swap'` : le texte s'affiche tout de suite dans la police de
 * repli, puis bascule. Un gérant qui ouvre son rapport du matin ne doit pas
 * attendre devant un écran vide.
 */
const sora = Sora({
  subsets: ['latin'],
  weight: ['600', '700'],
  display: 'swap',
  variable: '--police-titre',
})

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  display: 'swap',
  variable: '--police-corps',
})

/*
 * Les fonctions serveur tournent À CÔTÉ de la base — Francfort.
 *
 * PANNE DE PERFORMANCE SIGNALÉE : 1 à 2 secondes à chaque onglet et à chaque
 * filtre. Supabase est en `eu-central-1` (Francfort) ; sans réglage, Vercel
 * exécute les fonctions à Washington (`iad1`). Chaque requête traversait
 * donc l'Atlantique aller-retour, environ 90 ms — et une page en enchaîne
 * une dizaine : session, appartenances, établissement, puis les données.
 * À Francfort, le même aller-retour coûte quelques millisecondes.
 *
 * Déclaré ici, sur la racine : tous les segments en héritent, et une page
 * ajoutée demain ne peut pas l'oublier. Si la base déménage, ce réglage
 * déménage avec elle.
 */
export const preferredRegion = 'fra1'

export const metadata = {
  title: 'Kaissi — Back-office',
  description: 'Administration et rapports — Res2Boost',
}

export default function RacineLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr" className={`${sora.variable} ${inter.variable}`}>
      <body>{children}</body>
    </html>
  )
}
