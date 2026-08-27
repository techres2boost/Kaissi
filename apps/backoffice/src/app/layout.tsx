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
