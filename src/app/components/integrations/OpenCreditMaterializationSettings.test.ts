import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

type Element = { type: unknown; props: Record<string, unknown> };
const code = ts.transpileModule(readFileSync("src/app/components/integrations/OpenCreditMaterializationSettings.tsx", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText;
function fixture(options: { reserved?: boolean; denied?: boolean; paused?: boolean; refuseWrite?: boolean; staleRead?: boolean;
  active?: boolean; autoStart?: boolean; ambiguousPilot?: boolean } = {}) {
  let cursor = 0, saved = !!options.active, version = 0;
  const slots: unknown[] = [], effects: Array<() => void> = [], calls: Record<string, unknown>[] = [], changes: boolean[] = [];
  const react = {
    useState(initial: unknown) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], (v: unknown) => { slots[i] = typeof v === "function" ? v(slots[i]) : v; }]; },
    useRef(initial: unknown) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    useEffect(effect: () => void, deps: unknown[]) { const i = cursor++; if (!(i in slots)) { slots[i] = deps; effects.push(effect); } },
  };
  const exports = {} as { OpenCreditMaterializationSettings(props: object): Element };
  runInNewContext(code, { exports, AbortController, window: { confirm: () => true },
    require(name: string) { if (name === "react") return react; assert.equal(name, "react/jsx-runtime"); return { jsx: (type: unknown, props: object) => ({ type, props }), jsxs: (type: unknown, props: object) => ({ type, props }) }; },
    fetch: async (_url: string, init: { body: string; cache: string }) => {
      assert.equal(init.cache, "no-store"); const command = JSON.parse(init.body); calls.push(command);
      if (options.denied) return { ok: false, status: 403 };
      if (command.action === "PILOT") return { ok: true, json: async () => options.ambiguousPilot
        ? { status: "RESULT_UNCONFIRMED" } : { status: "PROCESSED", outcome: "COMPLETED", bootstrapAttempted: true, bootstrapResult: "SENT" } };
      if (command.action === "SET") {
        if (options.refuseWrite) return { ok: false, status: 409, json: async () => ({ error: "CONFLICT" }) };
        if (!options.staleRead) saved = command.materializationEnabled;
        version++; return { ok: true, json: async () => ({ ok: true }) };
      }
      return { ok: true, json: async () => ({ ok: true, companyId: "company", integrationId: "integration", materializationEnabled: saved,
        enabled: false, paused: !!options.paused, passiveInboundEnabled: true, interlockReady: saved, bindingReserved: !!options.reserved, autoStartOperational: !!options.autoStart,
        updatedAt: new Date(version).toISOString(), queue: { claimableNow: 0, complete: true, counts: { PENDING: 2, RETRY: 0, NEEDS_REVIEW: 1 } } }) };
    },
  });
  const render = () => { cursor = 0; const tree = exports.OpenCreditMaterializationSettings({ companyId: "company", integrationId: "integration", materializationEnabled: false, onChanged: (v: boolean) => changes.push(v) }); effects.splice(0).forEach(effect => effect()); return tree; };
  const nodes = (value: unknown): Element[] => !value || typeof value !== "object" ? [] : Array.isArray(value) ? value.flatMap(nodes)
    : [value as Element, ...nodes((value as Element).props?.children)];
  const text = (value: unknown): string => value == null || typeof value === "boolean" ? "" : Array.isArray(value) ? value.map(text).join("")
    : typeof value === "object" ? text((value as Element).props?.children) : String(value);
  const flush = async () => { await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve)); };
  return { render, text, calls, changes, flush, button: (tree: Element, label: string) => nodes(tree).find(node => node.type === "button" && text(node).includes(label))! };
}
test("UI loads persisted preflight, performs one write and renders only re-read server state", async () => {
  const f = fixture(); f.render(); await f.flush(); let tree = f.render();
  assert(f.text(tree).includes("DESATIVADA")); assert(f.text(tree).includes("PENDING: 2"));
  const button = f.button(tree, "Ativar materialização"); assert.equal(button.props.disabled, false); (button.props.onClick as () => void)();
  await f.flush(); tree = f.render(); assert(f.text(tree).includes("ATIVA")); assert.deepEqual(f.changes, [true]);
  assert.deepEqual(f.calls.map(c => c.action), ["READ", "SET", "READ"]); assert.equal(f.calls[1].expectedUpdatedAt, new Date(0).toISOString());
});

test("pilot requires the operating window and reservation and never retries an ambiguous response", async () => {
  for (const options of [{ active: false, reserved: true, autoStart: true }, { active: true, reserved: false, autoStart: true },
    { active: true, reserved: true, autoStart: false }]) {
    const f = fixture(options); f.render(); await f.flush();
    assert.equal(f.button(f.render(), "Processar 1 lead teste").props.disabled, true);
  }
  for (const ambiguousPilot of [false, true]) {
    const f = fixture({ active: true, reserved: true, autoStart: true, ambiguousPilot });
    f.render(); await f.flush();
    const button = f.button(f.render(), "Processar 1 lead teste");
    assert.equal(button.props.disabled, false);
    const click = button.props.onClick as () => void;
    click(); click();
    await f.flush();
    assert.deepEqual(f.calls.map(c => c.action), ["READ", "PILOT", "READ"]);
    const tree = f.render();
    assert(f.text(tree).includes(ambiguousPilot ? "Resultado do piloto não confirmado" : "Template enviado."));
    assert.equal(f.button(tree, "Processar 1 lead teste").props.disabled, ambiguousPilot);
  }
});
test("successful write response cannot fabricate an optimistic active state", async () => {
  const f = fixture({ staleRead: true }); f.render(); await f.flush(); (f.button(f.render(), "Ativar materialização").props.onClick as () => void)();
  await f.flush(); assert(f.text(f.render()).includes("DESATIVADA")); assert.deepEqual(f.changes, [false]);
});
for (const options of [{ reserved: true }, { paused: true }, { denied: true }]) test("UI fails closed for reservation/gates/non-platform actor " + JSON.stringify(options), async () => {
  const f = fixture(options); f.render(); await f.flush(); const tree = f.render(), button = f.button(tree, "Ativar materialização");
  assert(!button || button.props.disabled); assert.equal(f.calls.filter(c => c.action === "SET").length, 0);
  if (options.reserved) assert(f.text(tree).includes("ainda reservado"));
});
test("write conflict remains unconfirmed, disables retry and never claims historical backfill", async () => {
  const f = fixture({ refuseWrite: true }); f.render(); await f.flush(); (f.button(f.render(), "Ativar materialização").props.onClick as () => void)(); await f.flush();
  const tree = f.render(); assert(f.text(tree).includes("ESTADO NÃO CONFIRMADO")); assert.equal(f.button(tree, "Ativar materialização").props.disabled, true);
  assert.equal(f.calls.filter(c => c.action === "SET").length, 1); assert(f.text(tree).includes("Eventos históricos da inbox não geram jobs automaticamente"));
});
