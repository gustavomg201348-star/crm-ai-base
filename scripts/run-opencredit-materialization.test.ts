import assert from "node:assert/strict";
import test from "node:test";
import { createPilotExecutor } from "./run-opencredit-materialization";

const args = ["--pilot", "--job-id", "job", "--company-id", "company", "--integration-id", "integration", "--provider-scope", "scope"];
const lease = { id: "job", leaseToken: "synthetic-token" };

test("pilot rejects missing, unknown and duplicate arguments and a globally enabled worker before loading runtime", async () => {
  let loads = 0;
  const execute = createPilotExecutor(async () => { loads++; throw Error(); });
  assert.equal(await execute(args, "true"), "PILOT_WORKER_ENABLED");
  for (const invalid of [[], args.slice(0, -2), [...args, "--other", "x"], args.map(x => x === "--company-id" ? "--job-id" : x)]) {
    assert.equal(await execute(invalid), "PILOT_INVALID_ARGUMENTS");
  }
  assert.equal(loads, 0);
});

for (const [scenario, code] of [
  ["COMPLETED", "PILOT_COMPLETED"], ["RETRY", "PILOT_RETRY"], ["NEEDS_REVIEW", "PILOT_NEEDS_REVIEW"],
  ["empty", "PILOT_NOT_CLAIMED"], ["claim error", "PILOT_CLAIM_FAILED"], ["process error", "PILOT_PROCESS_FAILED"],
  ["wrong lease", "PILOT_INVALID_LEASE"], ["null outcome", "PILOT_OUTCOME_UNCONFIRMED"]
] as const) {
  test(`pilot consumes exactly one attempt for ${scenario}`, async () => {
    const calls: string[] = [];
    const forbidden = () => { calls.push("forbidden"); throw Error(); };
    const execute = createPilotExecutor(async () => ({
      recover: forbidden, expire: forbidden, claim: forbidden,
      async claimPilotJob(target) {
        calls.push("pilot");
        assert.deepEqual(target, { id: "job", companyId: "company", integrationId: "integration", providerScope: "scope" });
        if (scenario === "claim error") throw Error("private error");
        if (scenario === "empty") return null;
        return scenario === "wrong lease" ? { ...lease, id: "other" } : lease;
      },
      async process(input) {
        calls.push("process");
        assert.deepEqual(input, lease);
        if (scenario === "process error") throw Error("private error");
        return scenario === "null outcome" ? null : { id: input.id, state: scenario };
      },
      async close() { calls.push("close"); }
    }));
    assert.deepEqual(await Promise.all([execute(args), execute(args)]), [code, "PILOT_ALREADY_USED"]);
    assert.equal(await execute(args), "PILOT_ALREADY_USED");
    assert.deepEqual(calls, ["empty", "claim error", "wrong lease"].includes(scenario)
      ? ["pilot", "close"] : ["pilot", "process", "close"]);
  });
}
