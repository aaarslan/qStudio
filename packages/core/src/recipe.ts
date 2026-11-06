import type { PromptRecipe as PromptRecipeValue } from "./types";

export function initialPromptRecipe(identity: string, isVisual = true): PromptRecipeValue {
  return {
    identity,
    wardrobe: "",
    pose: "",
    expression: "",
    lighting: "",
    background: "",
    camera: "",
    preserveFace: isVisual,
    preserveProportions: isVisual,
    preserveOutfit: isVisual,
  };
}

export function compilePromptRecipe(recipe: PromptRecipeValue, referenceCount = 0, isVisual = true): string {
  const sections = [
    recipe.identity.trim(),
    recipe.wardrobe.trim() && `Wardrobe: ${recipe.wardrobe.trim()}`,
    recipe.pose.trim() && `Pose: ${recipe.pose.trim()}`,
    recipe.expression.trim() && `Expression: ${recipe.expression.trim()}`,
    recipe.lighting.trim() && `Lighting: ${recipe.lighting.trim()}`,
    recipe.background.trim() && `Background: ${recipe.background.trim()}`,
    recipe.camera.trim() && `Camera: ${recipe.camera.trim()}`,
  ].filter((section): section is string => Boolean(section));
  const consistency = isVisual ? [
    recipe.preserveFace && "Preserve the subject's facial identity.",
    recipe.preserveProportions && "Preserve the subject's established body proportions.",
    recipe.preserveOutfit && "Keep the specified outfit consistent.",
  ].filter(Boolean) : [];
  const references = !isVisual ? [] : [referenceCount > 0
    ? `Reference guidance: follow the assigned role of each attached image: ${Array.from({ length: referenceCount }, (_, index) => `[Image ${index + 1}]`).join(", ")}.`
    : "Reference guidance: when images are attached, follow each image's assigned role and use it only for that reference."];
  return [...sections, ...consistency, ...references].join("\n\n");
}

