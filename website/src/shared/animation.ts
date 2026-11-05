import { GAME_CONFIG } from "../config";
import { assetUrl, publicAssetUrl } from "../pixellab/templateAssetPaths";
import { DIRECTIONS, type Direction } from "./direction";

// ---------------------------------------------------------------------------
// Manifest types (must match manifest.json written by asset_sync.py)
// ---------------------------------------------------------------------------

export interface ManifestAnimation {
  id: string;
  name: string;
  display_name: string | null;
  source_name: string;
  description?: string | null;
  generation_model?: string | null;
  frame_count: number;
  directions: string[];
  loop: boolean;
  aliases: string[];
  fps?: number;
}

export interface CharacterPortraitAsset {
  path: string;
  size: number;
  generated_at: string;
}

export interface CharacterVocalAnimationAsset {
  path: string;
  moods: string[];
  viseme_count: number;
  width: number;
  height: number;
  generated_at: string;
  layout: "grid";
  columns: "visemes";
  rows: "moods";
}

export interface CharacterState {
  id: string;
  name: string;
  folder: string;
  directions: string[];
  animations: ManifestAnimation[];
  portrait?: CharacterPortraitAsset;
  vocal_animation?: CharacterVocalAnimationAsset;
}

export interface CharacterManifest {
  id: string;
  name: string;
  group_id: string | null;
  atlas_key: string;
  states: CharacterState[];
}

// ---------------------------------------------------------------------------
// Animation clip types
// ---------------------------------------------------------------------------

export interface AnimationClip {
  name: string;
  frameCount: number;
  directions: Direction[];
  loop: boolean;
  aliases?: string[];
  displayName?: string | null;
  sourceName?: string;
  id?: string;
  fps?: number;
}

export type AnimationMap = Record<string, AnimationClip>;

export interface CharacterStateSelectionOptions {
  state?: string;
  preferredClips?: string[];
}

export interface CharacterStateSelection {
  state: CharacterState;
  stateIndex: number;
  stateFolder: string;
  animations: AnimationMap;
}

export interface CharacterAnimationResolution extends CharacterStateSelection {
  animation: ManifestAnimation;
  clipName: string;
  matchedCandidate: string;
}

export interface CharacterAnimationResolutionOptions {
  state?: string;
  direction?: Direction;
}

// ---------------------------------------------------------------------------
// Direction resolution
// ---------------------------------------------------------------------------

/** DIRECTIONS laid out as angles (0 = south, incrementing clockwise in 45° steps). */
const DIRECTION_ANGLE: Record<Direction, number> = {
  "south": 0,
  "south-west": 1,
  "west": 2,
  "north-west": 3,
  "north": 4,
  "north-east": 5,
  "east": 6,
  "south-east": 7,
};

/** Snap a requested direction to the nearest available one in the clip. */
function resolveDirection(requested: Direction, available: Direction[]): Direction {
  if (available.length === 0) {
    throw new Error(`Cannot resolve "${requested}" with no available animation directions`);
  }
  if (available.includes(requested)) return requested;
  let best = available[0];
  let bestDist = 8;
  const reqAngle = DIRECTION_ANGLE[requested];
  for (const dir of available) {
    const dist = Math.min(
      Math.abs(DIRECTION_ANGLE[dir] - reqAngle),
      8 - Math.abs(DIRECTION_ANGLE[dir] - reqAngle),
    );
    if (dist < bestDist) {
      bestDist = dist;
      best = dir;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Clip and state selection
// ---------------------------------------------------------------------------

function normalizedLabel(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function animationIdentityMatchRank(
  candidate: string,
  name: string,
  displayName?: string | null,
  sourceName?: string,
  aliases: string[] = [],
): number | undefined {
  const normalizedCandidate = normalizedLabel(candidate);
  const exactLabels = [name, displayName, sourceName];
  for (let index = 0; index < exactLabels.length; index += 1) {
    const label = exactLabels[index];
    if (label && normalizedLabel(label) === normalizedCandidate) return index;
  }
  if (aliases.some((alias) => normalizedLabel(alias) === normalizedCandidate)) {
    return 3;
  }
  return undefined;
}

function animationMatchRank(
  animation: ManifestAnimation,
  candidate: string,
): number | undefined {
  return animationIdentityMatchRank(
    candidate,
    animation.name,
    animation.display_name,
    animation.source_name,
    animation.aliases,
  );
}

function stableAnimationId(animation: ManifestAnimation): string {
  return normalizedLabel(animation.id);
}

function compareAnimations(
  left: ManifestAnimation,
  right: ManifestAnimation,
): number {
  return (
    right.directions.length - left.directions.length ||
    stableAnimationId(left).localeCompare(stableAnimationId(right)) ||
    normalizedLabel(left.name).localeCompare(normalizedLabel(right.name))
  );
}

function matchingAnimationsForCandidate(
  state: CharacterState,
  candidate: string,
  direction?: Direction,
): ManifestAnimation[] {
  return state.animations
    .filter((animation) => animationMatchRank(animation, candidate) !== undefined)
    .sort((left, right) => (
      (direction && !left.directions.includes(direction) ? 1 : 0) -
        (direction && !right.directions.includes(direction) ? 1 : 0) ||
      animationMatchRank(left, candidate)! - animationMatchRank(right, candidate)! ||
      compareAnimations(left, right)
    ));
}


function stateMatchesName(state: CharacterState, stateName: string): boolean {
  const normalizedState = normalizedLabel(stateName);
  return (
    normalizedLabel(state.name) === normalizedState ||
    normalizedLabel(state.folder) === normalizedState ||
    normalizedLabel(state.id) === normalizedState
  );
}

// ---------------------------------------------------------------------------
// Manifest loading helpers
// ---------------------------------------------------------------------------

export function characterAtlasKey(characterId: string): string {
  return `char-${characterId}`;
}

export function characterAssetUrl(characterId: string, path: string): string {
  return assetUrl("characters", characterId, ...path.split("/"));
}

export function characterStatePortraitUrl(
  characterId: string,
  state: CharacterState,
): string | undefined {
  return state.portrait ? characterAssetUrl(characterId, state.portrait.path) : undefined;
}

export function characterStateVocalAnimationUrl(
  characterId: string,
  state: CharacterState,
): string | undefined {
  return state.vocal_animation
    ? characterAssetUrl(characterId, state.vocal_animation.path)
    : undefined;
}

function characterManifestKey(characterId: string): string {
  return `char-manifest-${characterId}`;
}

export function preloadCharacterAtlas(scene: Phaser.Scene, characterId: string): void {
  const key = characterAtlasKey(characterId);
  // Guard like every map preload does: a scene restart re-runs preload, and re-adding a loaded
  // atlas throws "Texture key already in use".
  if (scene.textures.exists(key)) return;
  // publicAssetUrl appends the build id (?v=) — the atlas is the largest, most frequently
  // regenerated asset; without the version a cached stale JSON pairs with a fresh PNG (or vice
  // versa) after a character re-sync and frames go missing/wrong.
  scene.load.atlas(
    key,
    publicAssetUrl("atlases", `${key}.png`),
    publicAssetUrl("atlases", `${key}.json`),
  );
  scene.load.json(
    characterManifestKey(characterId),
    assetUrl("characters", characterId, "manifest.json"),
  );
}

/** Load and validate the character manifest from the Phaser cache. */
export function characterManifest(scene: Phaser.Scene, characterId: string): CharacterManifest {
  const manifest = scene.cache.json.get(
    characterManifestKey(characterId),
  ) as CharacterManifest | undefined;
  if (!manifest) {
    throw new Error(`Missing character manifest for ${characterId}. Re-sync assets.`);
  }
  if (!manifest.states || manifest.states.length === 0) {
    throw new Error(`Character ${characterId} has no states in manifest.json`);
  }
  return manifest;
}

/** Build an AnimationMap from a single character state. No hardcoded constants. */
export function animationMapFromState(state: CharacterState): AnimationMap {
  const animations = [...state.animations].sort(compareAnimations);
  const anims: AnimationMap = {};
  for (const anim of animations) {
    const dirs = anim.directions.filter(
      (d): d is Direction => DIRECTIONS.includes(d as Direction),
    );
    const clip: AnimationClip = {
      name: anim.name,
      frameCount: anim.frame_count,
      directions: dirs,
      loop: anim.loop,
      aliases: anim.aliases,
      displayName: anim.display_name,
      sourceName: anim.source_name,
      id: anim.id,
      fps: anim.fps,
    };
    if (!(anim.name in anims)) {
      anims[anim.name] = clip;
    }
  }

  const aliases = [...new Set(animations.flatMap((animation) => animation.aliases))]
    .sort((left, right) => normalizedLabel(left).localeCompare(normalizedLabel(right)));
  for (const alias of aliases) {
    if (alias in anims) continue;
    const animation = matchingAnimationsForCandidate(state, alias)[0];
    if (animation) {
      anims[alias] = anims[animation.name];
    }
  }
  return anims;
}

/** Build an AnimationMap from a character manifest. No hardcoded constants. */
export function animationMapFromManifest(manifest: CharacterManifest, stateIndex = 0): AnimationMap {
  return animationMapFromState(manifest.states[stateIndex]);
}

/**
 * Resolve a requested exact clip or semantic role across every character state.
 *
 * Candidate priority is respected first. Within a candidate, clips supporting
 * the requested direction win, exact manifest names beat aliases, and stable
 * manifest identifiers make equivalent variants deterministic.
 */
export function resolveCharacterAnimation(
  manifest: CharacterManifest,
  candidates: string[],
  options: CharacterAnimationResolutionOptions = {},
): CharacterAnimationResolution | undefined {
  const states = options.state
    ? manifest.states
        .map((state, stateIndex) => ({ state, stateIndex }))
        .filter(({ state }) => stateMatchesName(state, options.state!))
    : manifest.states.map((state, stateIndex) => ({ state, stateIndex }));

  if (options.state && states.length === 0) {
    throw new Error(
      `Character "${manifest.name}" has no state "${options.state}". Available states: ${
        manifest.states.map((state) => `${state.name} (${state.folder})`).join(", ")
      }`,
    );
  }

  for (const candidate of candidates) {
    const matches = states.flatMap(({ state, stateIndex }) => {
      return matchingAnimationsForCandidate(state, candidate, options.direction)
        .map((animation) => ({
          state,
          stateIndex,
          animation,
          directionRank: (
            options.direction && !animation.directions.includes(options.direction)
              ? 1
              : 0
          ),
          matchRank: animationMatchRank(animation, candidate)!,
        }));
    });

    matches.sort((left, right) => (
      left.directionRank - right.directionRank ||
      left.matchRank - right.matchRank ||
      compareAnimations(left.animation, right.animation) ||
      normalizedLabel(left.state.folder).localeCompare(normalizedLabel(right.state.folder)) ||
      left.stateIndex - right.stateIndex
    ));

    const match = matches[0];
    if (match) {
      return {
        state: match.state,
        stateIndex: match.stateIndex,
        stateFolder: match.state.folder,
        animations: animationMapFromState(match.state),
        animation: match.animation,
        clipName: match.animation.name,
        matchedCandidate: candidate,
      };
    }
  }
  return undefined;
}

/** Cache direction-aware manifest resolutions for a character controller. */
export class CharacterAnimationResolver {
  private readonly cache = new Map<
    string,
    CharacterAnimationResolution | undefined
  >();

  constructor(
    private readonly manifest: CharacterManifest,
    private readonly state?: string,
  ) {}

  resolve(
    candidates: string[],
    direction: Direction,
  ): CharacterAnimationResolution | undefined {
    const cacheKey = `${direction}:${candidates.join(",")}`;
    if (!this.cache.has(cacheKey)) {
      this.cache.set(
        cacheKey,
        resolveCharacterAnimation(
          this.manifest,
          candidates,
          { state: this.state, direction },
        ),
      );
    }
    return this.cache.get(cacheKey);
  }
}

export function selectCharacterState(
  manifest: CharacterManifest,
  options: CharacterStateSelectionOptions = {},
): CharacterStateSelection {
  let stateIndex = 0;
  const requestedState = options.state;
  const preferredClips = options.preferredClips;

  if (requestedState) {
    stateIndex = manifest.states.findIndex((state) => stateMatchesName(state, requestedState));
    if (stateIndex === -1) {
      throw new Error(
        `Character "${manifest.name}" has no state "${requestedState}". Available states: ${
          manifest.states.map((state) => `${state.name} (${state.folder})`).join(", ")
        }`,
      );
    }
  } else if (preferredClips && preferredClips.length > 0) {
    const resolved = resolveCharacterAnimation(manifest, preferredClips);
    if (resolved) return resolved;
  }

  const state = manifest.states[stateIndex];
  return {
    state,
    stateIndex,
    stateFolder: state.folder,
    animations: animationMapFromState(state),
  };
}

export function characterRotationFrameName(state: string, direction: Direction): string {
  return `${state}/rotations/${direction}`;
}

/**
 * Build the atlas frame name for a real animation clip.
 *
 * Matches the export format:
 *   {state}/animations/{anim}/{direction}/frame_NNN — animation frame
 */
export function characterAnimationFrameName(
  state: string,
  animation: string,
  direction: Direction,
  frame: number,
): string {
  return `${state}/animations/${animation}/${direction}/frame_${frame.toString().padStart(3, "0")}`;
}

export class SpriteAnimator {
  private clipName: string | null = null;
  private direction: Direction = "south";
  private resolvedDirection: Direction = "south";
  private elapsedMs = 0;
  private frame = 0;
  private didComplete = false;
  private state: string;
  private poseDirections: Direction[];

  constructor(
    private readonly sprite: Phaser.GameObjects.Sprite,
    private readonly atlasKey: string,
    private animations: AnimationMap,
    state = "default",
    poseDirections?: Direction[],
  ) {
    this.state = state;
    this.poseDirections = poseDirections ?? this.directionsFromAnimations();
    this.resolvedDirection = resolveDirection(this.direction, this.poseDirections);
    this.applyTexture();
  }

  /** Check whether an exact or role-like clip name exists in this animator's animation map. */
  hasClip(clipName: string): boolean {
    return this.chooseClip([clipName]) !== undefined;
  }

  /** Pick the first available exact or role-like clip. Missing clips return undefined. */
  chooseClip(
    candidates: string[],
    direction: Direction = this.direction,
  ): string | undefined {
    const clips = this.uniqueClips();
    for (const candidate of candidates) {
      const matches = clips
        .filter((clip) => this.clipMatchRank(clip, candidate) !== undefined)
        .sort((left, right) => (
          (left.directions.includes(direction) ? 0 : 1) -
            (right.directions.includes(direction) ? 0 : 1) ||
          this.clipMatchRank(left, candidate)! - this.clipMatchRank(right, candidate)! ||
          right.directions.length - left.directions.length ||
          normalizedLabel(left.id ?? left.name).localeCompare(normalizedLabel(right.id ?? right.name))
        ));
      if (matches[0]) return matches[0].name;
    }
    return undefined;
  }

  setAnimationMap(
    animations: AnimationMap,
    state = "default",
    poseDirections?: Direction[],
  ): void {
    if (this.animations === animations && this.state === state) return;
    this.animations = animations;
    this.state = state;
    this.poseDirections = poseDirections ?? this.directionsFromAnimations();
    this.clipName = null;
    this.elapsedMs = 0;
    this.frame = 0;
    this.didComplete = false;
    this.resolvedDirection = resolveDirection(this.direction, this.poseDirections);
    this.applyTexture();
  }

  setState(state: string): void {
    if (this.state === state) return;
    this.state = state;
    this.applyTexture();
  }

  /** Display a static state rotation. This is deliberately separate from animated idle clips. */
  setPose(
    direction: Direction,
    state = this.state,
    poseDirections = this.poseDirections,
  ): void {
    const resolvedDirection = resolveDirection(direction, poseDirections);
    if (
      this.clipName === null &&
      this.direction === direction &&
      this.state === state &&
      this.resolvedDirection === resolvedDirection
    ) {
      return;
    }
    this.state = state;
    this.poseDirections = poseDirections;
    this.clipName = null;
    this.direction = direction;
    this.resolvedDirection = resolvedDirection;
    this.elapsedMs = 0;
    this.frame = 0;
    this.didComplete = false;
    this.applyTexture();
  }

  setClip(clipName: string, direction: Direction, state = this.state): void {
    if (this.clipName === clipName && this.direction === direction && this.state === state) {
      return;
    }
    const clip = this.animations[clipName];
    if (!clip) {
      throw new Error(`Animation clip "${clipName}" not found. Available: ${Object.keys(this.animations).join(", ")}`);
    }
    this.state = state;
    this.clipName = clipName;
    this.direction = direction;
    this.resolvedDirection = resolveDirection(direction, clip.directions);
    this.elapsedMs = 0;
    this.frame = 0;
    this.didComplete = false;
    this.applyTexture();
  }

  update(deltaMs: number): void {
    if (this.clipName === null) return;
    const clip = this.animations[this.clipName];
    if (clip.frameCount <= 1 || this.didComplete) {
      return;
    }

    const frameMs = 1000 / (clip.fps ?? GAME_CONFIG.animation.fps);
    this.elapsedMs += deltaMs;
    while (this.elapsedMs >= frameMs) {
      this.elapsedMs -= frameMs;
      this.frame += 1;
      if (this.frame >= clip.frameCount) {
        if (clip.loop) {
          this.frame = 0;
        } else {
          this.frame = clip.frameCount - 1;
          this.didComplete = true;
        }
      }
      this.applyTexture();
    }
  }

  private applyTexture(): void {
    if (this.clipName === null) {
      this.sprite.setTexture(
        this.atlasKey,
        characterRotationFrameName(this.state, this.resolvedDirection),
      );
      return;
    }
    const clip = this.animations[this.clipName];
    this.sprite.setTexture(
      this.atlasKey,
      characterAnimationFrameName(
        this.state,
        clip.name,
        this.resolvedDirection,
        this.frame,
      ),
    );
  }

  private uniqueClips(): AnimationClip[] {
    return [...new Map(
      Object.values(this.animations).map((clip) => [clip.name, clip]),
    ).values()];
  }

  private clipMatchRank(
    clip: AnimationClip,
    candidate: string,
  ): number | undefined {
    return animationIdentityMatchRank(
      candidate,
      clip.name,
      clip.displayName,
      clip.sourceName,
      clip.aliases,
    );
  }

  private directionsFromAnimations(): Direction[] {
    const directions = new Set(
      this.uniqueClips().flatMap((clip) => clip.directions),
    );
    return directions.size > 0 ? [...directions] : [...DIRECTIONS];
  }
}
