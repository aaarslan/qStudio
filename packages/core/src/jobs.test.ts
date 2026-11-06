import test from "node:test";
import assert from "node:assert/strict";
import {
  canTransitionJobStatus,
  isActiveJobStatus,
  isTerminalJobStatus,
} from "./index";

test("terminal job states cannot move again", () => {
  for (const terminal of ["succeeded", "failed", "canceled"] as const) {
    assert.equal(isTerminalJobStatus(terminal), true);
    assert.equal(isActiveJobStatus(terminal), false);
    for (const next of ["queued", "running", "succeeded", "failed", "canceled"] as const) {
      assert.equal(canTransitionJobStatus(terminal, next), next === terminal);
    }
  }
});

test("active jobs support normal completion and restart recovery", () => {
  assert.equal(canTransitionJobStatus("queued", "running"), true);
  assert.equal(canTransitionJobStatus("queued", "canceled"), true);
  assert.equal(canTransitionJobStatus("running", "succeeded"), true);
  assert.equal(canTransitionJobStatus("running", "failed"), true);
  assert.equal(canTransitionJobStatus("running", "canceled"), true);
  assert.equal(canTransitionJobStatus("running", "queued"), true);
  assert.equal(canTransitionJobStatus("queued", "succeeded"), false);
});
