# Character and recipe workflows

Open **Prompts → Characters** to browse the character collections. Pages group existing character prompts, assigned references, and outputs whose saved job references match those images. Appearance descriptions come from the saved portrait prompt; they do not replace the original source documents.

References begin as candidates. Approving an image records your selection; generation does not automatically approve an output. Assign additional images from the character page, or use an approved reference in Studio. Generated reference candidates retain their generated label.

Open a prompt to edit its identity, wardrobe, pose, expression, lighting, background, and camera fields. Face, proportion, and outfit controls add inspectable instructions to the final prompt. These instructions guide the model and do not guarantee identity consistency. Saving preserves the previous recipe version. Applying uses the displayed final text and the recipe's saved references.

Select generated examples in the recipe editor. Examples can be images, playable videos, or audio; available generating-job settings and source references appear alongside them. Example selection is explicit and does not claim that unrelated outputs were generated from the recipe.

In **Library**, open an output to mark its likeness or motion quality, navigate its parent and derived media, or save a successful job as a recipe with its settings and references. Quality labels are available as a Library filter. Old lineage is inferred from saved job references; new generation, frame extraction, and image edits also record parent IDs. Deleted or unavailable parents cannot be reconstructed.

Choose **Animate image** to review a video model, motion preset, camera movement, duration, and reference roles. The handoff checks the registered model's reference limits and opens the result as a Studio draft. It does not submit generation. Changing the model clears additional references so unsupported roles are not carried across silently.

The prompt library starts with the starter recipes only. A character collection appears as soon as a prompt or a reference carries the `character` tag plus a shared slug tag (for example `subject-01`); prompts whose id follows the `character-<slug>-…` convention join the same page automatically. Tag references from a character page or from a media card's tags field, then approve the ones that should anchor future generations.
