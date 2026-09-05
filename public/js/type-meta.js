// Shared insight-type labels, used by both the consolidated insights table and the customer profile page.
const TYPE_META = {
  churn: { label: 'סיכון נטישה', category: 'התראה' },
  decline: { label: 'ירידת מחזור', category: 'התראה' },
  dropoff: { label: 'הפסקת מוצר', category: 'התראה' },
  frequencyDecline: { label: 'ירידת תדירות', category: 'התראה' },
  anomaly: { label: 'חריגה לא צפויה', category: 'התראה' },
  weeklyProductBreak: { label: 'שבירת דפוס שבועי', category: 'התראה' },
  monthlyDeclineDetail: { label: 'ירידה חודשית מפורטת', category: 'התראה' },
  seasonalDecline: { label: 'ירידה עונתית/חג', category: 'התראה' },
  lookalike: { label: 'פוטנציאל צמיחה', category: 'הזדמנות' },
  upsell: { label: 'הזדמנות Upsell', category: 'הזדמנות' },
  productVarietyGap: { label: 'פער מגוון מוצרים', category: 'הזדמנות' },
  seasonalGrowth: { label: 'צמיחה עונתית/חג', category: 'הזדמנות' }
};
const SEV_LABEL = { high: 'גבוהה', medium: 'בינונית', low: 'נמוכה' };
const SEV_CLASS = { high: 'pill-red', medium: 'pill-orange', low: 'pill-gray' };
