import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { MediaAsset, PromptRecipe } from "@qstudio/core";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "qstudio-workflow-"));
process.env.QSTUDIO_HOME = home;
process.env.QWEN_TOKEN_PLAN_KEY = "local-demo-sentinel";
delete process.env.QSTUDIO_TOKEN;
const { app } = await import("./index");
const store = await import("./store");
store.loadDb();
const media: MediaAsset = { id: "example", kind: "image", source: "generated", filePath: path.join(home, "example.png"), name: "Example", mime: "image/png", bytes: 1, hash: "example", createdAt: new Date().toISOString(), tags: [], favorite: false, useCount: 0 };
store.addMedia(media);
const recipe: PromptRecipe = { identity: "Original identity", wardrobe: "Blue jacket", pose: "Standing", expression: "Calm", lighting: "Soft", background: "Grey", camera: "Portrait", preserveFace: true, preserveProportions: true, preserveOutfit: false };
const request = (url: string, body: unknown, method = "PATCH") => app.request(url, { method, headers: { Host: "127.0.0.1:8799", "Content-Type": "application/json" }, body: JSON.stringify(body) });
after(() => { store.closeDb(); fs.rmSync(home, { recursive: true, force: true }); });

test("recipes, examples, approvals and quality survive restart and reject malformed writes", async () => {
  const saved = await request("/api/prompts", { title: "Reusable recipe", text: "Exact selected prompt", mode: "image", modelId: "qwen-image-3.0-pro", params: { refs: [{ mediaId: media.id, role: "reference" }] }, recipe, exampleMediaIds: [media.id] }, "POST");
  assert.equal(saved.status, 200);
  const { prompt } = await saved.json();
  assert.deepEqual(prompt.recipe, recipe);
  assert.deepEqual(prompt.exampleMediaIds, [media.id]);
  for (const invalid of [{ recipe: { ...recipe, preserveFace: "yes" } }, { recipe: { ...recipe, secret: "unexpected" } }, { exampleMediaIds: ["missing"] }, { exampleMediaIds: Array(13).fill(media.id) }]) {
    assert.equal((await request(`/api/prompts/${prompt.id}`, invalid)).status, 400);
  }
  assert.equal((await request(`/api/prompts/${prompt.id}`, { recipe: { ...recipe, wardrobe: "Green jacket" } })).status, 200);
  assert.deepEqual(store.listPrompts().find((item) => item.id === prompt.id)?.history?.[0].recipe, recipe);
  assert.equal((await request(`/api/media/${media.id}`, { referenceStatus: "approved", qualityLabels: ["best-likeness"] })).status, 200);
  assert.equal((await request(`/api/media/${media.id}`, { referenceStatus: "unknown" })).status, 400);
  assert.equal((await request(`/api/media/${media.id}`, { qualityLabels: ["made-up"] })).status, 400);
  assert.ok(store.mediaReferences(media.id).some((ref) => ref.startsWith("Prompt example:")));
  store.flushNow();
  store.closeDb();
  store.loadDb();
  assert.equal(store.listPrompts().find((item) => item.id === prompt.id)?.recipe?.wardrobe, "Green jacket");
  assert.deepEqual(store.listPrompts().find((item) => item.id === prompt.id)?.exampleMediaIds, [media.id]);
  assert.equal(store.getMedia(media.id)?.referenceStatus, "approved");
  assert.deepEqual(store.getMedia(media.id)?.qualityLabels, ["best-likeness"]);
});

test("recipe preview compiles the selected fields and consistency controls deterministically", async () => {
  const { compilePromptRecipe } = await import("@qstudio/core");
  const compiled = compilePromptRecipe(recipe, 2);
  assert.ok(compiled.includes("Original identity"));
  assert.ok(compiled.includes("Wardrobe: Blue jacket"));
  assert.ok(compiled.includes("Preserve the subject's facial identity."));
  assert.ok(!compiled.includes("Keep the specified outfit consistent."));
  assert.ok(compiled.includes("[Image 1], [Image 2]"));
  const changed = compilePromptRecipe({ ...recipe, wardrobe: "Green jacket", preserveFace: false }, 2);
  assert.ok(changed.includes("Wardrobe: Green jacket"));
  assert.ok(!changed.includes("Wardrobe: Blue jacket"));
  assert.ok(!changed.includes("Preserve the subject's facial identity."));
  assert.equal(compilePromptRecipe({ ...recipe, wardrobe: "", pose: "", expression: "", lighting: "", background: "", camera: "" }, 0, false), recipe.identity);
});
