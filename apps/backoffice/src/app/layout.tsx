import type { ReactNode } from 'react'

export const metadata = {
  title: 'Kaissi — Back-office',
  description: 'Administration et rapports — Res2Boost',
}

export default function RacineLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <body
        style={{
          margin: 0,
          fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
          background: '#0f1214',
          color: '#eceeea',
        }}
      >
        {children}
      </body>
    </html>
  )
}
