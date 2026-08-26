/**
 * Graine locale — le catalogue de démonstration EMPAQUETÉ dans l'APK.
 *
 * Pourquoi c'est nécessaire : au tout premier lancement, avant tout appairage
 * et tout pull, la base locale est vide. Sans graine, l'écran de caisse
 * afficherait une page blanche en mode avion — et le critère de sortie de la
 * Phase 0 ne serait pas tenu.
 *
 * Ces données sont le MIROIR EXACT de `supabase/migrations/0007_donnees_
 * demonstration.sql`. En Phase 1, elles seront remplacées par le catalogue
 * réel reçu au premier pull ; la graine ne sert plus qu'à la démonstration
 * et aux tests d'intégration.
 *
 * ⚠ Les taux de TVA sont des valeurs de DÉMONSTRATION, à valider par un
 *   expert-comptable tunisien avant toute mise en production.
 */

import type { AdaptateurSqlite } from './adaptateur.js'

export const DEMO_ORG = '01930000-0000-7000-8000-000000000001'
export const DEMO_RESTO = '01930000-0000-7000-8000-000000000002'
export const DEMO_DEVICE = '01930000-0000-7000-8000-000000000003'
export const DEMO_PREFIXE_TICKET = 'P1'

const TVA_19 = '01930000-0000-7000-8000-000000000010'
const TVA_13 = '01930000-0000-7000-8000-000000000011'
const TVA_07 = '01930000-0000-7000-8000-000000000012'
const CAT_PLATS = '01930000-0000-7000-8000-000000000020'
const CAT_SNACKS = '01930000-0000-7000-8000-000000000021'
const CAT_BOISSONS = '01930000-0000-7000-8000-000000000022'
const CAT_DESSERTS = '01930000-0000-7000-8000-000000000023'
const ST_CUISINE = '01930000-0000-7000-8000-000000000030'
const ST_BAR = '01930000-0000-7000-8000-000000000031'
const ZONE_SALLE = '01930000-0000-7000-8000-000000000040'
const ZONE_TERRASSE = '01930000-0000-7000-8000-000000000041'
const GRP_CUISSON = '01930000-0000-7000-8000-000000000050'
const GRP_SUPP = '01930000-0000-7000-8000-000000000051'

/** Prix en MILLIMES : 14500 = 14,500 TND. */
const PRODUITS: readonly [string, string, string, string, string, number, number][] = [
  ['0200', 'Pizza Margherita',      CAT_PLATS,    ST_CUISINE, TVA_19, 14500, 1],
  ['0201', 'Pizza Quatre Fromages', CAT_PLATS,    ST_CUISINE, TVA_19, 18500, 2],
  ['0202', 'Escalope panée frites', CAT_PLATS,    ST_CUISINE, TVA_19, 16000, 3],
  ['0203', 'Couscous poulet',       CAT_PLATS,    ST_CUISINE, TVA_19, 19000, 4],
  ['0204', 'Ojja merguez',          CAT_PLATS,    ST_CUISINE, TVA_19, 13500, 5],
  ['0210', 'Sandwich thon',         CAT_SNACKS,   ST_CUISINE, TVA_19,  8500, 1],
  ['0211', 'Chapati poulet',        CAT_SNACKS,   ST_CUISINE, TVA_19,  9500, 2],
  ['0212', 'Libanais viande',       CAT_SNACKS,   ST_CUISINE, TVA_19, 11000, 3],
  ['0213', 'Frites',                CAT_SNACKS,   ST_CUISINE, TVA_19,  4500, 4],
  ['0220', 'Eau minérale 50cl',     CAT_BOISSONS, ST_BAR,     TVA_07,  1500, 1],
  ['0221', 'Coca-Cola 33cl',        CAT_BOISSONS, ST_BAR,     TVA_07,  4200, 2],
  ['0222', 'Boga Cidre 33cl',       CAT_BOISSONS, ST_BAR,     TVA_07,  4200, 3],
  ['0223', 'Express',               CAT_BOISSONS, ST_BAR,     TVA_13,  2800, 4],
  ['0224', 'Capucin',               CAT_BOISSONS, ST_BAR,     TVA_13,  3200, 5],
  ['0225', 'Thé à la menthe',       CAT_BOISSONS, ST_BAR,     TVA_13,  2500, 6],
  ['0230', 'Tiramisu',              CAT_DESSERTS, ST_BAR,     TVA_13,  6500, 1],
  ['0231', 'Salade de fruits',      CAT_DESSERTS, ST_BAR,     TVA_13,  5500, 2],
]

const id = (suffixe: string) => `01930000-0000-7000-8000-00000000${suffixe}`

/** Employés de démonstration : suffixe, nom, rôle, code, hachage Argon2id du PIN. */
const EMPLOYES_DEMO: readonly (readonly [string, string, string, string, string])[] = [
  [
    '0700', 'Ahmed Ben Salah', 'gerant', 'AHM',
    'argon2id$m=8192,t=3,p=1$JTgeDj0ICNrg+OR4I8FMxQ==$F41EUhI2TK+yOduItfO2UL7wb5WNhsjnHO297/vrd0g=',
  ],
  [
    '0701', 'Salma Trabelsi', 'caissier', 'SAL',
    'argon2id$m=8192,t=3,p=1$mQR6YFgbGBRCFCWJEXArcg==$9EobXd52+moNNOoYrEAJhKUJ+Y3bxnIKD5+b+PjGe5k=',
  ],
  [
    '0702', 'Karim Jelassi', 'serveur', 'KAR',
    'argon2id$m=8192,t=3,p=1$dIPsUbsZBcAVKeCREBKJ5g==$S5nNIyyVxMxuTgOH7dGLYatgpqu0AvcLHN4GKiF2KME=',
  ],
]

/**
 * Installe la graine si — et seulement si — la base est vide.
 * Idempotent : rappeler cette fonction ne double jamais le catalogue.
 */
export async function installerGraine(db: AdaptateurSqlite): Promise<boolean> {
  const deja = await db.lireUne<{ n: number }>('SELECT COUNT(*) AS n FROM products')
  if ((deja?.n ?? 0) > 0) return false

  const maintenant = new Date().toISOString()

  await db.transaction(async () => {
    await db.executer(
      `INSERT INTO restaurants
         (id, organization_id, name, timezone, currency, currency_exponent,
          service_rate_bp, service_taxable, stamp_duty_millimes, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [DEMO_RESTO, DEMO_ORG, 'Snack Lac 1', 'Africa/Tunis', 'TND', 3, 0, 0, 0, maintenant],
    )

    // Taux TTC : le prix carte est celui que le client paie.
    for (const [tid, nom, bp, parDefaut] of [
      [TVA_19, 'TVA 19 %', 1900, 1],
      [TVA_13, 'TVA 13 %', 1300, 0],
      [TVA_07, 'TVA 7 %', 700, 0],
    ] as const) {
      await db.executer(
        `INSERT INTO tax_rates
           (id, organization_id, restaurant_id, name, rate_bp, is_included, is_default)
         VALUES (?, ?, ?, ?, ?, 1, ?)`,
        [tid, DEMO_ORG, DEMO_RESTO, nom, bp, parDefaut],
      )
    }

    for (const [sid, nom, hote, pos] of [
      [ST_CUISINE, 'Cuisine', '192.168.1.50', 1],
      [ST_BAR, 'Bar', '192.168.1.51', 2],
    ] as const) {
      await db.executer(
        `INSERT INTO stations
           (id, organization_id, restaurant_id, name, printer_host, printer_port, position)
         VALUES (?, ?, ?, ?, ?, 9100, ?)`,
        [sid, DEMO_ORG, DEMO_RESTO, nom, hote, pos],
      )
    }

    for (const [cid, nom, pos, couleur] of [
      [CAT_PLATS, 'Plats', 1, '#C2410C'],
      [CAT_SNACKS, 'Snacks', 2, '#B45309'],
      [CAT_BOISSONS, 'Boissons', 3, '#0E7490'],
      [CAT_DESSERTS, 'Desserts', 4, '#9333EA'],
    ] as const) {
      await db.executer(
        `INSERT INTO categories
           (id, organization_id, restaurant_id, name, position, color)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [cid, DEMO_ORG, DEMO_RESTO, nom, pos, couleur],
      )
    }

    for (const [suffixe, nom, categorie, station, taxe, prix, pos] of PRODUITS) {
      await db.executer(
        `INSERT INTO products
           (id, organization_id, restaurant_id, category_id, station_id,
            tax_rate_id, name, base_price_millimes, position, is_available, track_stock)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0)`,
        [id(suffixe), DEMO_ORG, DEMO_RESTO, categorie, station, taxe, nom, prix, pos],
      )
    }

    for (const [suffixe, produit, nom, delta, pos] of [
      ['0300', id('0200'), 'Moyenne', 0, 1],
      ['0301', id('0200'), 'Grande', 5000, 2],
      // Delta NÉGATIF : une petite portion coûte moins cher que la référence.
      ['0302', id('0213'), 'Petite', -1500, 1],
      ['0303', id('0213'), 'Normale', 0, 2],
    ] as const) {
      await db.executer(
        `INSERT INTO product_variants
           (id, organization_id, restaurant_id, product_id, name,
            price_delta_millimes, position, is_available)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
        [id(suffixe), DEMO_ORG, DEMO_RESTO, produit, nom, delta, pos],
      )
    }

    for (const [gid, nom, min, max, requis, pos] of [
      [GRP_CUISSON, 'Cuisson', 1, 1, 1, 1],
      [GRP_SUPP, 'Suppléments', 0, 5, 0, 2],
    ] as const) {
      await db.executer(
        `INSERT INTO modifier_groups
           (id, organization_id, restaurant_id, name, min_select, max_select,
            is_required, position)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [gid, DEMO_ORG, DEMO_RESTO, nom, min, max, requis, pos],
      )
    }

    for (const [suffixe, groupe, nom, delta, pos] of [
      ['0400', GRP_CUISSON, 'Saignant', 0, 1],
      ['0401', GRP_CUISSON, 'À point', 0, 2],
      ['0402', GRP_CUISSON, 'Bien cuit', 0, 3],
      ['0410', GRP_SUPP, 'Fromage', 1500, 1],
      ['0411', GRP_SUPP, 'Œuf', 1000, 2],
      ['0412', GRP_SUPP, 'Harissa', 500, 3],
      ['0413', GRP_SUPP, 'Sans oignon', 0, 4],
    ] as const) {
      await db.executer(
        `INSERT INTO modifiers
           (id, organization_id, restaurant_id, modifier_group_id, name,
            price_delta_millimes, position, is_available)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
        [id(suffixe), DEMO_ORG, DEMO_RESTO, groupe, nom, delta, pos],
      )
    }

    for (const [produit, groupe] of [
      [id('0200'), GRP_SUPP],
      [id('0201'), GRP_SUPP],
      [id('0202'), GRP_CUISSON],
      [id('0210'), GRP_SUPP],
      [id('0211'), GRP_SUPP],
      [id('0212'), GRP_SUPP],
    ] as const) {
      await db.executer(
        `INSERT INTO product_modifiers
           (product_id, modifier_group_id, restaurant_id, position)
         VALUES (?, ?, ?, 1)`,
        [produit, groupe, DEMO_RESTO],
      )
    }

    for (const [zid, nom, pos] of [
      [ZONE_SALLE, 'Salle', 1],
      [ZONE_TERRASSE, 'Terrasse', 2],
    ] as const) {
      await db.executer(
        `INSERT INTO areas (id, organization_id, restaurant_id, name, position)
         VALUES (?, ?, ?, ?, ?)`,
        [zid, DEMO_ORG, DEMO_RESTO, nom, pos],
      )
    }

    for (let n = 1; n <= 12; n += 1) {
      await db.executer(
        `INSERT INTO tables
           (id, organization_id, restaurant_id, area_id, label, seats)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          id(`01${String(n).padStart(2, '0')}`),
          DEMO_ORG,
          DEMO_RESTO,
          n <= 8 ? ZONE_SALLE : ZONE_TERRASSE,
          String(n),
          n % 3 === 0 ? 4 : 2,
        ],
      )
    }

    for (const [suffixe, nom, type, tiroir, pos] of [
      ['0500', 'Espèces', 'cash', 1, 1],
      ['0501', 'Carte bancaire', 'card', 0, 2],
      ['0502', 'Chèque resto', 'other', 0, 3],
    ] as const) {
      await db.executer(
        `INSERT INTO payment_methods
           (id, organization_id, restaurant_id, name, type, opens_drawer, position, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
        [id(suffixe), DEMO_ORG, DEMO_RESTO, nom, type, tiroir, pos],
      )
    }

    // ── Employés de démonstration ─────────────────────────────────────────
    // Les hachages sont PRÉCALCULÉS et embarqués : hacher trois PIN avec
    // Argon2id coûterait une bonne seconde au premier lancement sur une
    // tablette d'entrée de gamme, pour rien. En production les hachages
    // arrivent déjà faits par la synchronisation ; l'appareil ne les calcule
    // jamais lui-même.
    //
    // PIN de démonstration — à changer avant toute mise en service réelle :
    //   Ahmed  1357  gérant     Salma  2468  caissier     Karim  9753  serveur
    for (const [suffixe, nom, role, code, hachage] of EMPLOYES_DEMO) {
      await db.executer(
        `INSERT INTO employees
           (id, organization_id, restaurant_id, full_name, role, pin_hash,
            permissions, code, is_active)
         VALUES (?, ?, ?, ?, ?, ?, '{}', ?, 1)`,
        [id(suffixe), DEMO_ORG, DEMO_RESTO, nom, role, hachage, code],
      )
    }

    // Identité locale de l'appareil de démonstration.
    for (const [cle, valeur] of [
      ['device_id', DEMO_DEVICE],
      ['restaurant_id', DEMO_RESTO],
      ['organization_id', DEMO_ORG],
      ['ticket_prefix', DEMO_PREFIXE_TICKET],
    ] as const) {
      await db.executer('UPDATE sync_state SET valeur = ? WHERE cle = ?', [valeur, cle])
    }
  })

  return true
}
