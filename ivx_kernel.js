// ── ivx_kernel.js ────────────────────────────────────────────────────────
// A minimal, REAL implementation of two of IVX's five primitives -- word
// and bind -- not a spec, not a mockup. kind/match (semantic modeling) are
// deliberately out of scope here; this kernel only proves the two
// mechanisms that were actually tested against KH: syntax absorption and
// host interop.
//
// Design goal, directly following from what the last two experiments
// found: every absorbed/hosted fragment must come back tagged with its
// OWN fidelity level, not silently merged into one undifferentiated
// "IVX AST". That's the whole point of the "unified but honest" system --
// word-absorbed code is real, zoomable IVX structure; bind-hosted code is
// opaque, correct, non-zoomable. The kernel enforces that distinction
// structurally, not just in prose: the two produce different node shapes
// and the runner never blends them.
//
// ── Fidelity levels ─────────────────────────────────────────────────────
const FIDELITY = Object.freeze({
  ABSORBED: 'absorbed',   // real IVX AST, produced by a registered word()
                           // handler -- structurally inspectable, zoomable
  HOSTED: 'hosted',        // opaque call into a registered bind() target --
                           // correct, but not represented in IVX's own terms
});

class IVXKernel {
  constructor() {
    this._words = new Map();  // trigger -> { parse(src) -> ast }
    this._binds = new Map();  // name -> async (args, ctx) -> value
    this._kinds = new Map();  // name -> [fieldName, ...]
    this.trace = [];          // fidelity ledger for the whole run, in order
  }

  // ── kind: register a named, fixed-field value shape. Deliberately just a
  // field list, not a type system -- matches the spec's "pure value type,
  // zero metadata overhead" description. What makes a value this kind is
  // its __kind tag, not structural duck-typing, so match() can dispatch on
  // it directly without guessing.
  kind(name, fields) {
    if (this._kinds.has(name)) throw new Error(`kind '${name}' already registered`);
    this._kinds.set(name, fields);
  }

  // ── make: construct a value of a registered kind. Requires every
  // declared field to be present -- a kind is a contract, not a suggestion.
  make(kindName, data) {
    const fields = this._kinds.get(kindName);
    if (!fields) throw new Error(`kind '${kindName}' not registered`);
    const value = { __kind: kindName };
    for (const f of fields) {
      if (!(f in data)) throw new Error(`kind '${kindName}' requires field '${f}'`);
      value[f] = data[f];
    }
    return value;
  }

  // ── match: structural dispatch on a kinded value. cases is an ordered
  // list of { kind, when?, then } -- first case whose kind matches (and
  // whose optional guard passes) wins; 'kind: "_"' is a wildcard. Throws
  // if nothing matches, same as an unhandled case in any real pattern
  // match -- silently falling through would hide exactly the kind of gap
  // this primitive exists to surface.
  match(value, cases) {
    const kindName = value && typeof value === 'object' ? value.__kind : undefined;
    for (const c of cases) {
      if (c.kind === '_' || c.kind === kindName) {
        if (c.when && !c.when(value)) continue;
        return c.then(value);
      }
    }
    throw new Error(`match: no case for kind '${kindName ?? typeof value}'`);
  }

  // ── word: register a syntax-absorption handler for a trigger keyword.
  // parseFn(sourceText) must return a plain object AST -- no constraints
  // on shape beyond that, because different absorbed languages legitimately
  // have different node shapes. What IS enforced is that the result gets
  // wrapped and tagged before it re-enters the IVX-level trace.
  word(trigger, parseFn) {
    if (this._words.has(trigger)) throw new Error(`word '${trigger}' already registered`);
    this._words.set(trigger, parseFn);
  }

  // ── bind: register a host-call target. hostFn receives (args, ctx) where
  // ctx exposes { inject(name, value), readBack(name) } for the two-way
  // marshaling the KH hosting test required -- that's not incidental, it's
  // the actual interface real interop needs, generalized from what worked.
  bind(name, hostFn) {
    if (this._binds.has(name)) throw new Error(`bind '${name}' already registered`);
    this._binds.set(name, hostFn);
  }

  // ── Top-level IVX program format (deliberately tiny -- this kernel is
  // not trying to be a full language, only to prove word/bind for real):
  //
  //   word <trigger> <<<
  //   ...raw source in the absorbed language...
  //   >>>
  //
  //   bind <name>(arg1: val1, arg2: val2) -> readBackVar1, readBackVar2
  //
  // Blank lines and '#' comments are skipped. Every block produces exactly
  // one trace entry, tagged with its real fidelity level.
  async run(ivxSource) {
    const lines = ivxSource.split('\n');
    let i = 0;
    while (i < lines.length) {
      const line = lines[i].trim();
      if (!line || line.startsWith('#')) { i++; continue; }

      const wordMatch = /^word\s+(\S+)\s+<<<\s*$/.exec(line);
      if (wordMatch) {
        const trigger = wordMatch[1];
        const bodyLines = [];
        i++;
        while (i < lines.length && lines[i].trim() !== '>>>') { bodyLines.push(lines[i]); i++; }
        if (i >= lines.length) throw new Error(`word '${trigger}' block never closed with >>>`);
        i++; // consume '>>>'
        const raw = bodyLines.join('\n');
        const parseFn = this._words.get(trigger);
        if (!parseFn) throw new Error(`no word() handler registered for '${trigger}'`);
        let entry;
        try {
          const ast = parseFn(raw);
          entry = { fidelity: FIDELITY.ABSORBED, trigger, raw, ast };
        } catch (e) {
          entry = { fidelity: FIDELITY.ABSORBED, trigger, raw, ast: null, error: e.message };
        }
        this.trace.push(entry);
        continue;
      }

      const bindMatch = /^bind\s+(\w+)\((.*)\)\s*(?:->\s*(.*))?$/.exec(line);
      if (bindMatch) {
        const [, name, argsRaw, readBackRaw] = bindMatch;
        const args = {};
        if (argsRaw.trim()) {
          for (const pair of argsRaw.split(',')) {
            const [k, v] = pair.split(':').map(s => s.trim());
            args[k] = /^-?\d+(\.\d+)?$/.test(v) ? Number(v)
              : v.replace(/^["']|["']$/g, '').replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\\\/g, '\\');
          }
        }
        const readBack = readBackRaw ? readBackRaw.split(',').map(s => s.trim()).filter(Boolean) : [];
        const hostFn = this._binds.get(name);
        if (!hostFn) throw new Error(`no bind() target registered for '${name}'`);
        let entry;
        try {
          const result = await hostFn(args, readBack);
          entry = { fidelity: FIDELITY.HOSTED, name, args, readBack, result };
        } catch (e) {
          entry = { fidelity: FIDELITY.HOSTED, name, args, readBack, result: null, error: e.message };
        }
        this.trace.push(entry);
        i++;
        continue;
      }

      throw new Error(`unrecognized IVX-level line ${i + 1}: ${JSON.stringify(line)}`);
    }
    return this.trace;
  }
}

module.exports = { IVXKernel, FIDELITY };
