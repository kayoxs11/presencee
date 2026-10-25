/* Public non-secret configuration. The origin is fixed in shipping.js.
   endpoint stays null until a same-origin secure backend is actually deployed.
   Never put a Correios username, password, posting card or token in this file. */
const PRESENCE_SHIPPING = {
  endpoint: null,
  timeoutMs: 8000,
  enabledServices: [],
  packaging: {
    strategy: 'manual',
    // 'approved-recipes': exact order combinations and measured outer packages.
    // Recipe schema is documented in docs/shipping.md. No made-up measurements.
    recipes: []
  }
};
