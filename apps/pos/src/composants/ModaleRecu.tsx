/**
 * Un reçu, ouvert — et son remboursement.
 *
 * Le ticket montré ici est EXACTEMENT celui que l'imprimante sortirait : la
 * même charge ESC/POS, relue à l'écran. Après un remboursement, il porte les
 * lignes « Remboursé » et le net encaissé : un ticket réédité ne doit jamais
 * affirmer encaissée une somme qui ne l'est plus.
 *
 * ── Ce que l'écran ne fait PAS ────────────────────────────────────────────
 *
 * Il ne calcule aucun montant. Ce qu'une ligne a coûté au client — sa part
 * de remise, de service, de TVA — vient de `partsRemboursables` et
 * `calculerRemboursement`, dans `@kaissi/domain`. C'est la RÈGLE 7 : une
 * seule source pour un chiffre qui finit dans un tiroir-caisse.
 */

import { useEffect, useMemo, useState } from 'react'
import {
  calculerRemboursement,
  calculerTotaux,
  configEffective,
  construireTicketClient,
  formaterTND,
  partsRemboursables,
  resteRemboursable,
  totalRembourse,
  type Employe,
  type EtatCommande,
  type ModePaiement,
} from '@kaissi/domain'
import { rendreTicketClient } from '@kaissi/printing'
import { useApp } from '../etat/contexte.js'
import { RefusOperation } from '../donnees/session.js'
import { DemandePin } from './DemandePin.js'
import { Modale } from './Modale.js'
import { TicketEcran } from './TicketEcran.js'
import { libellePaiement, t, tm } from '../i18n.js'

/**
 * Les motifs qu'on entend au comptoir — un toucher au lieu d'une phrase à taper.
 *
 * Ils sont ÉCRITS en français dans le journal, quelle que soit la langue de
 * la caisse : le journal est une donnée, et le back-office les traduit à
 * l'affichage. Seul le bouton parle la langue du caissier.
 */
const MOTIFS_COURANTS = [
  'Plat non conforme',
  'Erreur d’encaissement',
  'Client mécontent',
  'Article indisponible',
] as const

interface Props {
  readonly orderId: string
  readonly onFermer: () => void
}

export function ModaleRecu({ orderId, onFermer }: Props) {
  const {
    session,
    config,
    etablissement,
    piedDePage,
    methodesPaiement,
    tables,
    employes,
    employe,
    rafraichir,
  } = useApp()
  const [etat, setEtat] = useState<EtatCommande | null>(null)
  const [mode, setMode] = useState<'ticket' | 'remboursement'>('ticket')
  const [choisies, setChoisies] = useState<Set<string>>(new Set())
  const [modeRendu, setModeRendu] = useState<ModePaiement>('cash')
  const [motif, setMotif] = useState('')
  const [erreur, setErreur] = useState<string | null>(null)
  const [enCours, setEnCours] = useState(false)
  const [escalade, setEscalade] = useState<string | null>(null)

  useEffect(() => {
    let vivant = true
    void session.etatDe(orderId).then((e) => {
      if (!vivant) return
      setEtat(e)
      const premier = e.paiements.find((p) => !p.annule)
      if (premier) setModeRendu(premier.mode)
    })
    return () => {
      vivant = false
    }
  }, [session, orderId])

  const totaux = useMemo(
    () =>
      etat
        ? calculerTotaux({
            lignes: etat.lignes,
            remiseGlobale: etat.remiseGlobale ?? undefined,
            config: configEffective(config, etat),
          })
        : null,
    [etat, config],
  )

  const charge = useMemo(() => {
    if (!etat || !totaux) return null
    const ticket = construireTicketClient(etat, totaux, {
      etablissement,
      employe: employes.find((e) => e.id === etat.closePar)?.nom ?? null,
      libelleTable: tables.find((elt) => elt.id === etat.tableId)?.label ?? null,
      numeroFiscal: null,
      libellesPaiement: Object.fromEntries(methodesPaiement.map((m) => [m.id, m.nom])),
      ...(piedDePage.length > 0 ? { piedDePage } : {}),
    })
    return rendreTicketClient(ticket)
  }, [etat, totaux, etablissement, employes, tables, methodesPaiement, piedDePage])

  const parts = useMemo(
    () => (etat && totaux && etat.statut === 'close' ? partsRemboursables(etat, totaux) : []),
    [etat, totaux],
  )

  // Le montant de la sélection, calculé par le domaine. Une sélection vide
  // n'est pas une erreur à afficher : c'est un formulaire pas encore rempli.
  const calcul = useMemo(() => {
    if (!etat || !totaux || choisies.size === 0) return null
    try {
      return calculerRemboursement(etat, totaux, [...choisies])
    } catch {
      return null
    }
  }, [etat, totaux, choisies])

  // Les modes proposés sont ceux du ticket : on rend comme on a encaissé.
  const modes = useMemo(
    () => [...new Set((etat?.paiements ?? []).filter((p) => !p.annule).map((p) => p.mode))],
    [etat],
  )

  if (!etat || !totaux || !charge) {
    return (
      <Modale titre={t('Reçu')} onFermer={onFermer}>
        <p className="aide">{t('Lecture du ticket…')}</p>
      </Modale>
    )
  }

  const reste = resteRemboursable(etat, totaux)
  const deja = totalRembourse(etat)
  const remboursable = etat.statut === 'close' && reste > 0 && parts.some((p) => !p.dejaRemboursee)

  const basculer = (id: string) =>
    setChoisies((actuel) => {
      const suivant = new Set(actuel)
      if (suivant.has(id)) suivant.delete(id)
      else suivant.add(id)
      return suivant
    })

  const confirmer = async (manager?: Employe) => {
    setErreur(null)
    setEnCours(true)
    try {
      const apres = await session.rembourser(
        employe,
        orderId,
        { ligneIds: [...choisies], mode: modeRendu, motif },
        manager,
      )
      setEtat(apres)
      setChoisies(new Set())
      setMotif('')
      setMode('ticket')
      rafraichir()
    } catch (e) {
      if (e instanceof RefusOperation && e.escaladePossible) {
        setEscalade(e.message)
        return
      }
      setErreur(e instanceof Error ? tm(e.message) : String(e))
    } finally {
      setEnCours(false)
    }
  }

  if (escalade) {
    return (
      <DemandePin
        titre={t('Autorisation requise')}
        // Le refus du domaine nomme la permission technique : utile au
        // journal, illisible au comptoir. On dit ce qui est attendu.
        sousTitre={t('Un remboursement doit être autorisé par un gérant. Il pose son code ; son nom restera dans le journal.')}
        candidats={employes.filter((e) => e.role === 'gerant' || e.role === 'admin')}
        onAnnuler={() => setEscalade(null)}
        onValide={(manager) => {
          setEscalade(null)
          void confirmer(manager)
        }}
      />
    )
  }

  if (mode === 'remboursement') {
    return (
      <Modale
        titre={t('Rembourser — {numero}', { numero: etat.numeroTicket ?? t('ticket') })}
        sousTitre={t('Choisissez ce que le client rend. Le montant est calculé avec sa part de remise et de TVA.')}
        onFermer={() => setMode('ticket')}
        large
        pied={
          <button
            type="button"
            className="principal"
            disabled={enCours || !calcul || motif.trim() === ''}
            onClick={() => void confirmer()}
          >
            {enCours
              ? t('Enregistrement…')
              : calcul
                ? t('Rendre {montant}', { montant: formaterTND(calcul.montantMillimes) })
                : t('Rembourser')}
          </button>
        }
      >
        <ul className="lignes-remboursables">
          {parts.map((p) => (
            <li key={p.ligneId} className={p.dejaRemboursee ? 'deja' : ''}>
              <label>
                <input
                  type="checkbox"
                  checked={choisies.has(p.ligneId)}
                  disabled={p.dejaRemboursee}
                  onChange={() => basculer(p.ligneId)}
                />
                <span className="designation">
                  {p.quantite} × {p.designation}
                </span>
                <span className="montant">
                  {p.dejaRemboursee ? t('déjà remboursé') : formaterTND(p.montantMillimes)}
                </span>
              </label>
            </li>
          ))}
        </ul>
        <button
          type="button"
          className="lien tout-le-ticket"
          onClick={() =>
            setChoisies(new Set(parts.filter((p) => !p.dejaRemboursee).map((p) => p.ligneId)))
          }
        >{t('Tout le ticket')}</button>

        {calcul && calcul.timbreMillimes > 0 && (
          <p className="aide">
            {t(
              'Le droit de timbre ({montant}) est rendu avec la dernière ligne : le ticket est alors entièrement remboursé.',
              { montant: formaterTND(calcul.timbreMillimes) },
            )}
          </p>
        )}

        {modes.length > 1 && (
          <>
            <label>{t('Rendu en')}</label>
            <div className="options">
              {modes.map((m) => (
                <button
                  key={m}
                  type="button"
                  className={modeRendu === m ? 'actif' : ''}
                  aria-pressed={modeRendu === m}
                  onClick={() => setModeRendu(m)}
                >
                  {libellePaiement(m)}
                </button>
              ))}
            </div>
          </>
        )}
        {modeRendu === 'card' && (
          <p className="aide">{t('Un remboursement sur carte se fait sur le terminal de la banque. Kaissi l’enregistre ; le tiroir n’est pas concerné.')}</p>
        )}

        <label htmlFor="remb-motif">{t('Motif')}</label>
        <div className="options">
          {MOTIFS_COURANTS.map((m) => (
            <button
              key={m}
              type="button"
              className={motif === m ? 'actif' : ''}
              aria-pressed={motif === m}
              onClick={() => setMotif(m)}
            >
              {t(m)}
            </button>
          ))}
        </div>
        <input
          id="remb-motif"
          type="text"
          // Un motif RAPIDE est gardé en français (il part au journal), mais
          // il s'affiche dans la langue de la caisse.
          value={(MOTIFS_COURANTS as readonly string[]).includes(motif) ? t(motif) : motif}
          maxLength={200}
          placeholder={t('Ou écrivez le motif')}
          onChange={(e) => setMotif(e.target.value)}
        />

        {erreur && <p className="erreur">{erreur}</p>}
      </Modale>
    )
  }

  return (
    <Modale
      titre={t('Reçu {numero}', { numero: etat.numeroTicket ?? '' }).trim()}
      sousTitre={
        deja > 0
          ? t('Déjà remboursé : {deja} — reste {reste}', { deja: formaterTND(deja), reste: formaterTND(reste) })
          : undefined
      }
      onFermer={onFermer}
      pied={
        remboursable ? (
          <button
            type="button"
            className="secondaire"
            onClick={() => {
              setErreur(null)
              setMode('remboursement')
            }}
          >{t('Rembourser…')}</button>
        ) : undefined
      }
    >
      <TicketEcran charge={charge} />
      {etat.statut === 'annulee' && (
        <p className="aide">{t('Commande annulée : il n’y a rien à rembourser.')}</p>
      )}
      {etat.exceptions.some((e) => e.type === 'double_remboursement') && (
        <p className="erreur">{t('Une même ligne a été remboursée deux fois, sans doute par deux caisses hors ligne. Le gérant doit vérifier les deux tiroirs.')}</p>
      )}
    </Modale>
  )
}
