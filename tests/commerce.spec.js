const { test, expect } = require('@playwright/test');
const engine = require('../js/commerce');
// Test fixtures are only imported by tests, never by the storefront.
const products = [
  { id: 'book', name: 'Livro de teste', cat: 'books', price: 60, available: true },
  { id: 'dev', name: 'Devocional de teste', cat: 'books', price: 45, available: true },
  { id: 'quote', price: null, available: true },
  { id: 'custom', name: 'Teste', cat: 'gifts', price: 10.05, available: true, personalizable: true, variants: ['A', 'B'] },
];
const line = (id, quantity = 1, extra = {}) => ({ id, quantity, ...extra });
const fixed = { code: 'TEST_FIXED', active: true, type: 'fixed', value: 1500 };
const percent = { code: 'TEST_PERCENT', active: true, type: 'percentage', value: 10 };
const total = (lines, rule, overrides = {}) => engine.summary(lines, products, rule?.code, rule ? [{ ...rule, ...overrides }] : []);

test('persisted cart schema validation rejects unsupported envelopes without trusting nested data', () => {
  for (const raw of ['{bad', 'null', '[]', '0', 'true', '{}', '{"version":1}', '{"lines":[]}', '{"version":2,"lines":[]}', '{"version":1,"lines":{}}']) {
    const restored = engine.restoreCart(raw, products);
    expect(restored.lines).toEqual([]); expect(restored.coupon).toBe(''); expect(restored.notices.length).toBeGreaterThan(0);
  }
  expect(engine.restoreCart(null, products).lines).toEqual([]);
});

test('partial cart recovery retains valid options and notes, validates coupon shape and ignores claimed prices or checkout state', () => {
  const restored = engine.restoreCart(JSON.stringify({ version:1, coupon:' bemvindo5 ', lines:[
    null, [], {}, {id:'book',quantity:'2'}, {id:'book',quantity:0}, {id:'book',quantity:100},
    {id:'book',quantity:1,variant:{}}, {id:'custom',quantity:1,variant:'A',note:{}},
    {id:'custom',quantity:2,variant:'A',note:'Maria',priceSeen:1,price:0},
    {id:'book',quantity:1,total:0}, {id:'quote',quantity:1}, {id:'custom',quantity:1,variant:'unknown'},
  ], customer:{}, quote:{approved:true}, paymentStatus:'approved', total:0 }), products);
  expect(restored.lines).toHaveLength(2); expect(restored.coupon).toBe('BEMVINDO5');
  expect(restored.lines[0]).toMatchObject({id:'custom',quantity:2,variant:'A',note:'Maria',priceSeen:1005});
  expect(engine.summary(restored.lines,products,'',[]).subtotal).toBe(8010);
  expect(restored.notices.join(' ')).toContain('removido'); expect(restored.notices.join(' ')).toContain('atualizado');
  for (const coupon of [[],{},true,1,'X'.repeat(65)]) expect(engine.restoreCart(JSON.stringify({version:1,lines:[line('book')],coupon}),products).coupon).toBe('');
});

test('integer subtotals, repeated options merge, distinct options stay separate', () => {
  const order = total([line('book'), line('book', 2), line('dev', 2), line('custom', 1, { variant: 'A', note: 'Maria' }), line('custom', 1, { variant: 'B', note: 'Maria' }), line('custom', 1, { variant: 'A', note: 'Ana' })]);
  expect(order.entries).toHaveLength(5);
  expect(order.entries[0].quantity).toBe(3);
  expect(order.subtotal).toBe(30015);
  expect(order.total).toBe(30015);
});
test('unpriced, unavailable, unknown and invalid quantities are excluded', () => {
  const order = total([line('quote'), line('missing'), line('book', 0), line('book', 1.5), line('book', -1), line('book', 100)]);
  expect(order.entries).toEqual([]);
  expect(order.total).toBe(0);
  expect(order.notices.length).toBeGreaterThan(0);
});
test('stored prices are recalculated and changes reported', () => {
  const order = total([line('book', 2, { priceSeen: 1, price: 0 })]);
  expect(order.total).toBe(12000);
  expect(order.notices.join(' ')).toContain('atualizado');
  expect(engine.summary([line('book')], [{ ...products[0], available: false }], '', []).entries).toEqual([]);
});
test('unknown, inactive and expired coupons fail clearly', () => {
  expect(engine.summary([line('book')], products, 'UNKNOWN', []).coupon.message).toContain('não encontrado');
  expect(total([line('book')], fixed, { active: false }).coupon.message).toContain('inativo');
  expect(total([line('book')], fixed, { expiresAt: '2000-01-01T00:00:00Z' }).coupon.message).toContain('expirou');
});
test('fixed discounts are capped at eligible subtotal and cannot make totals negative', () => {
  expect(total([line('book')], fixed).total).toBe(4500);
  expect(total([line('book')], fixed, { value: 100000 }).total).toBe(0);
});
test('percentages round half up once and respect maximum discount', () => {
  expect(total([line('custom', 1, { variant: 'A' })], percent).discount).toBe(101);
  expect(total([line('book', 2)], percent, { maxDiscountCents: 500 }).discount).toBe(500);
});
test('minimum, eligibility and order quantity restrictions recalculate', () => {
  expect(total([line('book')], fixed, { minSubtotalCents: 10000 }).coupon.valid).toBe(false);
  expect(total([line('book', 2)], fixed, { minSubtotalCents: 10000 }).coupon.valid).toBe(true);
  expect(total([line('book'), line('dev')], percent, { productIds: ['dev'] }).discount).toBe(450);
  expect(total([line('book')], percent, { categoryIds: ['gifts'] }).coupon.valid).toBe(false);
  expect(total([line('book', 2)], percent, { maxQuantity: 1 }).coupon.valid).toBe(false);
});
test('coupon normalization and removal preserve correct totals', () => {
  const order = engine.summary([line('book')], products, ' test_fixed ', [fixed]);
  expect(order.coupon.code).toBe('TEST_FIXED');
  expect(order.discount).toBe(1500);
  expect(total(order.lines).total).toBe(6000);
});
test('WhatsApp summary includes every item, options, totals and review terms', () => {
  const order = total([line('book', 2), line('custom', 1, { variant: 'A', note: 'Maria' })], fixed);
  const text = engine.message(order, cents => `${cents} centavos`);
  for (const phrase of ['Livro de teste', 'Quantidade: 2', 'Opção: A', 'Personalização: Maria', 'Unitário: 6000', 'Subtotal: 12000', 'Cupom: TEST_FIXED', 'Subtotal dos produtos: 13005', 'Desconto: 1500', 'Total dos produtos: 11505', 'frete não incluídos', 'não está confirmado']) expect(text).toContain(phrase);
});
