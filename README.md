# Presence Papelaria

Storefront in HTML/CSS/JavaScript with catalog and hash-based product detail pages.

Current sales are WhatsApp-assisted only. Customers review products/cart/coupons and explicitly send an inquiry in WhatsApp; the store confirms availability, shipping, final price and payment instructions there. `checkout.html` prepares that message and never submits an order. Public order creation and payment initiation are disabled regardless of provider credentials. Existing SQLite/admin/tracking modules and records are preserved; tracking only works for an actual registered order supplied by staff. See [docs/phase1.md](docs/phase1.md) for the current policy and limitations. Older integration documentation is historical, not an activation plan for this phase.

Run `npm ci`, then `npm run test:server` and `npm test`. For configured local work, copy `.env.example` to `.env`, generate the administrator hash/access secret as documented, and run `node --env-file=.env scripts/serve.cjs --dev`. The plain `npm start` command does not load `.env`. Opening HTML as a file supports only the static storefront, not the checkout APIs.

- `index.html`: page markup and navigation.
- `css/styles.css`: responsive layout and light/dark theme tokens.
- `js/theme.js`: early theme restoration and accessible theme toggle.
- `js/catalog.js`: shared product catalog, categories and owner contact configuration.
- `js/app.js`: filters, favorites, product details and WhatsApp links.

Open `index.html` directly or run `npm start` for a local preview at
`http://localhost:8010` (or `http://127.0.0.1:8010`). `npm start` / `npm run dev`
explicitly enables the loopback-only DEV coupon validation endpoint. Stop any old
preview server first and restart it after updating the server/catalog files.
`npm run preview` serves the static production-style version with DEV disabled.
The server now includes the commerce APIs described in docs/checkout.md; the older cart shipping adapter remains disabled.
Light mode is the default, regardless of device settings. The navigation's moon/sun
button saves the selected mode under `presence:theme` in localStorage. When storage
is blocked, switching still works for the current page. Reduced-motion preferences
disable theme transitions. Product illustrations retain their original brand colors.

Run `npm install` and `npm test` to check themes at 1440px, 390px and 320px using
an installed Google Chrome. Tests cover persistence, keyboard activation, navigation,
filters, favorites, product details, personalization and unavailable storage.
Screenshots are saved to `test-results/`.

The editorial refinement is in `css/refinements.css`; `js/motion.js` adds one-shot
scroll entrances and keeps the floating WhatsApp contact clear of nearby controls.
Animations use CSS and IntersectionObserver, with a reduced-motion fallback.
No official photography was supplied: the hero is a clearly labeled typographic
paper composition and catalog tiles are temporary typography, not product photos.
Add genuine photo URLs to each product's `img` or `images` fields in `js/catalog.js`;
the catalog and detail gallery will use them automatically. Replace the `.herovis`
figure contents with an official campaign image when available.

The shopping cart uses `js/commerce.js` for pure integer-cent calculations and
`js/cart.js` for the native dialog, storage and checkout. `css/cart.css` provides
the shared rounded controls and both drawer themes. Catalog/contact configuration
remains in `js/catalog.js`; no product price is duplicated. The versioned
`presence:cart:v1` key stores product IDs, quantities, selected options and the
coupon code. A previous price snapshot is used only to warn about changes; every
price is recalculated from the current catalog. Invalid, unavailable or unpriced
lines are removed with a notice. Quantity is limited to 1–99 per configuration,
with at most 100 distinct lines. Themes and favorites use independent keys.

Coupon rules belong in `js/coupons.js`. Owner-approved public codes are
`BEMVINDO5` (7% merchandise discount, eligible subtotal at least R$50),
`PRESENCA10` (10% only on explicit combos, no minimum) and `FRETEGRATIS` (selected quoted shipping only).
Only one code applies per order. `DEV` is available only through `npm start` /
`npm run dev` on loopback, validated by the local server. Add priced products,
open the cart and apply `DEV`: merchandise becomes zero; shipping stays separate.
With unknown freight the final total remains **A confirmar**, rather than claiming
free delivery. Static previews and `NODE_ENV=production` always disable DEV,
even with `--dev`. See [docs/coupons.md](docs/coupons.md).
Rules support `code`, `active`, `type` (`fixed`, `percentage` or `shipping`), `value` (integer
cents for fixed discounts; percent with up to two decimals for percentages),
`minSubtotalCents`, `maxDiscountCents`, `productIds`, `categoryIds`, `combosOnly`, `maxQuantity`
(eligible quantity per order) and `expiresAt` (ISO timestamp with timezone).
Product and category restrictions combine; minimum spending is checked against
eligible lines only. Percentages round half up once on the eligible subtotal,
then the maximum and eligible-subtotal caps apply. Fixed discounts cannot exceed
the eligible subtotal. Product total = order subtotal minus the merchandise discount.
The shipping coupon never discounts merchandise and requires an unexpired quote.
Its shipping discount is separate from the quoted charge; unknown freight stays
unknown, and percentage coupons never reduce shipping.
Changing items or quantities revalidates the coupon. Test rules exist only in
test fixtures and are never loaded by the public site.

Frontend rules are not a secure server-side pricing authority. The new checkout validates prices, coupons and quotes on the server and persists orders in SQLite. Global redemption counts, one-use-per-customer limits and inventory reservations are not implemented. WhatsApp opens a request
for business review, not a confirmed or paid order. The owner must confirm prices,
discounts and delivery costs. Unquoted shipping is not included. Unknown-price
products retain their individual quotation flow and never enter the payable total.
Other product prices and any additional promotion rules remain owner-supplied requirements.

When a checkout URL exceeds 1800 characters, the drawer exposes the complete
summary for copying or downloading as text, then lets the customer open WhatsApp
and paste/attach it. No order lines are silently omitted. Checkout does not clear
the cart or simulate success. Clipboard failures fall back to manual selection.
Run `npm test` for calculation fixtures, drawer interactions, persistence,
malformed storage, coupon changes, checkout summaries and the existing checks.

Shipping estimation and quotation are documented in [docs/shipping.md](docs/shipping.md).
Origin is fixed at **53110-000**. Destination CEP entry, validation, WhatsApp
quotation, explicit unknown shipping totals and a modular same-origin API adapter
are implemented. Live Correios rates remain disabled: business credentials,
enabled services, verified measurements and approved packaging are still required.
The checkout backend now supports optional Melhor Envio quotation and authenticated manual approval; see docs/checkout.md. No actual rates or product measurements are invented.
