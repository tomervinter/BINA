// Shared insight-type labels, used by both the consolidated insights table and the customer profile page.
// Covers only the currently-active rules: Rule 1 (customer sales pattern) and Rule 2
// (customer purchase pattern) — every other previously-explored rule type was removed.
const TYPE_META = {
  monthlyRevenueShift: { label: 'מגמת מחזור חודשית', category: 'התראה' },
  seasonalDecline: { label: 'ירידה עונתית/חג', category: 'התראה' },
  cumulativeYoyShift: { label: 'מגמת מחזור מצטברת שנתית', category: 'התראה' },
  quarterlyRevenueShift: { label: 'מגמת מחזור רבעונית', category: 'התראה' },
  holidayMomentumShift: { label: 'מומנטום בין חגים', category: 'התראה' },
  productQuantityShift: { label: 'שינוי בכמות מוצר', category: 'התראה' },
  productFrequencyYoyShift: { label: 'שינוי בתדירות מוצר', category: 'התראה' },
  productConcentrationRisk: { label: 'סיכון ריכוזיות מוצרים', category: 'התראה' },
  seasonalGrowth: { label: 'צמיחה עונתית/חג', category: 'הזדמנות' },
  purchaseIrregularity: { label: 'קצב רכישה לא סדיר', category: 'הזדמנות' },
  newProductAdopted: { label: 'אימוץ מוצר חדש', category: 'הזדמנות' }
};
const SEV_LABEL = { high: 'גבוהה', medium: 'בינונית', low: 'נמוכה' };
const SEV_CLASS = { high: 'pill-red', medium: 'pill-orange', low: 'pill-gray' };
