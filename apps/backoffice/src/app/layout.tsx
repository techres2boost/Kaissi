import type { ReactNode } from 'react'
import './styles.css'

export const metadata = {
  title: 'Kaissi — Back-office',
  description: 'Administration et rapports — Res2Boost',
}

export default function RacineLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  )
}
