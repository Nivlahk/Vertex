const fs = require('fs');
const { IVXKernel } = require('./ivx_kernel.js');
const { wordParse } = require('./word_kh.js');
const { registerKHKinds, summarizeTrace } = require('./ivx_semantic.js');

const coreSrc = fs.readFileSync(__dirname + '/core.js', 'utf8');
const runtimeSrc = fs.readFileSync(__dirname + '/runtime.js', 'utf8');

const setup = `
const kernel = new IVXKernel();
kernel.word('kh', wordParse);
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
registerKHKinds(kernel);

const ivxProgram = `
# Absorbed: real structure, several different statement kinds so match()
# actually has more than one case to prove out.
word kh <<<
make total 0
if total = 0
    print "starting"
    say "beginning run"
for x in items
    print x
>>>

# Hosted: same real KH program as before, still opaque past the boundary.
bind kh_run(source: "make doubled principal * 2\\nmake bonus doubled + 100\\nprint bonus", principal: 250) -> doubled, bonus
`;

(async () => {
  await kernel.run(ivxProgram);
  console.log(summarizeTrace(kernel).join('\n'));
})().catch(e => console.error('ERROR:', e));
