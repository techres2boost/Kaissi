/**
 * La CARTE, tenue depuis la caisse — sans ouvrir le back-office.
 *
 * ── Ce que cet écran ouvre, et ce qu'il laisse fermé ──────────────────────
 *
 * Il CRÉE : un article, une catégorie, une réduction, un groupe de
 * modificateurs. Il ne MODIFIE rien, et ce n'est pas un manque : deux caisses
 * hors ligne qui créent produisent deux lignes distinctes, au pire deux fois
 * le même nom que le back-office fusionne — un désagrément. Deux caisses qui
 * MODIFIENT la même ligne exigeraient le dernier-écrivain-gagne arbitré par
 * `(server_seq, device_id)`, et on ne l'ajoute pas « en passant ». Renommer,
 * changer un prix, archiver : back-office, et cela redescend par
 * `change_log`.
 *
 * ── Pourquoi un écran, alors que la tuile « + Nouvel article » existe ─────
 *
 * Parce que la tuile vit DANS une commande : elle sert à vendre tout de suite
 * ce qu'on vient d'inventer. Tenir sa carte est un autre geste, qu'on fait
 * avant le service, et qui n'a aucune raison d'exiger une commande ouverte.
 *
 * ── La garde de rôle, et ce qu'elle vaut ──────────────────────────────────
 *
 * Réservé au gérant et à l'administrateur. Un serveur ne voit pas l'entrée du
 * tiroir, et cet écran le refuse s'il y arrive quand même — mais ce n'est PAS
 * ce qui protège : le serveur de synchronisation relit le rôle EN BASE et
 * rejette la mutation (`droits_insuffisants`). Masquer évite une erreur, pas
 * une malveillance.
 */

import { useCallback, useEffect, useState } from 'react'
import { ListPlus, Percent, SlidersHorizontal, Tag } from 'lucide-react'
import { peutModifierCatalogue, type Employe } from '@kaissi/domain'
import type { CategorieLocale, ProduitLocal } from '@kaissi/db-local'
import { useApp } from '../etat/contexte.js'
import { ModaleNouvelArticle } from '../composants/ModaleNouvelArticle.js'
import { ModaleNouvelleCategorie } from '../composants/ModaleNouvelleCategorie.js'
import { ModaleNouvelleReduction } from '../composants/ModaleNouvelleReduction.js'
import { ModaleNouveauModificateur } from '../composants/ModaleNouveauModificateur.js'

type Quoi = 'article' | 'categorie' | 'reduction' | 'modificateur'

export function EcranCarte({ employe }: { readonly employe: Employe | null }) {
  const { app } = useApp()
  const [categories, setCategories] = useState<CategorieLocale[]>([])
  const [produits, setProduits] = useState<ProduitLocal[]>([])
  const [reductions, setReductions] = useState<{ id: string; nom: string }[]>([])
  const [groupes, setGroupes] = useState<{ id: string; nom: string }[]>([])
  const [ouvert, setOuvert] = useState<Quoi | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const recharger = useCallback(async () => {
    const [cats, prods, reds, grps] = await Promise.all([
      app.catalogue.categories(),
      app.catalogue.produits(),
      app.catalogue.reductions(),
      app.catalogue.groupesModificateurs(),
    ])
    setCategories([...cats])
    setProduits([...prods])
    setReductions(reds.map((r) => ({ id: r.id, nom: r.nom })))
    setGroupes([...grps])
  }, [app])

  useEffect(() => {
    void recharger()
  }, [recharger])

  if (!employe || !peutModifierCatalogue(employe.role)) {
    return (
      <section className="carte-action">
        <h1>Carte</h1>
        <p>
          Tenir la carte demande le rôle <strong>gérant</strong> ou{' '}
          <strong>administrateur</strong>. Demande à un responsable de se
          déverrouiller sur ce terminal.
        </p>
      </section>
    )
  }

  const apresCreation = async (quoi: string) => {
    setMessage(`${quoi} — créé. Il part au bureau à la prochaine synchronisation.`)
    await recharger()
  }

  const entrees: { cle: Quoi; libelle: string; detail: string; icone: typeof Tag }[] = [
    {
      cle: 'article',
      libelle: 'Nouvel article',
      detail: `${produits.length} article(s) · vendable aussitôt, même hors ligne`,
      icone: ListPlus,
    },
    {
      cle: 'categorie',
      libelle: 'Nouvelle catégorie',
      detail: `${categories.length} catégorie(s) · son poste décide où sort le bon`,
      icone: Tag,
    },
    {
      cle: 'reduction',
      libelle: 'Nouvelle réduction',
      detail: `${reductions.length} réduction(s) · proposée au moment de la remise`,
      icone: Percent,
    },
    {
      cle: 'modificateur',
      libelle: 'Nouveau groupe d’options',
      detail: `${groupes.length} groupe(s) · cuisson, suppléments`,
      icone: SlidersHorizontal,
    },
  ]

  return (
    <section className="ecran-carte">
      <header>
        <h1>Carte</h1>
        <p className="aide">
          Ce qu’on ajoute ici se vend <strong>tout de suite</strong>, même sans
          réseau, et remonte au bureau à la prochaine synchronisation. Pour{' '}
          <strong>modifier</strong> ou retirer quelque chose, c’est le
          back-office : la caisse propose, le bureau décide.
        </p>
      </header>

      {message && (
        <p className="message succes" role="status">
          {message}
        </p>
      )}

      <div className="options grand">
        {entrees.map((e) => {
          const Icone = e.icone
          return (
            <button
              key={e.cle}
              type="button"
              onClick={() => {
                setMessage(null)
                setOuvert(e.cle)
              }}
            >
              <span className="nom-reduction">
                <Icone size={16} strokeWidth={2} aria-hidden="true" /> {e.libelle}
              </span>
              <span className="detail">{e.detail}</span>
            </button>
          )
        })}
      </div>

      {ouvert === 'article' && (
        <ModaleNouvelArticle
          employe={employe}
          categories={categories}
          categorieActive={null}
          onFerme={() => setOuvert(null)}
          onCree={(nom) => apresCreation(nom)}
        />
      )}
      {ouvert === 'categorie' && (
        <ModaleNouvelleCategorie
          employe={employe}
          onFerme={() => setOuvert(null)}
          onCree={(nom) => apresCreation(nom)}
        />
      )}
      {ouvert === 'reduction' && (
        <ModaleNouvelleReduction
          employe={employe}
          onFerme={() => setOuvert(null)}
          onCree={(nom) => apresCreation(nom)}
        />
      )}
      {ouvert === 'modificateur' && (
        <ModaleNouveauModificateur
          employe={employe}
          produits={produits}
          onFerme={() => setOuvert(null)}
          onCree={(nom) => apresCreation(nom)}
        />
      )}
    </section>
  )
}
