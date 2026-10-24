// Run: node lp-report/calc.test.mjs
import assert from 'node:assert/strict';
import { vsHodlUsd, exitPrices, summarize } from './calc.js';

const pos = o => ({
  open: false, minPrice: 0, maxPrice: 0, depositedUsd: 0, feesUsd: 0, pnlUsd: 0,
  deposited: { x: 0, y: 0 }, withdrawn: { x: 0, y: 0 }, withdrawnUsd: { x: 0, y: 0 }, balance: { x: 0, y: 0 },
  ...o,
});
const today = { x: 100, y: 1 }; // SOL $100, USDC $1
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

// Put in 10 SOL, exited at SOL=$90 with 5 SOL + 450 USDC, plus $10 fees.
// Holding at exit: 10 × 90 = $900. LP: 450 + 450 + 10 = $910 → +$10. Today's SOL price is irrelevant.
const closed = pos({ deposited: { x: 10, y: 0 }, withdrawn: { x: 5, y: 450 }, withdrawnUsd: { x: 450, y: 450 }, feesUsd: 10, depositedUsd: 1000 });
near(vsHodlUsd(closed, today), 10);

// Fully swapped to USDC: no SOL paid out, so SOL had crossed the range top (200 USDC per SOL).
// Put in 1 SOL, got 190 USDC + $5 fees. Holding at exit ≥ $200 → LP −$5.
const swapped = pos({ maxPrice: 200, deposited: { x: 1, y: 0 }, withdrawn: { x: 0, y: 190 }, withdrawnUsd: { x: 0, y: 190 }, feesUsd: 5 });
near(exitPrices(swapped).x, 200);
near(vsHodlUsd(swapped, today), -5);

// Fully swapped to SOL below the range bottom (50 USDC per SOL): USDC price derived from SOL's.
const caught = pos({ minPrice: 50, deposited: { x: 0, y: 100 }, withdrawn: { x: 2, y: 0 }, withdrawnUsd: { x: 90, y: 0 } });
near(exitPrices(caught).y, 0.9); // 45 / 50

// Open position at today's prices: holds everything plus $10 fees → ahead by the fees.
const open = pos({ open: true, deposited: { x: 1, y: 100 }, balance: { x: 1, y: 100 }, feesUsd: 10, depositedUsd: 200 });
near(vsHodlUsd(open, today), 10);

// Pools sum their positions; open pool without a price is flagged; empty pools are dropped.
const s = summarize([
  { address: 'a', name: 'SOL-USDC', today, positions: [closed, open] },
  { address: 'b', name: 'RUG-SOL', today: { x: undefined, y: 100 }, positions: [pos({ open: true, depositedUsd: 50, feesUsd: 1 })] },
  { address: 'c', name: 'EMPTY', today, positions: [] },
]);
assert.equal(s.rows.length, 2);
near(s.vsHodl, 21);
near(s.feesUsd, 21);
assert.equal(s.rows[0].address, 'a');
assert.equal(s.unpriced, 1);

console.log('calc ok');
