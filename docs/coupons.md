# Coupon behavior and security boundaries

The existing coupon engine (`js/commerce.js`) and cart (`js/cart.js`) are used.
There is no separate promotion store or checkout system. Public configuration
is in `js/coupons.js`.

| Code | Merchandise | Minimum eligible merchandise | Shipping |
| --- | --- | --- | --- |
| BEMVINDO5 | 7% | R$50.00 inclusive | Unchanged |
| PRESENCA10 | 10% on explicit combos/kits only | None | Unchanged |
| FRETEGRATIS | Unchanged | None; cart must contain a purchasable product | Waives the selected valid quoted charge |
| DEV | 100%, only via the explicit loopback development server | None; priced merchandise required | Never waived |

`BEMVINDO5` intentionally gives **7%**, despite the `5` in its name. No expiration,
category exclusions or redemption limits were supplied for these public codes,
so none are invented. The engine continues to support configured expiration,
enabled status, eligible product/category lists, discount caps and order limits.

`PRESENCA10` requires `is_combo: true` on the current catalog product. This is a
strict boolean; names containing “combo” or “kit”, missing flags, strings such as
`"true"`, and flags supplied in saved cart data never qualify. Set the field to
true only for an owner-confirmed combo/kit. All currently supplied products are
explicitly marked false because no actual combo classification has been supplied.
There are no invented combo products or prices. Until combos are configured, this
coupon is rejected for the live catalog with the exact message:
“Este cupom é válido somente para combos.”

Mixed carts retain the full price of individual items; only the combined subtotal
of eligible combo lines (including their quantities) receives 10%. There is no
minimum for that eligible subtotal. Removing the last eligible combo removes the
coupon effect; product/quantity changes and restored carts re-evaluate eligibility
using the current catalog. Other coupons are not restricted by `is_combo`.

Only one coupon applies. Successfully applying a different code replaces the old
one; invalid input leaves a still-valid applied coupon intact. Codes are trimmed
and uppercased. Empty carts and quotation-only products cannot generate discounts.

All arithmetic is integer cents. Eligible merchandise is summed before applying
the minimum. Percentage calculations use integer basis points and BigInt, rounding
half up **once** on the eligible subtotal. Merchandise discounts are capped at
that subtotal. Shipping discounts are accounted for separately. Calculation order:

1. Resolve current catalog prices and valid quantities; sum merchandise lines.
2. Validate the one coupon against eligible merchandise and, for shipping coupons,
   the selected unexpired shipping quote.
3. Subtract only the merchandise discount from merchandise subtotal.
4. Subtract only the shipping discount from the quoted shipping charge.
5. Add the nonnegative merchandise and shipping payable amounts. If shipping is
   unknown, the final estimated order total remains **A confirmar**.

The cart shows merchandise subtotal, merchandise discount, updated product total,
quoted shipping, shipping discount, payable shipping and final estimate. WhatsApp
includes the same amounts and selected service for review. Opening it is not
payment or order confirmation.

## Shipping coupon eligibility

`FRETEGRATIS` requires the current destination, an unexpired quote ID and a selected
service from that quote, with a validated nonnegative integer-cent charge. Entering
a CEP, clicking “Calcular frete”, a loading state, a failed API request, a stored
coupon code or an unknown shipping cost do not make it eligible. Until live Correios
access and verified measurements/packaging are configured, customers are told to
request a shipping quotation through WhatsApp. There is no manual client field
that claims a business-confirmed rate.

Applying/removing this coupon does not invalidate the quote it relies on. Switching
between options in the same valid quote recalculates the waived amount. Physical
cart/CEP changes, quote expiration and merchandise-price coupon changes invalidate
shipping as before. Once a quote becomes invalid, the shipping coupon is removed
with an explanation and freight returns to **A consultar**. Recalculate and apply
again; it never silently remains “free”.

Cart persistence stores only the coupon code, never trusted discount totals or
shipping quotes. Every restoration recomputes from current rules and catalog.
`FRETEGRATIS` is therefore not restored as valid after a refresh without a new quote.
Theme persistence is independent.

## Testing DEV locally

1. Stop any older preview process using port 8010 (Ctrl+C in its terminal).
2. Run `npm start` or `npm run dev` in the project root.
3. Open **http://localhost:8010** or **http://127.0.0.1:8010**.
4. Add products with confirmed prices, open the cart, enter `DEV`, and apply it.
   The application briefly validates the cart with the local server. For example,
   one Bíblia plus one Devocional yields subtotal R$105, discount R$105 and product
   total R$0. Shipping is not waived: unknown freight/final total remains unknown;
   a quoted shipping charge is still payable in full.
5. Change quantities, add/remove products, remove the coupon, or refresh to test
   recalculation. DEV authorizations remain only in memory and are revalidated
   after refresh, cart changes or their one-minute expiration.

For another port, use `npm start -- 8012` and open the corresponding local URL.
Opening `index.html` directly or using a different static server/IDE Live Server
does **not** authorize DEV. Use the project's local server. Restart it after
changing the shared catalog or server files, then reload the page; Node loads
catalog values at startup. Mismatches fail with a restart instruction rather than
accepting stale prices. If `NODE_ENV` is set to `production` in your terminal,
use a development terminal/configuration for local tests.

## Server-side development policy and production defaults

`npm start` explicitly invokes `scripts/serve.cjs --dev`. The server binds only
to 127.0.0.1 and enables the development adapter/API only with that CLI switch
and NODE_ENV unset, `development` or `test`. `NODE_ENV=production` (or an unknown
environment value) disables it even with `--dev`. `npm run preview` omits the
switch and is a production-style static preview with DEV disabled.

Only enabled local HTML receives `/__dev__/coupons.js`. That adapter submits
current cart lines to POST `/__dev__/coupons`; the server resolves prices and
availability from `js/catalog.js` and calls the server-only development instance
of the existing `js/commerce.js` engine. There is no duplicate discount formula,
secret frontend code or new public promotion. Client-supplied prices, discounts,
totals and shipping waivers are ignored; invalid/unpriced carts are rejected.
The server returns integer-cent totals, a cart binding and a one-minute expiration.
Pending/failed validation cannot grant DEV or proceed through checkout as approved.

Requests require a loopback connection, a localhost/127.0.0.1 Host with the correct
port, matching same-origin Origin, JSON and a custom request header. Cross-origin
requests and DNS-rebinding-style Host values are rejected without enabling CORS.
Local process ownership and the explicit server switch define this development
boundary; the header is not a password and no administrator identity is claimed.
Keep this test server on the local workstation, not behind a public tunnel/proxy.

Production/static previews have no injected adapter; the normal browser/default
engine still rejects DEV even if public rules are forged. Production mode returns
403 for direct requests to the development API and 404 for its client adapter.
Browser storage, URL flags, cookies, caller-provided `environment`/`authorized`
fields and knowledge of the code cannot enable that server path. Saved DEV codes
from local testing are rejected in a production/static page.

This local endpoint validates test discounts only. It is not a production order,
payment or shipping backend, and does not turn test prices into real business
offers. Anyone controlling browser JavaScript or editing a WhatsApp message can
still fabricate displayed/requested prices; Presence must confirm actual orders.
The checkout backend now reuses this engine for authoritative server-side public coupon validation; see [checkout.md](checkout.md). The production checkout always rejects DEV. Authenticated staff administration is implemented; global redemption limits remain unimplemented.

Run `npm test`. `tests/coupons.spec.js` covers the real public rules, exact minimum
boundary, no-minimum behavior, rounding, removal/replacement, persistence, cart
updates, DEV bypass attempts and mocked shipping-option/expiration scenarios.
Shipping fixtures are isolated from the shipped configuration.
`tests/combos.spec.js` covers combo-only, mixed, individual-only and multiple-combo
carts, strict catalog flags, quantity changes, removal, reclassification and
checkout summaries. Browser combo classifications exist only in test fixtures.
`tests/dev-coupon.spec.js` exercises the real local API and browser adapter,
server-catalog pricing, localhost access, 100% merchandise arithmetic, shipping
separation, quantity/removal/persistence, cross-origin rejection and a separate
NODE_ENV=production server launched with --dev to prove the production override.
