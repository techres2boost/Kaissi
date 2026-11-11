import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import localFont from 'next/font/local'
import { direction } from '@kaissi/i18n'
import { FournisseurLangue } from '../i18n/client.js'
import { langueCourante, traduction } from '../i18n/serveur.js'
import './styles.css'

/*
 * Les polices de la marque — des FICHIERS du dépôt, pas un téléchargement.
 *
 * PANNE DE BUILD OBSERVÉE (1er novembre) : `next/font/google` télécharge les
 * polices chez Google à CHAQUE build. Ce jour-là, Google a répondu une
 * adresse de fichier que Next ne savait pas lire, et le build est tombé sur
 * « Cannot read properties of null (reading '1') » — dans la CI, mais le
 * même chemin sert au déploiement Vercel : un back-office qu'on ne peut plus
 * déployer parce qu'un tiers a changé un format de réponse.
 *
 * `src/polices/` porte donc les woff2 et leurs licences (SIL OFL 1.1, qui
 * autorise la redistribution). Le build ne dépend plus d'aucun réseau —
 * la même exigence que pour la caisse, appliquée à ce qui la mérite ici.
 * Rien ne change à l'exécution : Next servait déjà ces polices depuis notre
 * domaine, sans requête vers un tiers.
 *
 * Inter et Sora sont des polices VARIABLES : un seul fichier couvre toutes
 * les graisses (`weight` donne la plage).
 *
 * `display: 'swap'` : le texte s'affiche tout de suite dans la police de
 * repli, puis bascule. Un gérant qui ouvre son rapport du matin ne doit pas
 * attendre devant un écran vide.
 */
const sora = localFont({
  src: '../polices/sora-latin.woff2',
  weight: '100 800',
  display: 'swap',
  variable: '--police-titre',
})

const inter = localFont({
  src: '../polices/inter-latin.woff2',
  weight: '100 900',
  display: 'swap',
  variable: '--police-corps',
})

/*
 * L'arabe a sa propre police : Inter et Sora n'ont aucun glyphe arabe, et le
 * navigateur retomberait sur la police du système — Tahoma sur un poste,
 * Noto sur un autre, des chasses différentes partout. IBM Plex Sans Arabic
 * est dessinée pour l'écran, lisible en petit corps, et sous licence libre
 * (OFL). Chargée seulement pour une page en arabe : la classe n'est posée
 * qu'alors, et `preload: false` évite de la précharger ailleurs.
 */
const arabe = localFont({
  src: [
    { path: '../polices/ibm-plex-sans-arabic-400.woff2', weight: '400', style: 'normal' },
    { path: '../polices/ibm-plex-sans-arabic-500.woff2', weight: '500', style: 'normal' },
    { path: '../polices/ibm-plex-sans-arabic-600.woff2', weight: '600', style: 'normal' },
    { path: '../polices/ibm-plex-sans-arabic-700.woff2', weight: '700', style: 'normal' },
  ],
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
