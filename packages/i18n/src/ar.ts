/**
 * Dictionnaire français → arabe.
 *
 * ── Les sources, et pourquoi celles-là ────────────────────────────────────
 *
 * Arabe standard moderne, avec les termes TUNISIENS là où ils diffèrent de
 * ceux du Golfe — un caissier de Sfax ne lit pas « ضريبة القيمة المضافة »
 * sur ses déclarations, il lit « الأداء على القيمة المضافة ».
 *
 *  • Fiscalité : ministère des Finances (finances.gov.tn) et Code de la TVA
 *    en arabe — الأداء على القيمة المضافة (TVA), المعرف الجبائي (matricule
 *    fiscal), معلوم الطابع الجبائي (droit de timbre), رقم المعاملات (chiffre
 *    d'affaires), الحريف (le client, terme des textes tunisiens).
 *  • Caisse : glossaire de la CESAO (Nations unies) pour « نقطة بيع », et
 *    le vocabulaire des logiciels de caisse arabes en usage — الوردية
 *    (service de caisse), الدرج (tiroir), العجز / الفائض (écart).
 *  • Dates : ICU, locale ar-TN — mois tunisiens, chiffres occidentaux.
 *
 * ⚠ Les libellés FISCAUX imprimés ou affichés à un client restent à faire
 *   valider par un expert-comptable tunisien, comme en français.
 *
 * ── Le glossaire, pour rester cohérent ────────────────────────────────────
 *
 *   Encaisser  → تحصيل           Remboursement → استرداد
 *   Reçu       → إيصال           Remise / Réduction → تخفيض
 *   Commande   → طلب             Article       → منتج
 *   Carte      → قائمة الطعام    Catégorie     → فئة
 *   Options    → خيارات          Table / Salle → طاولة / القاعة
 *   Service de caisse → الوردية  Fond de caisse → رصيد الافتتاح
 *   Écart      → الفارق          Attendu / Compté → المتوقع / المعدود
 *   Gérant     → المدير          Caissier      → أمين الصندوق
 *   Serveur    → النادل          Administrateur → المشرف
 *   Fournisseur → المزوّد        Stock         → المخزون
 *   Client     → الحريف          Back-office   → لوحة الإدارة
 *
 * Chaque clé est la phrase française EXACTE passée à `t()`. Les `{marques}`
 * doivent être les mêmes des deux côtés — un test le vérifie.
 */
import { AR_BACKOFFICE } from './ar/backoffice.js'
import { AR_CAISSE } from './ar/caisse.js'

/**
 * Les dictionnaires de chaque application, réunis en un seul.
 *
 * Une même phrase française a UNE traduction : si la caisse et le
 * back-office disent tous deux « Encaissée », l'un ne peut pas la traduire
 * autrement que l'autre. `couverture.test.ts` le vérifie.
 */
export const AR: Readonly<Record<string, string>> = {
  ...AR_CAISSE,
  ...AR_BACKOFFICE,
}
