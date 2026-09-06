// Canonical Hebrew column headers per uploadable entity — shared by the upload routes'
// parsing, the template-download endpoint, and data export.
module.exports = {
  customers: ['מספר לקוח', 'שם לקוח', 'סיווג ראשי לקוח', 'סוג לקוח', 'עיר', 'שם לקוח מרכז', 'סטטוס לקוח'],
  products: ['קוד פריט', 'שם פריט', 'טיפוס', 'טיפוס על', 'מחלקה', 'יחידת מידה למוצר', 'סטטוס מוצר', 'לעיתוד', 'לשיווק'],
  sales: ['מספר לקוח', 'שם לקוח', 'קוד פריט', 'שם פריט', 'שנה', 'חודש', 'מכר כספי', 'מכר כמותי', 'משקל'],
  inventory: ['מק"ט', 'שם מוצר', 'תאריך', 'מלאי']
};
