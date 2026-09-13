/**
 * Les rares chemins qui s'ouvrent SANS session.
 *
 * ── Pourquoi cette liste existe ───────────────────────────────────────────
 *
 * Le middleware redirige tout le reste vers `/connexion`, et c'est la bonne
 * politique par défaut : un back-office n'a rien de public. Mais deux pages
 * doivent être atteignables par quelqu'un qui n'a pas de compte — et l'une
 * d'elles est une EXIGENCE de publication.
 *
 * Google Play refuse une fiche dont l'URL de politique de confidentialité ne
 * répond pas. Il la teste, automatiquement, sans être connecté : servie
 * derrière l'authentification, elle rendrait une page de connexion, et la
 * fiche serait rejetée pour « politique injoignable » — un motif de refus
 * fréquent, et particulièrement agaçant parce que la page existe bel et bien.
 *
 * L'App Store exige EN PLUS une « Support URL », et un relecteur humain la
 * visite pendant la revue. Même piège, même remède.
 *
 * ── Pourquoi une LISTE, et pas un test dans le middleware ─────────────────
 *
 * Pour qu'elle soit énumérable. Une condition écrite en ligne dans le
 * middleware se relit mal et se teste encore moins bien ; ici, `publiques.test.ts`
 * vérifie que la liste contient ce qu'il faut et rien de plus. Ouvrir une page
 * au public est une décision, elle doit se voir.
 */

/** Les préfixes ouverts. Le reste du back-office exige une session. */
export const CHEMINS_PUBLICS = [
  '/connexion',
  // Exigée par Google Play et l'App Store, et testée par eux sans session.
  '/confidentialite',
  // Exigée par l'App Store (« Support URL »), visitée par le relecteur.
  '/support',
] as const

/**
 * Ce chemin s'ouvre-t-il sans session ?
 *
 * Comparaison par PRÉFIXE DE SEGMENT, et non `startsWith` brut : ce dernier
 * ouvrirait `/confidentialite-interne` ou `/connexions-des-appareils` du seul
 * fait qu'ils commencent par les mêmes lettres. Une page privée ne doit pas
 * devenir publique parce que quelqu'un a choisi un nom qui ressemble.
 */
export function estPublique(chemin: string): boolean {
  return CHEMINS_PUBLICS.some((p) => chemin === p || chemin.startsWith(`${p}/`))
}
