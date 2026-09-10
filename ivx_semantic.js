// ── ivx_semantic.js ─────────────────────────────────────────────────────
// Registers kind()s for the statement shapes KH's word-absorbed AST
// actually produces, plus a single deliberately-terminal 'Opaque' kind for
// whatever a bind() call returns. Then runs the SAME match()-based
// summarizer over both fidelity levels in kernel.trace, so the difference
// between them shows up as running code, not as a claim about them.

function registerKHKinds(kernel) {
  kernel.kind('Assign', ['name', 'expr']);
  kernel.kind('If', ['condition', 'body', 'else_']);
  kernel.kind('Print', ['expr']);
  kernel.kind('Speak', ['expr']);
  kernel.kind('For', ['iterVar', 'body']);
  kernel.kind('Loop', ['condition', 'body']);
  // The one kind on the hosted side of the fence. Notice it has no
  // internal structure to speak of -- 'output' and 'results' are already
  // as deep as it goes, because a bind() call is opaque by construction,
  // not by an omission we could patch later.
  kernel.kind('Opaque', ['name', 'output', 'results']);
}

// Raw word-absorbed AST node -> kinded value. Anything not in this list
// stays a plain, un-kinded object -- still inspectable by hand, just not
// dispatchable through match(). That's an honest gap in THIS converter's
// coverage, not a claim that absorption itself has a ceiling here.
function toKindValue(kernel, node) {
  if (!node || typeof node !== 'object') return node;
  const KNOWN = new Set(['Assign', 'If', 'Print', 'Speak', 'For', 'Loop']);
  if (!KNOWN.has(node.type)) return node;
  const fields = {
    Assign: { name: node.name, expr: node.expr },
    If: { condition: node.condition, body: node.body, else_: node.else_ },
    Print: { expr: node.expr },
    Speak: { expr: node.expr },
    For: { iterVar: node.iterVar, body: node.body },
    Loop: { condition: node.condition, body: node.body },
  }[node.type];
  return kernel.make(node.type, fields);
}

function summarizeStatement(kernel, node) {
  const kinded = toKindValue(kernel, node);
  if (!kinded || typeof kinded !== 'object' || !kinded.__kind) {
    return `(un-kinded node: ${node?.type ?? typeof node})`;
  }
  return kernel.match(kinded, [
    { kind: 'Assign', then: v => `assigns '${v.name}' from a ${v.expr.type} expression` },
    { kind: 'If', then: v => `branches on a ${v.condition.type} condition -- ${v.body.length} statement(s) if true` +
        (v.else_ ? `, ${v.else_.length} if false` : '') },
    { kind: 'Print', then: v => `prints a ${v.expr.type} expression` },
    { kind: 'Speak', then: v => `speaks a ${v.expr.type} expression` },
    { kind: 'For', then: v => `iterates as '${v.iterVar}' over ${v.body.length} statement(s)` },
    { kind: 'Loop', then: v => `loops while a ${v.condition.type} condition holds, ${v.body.length} statement(s)` },
    { kind: '_', then: v => `(unhandled kind '${v.__kind}')` },
  ]);
}

// Runs the same match() machinery over the whole trace. The absorbed
// branch recurses into real structure; the hosted branch has exactly one
// case because Opaque has exactly one shape -- that asymmetry is the
// point, and it's enforced by match() throwing on anything it can't
// dispatch, not by this function choosing to stop early.
function summarizeTrace(kernel) {
  const lines = [];
  for (const entry of kernel.trace) {
    if (entry.fidelity === 'absorbed') {
      if (entry.error) { lines.push(`[absorbed '${entry.trigger}'] parse error: ${entry.error}`); continue; }
      lines.push(`[absorbed '${entry.trigger}'] ${entry.ast.body.length} statement(s):`);
      for (const stmt of entry.ast.body) lines.push(`  - ${summarizeStatement(kernel, stmt)}`);
    } else {
      const opaque = kernel.make('Opaque', {
        name: entry.name,
        output: entry.result?.output ?? [],
        results: entry.result?.results ?? {},
      });
      lines.push(kernel.match(opaque, [
        { kind: 'Opaque', then: v =>
          `[hosted '${v.name}'] produced ${v.output.length} output line(s), ` +
          `${Object.keys(v.results).length} read-back value(s) -- ` +
          `nothing further to match into; this is as deep as a bind() result goes` },
      ]));
    }
  }
  return lines;
}

module.exports = { registerKHKinds, toKindValue, summarizeStatement, summarizeTrace };
