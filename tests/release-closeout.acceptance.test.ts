// ACCEPTANCE tests for the v5 release close-out story.
// (.claude/feature-factory/runs/2026-07-23-release-closeout/02-story.md §2)
//
// One test per acceptance criterion it can honestly prove, named with the
// criterion number so a failure names the criterion. These are NOT unit tests —
// the builders own those (tests/duration|product|download|coverage|stages|
// generators). These drive the real thing from the outside: the real
// concatBrolls through real ffmpeg, the real downloadToFile over a real socket,
// the real jobs.ts PATCH allowlist, the real visual adapter through the real
// Python generator contract.
//
// Nothing here calls a vendor or the DB:
//   * ffmpeg/ffprobe are the project's own local static binaries;
//   * every HTTP request goes to a localhost node:http server on an ephemeral
//     port;
//   * the one Python generator invocation exits on its argument contract before
//     any API call, with a deliberately missing reference file;
//   * the two jobs.ts calls that touch Supabase throw before reaching it.
//
// Criteria tagged [studio] or [live-text] in the story, plus 10 (second half),
// 32 (full reel), 33 (past the render boundary) and 40, are NOT covered here.
// See the verifier report — they are recorded as unverified, never as passing.

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFile, spawn, spawnSync } from 'node:child_process';
import { createRequire, register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const LIB = path.join(ROOT, 'src', 'lib');

// The Python generators resolve `python3` by default (the Docker image); on this
// host the documented override is `python` (CLAUDE.md). Set before the visual
// adapter is imported — it reads PYTHON_BIN into a module const.
if (!process.env.PYTHON_BIN && process.platform === 'win32') process.env.PYTHON_BIN = 'python';

// Resolve product modules the way the app's build resolves them (see
// helpers/node-resolve.mjs). Nothing is stubbed: these are the real modules.
register(pathToFileURL(path.join(__dirname, 'helpers', 'node-resolve.mjs')).href);

const duration = await import('../src/lib/pipeline/duration.ts');
const coverage = await import('../src/lib/pipeline/coverage.ts');
const productLib = await import('../src/lib/pipeline/product.ts');
const downloadLib = await import('../src/lib/pipeline/download.ts');
const stagesLib = await import('../src/lib/pipeline/stages.ts');
const audioLib = await import('../src/lib/pipeline/audio.ts');
const assemblyLib = await import('../src/lib/pipeline/assembly.ts');
const jobsLib = await import('../src/lib/jobs.ts');
const authLib = await import('../src/lib/auth.ts');
const scriptAdapters = await import('../src/lib/adapters/script/index.ts');
const visualAdapters = await import('../src/lib/adapters/visual/index.ts');

const requireCjs = createRequire(import.meta.url);
const FFMPEG = requireCjs('ffmpeg-static') as string;
const execFileP = promisify(execFile);
const PY = process.env.PYTHON_BIN || (process.platform === 'win32' ? 'python' : 'python3');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'closeout-acceptance-'));
after(() => {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
});

const scratch = (name: string): string => {
  const d = path.join(TMP, name);
  fs.mkdirSync(d, { recursive: true });
  return d;
};

// --- ffmpeg fixtures --------------------------------------------------------
// Tiny locally-generated clips (lavfi colour + sine tone). No vendor, no
// network — the same static binary production uses.

interface Fixtures {
  clips: string[];
  voice: string;
  base: string;
}
let fixturesPromise: Promise<Fixtures> | null = null;

function makeClip(dest: string, seconds: number, colour: string): Promise<unknown> {
  return execFileP(FFMPEG, [
    '-f', 'lavfi', '-i', `color=c=${colour}:s=320x240:d=${seconds}:r=30`,
    '-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}:sample_rate=44100`,
    '-shortest', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-c:a', 'aac', '-y', dest,
  ]);
}

function fixtures(): Promise<Fixtures> {
  if (!fixturesPromise) {
    fixturesPromise = (async () => {
      const dir = scratch('fixtures');
      const clips: string[] = [];
      for (const [i, colour] of ['red', 'green', 'blue'].entries()) {
        const p = path.join(dir, `clip${i}.mp4`);
        await makeClip(p, 1, colour);
        clips.push(p);
      }
      const voice = path.join(dir, 'voice.mp3');
      await execFileP(FFMPEG, [
        '-f', 'lavfi', '-i', 'sine=frequency=300:duration=3:sample_rate=44100',
        '-c:a', 'libmp3lame', '-y', voice,
      ]);
      const base = path.join(dir, 'base.mp4');
      await makeClip(base, 3, 'gray');
      return { clips, voice, base };
    })();
  }
  return fixturesPromise;
}

/** Placements shaped the way a b-roll plan reaches assembly. */
function placements(clips: string[], spans: [number, number][]) {
  return spans.map(([start, end], i) => ({
    localPath: clips[i],
    start,
    end,
    isImage: false,
  }));
}

// --- localhost fixtures -----------------------------------------------------

interface Server {
  url: (p: string) => string;
  close: () => Promise<void>;
}

/**
 * Run a node child and collect its exit code. Deliberately NOT spawnSync: this
 * process is also serving the child's HTTP request, and spawnSync blocks the
 * event loop that would answer it.
 */
function runNode(args: string[], timeoutMs: number): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += String(d); });
    child.stderr.on('data', (d) => { stderr += String(d); });
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

function serve(handler: http.RequestListener): Promise<Server> {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      resolve({
        url: (p: string) => `http://127.0.0.1:${port}${p}`,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}

// =============================================================================
// ITEM 2 — duration discipline on adapt_voice
// =============================================================================

test('6: the adapt_voice word budget is derived from the CLIENT\'S configured words-per-second', () => {
  // Decision 6: one value per client (clients.speech_words_per_sec), reused for
  // adapt_voice rather than a second column or a constant. A budget that did
  // not move with the client's rate would be a hardcoded pace.
  assert.equal(duration.wordBudgetFor(20, 2.5), 50);
  assert.equal(duration.wordBudgetFor(20, 2.0), 40);
  assert.equal(duration.wordBudgetFor(20, 3.0), 60);
  // ...and it tracks the ordered duration, not just the rate.
  assert.equal(duration.wordBudgetFor(45, 2.5), 113);
  assert.equal(duration.wordBudgetFor(30, 2.5), 75);

  // The block is stated only when there IS an ordered duration to state.
  assert.equal(
    duration.resolveOrderedDurationSec({ target_duration_sec: 20, pipeline_id: 'p1' }, [{ id: 'p1', duration_default_sec: 45 }]),
    20
  );
  assert.equal(duration.resolveOrderedDurationSec({ target_duration_sec: null, pipeline_id: null }, []), null);
});

test('8: a 300-word script on a 20s target is flagged; a 45-word script on the same target is not', () => {
  // The exact pair the criterion names, driven through the chain the Studio
  // runs on every keystroke: estimate the edited text, then judge it.
  const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');
  const judge = (script: string, target: number | null) =>
    duration.checkDurationDeviation(duration.estimateSpokenScript(script, 2.5).seconds, target);

  const flagged = judge(words(300), 20);
  assert.ok(flagged, 'a 300-word script on a 20s target must be flagged');
  assert.match(flagged!, /120\.0s/);   // what it actually reads at
  assert.match(flagged!, /20s/);       // what was ordered
  assert.match(flagged!, /over/);

  assert.equal(judge(words(45), 20), null, 'a 45-word script on a 20s target must NOT be flagged');
});

test('8 (GATE 2 amendment 1): the deviation check is TWO-SIDED — -5.1s flags, -5.0s does not, +5.0s does not, +5.1s flags', () => {
  // The user refined the rule at the gate: a 20s target returning 12s is as
  // wrong as one returning 27s. An undershoot that fails to flag is the defect.
  assert.equal(duration.DURATION_DEVIATION_TOLERANCE_SEC, 5);

  assert.equal(duration.checkDurationDeviation(14.9, 20) === null, false, '-5.1s must flag');
  assert.equal(duration.checkDurationDeviation(15.0, 20), null, '-5.0s must NOT flag');
  assert.equal(duration.checkDurationDeviation(25.0, 20), null, '+5.0s must NOT flag');
  assert.equal(duration.checkDurationDeviation(25.1, 20) === null, false, '+5.1s must flag');

  // ...and the message says which way it is wrong.
  assert.match(duration.checkDurationDeviation(12, 20)!, /under/);
  assert.match(duration.checkDurationDeviation(27, 20)!, /over/);

  // The helper is named for what it does. checkDurationOvershoot must not exist:
  // a one-sided name is how the undershoot half goes missing again.
  assert.equal(typeof duration.checkDurationDeviation, 'function');
  assert.equal((duration as Record<string, unknown>).checkDurationOvershoot, undefined);
});

test('9 [partial — pure half only]: the flag is recomputed from the script text, so a trim clears it', () => {
  // The Studio half ("without leaving the page") is [studio]; what is provable
  // here is that the estimate is a function of the TEXT, not of the model's
  // self-reported wordCount — so trimming can clear an overshoot at all.
  const long = Array.from({ length: 300 }, (_, i) => `w${i}`).join(' ');
  const trimmed = long.split(' ').slice(0, 48).join(' ');
  const judge = (s: string) => duration.checkDurationDeviation(duration.estimateSpokenScript(s, 2.5).seconds, 20);

  assert.ok(judge(long), 'the untrimmed script must be flagged');
  assert.equal(judge(trimmed), null, 'trimming below tolerance must clear the flag');
});

test('11: the estimate counts spoken time consistently with what the voice vendor is actually sent', () => {
  const script =
    'THE HOOK:\n[warm, smiling] Never ignore this. <break time="1.5s"/> <emphasis level="strong">It matters</emphasis> a lot.';

  // prepareScriptForTts IS what ElevenLabs receives.
  const sentToVendor = audioLib.prepareScriptForTts(script);
  assert.doesNotMatch(sentToVendor, /THE HOOK/, 'the header is stripped before TTS');
  assert.doesNotMatch(sentToVendor, /\[warm/, 'bracketed direction is stripped before TTS');
  assert.match(sentToVendor, /<break time="1\.5s"\/>/, 'the break IS sent');
  assert.match(sentToVendor, /<emphasis/, 'emphasis IS sent');

  const est = duration.estimateSpokenScript(script, 2.5);
  // "Never ignore this. It matters a lot." — 7 spoken words. The header, the
  // bracketed direction and both markup tags cost zero words.
  assert.equal(est.words, 7);
  // ...and the break costs TIME, not words: 7/2.5 + 1.5 = 4.3s.
  assert.equal(est.seconds, 4.3);

  // Stripped direction costs nothing at all, in either dimension.
  assert.deepEqual(
    duration.estimateSpokenScript('[pause] one two three [smiling]', 2.5),
    duration.estimateSpokenScript('one two three', 2.5)
  );
});

test('12: a reel with no recorded target claims no overshoot and shows no invented number', () => {
  for (const estimate of [0, 5, 18, 65, 300]) {
    assert.equal(duration.checkDurationDeviation(estimate, null), null);
    assert.equal(duration.checkDurationDeviation(estimate, undefined), null);
    assert.equal(duration.checkDurationDeviation(estimate, 0), null);
  }

  // Decision 5: with no reel target the basis is the PIPELINE default — the
  // client_script / inject-script case, whose plan has no script stage and so
  // never records a target.
  const clientScriptReel = { target_duration_sec: null, pipeline_id: 'p-client-script' };
  assert.equal(
    duration.resolveOrderedDurationSec(clientScriptReel, [{ id: 'p-client-script', duration_default_sec: 30 }]),
    30
  );
  // ...and null, never a literal, when even that is gone.
  assert.equal(duration.resolveOrderedDurationSec(clientScriptReel, []), null);
});

// =============================================================================
// ITEM 3 — per-reel product-override toggle
// =============================================================================

test('18 [unit half]: with no product context the topic prompt is byte-identical to today\'s', () => {
  const RESEARCH = '=== RESEARCH DOC ===\nChoose three topics.';
  const compose = (job: Record<string, unknown>) =>
    RESEARCH + productLib.productBlock(job) + productLib.productPrecedenceBlock(job);

  // No photos: neither block contributes, however the flag is set.
  assert.equal(compose({ product_image_urls: [] }), RESEARCH);
  assert.equal(compose({ product_image_urls: [], product_overrides_research: true }), RESEARCH);
  assert.equal(compose({}), RESEARCH);
  assert.equal(compose({ product_overrides_research: true }), RESEARCH);

  // Photos but the flag off (today's behaviour, and the pre-0007 row shape):
  // the product block appears, the precedence clause does not.
  const withPhotos = { product_image_urls: ['https://cdn.example/a.jpg'] };
  const todayWithPhotos = RESEARCH + productLib.productBlock(withPhotos);
  assert.equal(compose(withPhotos), todayWithPhotos);
  assert.equal(compose({ ...withPhotos, product_overrides_research: false }), todayWithPhotos);
  assert.equal(compose({ ...withPhotos, product_overrides_research: null }), todayWithPhotos);
});

test('19: the product-override toggle changes no stage membership — every preset, every toggle combination', () => {
  // Which stages run is data (voiceover + injectScript). The override is prompt
  // weighting. If it ever became a stage axis, a reel would silently lose a
  // stage it was ordered with.
  for (const preset of stagesLib.PIPELINE_PRESETS) {
    for (const voiceover of [undefined, true, false]) {
      for (const injectScript of [undefined, true, false]) {
        const base = stagesLib.resolveReelStages(preset.stages, { voiceover, injectScript });
        const withFlag = stagesLib.resolveReelStages(preset.stages, {
          voiceover,
          injectScript,
          productOverridesResearch: true,
        } as never);
        assert.deepEqual(withFlag, base, `${preset.key} voiceover=${voiceover} injectScript=${injectScript}`);

        // ...and the read-back path: a row carrying the flag resolves the same plan.
        assert.deepEqual(
          stagesLib.getJobStagePlan({ stage_plan: base, product_overrides_research: true } as never),
          stagesLib.getJobStagePlan({ stage_plan: base, product_overrides_research: false } as never)
        );
      }
    }
  }
});

// =============================================================================
// ITEM 4 — no generation path changes
// =============================================================================

test('23: a still requested WITH reference images still goes to the generator that can see them', async () => {
  // Routing proof without a vendor call: the reference file deliberately does
  // not exist, and nanobanana_generator.py refuses a missing --ref (exit 2,
  // stderr) BEFORE it builds a request. imagen_generator.py would instead have
  // refused with "cannot condition", which is how we know which one ran.
  const dir = scratch('routing');
  const outPath = path.join(dir, 'still.jpg');
  const missingRef = path.join(dir, 'no-such-product.png');

  const visual = visualAdapters.getVisualAdapter('veo_imagen');
  const err = await visual
    .generateClip({
      prompt: 'a shot of the product on a table',
      negativePrompt: '',
      mediaType: 'image',
      outPath,
      referenceImages: [missingRef],
      models: {},
    })
    .then(
      () => null,
      (e: Error) => e
    );

  assert.ok(err, 'a missing reference file must fail the clip');
  assert.match(
    err!.message,
    /reference image not found/i,
    `expected nano banana (the generator that CAN see references); got: ${err!.message}`
  );
  assert.doesNotMatch(err!.message, /cannot condition/i, 'must not have been routed to Imagen');
  // Permanent: exit 2 stops the retry loop instead of burning three attempts.
  assert.match(err!.message, /cannot be retried/i);
  assert.equal(fs.existsSync(outPath), false, 'no partial artefact may be left behind');
});

// =============================================================================
// ITEM 5 — duration guard for no-voiceover concat reels
// Driven through the REAL concatBrolls / overlayBrolls with real ffmpeg.
// =============================================================================

test('24: a no-voiceover concat reel that tiles the ordered duration contiguously assembles exactly as today', async () => {
  const { clips } = await fixtures();
  const out = path.join(scratch('c24'), 'reel.mp4');

  // The proven variant-6 shape, scaled: contiguous, zero gaps, full order.
  const result = await assemblyLib.concatBrolls(
    placements(clips, [[0, 1], [1, 2], [2, 3]]),
    { orderedDurationSec: 3 },
    out
  );

  assert.deepEqual(result.warnings, [], 'a contiguous plan must not be flagged');
  assert.ok(fs.existsSync(out) && fs.statSync(out).size > 0, 'the reel must still be produced');
}, { timeout: 180_000 });

test('25: a no-voiceover concat reel whose plan leaves GAPS does not ship silently — the warning names ordered and covered seconds', async () => {
  const { clips } = await fixtures();
  const out = path.join(scratch('c25'), 'reel.mp4');

  // 15s ordered; the plan spans 0..11 but concat drops the gaps, so only 3s of
  // content actually survives. This is the M1 shape in its no-voiceover form.
  const result = await assemblyLib.concatBrolls(
    placements(clips, [[0, 1], [5, 6], [10, 11]]),
    { orderedDurationSec: 15 },
    out
  );

  assert.equal(result.warnings.length, 1, 'the shortfall must be reported');
  assert.match(result.warnings[0], /15\.0s/, 'the warning must name the ordered seconds');
  assert.match(result.warnings[0], /3\.0s/, 'the warning must name the covered seconds');
  // Decision 11: WARN, do not refuse. The reel still ships.
  assert.ok(fs.existsSync(out) && fs.statSync(out).size > 0, 'the reel must still ship');
}, { timeout: 180_000 });

test('26: the guard does not fire in overlay mode, where gaps are legitimate (the M1 axis)', async () => {
  const { clips, base } = await fixtures();
  const out = path.join(scratch('c26'), 'reel.mp4');

  // A deliberately gappy overlay plan over a 3s avatar base: the presenter shows
  // through the gap, so this must assemble without complaint. overlayBrolls has
  // no warning channel at all — it resolves undefined.
  const result = await assemblyLib.overlayBrolls(
    base,
    [
      { localPath: clips[0], start: 0, end: 1, isImage: false },
      { localPath: clips[1], start: 2, end: 3, isImage: false },
    ],
    out
  );

  assert.equal(result, undefined, 'overlay assembly reports no warnings — there is nothing to report');
  assert.ok(fs.existsSync(out) && fs.statSync(out).size > 0);
}, { timeout: 180_000 });

test('26 (edge case 9): a VOICEOVER concat reel is judged against its narration only, never twice', async () => {
  const { clips, voice } = await fixtures();
  const out = path.join(scratch('c26b'), 'reel.mp4');

  // Variant 5's shape: concat WITH a voiceover. The clips tile the ~3s
  // narration, so the narration guard passes. An ordered duration of 60s is
  // also supplied — if the no-voiceover guard were keyed on the wrong axis it
  // would raise a false alarm here.
  const result = await assemblyLib.concatBrolls(
    placements(clips, [[0, 1], [1, 2], [2, 3]]),
    { audioPath: voice, orderedDurationSec: 60 },
    out
  );

  assert.deepEqual(result.warnings, [], 'a voiceover concat reel must not be judged against the ordered duration too');
  assert.ok(fs.existsSync(out) && fs.statSync(out).size > 0);
}, { timeout: 180_000 });

test('27: voiceover reels keep today\'s narration-coverage behaviour, unchanged, at the existing threshold', async () => {
  const { clips, voice } = await fixtures();
  const out = path.join(scratch('c27'), 'reel.mp4');

  // The M1 defect shape, driven through the real concatBrolls: 3s of narration,
  // 1s of clips. It must still THROW (different severity from the new guard,
  // which warns) and produce nothing.
  const err = await assemblyLib
    .concatBrolls([{ localPath: clips[0], start: 0, end: 1, isImage: false }], { audioPath: voice }, out)
    .then(
      () => null,
      (e: Error) => e
    );

  assert.ok(err, 'an under-tiled voiceover concat plan must still be REFUSED, not warned about');
  assert.match(err!.message, /covers only 1\.0s of the 3\.0s voiceover/);
  assert.match(err!.message, /regenerate the B-roll plan/);
  assert.equal(fs.existsSync(out), false, 'nothing may be produced from a refused plan');

  // The threshold and message shape are untouched by the new sibling guard.
  assert.equal(coverage.MIN_NARRATION_COVERAGE, 0.95);
  assert.equal(coverage.checkNarrationCoverage([28.5], 30), null, 'exactly 95% still passes');
  assert.ok(coverage.checkNarrationCoverage([28.4], 30), 'just below 95% still fails');
  assert.equal(coverage.checkNarrationCoverage([40], 30), null, 'over-coverage still passes');
}, { timeout: 180_000 });

test('28: the guard never invents an ordered duration', async () => {
  // Pure: nothing in, nothing claimed.
  for (const unknown of [null, undefined, 0, Number.NaN]) {
    assert.equal(coverage.checkOrderedDurationCoverage([1, 1], unknown as never), null);
    assert.equal(coverage.checkOrderedDurationCoverage([], unknown as never), null);
    assert.equal(coverage.checkOrderedDurationCoverage([0.1], unknown as never), null);
  }

  // ...and through the real assembly path: a reel whose ordered duration could
  // not be resolved assembles with no warning rather than against a literal.
  const { clips } = await fixtures();
  const out = path.join(scratch('c28'), 'reel.mp4');
  const result = await assemblyLib.concatBrolls(
    placements(clips, [[0, 1], [5, 6], [10, 11]]),
    { orderedDurationSec: null },
    out
  );
  assert.deepEqual(result.warnings, [], 'with no ordered duration there is nothing to fall short of');
}, { timeout: 180_000 });

test('25 (decision 11): the ordered-duration guard RETURNS a string and never throws', () => {
  assert.doesNotThrow(() => coverage.checkOrderedDurationCoverage([1], 60));
  assert.equal(typeof coverage.checkOrderedDurationCoverage([1], 60), 'string');
  assert.doesNotThrow(() => coverage.checkOrderedDurationCoverage([], 60));
});

// =============================================================================
// ITEM 6 — a failed file write fails the stage
// =============================================================================

test('29: an unwritable destination fails within seconds and does not take the process down', async () => {
  // Decision 13 (empirically settled): before the fix an unwritable destination
  // emitted an UNHANDLED WriteStream 'error' — an uncaught exception that exits
  // the process and every reel in flight with it. Proven here in a CHILD
  // process, because "the process survived" is not observable in-process.
  const server = await serve((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'image/png' });
    res.end(Buffer.alloc(4096, 1));
  });
  const dir = scratch('c29');
  const dest = path.join(dir, 'no-such-directory', 'presenter.png');
  const childPath = path.join(dir, 'child.mjs');
  fs.writeFileSync(
    childPath,
    `const m = await import(${JSON.stringify(pathToFileURL(path.join(LIB, 'pipeline', 'download.ts')).href)});\n` +
      `try { await m.downloadToFile(${JSON.stringify(server.url('/p.png'))}, ${JSON.stringify(dest)}); console.log('RESOLVED'); }\n` +
      `catch (e) { console.log('REJECTED ' + e.message); }\n`
  );

  const started = Date.now();
  try {
    const child = await runNode(['--experimental-strip-types', childPath], 30_000);
    const elapsed = Date.now() - started;

    assert.equal(child.code, 0, `the process must SURVIVE a write failure; stderr: ${child.stderr}`);
    assert.match(child.stdout, /^REJECTED /m, `expected a rejection, got: ${child.stdout}`);
    assert.match(child.stdout, /Failed to write/, 'the rejection must name the write failure');
    assert.doesNotMatch(child.stderr, /ERR_UNHANDLED_ERROR|Uncaught|uncaughtException/);
    assert.ok(elapsed < 20_000, `must fail within seconds, took ${elapsed}ms`);
  } finally {
    await server.close();
  }
}, { timeout: 60_000 });

test('30: the reason is the write failure itself, not "Command failed" and not a downstream symptom', async () => {
  const server = await serve((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'image/png' });
    res.end(Buffer.alloc(4096, 1));
  });
  const dir = scratch('c30');
  try {
    // Two different unwritable destinations, two different OS errors — both must
    // surface as the write failure, naming the destination.
    const missingDir = path.join(dir, 'nope', 'out.png');
    const err1 = await downloadLib.downloadToFile(server.url('/p.png'), missingDir).then(
      () => null,
      (e: Error) => e
    );
    assert.ok(err1);
    assert.match(err1!.message, /Failed to write/);
    assert.ok(err1!.message.includes(missingDir), 'the message must name the destination');
    assert.match(err1!.message, /ENOENT|EACCES|EPERM/);
    assert.doesNotMatch(err1!.message, /Command failed/);

    // A destination that is a directory — the "permission denied / unwritable
    // path" class, and the one that previously killed the process.
    const dirDest = path.join(dir, 'a-directory');
    fs.mkdirSync(dirDest);
    const err2 = await downloadLib.downloadToFile(server.url('/p.png'), dirDest).then(
      () => null,
      (e: Error) => e
    );
    assert.ok(err2);
    assert.match(err2!.message, /Failed to write/);
    assert.match(err2!.message, /EISDIR|EACCES|EPERM/);
    assert.equal(fs.existsSync(dirDest), true, 'the guard must not destroy what was already there');
  } finally {
    await server.close();
  }
}, { timeout: 60_000 });

test('31: a partially written file is never left behind to be used as though complete', async () => {
  // Story edge case 12: the download fails AFTER most of the file is written.
  // The server declares 200_000 bytes, sends 20_000, then drops the socket.
  const server = await serve((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': '200000' });
    res.write(Buffer.alloc(20_000, 7));
    setTimeout(() => res.socket?.destroy(), 50);
  });
  const dest = path.join(scratch('c31'), 'avatar.mp4');
  try {
    const err = await downloadLib.downloadToFile(server.url('/v.mp4'), dest).then(
      () => null,
      (e: Error) => e
    );
    assert.ok(err, 'a truncated download must reject, not resolve with a short file');
    assert.equal(fs.existsSync(dest), false, 'no partial file may remain at the destination');
  } finally {
    await server.close();
  }
}, { timeout: 60_000 });

test('32 [single-download half]: a successful download is unaffected — exact bytes, chunked, with its content type', async () => {
  // A multi-chunk body, so the streaming loop is exercised rather than a single
  // read. The full-reel regression is outside the authorized budget.
  const body = Buffer.concat(
    Array.from({ length: 40 }, (_, i) => Buffer.alloc(8192, i % 251))
  );
  const server = await serve((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'image/webp; charset=binary', 'Content-Length': String(body.length) });
    for (let i = 0; i < body.length; i += 8192) res.write(body.subarray(i, i + 8192));
    res.end();
  });
  const dest = path.join(scratch('c32'), 'presenter.bin');
  try {
    const result = await downloadLib.downloadToFile(server.url('/p'), dest);
    assert.deepEqual(fs.readFileSync(dest), body, 'the written bytes must be byte-identical');
    assert.equal(result.contentType, 'image/webp', 'the content type is reported, parameters stripped');
  } finally {
    await server.close();
  }
}, { timeout: 60_000 });

// =============================================================================
// ITEM 7 — one photo-size limit
// =============================================================================

test('36 [unit half]: the limit the Studio states is EXACTLY the limit that is enforced, both directions', () => {
  // One number, read off the script adapter. /api/uploads enforces it per file,
  // GET ui-config prints Math.floor(bytes / 1024 / 1024), and fetchProductImages
  // enforces it as the reel total — all three from this one property.
  const bytes = scriptAdapters.getScriptAdapter('gemini').maxInlineImagePayloadBytes;
  assert.equal(typeof bytes, 'number');
  assert.ok(bytes > 0);

  const statedMb = Math.floor(bytes / 1024 / 1024);
  assert.equal(
    statedMb * 1024 * 1024,
    bytes,
    'the stated whole-MB limit must be lossless: a stated number below the enforced one under-promises, above it over-promises'
  );
  assert.equal(statedMb, 12, 'GATE 2 amendment 3 confirmed 12 MB raw');
});

test('34: the photo-size limit is a per-reel TOTAL, and the boundary is the same comparison on both surfaces', async () => {
  // Driven through the real fetchProductImages over localhost. The predicate is
  // `total > limit`, matching /api/uploads' `file.size > limit`: a photo exactly
  // at the limit is accepted by both, so nothing accepted at upload is rejected
  // for size by a stage on the single-photo path.
  const sizes: Record<string, number> = { '/a': 400, '/b': 400, '/c': 400, '/exact': 1000, '/over': 1001 };
  const server = await serve((req, res) => {
    const n = sizes[(req.url ?? '').split('?')[0]] ?? 100;
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': String(n) });
    res.end(Buffer.alloc(n, 9));
  });
  try {
    const opts = { maxImages: 3, maxTotalBytes: 1000 };

    // Exactly at the limit — accepted.
    const atLimit = await productLib.fetchProductImages({ product_image_urls: [server.url('/exact')] }, opts);
    assert.equal(atLimit.length, 1);
    assert.equal(atLimit[0].mimeType, 'image/jpeg');

    // One byte over — refused, naming both numbers in MB.
    const over = await productLib
      .fetchProductImages({ product_image_urls: [server.url('/over')] }, opts)
      .then(() => null, (e: Error) => e);
    assert.ok(over, 'one byte over the limit must be refused');
    assert.match(over!.message, /total/i);
    assert.match(over!.message, /MB/);

    // Three photos, each individually unremarkable, together over the ceiling —
    // the case a per-image cap cannot see (decision 14).
    const total = await productLib
      .fetchProductImages(
        { product_image_urls: [server.url('/a'), server.url('/b'), server.url('/c')] },
        { maxImages: 3, maxTotalBytes: 1000 }
      )
      .then(() => null, (e: Error) => e);
    assert.ok(total, 'three photos totalling 1200 bytes must be refused against a 1000-byte total');

    // ...and the same three pass when the total allows them.
    const ok = await productLib.fetchProductImages(
      { product_image_urls: [server.url('/a'), server.url('/b'), server.url('/c')] },
      { maxImages: 3, maxTotalBytes: 1200 }
    );
    assert.equal(ok.length, 3);
  } finally {
    await server.close();
  }
}, { timeout: 60_000 });

test('34 [creation half]: the reel-creation check measures the SAME axis and the SAME bytes as the stage', async () => {
  // The gap this closes: /api/uploads sees one file at a time, so three photos
  // that each pass upload can still blow the reel total — and the reel row would
  // already exist by the time a stage found out, with the picker off screen.
  // POST /api/jobs now measures the reel's whole photo set through
  // measureProductPayloadBytes and refuses through the same productPayloadRefusal
  // that fetchProductImages uses. Driven over localhost; nothing is stubbed.
  const sizes: Record<string, number> = { '/a': 400, '/b': 400, '/c': 400, '/nolength': 300 };
  const server = await serve((req, res) => {
    const p = (req.url ?? '').split('?')[0];
    if (p === '/gone') {
      res.writeHead(404);
      res.end();
      return;
    }
    const n = sizes[p] ?? 100;
    const headers: Record<string, string> = { 'Content-Type': 'image/jpeg' };
    // /nolength answers HEAD without a usable Content-Length — a CDN or proxy
    // that strips it must not turn into a guess, it must fall back to the body.
    if (!(req.method === 'HEAD' && p === '/nolength')) headers['Content-Length'] = String(n);
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : Buffer.alloc(n, 9));
  });
  try {
    const urls = [server.url('/a'), server.url('/b'), server.url('/c')];

    // The number creation sees is the number the stage will see.
    const measured = await productLib.measureProductPayloadBytes(urls);
    assert.equal(measured, 1200, 'creation must total the reel, not measure one file');
    const atTotal = await productLib.fetchProductImages(
      { product_image_urls: urls },
      { maxImages: 3, maxTotalBytes: measured }
    );
    assert.equal(atTotal.length, 3, 'the stage accepts exactly what creation measured');
    const oneLess = await productLib
      .fetchProductImages({ product_image_urls: urls }, { maxImages: 3, maxTotalBytes: measured - 1 })
      .then(() => null, (e: Error) => e);
    assert.ok(oneLess, 'the stage refuses one byte below what creation measured — same boundary');

    // ...so the two surfaces agree on the verdict for the same reel.
    const limit = 1000;
    assert.ok(
      productLib.productPayloadRefusal(measured, limit),
      'creation must refuse the set the stage would refuse'
    );
    const stage = await productLib
      .fetchProductImages({ product_image_urls: urls }, { maxImages: 3, maxTotalBytes: limit })
      .then(() => null, (e: Error) => e);
    assert.ok(stage);
    assert.equal(
      stage!.message,
      productLib.productPayloadRefusal(measured, limit),
      'one wording, so the user is told the same thing wherever they hit it'
    );

    // A stripped Content-Length falls back to reading the body — exact, not a guess.
    assert.equal(await productLib.measureProductPayloadBytes([server.url('/nolength')]), 300);

    // An unmeasurable photo is never silently counted as zero.
    const unreadable = await productLib
      .measureProductPayloadBytes([server.url('/a'), server.url('/gone')])
      .then(() => null, (e: Error) => e);
    assert.ok(unreadable, 'a photo whose size cannot be established must throw, not pass');
    assert.match(unreadable!.message, /PRODUCT_PHOTO_UNREADABLE/);

    // A reel with no photos costs nothing and is never refused.
    assert.equal(await productLib.measureProductPayloadBytes([]), 0);
    assert.equal(productLib.productPayloadRefusal(0, limit), null);
  } finally {
    await server.close();
  }
}, { timeout: 60_000 });

test('36 [message half]: the upload refusal states the reel-total axis, not a second per-file limit', () => {
  // The Studio states "a reel can carry N MB of product photos in total"; the
  // upload route refuses a single file against that same total. The two must not
  // read as two different limits (the old wording was "File exceeds 12 MB").
  const bytes = scriptAdapters.getScriptAdapter('gemini').maxInlineImagePayloadBytes;
  const msg = productLib.productPhotoTooLargeMessage(bytes + 1, bytes);
  assert.match(msg, /total/i);
  assert.match(msg, /reel/i);
  assert.match(msg, new RegExp(`${Math.floor(bytes / 1024 / 1024)}\\.0 MB`));
});

test('37 [enforcement half]: the per-reel photo COUNT limit is still enforced, from the adapter', async () => {
  const server = await serve((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': '10' });
    res.end(Buffer.alloc(10, 3));
  });
  try {
    const urls = [server.url('/1'), server.url('/2'), server.url('/3'), server.url('/4'), server.url('/5')];
    // The count comes from the visual adapter, never a parallel constant.
    const maxImages = visualAdapters.getVisualAdapter('veo_imagen').maxReferenceImages;
    assert.equal(maxImages, 3);

    const got = await productLib.fetchProductImages({ product_image_urls: urls }, { maxImages, maxTotalBytes: 10_000 });
    assert.equal(got.length, maxImages, 'no more than the adapter\'s count may reach the model');
  } finally {
    await server.close();
  }
}, { timeout: 60_000 });

// =============================================================================
// ITEM 8 — the presenter still declares its real format
// =============================================================================

test('38: the presenter still is handed to the composite step declaring the format it actually IS', async () => {
  // The route's resolution chain, driven end to end:
  //   URL extension  ->  else the download's own Content-Type  ->  else throw.
  // Then the resulting FILE NAME is what the Python compositor resolves its MIME
  // from, so the two sides must agree across the language boundary.
  const resolveExt = (url: string, contentType: string | null) =>
    downloadLib.extensionFromUrl(url) ?? downloadLib.extensionFromMimeType(contentType);

  // Decision 16: HeyGen serves .webp for 3 of Kiran's 4 avatars and .jpg for one.
  assert.equal(resolveExt('https://files2.heygen.ai/avatar/v3/a/preview_talk_1.webp', 'image/webp'), '.webp');
  assert.equal(resolveExt('https://resource2.heygen.ai/avatar/v3/b/preview_target.jpg', 'image/jpeg'), '.jpg');
  assert.equal(resolveExt('https://files2.heygen.ai/avatar/v3/c/p.webp?Expires=1&Signature=x%2Fy', 'image/webp'), '.webp');

  // The Content-Type fallback, exercised over a real download of an
  // extension-less CDN path — the shape a signed CDN URL takes.
  const server = await serve((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'image/webp' });
    res.end(Buffer.alloc(64, 5));
  });
  const dir = scratch('c38');
  try {
    const dest = path.join(dir, 'presenter.download');
    const { contentType } = await downloadLib.downloadToFile(server.url('/9f3ab21c0e'), dest);
    const ext = resolveExt(server.url('/9f3ab21c0e'), contentType);
    assert.equal(ext, '.webp', 'an extension-less URL must fall back to its Content-Type, not to .jpg');
  } finally {
    await server.close();
  }

  // Cross-language: the file name the route builds is what the compositor reads.
  const code = [
    'import sys',
    `sys.path.insert(0, ${JSON.stringify(LIB.replace(/\\/g, '/'))})`,
    'from nanobanana_generator import reference_mime_type',
    'print(reference_mime_type("presenter.webp"), reference_mime_type("presenter.jpg"), reference_mime_type("presenter.png"))',
  ].join('\n');
  const res = spawnSync(PY, ['-c', code], { cwd: TMP, encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr);
  assert.equal(
    res.stdout.trim(),
    'image/webp image/jpeg image/png',
    'a presenter named for its real extension must declare that format to the compositor'
  );
}, { timeout: 60_000 });

test('39: a presenter URL with no usable extension does not produce a confidently wrong declaration', () => {
  const resolveExt = (url: string, contentType: string | null) =>
    downloadLib.extensionFromUrl(url) ?? downloadLib.extensionFromMimeType(contentType);

  // No extension, no usable Content-Type -> nothing. The route turns this into
  // the graceful talking-head downgrade instead of declaring image/jpeg.
  assert.equal(resolveExt('https://cdn.example.com/assets/9f3ab21c0e', 'application/octet-stream'), null);
  assert.equal(resolveExt('https://cdn.example.com/assets/9f3ab21c0e', null), null);
  assert.equal(resolveExt('https://cdn.example.com/assets/9f3ab21c0e?format=auto', undefined as never), null);
  assert.equal(resolveExt('https://cdn.example.com/assets/thing.bin', 'text/html'), null);

  // ...and it is never a guess in the other direction either: a real extension
  // wins over a wrong Content-Type.
  assert.equal(resolveExt('https://cdn.example.com/a/p.webp', 'application/octet-stream'), '.webp');
});

// =============================================================================
// CROSS-CUTTING
// =============================================================================

test('41: every test file in tests/ is listed in package.json\'s test script — there is no glob', () => {
  // The failure mode this criterion exists to catch: a new test file that is
  // never run, so the suite is green about code nobody executed.
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const script: string = pkg.scripts.test;

  const onDisk = fs
    .readdirSync(path.join(ROOT, 'tests'))
    .filter((f) => /\.test\.(ts|mts|mjs|js)$/.test(f))
    .sort();

  assert.ok(onDisk.length > 0);
  for (const file of onDisk) {
    assert.ok(
      script.includes(`tests/${file}`),
      `tests/${file} exists but is NOT in package.json's test script — it would silently never run`
    );
  }

  // ...and nothing listed is missing from disk.
  for (const listed of script.match(/tests\/[\w.-]+/g) ?? []) {
    assert.ok(fs.existsSync(path.join(ROOT, listed)), `${listed} is listed but does not exist`);
  }
});

test('44: the browser cannot change a reel\'s BEHAVIOUR after creation — the PATCH allowlist filters it out', async () => {
  // The real allowlist from the real jobs.ts. product_overrides_research is a
  // per-reel behaviour flag: allowing it here would let any authenticated user
  // of the owning client re-weight the prompt on an already-created reel and
  // then trigger an admin retry under weighting the reel was never ordered with.
  const filtered = jobsLib.filterJobPatch({
    product_overrides_research: true,
    stage_plan: ['topic', 'assemble'],
    client_id: 'someone-else',
    pipeline_id: 'another-pipeline',
    current_stage: 'assemble',
    stage_status: 'done',
    final_video_url: 'https://evil.example/reel.mp4',
    provider_job_ids: { heygen: 'x' },
    audio_url: 'https://evil.example/a.mp3',
    avatar_video_url: 'https://evil.example/v.mp4',
    broll_plan: [],
    error: null,
    broll_frequency: 'Minimal', // item 1's field — already allowlisted, stays so
  });

  assert.deepEqual(
    filtered,
    { broll_frequency: 'Minimal' },
    'only the fields a user edits by hand may survive a public PATCH'
  );

  // ...and a PATCH carrying ONLY the behaviour flag is refused before any DB
  // write is attempted (no Supabase client is ever constructed).
  const err = await jobsLib.updateJob('any-job-id', { product_overrides_research: true }).then(
    () => null,
    (e: Error) => e
  );
  assert.ok(err, 'a PATCH of only non-allowlisted fields must be refused');
  assert.equal(err!.message, 'No valid job fields in patch');
  assert.doesNotMatch(err!.message, /supabase|SUPABASE|fetch/i, 'it must not have reached the database');
});

test('43 [partial — no-DB half]: the tenancy guards refuse a foreign client and leak nothing with the refusal', async () => {
  // Full proof needs the DB (a cross-client jobId against each touched route).
  // What is provable without one: the guards every touched route runs, and that
  // their refusals carry no data.
  const clientUser = { email: 'a@example.com', role: 'client' as const, clientId: 'client-a' };

  assert.equal(authLib.forbidClientMismatch(clientUser, 'client-a'), null, 'own client is allowed');

  const denied = authLib.forbidClientMismatch(clientUser, 'client-b');
  assert.ok(denied, 'another client must be refused');
  assert.equal(denied!.status, 403);
  const deniedBody = await denied!.json();
  assert.deepEqual(deniedBody, { error: 'Access to this client is not allowed' });
  assert.doesNotMatch(JSON.stringify(deniedBody), /client-b|client-a/, 'the refusal must not echo tenant ids');

  // Off-plan stages are refused with 409 and no job data.
  const offPlan = jobsLib.stageNotInPlan({ stage_plan: ['topic', 'assemble'] } as never, 'avatar');
  assert.ok(offPlan);
  assert.equal(offPlan!.status, 409);
  const offPlanBody = await offPlan!.json();
  assert.deepEqual(Object.keys(offPlanBody), ['error']);
  assert.match(offPlanBody.error, /not part of this reel's pipeline/);
  assert.equal(jobsLib.stageNotInPlan({ stage_plan: ['topic', 'assemble'] } as never, 'topic'), null);
});
