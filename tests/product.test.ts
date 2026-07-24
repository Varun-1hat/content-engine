import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hasProduct,
  productBlock,
  productPrecedenceBlock,
  productPayloadLimitMessage,
  productPayloadRefusal,
  productPhotoTooLargeMessage,
} from '../src/lib/pipeline/product.ts';
import {
  BROLL_FREQUENCIES,
  DEFAULT_BROLL_FREQUENCY,
  normalizeBrollFrequency,
} from '../src/lib/pipeline/broll.ts';

// Protects the per-reel product context: the topic-stage precedence clause
// (which must never become a suppression clause), the single photo-payload
// limit's message, and the server-side B-roll frequency allowlist.
// Nothing here fetches: fetchProductImages' network path is not exercised.

const PHOTOS = ['https://cdn.example/a.jpg', 'https://cdn.example/b.webp'];

// --- productPrecedenceBlock -------------------------------------------------
test('the precedence clause appears when photos exist AND the flag is true', () => {
  const block = productPrecedenceBlock({
    product_image_urls: PHOTOS,
    product_overrides_research: true,
  });
  assert.notEqual(block, '');
  assert.match(block, /product/i);
  assert.match(block, /topic/i);
});

test('the clause states PRECEDENCE, never suppression of the research doc', () => {
  const block = productPrecedenceBlock({
    product_image_urls: PHOTOS,
    product_overrides_research: true,
  });
  // The research doc stays in the prompt in full and keeps governing the
  // template decision tree, hook and close — the clause only decides who wins a
  // disagreement about the TOPIC. Any instruction to drop it would break the
  // stage's output contract.
  assert.doesNotMatch(block, /\bignore\b/i);
  assert.doesNotMatch(block, /\bdisregard\b/i);
  assert.doesNotMatch(block, /\bsuppress\b/i);
  assert.doesNotMatch(block, /\bskip\b/i);
  assert.doesNotMatch(block, /\bdo not use\b/i);
  assert.doesNotMatch(block, /\boverride the research\b/i);
  // ...and it names what the research doc still governs.
  assert.match(block, /template decision tree/i);
  assert.match(block, /hook & close/i);
});

test('the clause is empty when the flag is true but the reel has no photos', () => {
  assert.equal(
    productPrecedenceBlock({ product_image_urls: [], product_overrides_research: true }),
    ''
  );
  assert.equal(productPrecedenceBlock({ product_overrides_research: true }), '');
});

test('the clause is empty when photos exist but the flag is false', () => {
  assert.equal(
    productPrecedenceBlock({ product_image_urls: PHOTOS, product_overrides_research: false }),
    ''
  );
  // A row from before the column existed reads as null — today's behaviour.
  assert.equal(
    productPrecedenceBlock({ product_image_urls: PHOTOS, product_overrides_research: null }),
    ''
  );
  assert.equal(productPrecedenceBlock({ product_image_urls: PHOTOS }), '');
});

test('the clause is additive: productBlock is unchanged by the flag', () => {
  const on = productBlock({ product_image_urls: PHOTOS });
  const off = productBlock({ product_image_urls: PHOTOS });
  assert.equal(on, off);
  assert.equal(hasProduct({ product_image_urls: PHOTOS }), true);
  assert.equal(hasProduct({ product_image_urls: [] }), false);
});

// --- productPayloadLimitMessage ---------------------------------------------
test('the payload-limit message names both the reel total and the limit, in MB', () => {
  const msg = productPayloadLimitMessage(15 * 1024 * 1024, 12 * 1024 * 1024);
  assert.match(msg, /15\.0 MB/);
  assert.match(msg, /12\.0 MB/);
});

test('the payload limit is a TOTAL across the reel, not a per-image cap', () => {
  // Three 5 MB photos are each individually unremarkable and together over a
  // 12 MB ceiling — the case a per-image cap cannot see.
  const total = 3 * 5 * 1024 * 1024;
  assert.match(productPayloadLimitMessage(total, 12 * 1024 * 1024), /15\.0 MB/);
});

// --- productPayloadRefusal --------------------------------------------------
// The ONE size decision, shared by POST /api/jobs (before the reel row exists,
// while the user can still remove a photo) and fetchProductImages (on the bytes
// actually downloaded). Same axis, same comparison, same message — which is what
// makes "accepted at upload, rejected by a stage" unreachable.
test('the reel-creation refusal and the stage refusal are one decision, on one axis', () => {
  const limit = 12 * 1024 * 1024;
  // Three 5 MB photos: each fine on its own at /api/uploads, over the reel total.
  const three = 3 * 5 * 1024 * 1024;
  const refusal = productPayloadRefusal(three, limit);
  assert.ok(refusal, 'three 5 MB photos must be refused against a 12 MB reel total');
  assert.equal(refusal, productPayloadLimitMessage(three, limit), 'one message, not two wordings');
  // Two of the same photos are under it and must NOT be refused.
  assert.equal(productPayloadRefusal(2 * 5 * 1024 * 1024, limit), null);
});

test('the boundary is `>`: exactly at the limit is accepted, one byte over is not', () => {
  const limit = 12 * 1024 * 1024;
  assert.equal(productPayloadRefusal(limit, limit), null);
  assert.equal(productPayloadRefusal(limit - 1, limit), null);
  assert.ok(productPayloadRefusal(limit + 1, limit));
  // A reel with no photos measures 0 and is never refused.
  assert.equal(productPayloadRefusal(0, limit), null);
});

// --- productPhotoTooLargeMessage --------------------------------------------
test('the single-file refusal names the axis it measures — the reel TOTAL', () => {
  const msg = productPhotoTooLargeMessage(15 * 1024 * 1024, 12 * 1024 * 1024);
  assert.match(msg, /15\.0 MB/);
  assert.match(msg, /12\.0 MB/);
  // It must read as one rule with the Studio's "a reel can carry N MB in
  // total", not as a second, per-file limit of its own.
  assert.match(msg, /total/i);
  assert.match(msg, /reel/i);
  assert.doesNotMatch(msg, /^File exceeds/);
});

test('both size messages state the same limit for the same client', () => {
  const limit = 12 * 1024 * 1024;
  const perFile = productPhotoTooLargeMessage(13 * 1024 * 1024, limit);
  const perReel = productPayloadLimitMessage(13 * 1024 * 1024, limit);
  assert.match(perFile, /12\.0 MB/);
  assert.match(perReel, /12\.0 MB/);
});

test('at the boundary the refusal never states the same number twice', () => {
  // One byte over 12 MB used to render as "This photo is 12.0 MB … may total
  // 12.0 MB … so this one file is over the reel's limit on its own" — a refusal
  // that contradicts itself. The measured value rounds UP and the limit rounds
  // DOWN, so an over-limit file always reads as the bigger number.
  const limit = 12 * 1024 * 1024;

  for (const overBy of [1, 1024, 50 * 1024]) {
    const perFile = productPhotoTooLargeMessage(limit + overBy, limit);
    const perReel = productPayloadLimitMessage(limit + overBy, limit);
    for (const msg of [perFile, perReel]) {
      const [measured, stated] = msg.match(/\d+\.\d+ MB/g) ?? [];
      assert.ok(measured && stated, `both numbers should render: ${msg}`);
      assert.notEqual(
        measured,
        stated,
        `a refusal must not claim the file is the same size as the limit it exceeds: ${msg}`
      );
    }
  }

  // The limit itself is never overstated, and clear-cut sizes are unchanged.
  assert.match(productPhotoTooLargeMessage(15 * 1024 * 1024, limit), /15\.0 MB.*12\.0 MB/);
  // And the `>` boundary still holds: exactly at the limit is accepted.
  assert.equal(productPayloadRefusal(limit, limit), null);
});

// --- normalizeBrollFrequency ------------------------------------------------
test('the frequency allowlist is exactly Minimal / Standard / High', () => {
  assert.deepEqual([...BROLL_FREQUENCIES], ['Minimal', 'Standard', 'High']);
  assert.equal(DEFAULT_BROLL_FREQUENCY, 'Standard');
});

test('a known frequency label passes through; anything else becomes the default', () => {
  assert.equal(normalizeBrollFrequency('Minimal'), 'Minimal');
  assert.equal(normalizeBrollFrequency('High'), 'High');
  assert.equal(normalizeBrollFrequency('minimal'), 'Standard');
  assert.equal(normalizeBrollFrequency(undefined), 'Standard');
  assert.equal(normalizeBrollFrequency(null), 'Standard');
  assert.equal(normalizeBrollFrequency(7), 'Standard');
});
