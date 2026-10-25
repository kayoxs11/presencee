# Shipping configuration and activation

**Current checkout:** see [checkout.md](checkout.md). The Node/SQLite backend now implements optional authorized Melhor Envio quotes, service selection, binding/expiration and authenticated manual approval. This document describes the existing cart/WhatsApp shipping adapter and the shared approved-recipe strategy. Statements below about a future Correios endpoint apply to that legacy cart adapter; it remains disabled. No direct Correios contract integration or live rate is claimed. The checkout never trusts client-side package or price data.

## What works now

The cart accepts a destination CEP and shows the fixed origin **53110-000**.
CEP validation checks syntax and rejects repeated-digit placeholders; it does not
claim to verify that an address exists or that a delivery service covers it.
The destination stays in page memory, separate from cart/theme localStorage.

No Correios credentials, enabled contract services, measured product attributes,
or deployment backend have been supplied. Consequently the public configuration
has no active API endpoint, rates or delivery times. It shows **A consultar** for
shipping and **A confirmar** for the final total. The product total remains
visible. The WhatsApp quotation contains the entire cart, coupon/discount,
origin and destination, and an explicit request to confirm shipping and total.
The existing copy/download fallback handles long messages without losing items.

`js/shipping.js` contains the modular validation, packaging strategy, quote
response validation, messages and HTTP adapter. `js/shipping-config.js` contains
non-secret feature configuration. `js/cart.js` integrates it into checkout;
`css/shipping.css` shares the existing theme and rounded controls.

## Product measurements and packaging

Each product in `js/catalog.js` has its own `shipping` object:

```js
shipping: {
  eligible: null,
  weightGrams: null,
  lengthCm: null,
  widthCm: null,
  heightCm: null
}
```

Replace null only with verified business information. `eligible: true` means
the business has approved this product for the configured shipping workflow;
`false` excludes automatic quoting; null means unknown. The Bible repair service
also needs an owner-approved shipping policy; outbound/inbound service logistics
are not inferred from its price. Unknown-price products remain quotation-only.

Measure the shipping-ready unit weight (positive integer grams) and dimensions
(positive cm). For multiple units, their weights are summed with the approved
outer packaging tare. Clarify what wrapping is included when measuring, so tare
does not duplicate it. No measurements are seeded for actual Presence products.

Default packaging strategy is `manual`. Automatic quoting requires
`strategy: 'approved-recipes'` with measured, physically verified exact order
combinations. A recipe has this schema (types below, not live values):

```text
{
  items: { <product ID>: <integer quantity>, ... },
  tareGrams: <nonnegative integer>,
  lengthCm: <positive measured outer length>,
  widthCm: <positive measured outer width>,
  heightCm: <positive measured outer height>
}
```

A recipe must match all product quantities exactly, including units from
different variant/customization lines. Approve a recipe only when it works for
every included variant/customization. Products with unpredictable sizes must
remain manual. A basic per-unit fit check supplements the owner's physical
packability check; it is not a general bin-packing algorithm. Dimensions come
from the approved outer package, not sums of individual lengths/widths/heights.
An unmatched combination or missing measurement always returns to quotation.
Only one outer package is supported per recipe; multi-parcel orders stay manual.
The future backend must also enforce service-specific size/weight limits.

## Official integration investigated

The official [Price API manual](https://www.correios.com.br/atendimento/developers/manuais/manual-api-preco-1)
describes restricted contract access, enabled API service 38202, and bearer-token
authentication. The [Delivery-time API manual](https://www.correios.com.br/atendimento/developers/manuais/manual-api-prazo)
describes the corresponding restricted access for service 38210 and authenticated
delivery-time queries. Both need actual business entitlements; having a contract
alone must not be assumed sufficient. Documentation was checked for this change.

There is no live Correios backend in this static repository. The HTTP adapter is
an integration boundary, not an implementation of authenticated Correios calls.
No credentials are requested in the UI, placed in the frontend or logged.

## Secure backend contract for future deployment

Once a hosting/serverless platform, contract access and accurate shipping data
are supplied, deploy a **same-origin** POST endpoint before setting `endpoint` in
`js/shipping-config.js`. Populate `enabledServices` with only the owner's enabled
service codes; do not copy the artificial service IDs used by tests.

The adapter sends:

```text
{
  originCEP: "53110000",
  destinationCEP: <8 digits>,
  fingerprint: <opaque client state binding>,
  items: [{ id, quantity, variant, note }, ...],
  package: { weightGrams, lengthCm, widthCm, heightCm }
}
```

Backend responsibilities:

- Keep Correios credentials/tokens in server-only secret storage. Redact provider
  authentication details and payloads from errors/logs and browser responses.
- Fix the origin server-side; validate destination, IDs, quantities and options.
  Resolve catalog measurements and packaging server-side. Do not trust the
  client's package, totals, eligibility or opaque fingerprint as price authority.
- Authenticate with the official token API using the owner's enabled access,
  manage token expiration securely, and query price/time only for enabled services.
  Use the real weight and dimensions. Enforce request timeouts, rate limits and
  bounded payloads. Do not return an option whose price query failed.
- Combine actual price/time responses by service code. Normalize prices to
  integer cents exactly. A missing reliable delivery time is `null`, never an
  invented number. Return an empty/unavailable response when no service applies.
- Bind an expiring quote ID to server-validated order/destination data; store or
  sign it server-side if authoritative verification is later required. The client
  fingerprint is only a stale-state guard and is not a cryptographic signature.

Expected normalized success response:

```text
{
  source: "correios",
  quoteId: <nonempty opaque string>,
  originCEP: "53110000",
  destinationCEP: <same requested CEP>,
  fingerprint: <same requested state binding>,
  expiresAt: <ISO timestamp with timezone, future and no more than 1 hour>,
  options: [{ serviceCode, name, priceCents, deliveryDays: <integer or null> }]
}
```

Only return `source: 'correios'` for actual official API results. The browser
rejects unexpected services, mismatched state/origin/destination, invalid money,
duplicate services, expired quotes and malformed data. HTTP 401/403, 400/422,
404/503, other failures and timeouts show safe fallback messages. Raw server
errors are never displayed. The default client timeout is 8 seconds.

## Totals, invalidation and limitations

After a valid quote, customers can select an option. Product subtotal minus the
valid coupon gives product total; shipping is then added in integer cents to form
the estimated order total. Percentage coupons do not discount shipping. The public
`FRETEGRATIS` coupon waives the selected valid quoted cost without changing the
merchandise total. Quoted charge, shipping discount and shipping payable remain
separate amounts. Unknown shipping
is never shown as zero/free. A zero-cost option can only come from a validated
provider response. Delivery days, when supplied, are labeled as business-day
estimates rather than guaranteed arrival dates.

Cart quantity, products, variants, customization, merchandise price/coupon, destination,
service configuration or packaging changes invalidate the quote. Responses from
cancelled/outdated requests cannot reapply it. Expiration also clears the quote;
checkout revalidates before building the message. Applying/removing `FRETEGRATIS` preserves an otherwise
unchanged quote; selecting another service recalculates its waiver. Expiration or
cart/destination changes invalidate both the shipping quote and shipping coupon.
Quotes are not persisted or
restored from localStorage. The WhatsApp summary includes the selected service,
cost, available estimated days and total, or explicitly requests confirmation.
It remains a request for review, not payment, confirmation or inventory reservation.

Run `npm test`. Shipping tests use clearly isolated measurements, prices and
service codes; API success, errors and timeout cases are mocked. They do not
verify the business's credentials, live Correios rates or operational coverage.
