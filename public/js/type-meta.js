// Shared insight-type labels, used by both the consolidated insights table and the customer profile page.
// The engine only ever produces 2 insight types — one per formally agreed rule.
const TYPE_META = {
  salesPattern: { label: 'דפוס מכירות לקוח', category: 'תובנה 1' },
  purchasePattern: { label: 'דפוס רכישה של לקוח', category: 'תובנה 2' }
};
const SEV_LABEL = { high: 'גבוהה', medium: 'בינונית', low: 'נמוכה' };
const SEV_CLASS = { high: 'pill-red', medium: 'pill-orange', low: 'pill-gray' };
