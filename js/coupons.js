/* Owner-approved public rules. One coupon per order; no stacking.
   Fields: code, type ('percentage'|'fixed'|'shipping'), value (percent or integer cents),
   active, minSubtotalCents, expiresAt (ISO timestamp with timezone),
   productIds, categoryIds, combosOnly, maxDiscountCents, maxQuantity (per order).
   Client rules are estimates, not authoritative prices or global redemption limits.
   The business must confirm every discount in WhatsApp.
   DEV is intentionally absent from public rules. Only the explicit loopback
   development server authorizes its 100% merchandise test discount. Production
   and static previews have no activation flag in browser state. */
const PRESENCE_COUPONS = [
  { code: 'BEMVINDO5', type: 'percentage', value: 7, active: true, minSubtotalCents: 5000 },
  { code: 'PRESENCA10', type: 'percentage', value: 10, active: true, minSubtotalCents: 0, combosOnly: true },
  { code: 'FRETEGRATIS', type: 'shipping', active: true, minSubtotalCents: 0 }
];
if (typeof module === 'object' && module.exports) module.exports = PRESENCE_COUPONS;
