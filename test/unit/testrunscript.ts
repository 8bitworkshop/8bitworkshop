import assert from "assert";
import * as fs from "fs";
import { describe, it } from "mocha";
import { hashState } from "../../src/common/statehash";
import { formatTimestamp } from "../../src/common/timeline";
import { hex } from "../../src/common/util";
import { EmuTarget, loadPlatform } from "../../src/tools/emutarget";
import { RunScript } from "../../src/tools/runscript";

// The run-script commands that move backwards in time: back, seek, rewind,
// rbreak, now. They drive EmuCore's timeline, so going back and forward again
// has to land on the same state.

async function open() {
  const t = await loadPlatform('mw8080bw');
  await t.start();
  await t.loadROM(new Uint8Array(fs.readFileSync('test/roms/mw8080bw/game2.c.rom')));
  let out = '';
  const script = new RunScript(t, (s: string) => { out += s; });
  return { t, script, output: () => { const s = out; out = ''; return s; } };
}

function stateOf(t: EmuTarget) { return hashState(t.machine.saveState()); }

describe('RunScript time travel', function () {
  this.timeout(60000);

  it('labels output with the frame and step', async function () {
    const { script, output } = await open();
    script.run('run 3; step 2');
    const out = output();
    assert.match(out, /^\[3:0\] ran 3 frames$/m);
    assert.match(out, /^\[3:2\] PC=\$[0-9A-F]{4}$/m);
  });

  it('steps back to where it stepped from', async function () {
    const { t, script, output } = await open();
    script.run('run 5; step 1');
    const pc = t.getPC();
    const state = stateOf(t);
    script.run('step 7; back 7');
    assert.strictEqual(t.getPC(), pc);
    assert.strictEqual(stateOf(t), state);
    assert.match(output(), new RegExp(`PC=\\$${hex(pc, 4)}`));
  });

  it('seeks to a frame and step, and back to the present', async function () {
    const { t, script, output } = await open();
    script.run('run 12');
    const present = stateOf(t);
    script.run('seek 4:10; now');
    assert.strictEqual(formatTimestamp(t.now()), '4:10');
    assert.match(output(), /at 4:10 \(past; recorded 0:0 to 12:0\)/);
    script.run('seek 12');
    assert.strictEqual(stateOf(t), present);
    assert.ok(!t.isInPast());
  });

  it('rewinds whole frames, to a frame start', async function () {
    const { t, script } = await open();
    script.run('run 10; rewind 3');
    assert.strictEqual(formatTimestamp(t.now()), '7:0');
    script.run('step 5; rewind');
    assert.strictEqual(formatTimestamp(t.now()), '7:0');
  });

  it('runs back to the last time the PC was somewhere', async function () {
    const { t, script, output } = await open();
    script.run('run 10; step 1');
    const pc = t.getPC();
    const when = t.now();
    script.run('run 5');
    output();
    script.run(`rbreak $${hex(pc, 4)}`);
    assert.match(output(), /HIT/);
    assert.strictEqual(t.getPC(), pc);
    assert.ok(t.isInPast());
    // the last visit, which is no earlier than the one we saw
    assert.ok(t.now().frame >= when.frame);
  });

  it('reports a miss and stays put', async function () {
    const { t, script, output } = await open();
    script.run('run 5');
    script.run('rbreak $FFFF');
    assert.match(output(), /MISSED/);
    assert.strictEqual(formatTimestamp(t.now()), '5:0');
  });

  it('lists debug tree entries', async function () {
    const { script, output } = await open();
    script.run('tree');
    assert.match(output(), /^state\/$/m);
  });
});
