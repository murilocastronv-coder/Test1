import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { createServer } from "vite";

let animation;
let vite;
const fixtureDirs = [];

before(async () => {
  vite = await createServer({
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  animation = await vite.ssrLoadModule("/src/shared/animation.ts");
});

after(async () => {
  await vite.close();
  for (const dir of fixtureDirs) {
    await rm(dir, { recursive: true, force: true });
  }
});

function clip(name, options = {}) {
  return {
    id: `${name}-id`,
    name,
    display_name: null,
    source_name: name,
    frame_count: 7,
    directions: ["south"],
    loop: true,
    aliases: [],
    ...options,
  };
}

function state(name, animations) {
  return {
    id: `${name}-id`,
    name,
    folder: name,
    directions: ["south", "north", "east", "west"],
    animations,
  };
}

function manifest(states) {
  return {
    id: "character-id",
    name: "Hero",
    group_id: null,
    atlas_key: "char-character-id",
    states,
  };
}

const templateCharactersDir = fileURLToPath(
  new URL("../../assets/characters/", import.meta.url),
);

/**
 * Animation folder names for one state, or [] when the state has none.
 *
 * A rotation-only character (every V3 character before its first animation)
 * syncs rotations and no `animations/` directory at all, which made this read
 * throw ENOENT and fail the suite on a correctly synced project. [] still gets
 * compared against the manifest, so a state that CLAIMS clips it has no folders
 * for keeps failing — on the assertion, not on a stack trace.
 */
async function animationFolderNames(statePath) {
  let entries;
  try {
    entries = await readdir(join(statePath, "animations"), {
      withFileTypes: true,
    });
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/** Assert every character manifest under a directory matches its folders on disk. */
async function verifyCharacterManifests(charactersDir) {
  const characterDirs = await readdir(charactersDir, { withFileTypes: true });

  for (const characterDir of characterDirs.filter((entry) => entry.isDirectory())) {
    const characterPath = join(charactersDir, characterDir.name);
    const shippedManifest = JSON.parse(
      await readFile(join(characterPath, "manifest.json"), "utf8"),
    );

    for (const shippedState of shippedManifest.states) {
      const folderNames = await animationFolderNames(
        join(characterPath, shippedState.folder),
      );
      const manifestNames = shippedState.animations
        .map((entry) => entry.name)
        .sort();

      assert.deepEqual(
        manifestNames,
        folderNames,
        `${characterDir.name}/${shippedState.folder} manifest must match animation folders`,
      );

      for (const shippedClip of shippedState.animations) {
        assert.equal(typeof shippedClip.id, "string");
        assert.ok(Object.hasOwn(shippedClip, "display_name"));
        assert.equal(typeof shippedClip.source_name, "string");
        assert.ok(Array.isArray(shippedClip.aliases));
        assert.equal(Object.hasOwn(shippedClip, "animation_group_id"), false);
      }
    }
  }
}

/** Write one character into a throwaway characters directory. */
async function fixtureCharacter(states) {
  const charactersDir = await mkdtemp(join(tmpdir(), "character-manifests-"));
  fixtureDirs.push(charactersDir);

  const characterPath = join(charactersDir, "synced-character");
  await mkdir(join(characterPath, "default", "rotations"), { recursive: true });
  await writeFile(
    join(characterPath, "manifest.json"),
    JSON.stringify({
      id: "synced-character",
      name: "Synced",
      group_id: null,
      atlas_key: "char-synced-character",
      states,
    }),
  );
  return charactersDir;
}

describe("shipped character manifests", () => {
  it("list every animation folder with complete v11 identity metadata", async () => {
    await verifyCharacterManifests(templateCharactersDir);
  });

  it("accepts a rotation-only state that synced no animations directory", async () => {
    // Reported 2026-10-11: a V3 rotation-only character failed this suite with
    // ENOENT, and the reporter had to hand-patch the template to get past it.
    const charactersDir = await fixtureCharacter([
      { folder: "default", name: "default", animations: [], directions: ["south"] },
    ]);

    await verifyCharacterManifests(charactersDir);
  });

  it("still rejects a state claiming clips it has no folders for", async () => {
    // The negative: absent-directory tolerance must not become "skip the check".
    const charactersDir = await fixtureCharacter([
      {
        folder: "default",
        name: "default",
        animations: [clip("walk")],
        directions: ["south"],
      },
    ]);

    await assert.rejects(
      () => verifyCharacterManifests(charactersDir),
      /manifest must match animation folders/,
    );
  });
});

describe("character animation resolution", () => {
  it("keeps a real idle animation separate from rotation poses", () => {
    const rotationsOnly = state("default", []);
    const animated = state("animated", [
      clip("idle-breathe", {
        aliases: ["idle"],
        display_name: "Idle Breathing",
        frame_count: 8,
      }),
    ]);

    const resolved = animation.resolveCharacterAnimation(
      manifest([rotationsOnly, animated]),
      ["idle"],
      { direction: "south" },
    );

    assert.equal(resolved?.stateFolder, "animated");
    assert.equal(resolved?.clipName, "idle-breathe");
    assert.equal(resolved?.animation.frame_count, 8);
    assert.deepEqual(animation.animationMapFromState(rotationsOnly), {});
    assert.equal(
      animation.characterRotationFrameName("default", "south"),
      "default/rotations/south",
    );
  });

  it("finds a requested animation in another character state", () => {
    const resolved = animation.resolveCharacterAnimation(
      manifest([
        state("default", [clip("walk", { aliases: ["walk"] })]),
        state("combat", [
          clip("attack-slash", {
            aliases: ["attack", "slash"],
            display_name: "Sword Slash",
          }),
        ]),
      ]),
      ["attack"],
      { direction: "south" },
    );

    assert.equal(resolved?.stateFolder, "combat");
    assert.equal(resolved?.clipName, "attack-slash");
  });

  it("prefers a matching clip that supports the requested direction", () => {
    const resolved = animation.resolveCharacterAnimation(
      manifest([
        state("cardinal", [
          clip("walk-cardinal", {
            id: "a-cardinal",
            aliases: ["walk"],
            directions: ["south", "north"],
          }),
        ]),
        state("horizontal", [
          clip("walk-horizontal", {
            id: "z-horizontal",
            aliases: ["walk"],
            directions: ["east", "west"],
          }),
        ]),
      ]),
      ["walk"],
      { direction: "east" },
    );

    assert.equal(resolved?.stateFolder, "horizontal");
    assert.equal(resolved?.clipName, "walk-horizontal");
  });

  it("returns undefined instead of substituting rotations", () => {
    const resolved = animation.resolveCharacterAnimation(
      manifest([
        state("default", [clip("idle", { aliases: ["idle"] })]),
      ]),
      ["fly"],
      { direction: "south" },
    );

    assert.equal(resolved, undefined);
  });

  it("does not infer a role from an aliasless filename prefix", () => {
    const resolved = animation.resolveCharacterAnimation(
      manifest([
        state("default", [
          clip("walk-away-cinematic", {
            aliases: [],
            display_name: "Cinematic Exit",
            source_name: "custom-motion",
          }),
        ]),
      ]),
      ["walk"],
      { direction: "south" },
    );

    assert.equal(resolved, undefined);
  });

  it("plays a resolved animation frame instead of a rotation pose", () => {
    const resolved = animation.resolveCharacterAnimation(
      manifest([
        state("animated", [
          clip("idle-breathe", {
            aliases: ["idle"],
            fps: 10,
          }),
        ]),
      ]),
      ["idle"],
      { direction: "south" },
    );
    assert.ok(resolved);

    const frames = [];
    const sprite = {
      setTexture(atlasKey, frameName) {
        frames.push([atlasKey, frameName]);
        return this;
      },
    };
    const animator = new animation.SpriteAnimator(
      sprite,
      "char-character-id",
      resolved.animations,
      resolved.stateFolder,
      ["south"],
    );

    animator.setClip(
      resolved.clipName,
      "south",
      resolved.stateFolder,
    );
    animator.update(100);

    assert.deepEqual(frames.at(-2), [
      "char-character-id",
      "animated/animations/idle-breathe/south/frame_000",
    ]);
    assert.deepEqual(frames.at(-1), [
      "char-character-id",
      "animated/animations/idle-breathe/south/frame_001",
    ]);
  });
});
