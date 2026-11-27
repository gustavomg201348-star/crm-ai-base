import assert from "node:assert/strict";
import test from "node:test";
import { getVisibleNavigation, navItems } from "./sidebar-navigation";

const agentItems = [
  "motor-comercial", "next-best-action", "atendimento", "kanban", "contatos", "simulacao-clt"
];
const supervisorItems = ["dashboard", ...agentItems, "tags", "recem-aposentados"];
const adminItems = [
  ...supervisorItems, "multicred", "canais", "templates", "disparos", "chatbot", "config"
];

test("keeps the existing menu visibility for each profile", () => {
  const cases = [
    { role: "ADMIN", platform: true, expected: [...adminItems, "empresas"] },
    { role: "ADMIN", platform: false, expected: adminItems },
    { role: "SUPERVISOR", platform: false, expected: supervisorItems },
    { role: "AGENT", platform: false, expected: agentItems }
  ] as const;
  for (const { role, platform, expected } of cases) {
    const { visibleItems, sections } = getVisibleNavigation(role, platform);
    const listed = sections.flatMap((section) => "item" in section ? [section.item.id] : section.items.map(({ id }) => id));
    assert.deepEqual(visibleItems.map(({ id }) => id).sort(), [...expected].sort());
    assert.deepEqual(listed.sort(), [...expected].sort());
    assert.ok(sections.every((section) => "item" in section || section.items.length > 0));
  }
});

test("shows Dashboard once and places Chatbot under Comunicação", () => {
  const { sections } = getVisibleNavigation("ADMIN", true);
  assert.deepEqual(sections.map(({ id }) => id), [
    "dashboard", "operacao-comercial", "relacionamento", "comunicacao",
    "produtos-financeiros", "administracao-apoio"
  ]);
  const [dashboard] = sections;
  assert.ok("item" in dashboard && dashboard.item.id === "dashboard");
  const communication = sections.find(({ id }) => id === "comunicacao");
  assert.ok(communication && "items" in communication);
  assert.deepEqual(communication.items.map(({ id }) => id), ["canais", "templates", "disparos", "chatbot"]);
  assert.equal(navItems.find(({ id }) => id === "simulacao-clt")?.label, "Simulação CLT");
  assert.equal(navItems.find(({ id }) => id === "recem-aposentados")?.label, "Recém-aposentados");
});
