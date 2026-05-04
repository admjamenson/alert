const test = require('node:test');
const assert = require('node:assert/strict');
const {
  getTierBudgetUsd,
  getTierRevenueUsd,
  normalizeTier,
} = require('../EconomicsPolicy');

test('FREE budget default is 0.40 USD', () => {
  assert.equal(getTierBudgetUsd('free'), 0.4);
  assert.equal(getTierBudgetUsd('FREE'), 0.4);
});

test('PREMIUM budget default is 1.20 USD', () => {
  assert.equal(getTierBudgetUsd('premium'), 1.2);
  assert.equal(getTierBudgetUsd('Premium'), 1.2);
});

test('tier revenue defaults are set for free and premium', () => {
  assert.equal(getTierRevenueUsd('free'), 2.0);
  assert.equal(getTierRevenueUsd('premium'), 4.0);
});

test('normalizeTier maps values to free or premium safely', () => {
  assert.equal(normalizeTier('premium'), 'premium');
  assert.equal(normalizeTier('FREE'), 'free');
  assert.equal(normalizeTier('unknown'), 'free');
  assert.equal(normalizeTier(null), 'free');
});
