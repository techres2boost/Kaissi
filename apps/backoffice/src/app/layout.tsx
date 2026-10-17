import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { IBM_Plex_Sans_Arabic, Inter, Sora } from 'next/font/google'
import { direction } from '@kaissi/i18n'
import { FournisseurLangue } from '../i18n/client.js'
import { langueCourante, traduction } from '../i18n/serveur.js'
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
 * L'arabe a sa propre police : Inter et Sora n'ont aucun glyphe arabe, et le
 * navigateur retomberait sur la police du système — Tahoma sur un poste,
 * Noto sur un autre, des chasses différentes partout. IBM Plex Sans Arabic
 * est dessinée pour l'écran, lisible en petit corps, et sous licence libre
 * (OFL). Chargée seulement pour une page en arabe : la classe n'est posée
 * qu'alors, et `next/font` ne précharge que ce qui est utilisé.
 */
const arabe = IBM_Plex_Sans_Arabic({
  subsets: ['arabic'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--police-arabe',
  preload: false,
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

export async function generateMetadata(): Promise<Metadata> {
  const t = await traduction()
  return {
    title: t('Kaissi — Back-office'),
    description: t('Administration et rapports — Res2Boost'),
  }
}

/*
 * La langue et le SENS de la page sont posés ici, sur `<html>`, au premier
 * octet : rendus par le serveur, ils arrivent avec la page. Posés plus tard
 * par un script, l'écran s'afficherait de gauche à droite puis se
 * retournerait sous les yeux du gérant.
 */
export default async function RacineLayout({ children }: { children: ReactNode }) {
  const langue = await langueCourante()
  const polices = [sora.variable, inter.variable, langue === 'ar' ? arabe.variable : ''].filter(Boolean).join(' ')
  return (
    <html lang={langue} dir={direction(langue)} className={polices}>
      <body>
        <FournisseurLangue langue={langue}>{children}</FournisseurLangue>
      </body>
    </html>
  )
}
