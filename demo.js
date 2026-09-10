const fs = require('fs');
const { IVXKernel, FIDELITY } = require('./ivx_kernel.js');
const { wordParse } = require('./word_kh.js');

const coreSrc = fs.readFileSync(__dirname + '/core.js', 'utf8');
const runtimeSrc = fs.readFileSync(__dirname + '/runtime.js', 'utf8');

// Interpreter/Env/ivxRepr only exist inside this eval's own scope (classes
// declared via direct eval don't leak the way function declarations do --
// found the hard way two messages ago), so the bind() registration that
// needs `new Interpreter(...)` has to live in this same eval call.
const setup = `
const kernel = new IVXKernel();

// ── word: absorb KH's own syntax into a real, inspectable IVX AST.
// This is the exact subset parser validated earlier (6/8 constructs
// matching the real KH parser node-for-node, one KH parser bug found
// along the way). Nothing new here -- just registered as a first-class
// handler instead of a standalone script.
kernel.word('kh', wordParse);

// ── bind: host KH's real, unmodified interpreter as an opaque call.
// ctx.inject over-rides KH's static type-checker gate the same way the
// hosting experiment had to (ignoreTypeErrors: true) -- that's not a
// shortcut, it's the actual requirement that experiment surfaced.
kernel.bind('kh_run', async (args, readBackNames) => {
  const outputLines = [];
  const interp = new Interpreter({
    onOutput: (v) => outputLines.push(ivxRepr(v)),
    onError: (e) => outputLines.push('ERROR: ' + e.message),
  });
  const { source, ...inputs } = args;
  for (const [name, value] of Object.entries(inputs)) interp.globals.set(name, value);
  await interp.run(source, { ignoreTypeErrors: true });
  const results = {};
  for (const name of readBackNames) results[name] = interp.globals.get(name);
  return { output: outputLines, results };
});

module.exports.kernel = kernel;
`;

eval(coreSrc + '\n' + runtimeSrc + '\n' + setup);
const kernel = module.exports.kernel;

// ── The demo IVX program itself -- one word block, one bind call,
// deliberately doing DIFFERENT things so the fidelity split is visible
// rather than incidental.
const ivxProgram = `
# Absorbed: a KH assignment/loop snippet, parsed into IVX's own AST.
# This is real structure Vertex could zoom/transform -- it never touches
# KH's actual interpreter.
word kh <<<
make total 0
if total = 0
    print "starting"
>>>

# Hosted: a full, real KH program, executed by KH's own unmodified
# interpreter via bind. Host injects principal, KH computes with it,
# host reads results back out. Opaque to IVX -- correct, not zoomable.
bind kh_run(source: "make doubled principal * 2\\nmake bonus doubled + 100\\nprint bonus", principal: 250) -> doubled, bonus
`;

(async () => {
  const trace = await kernel.run(ivxProgram);
  for (const entry of trace) {
    console.log(`\n[${entry.fidelity}]`, entry.trigger ? `word '${entry.trigger}'` : `bind '${entry.name}'`);
    if (entry.error) { console.log('  error:', entry.error); continue; }
    if (entry.fidelity === FIDELITY.ABSORBED) {
      console.log('  AST (real IVX structure, zoomable):');
      console.log('  ', JSON.stringify(entry.ast));
    } else {
      console.log("  KH's own output:", entry.result.output);
      console.log('  values read back into IVX:', entry.result.results);
    }
  }
})().catch(e => console.error('KERNEL ERROR:', e));
