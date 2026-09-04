/**
 * Migration locale 005 — le poste de préparation suit la CATÉGORIE.
 *
 * Depuis la migration Postgres 0025, `categories.station_id` est la source de
 * vérité : les boissons vont au bar, les plats à la cuisine, et un produit
 * ajouté demain dans « Boissons » en hérite sans que personne y pense.
 *
 * Le poste portait cette information sur le PRODUIT. En pratique, un gérant
 * qui crée « Mojito » devait se souvenir de le rattacher au bar — et il
 * l'oubliait, parce que l'information est déjà dans la catégorie. Une ligne
 * sans poste n'apparaît sur AUCUN écran de préparation, et cela ne se voit
 * qu'en plein service.
 *
 * `products.station_id` reste : la règle des migrations additives l'impose
 * tant que le protocole supporte N−2, et une tablette restée en version 4
 * continue de l'écrire. Elle devient un REPLI — la résolution est
 * « catégorie d'abord, produit ensuite », dans le même ordre que côté
 * serveur.
 *
 * ADDITIVE : une tablette en version 4 ignore la colonne et se comporte
 * exactement comme avant.
 */

export const SQL_005 = `
ALTER TABLE categories ADD COLUMN station_id TEXT;
`
