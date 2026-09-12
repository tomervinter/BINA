// Shared insight-type labels, used by both the consolidated insights table and the customer profile page.
const TYPE_META = {
  churn: { label: 'סיכון נטישה', category: 'התראה' },
  decline: { label: 'ירידת מחזור', category: 'התראה' },
  dropoff: { label: 'הפסקת מוצר', category: 'התראה' },
  frequencyDecline: { label: 'ירידת תדירות', category: 'התראה' },
  anomaly: { label: 'חריגה לא צפויה', category: 'התראה' },
  monthlyProductBreak: { label: 'שבירת דפוס חודשי', category: 'התראה' },
  monthlyRevenueShift: { label: 'מגמת מחזור חודשית', category: 'התראה' },
  seasonalDecline: { label: 'ירידה עונתית/חג', category: 'התראה' },
  cumulativeYoyShift: { label: 'מגמת מחזור מצטברת שנתית', category: 'התראה' },
  varietyNarrowing: { label: 'צמצום מגוון רכישות', category: 'התראה' },
  decliningTrend: { label: 'מגמת קיטון', category: 'התראה' },
  quarterlyRevenueShift: { label: 'מגמת מחזור רבעונית', category: 'התראה' },
  holidayMomentumShift: { label: 'מומנטום בין חגים', category: 'התראה' },
  productQuantityShift: { label: 'שינוי בכמות מוצר', category: 'התראה' },
  productFrequencyYoyShift: { label: 'שינוי בתדירות מוצר', category: 'התראה' },
  productConcentrationRisk: { label: 'סיכון ריכוזיות מוצרים', category: 'התראה' },
  lookalike: { label: 'פוטנציאל צמיחה', category: 'הזדמנות' },
  upsell: { label: 'הזדמנות Upsell', category: 'הזדמנות' },
  productVarietyGap: { label: 'פער מגוון מוצרים', category: 'הזדמנות' },
  seasonalGrowth: { label: 'צמיחה עונתית/חג', category: 'הזדמנות' },
  substituteOpportunity: { label: 'הצעת מוצר תחליפי', category: 'הזדמנות' },
  hierarchyUpsell: { label: 'הזדמנות ממחלקת מוצר', category: 'הזדמנות' },
  standingOrderOpportunity: { label: 'הצעת הזמנה שוטפת', category: 'הזדמנות' },
  centralCustomerCrossSell: { label: 'הזדמנות בין-סניפית', category: 'הזדמנות' },
  marketingUnderperformance: { label: 'מוצר משווק שלא נמכר', category: 'הזדמנות' },
  upcomingEventReminder: { label: 'תזכורת לקראת אירוע', category: 'הזדמנות' },
  purchaseIrregularity: { label: 'קצב רכישה לא סדיר', category: 'הזדמנות' },
  newProductAdopted: { label: 'אימוץ מוצר חדש', category: 'הזדמנות' }
};
const SEV_LABEL = { high: 'גבוהה', medium: 'בינונית', low: 'נמוכה' };
const SEV_CLASS = { high: 'pill-red', medium: 'pill-orange', low: 'pill-gray' };
