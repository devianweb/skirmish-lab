import * as THREE from 'three';
import {
  TerrainPiece,
  terrainHalfExtents,
  resolveTerrainStructure,
  Vector3,
  Unit,
  LOS_UNIT_RADIUS,
  ShootingRayDebugInfo,
  Objective,
  OBJECTIVE_CONTROL_RADIUS,
  OBJECTIVE_CONTROL_MAX_VERTICAL,
  isStairPiece,
  SegmentKind,
  isClimbable,
  isDifficultPiece,
  isDangerousPiece,
  getWalkableSurfaces,
} from '@skirmish-lab/shared';
import { ModelLoader } from './ModelLoader';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { disposeObject3D } from './utils';
import { outcomeMarkerKey } from './assetManifest';
import { labelLayout, LabelBox } from './labelLayout';

/** Minimal unit shape the markers need (decoupled from game state schema). */
export interface MarkerUnit {
  id: string;
  position: Vector3;
  remainingMovement?: number;
  models?: Array<{ id: string; position: Vector3 }>;
}

export interface AttackRangeMarker {
  position: Vector3;
  range: number;
  /** Optional 2D visibility polygon in world XZ coordinates for LoS shadow fill. */
  losPolygon?: Array<{ x: number; z: number }>;
  /** Optional concentric range rings for multi-range weapons (e.g. [12, 24]) */
  concentricRanges?: number[];
}

/** One engine-classified leg of a previewed path (see `classifySegment`); styled by kind. */
export interface MovePathSegment {
  from: Vector3;
  to: Vector3;
  kind: SegmentKind;
  label?: string | null;
}

/** One firing model's aim line (eye height) to the target model it shoots at. */
export interface AimLine {
  from: Vector3;
  to: Vector3;
  /** False for an attacker model that cannot fire (drawn faint red). */
  fires: boolean;
  /** Weapons this model fires at the target, drawn as a floating label by the shooter (units with mixed loadouts). */
  label?: string;
}

/** Shooting preview: a line per attacker model, plus the target model the player pointed at. */
export interface AimLinesMarker {
  lines: AimLine[];
  /** Ground position of the target model aimed at (only when a firing model can see it). */
  aimedModel?: Vector3;
}

const AIM_LINE_COLOR = 0x66bb6a;
const AIM_BLOCKED_COLOR = 0xef5350;
const AIMED_MODEL_COLOR = 0xffeb3b;

/** One run of text on a target badge (see ui/distanceIndicators.ts); the tone decides how it is drawn. */
export interface TargetBadgeSegment {
  text: string;
  tone: 'distance' | 'on' | 'off' | 'negated';
}

/** A floating distance / gate badge above one target unit. */
export interface TargetBadgeMarker {
  unitId: string;
  position: Vector3;
  segments: TargetBadgeSegment[];
}

/** Dashed switch-distance rings centred on the attacker (radii already padded by the base radius). */
export interface ThresholdRingsMarker {
  position: Vector3;
  rings: Array<{ radius: number; label: string }>;
}

/** One Hero morale-aura or Blast-spread ring. */
export interface AuraMarker {
  kind: 'hero' | 'blast';
  side?: 'host' | 'guest';
  position: Vector3;
  radius: number;
  active: boolean;
  label?: string;
}

const THRESHOLD_RING_COLOR = 0xff7961;
const HOST_HERO_AURA_COLOR = 0x29b6f6;
const GUEST_HERO_AURA_COLOR = 0xef5350;
const BLAST_AURA_COLOR = 0xff9800;
const BLAST_SHARING_COLOR = 0xff9800;

/** One 1" keep-away disc to draw (see ui/keepAwayZones.ts). */
export interface KeepAwayZoneMarker {
  x: number;
  y: number;
  z: number;
  radius: number;
  exempt: boolean;
  otherTier: boolean;
}

/** A ring around a spot that matters while placing something (see ui/setupPlacement.ts). */
export interface PlacementCircleMarker {
  x: number;
  y: number;
  z: number;
  /** Centre distance covered by the circle. */
  radius: number;
  /** `spacing`: the 9" around a placed objective; `exclusion`: ground a Scout or Ambush unit can't use. */
  kind: 'spacing' | 'exclusion';
}

/** The placement preview: a ring at the cursor (green when legal, red when not) and the circles that explain why. */
export interface PlacementMarker {
  cursor?: { position: Vector3; valid: boolean; radius: number } | null;
  circles: PlacementCircleMarker[];
}

const PLACEMENT_VALID_COLOR = 0x69f0ae;
const PLACEMENT_INVALID_COLOR = 0xef5350;
const PLACEMENT_SPACING_COLOR = 0xffd54f;
const PLACEMENT_EXCLUSION_COLOR = 0xff9800;

const KEEP_AWAY_COLOR = 0xe53935;
const KEEP_AWAY_ALLOWED_COLOR = 0x66bb6a;

export interface MovePathMarker {
  from: Vector3;
  to: Vector3;
  waypoints?: Vector3[];
  color?: number;
  isMeleeContact?: boolean;
  /** When present, each leg is drawn in the style of its traversal kind instead of one line. */
  segments?: MovePathSegment[];
  /** A Flying unit's path: drawn dashed in its own colour, so it reads as passing over things rather than through them. */
  flying?: boolean;
  /** Where the path ended short of the cursor and why: a small ring and a floating label at that point. */
  stop?: { at: Vector3; text: string };
}

export const FLYING_PATH_COLOR = 0x4dd0e1;
const STOP_COLOR = 0x29b6f6;

const CLIMB_COLOR = 0xff9800;
const DROP_COLOR = 0xffc107;
const JUMP_COLOR = 0xf44336;

/** Line style for a path leg: walking and stairs/ladders keep the normal colour, climbs are orange, safe drops amber, jumps dashed red. */
export function segmentStyle(kind: SegmentKind, normalColor: number): { color: number; dashed: boolean } {
  switch (kind) {
    case 'climb':
      return { color: CLIMB_COLOR, dashed: false };
    case 'drop':
    case 'gap':
      return { color: DROP_COLOR, dashed: false };
    case 'jump-drop':
    case 'jump-gap':
    case 'fall':
      return { color: JUMP_COLOR, dashed: true };
    default:
      return { color: normalColor, dashed: false };
  }
}

export interface DeploymentZoneBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface DeploymentZoneMarker {
  hostZone: DeploymentZoneBounds;
  guestZone: DeploymentZoneBounds;
  previewUnitZone?: DeploymentZoneBounds & { color?: number };
}

const SELECTION_COLOR = 0x29b6f6;
const TARGET_COLOR = 0xff5252;
const CASUALTY_PICK_COLOR = 0xff9800;
const REACHABLE_TARGET_COLOR = 0x8e2424;
const RANGE_COLOR = 0xffd54f;
const PATH_COLOR = 0x69f0ae;
const OUTCOME_COLOR = 0xef5350;

/**
 * Renders gameplay UI markers in the scene: selection indicator under the
 * player's chosen unit, target indicator under a prospective attack target,
 * darker red rings under all reachable enemy targets within range,
 * movement-range ring for the active unit, thin attack-range ring during
 * shoot/charge/fight targeting, movement path preview line, and floating
 * wound-count tokens after an attack resolves.
 *
 * Markers use registered GLB assets when available (assetManifest) and
 * procedural ring/token fallbacks otherwise. Pure view layer — no game
 * state is read here; callers pass plain data.
 */
export class MarkerRenderer {
  private markerGroup: THREE.Group;
  private modelLoader: ModelLoader;
  private selection: THREE.Object3D | null = null;
  private target: THREE.Object3D | null = null;
  private reachableTargets: THREE.Group | null = null;
  private range: THREE.Object3D | null = null;
  private attackRange: THREE.Object3D | null = null;
  private movePath: THREE.Object3D | null = null;
  private meleeContact: THREE.Object3D | null = null;
  private terrainDebug: THREE.Object3D | null = null;
  private unitsDebug: THREE.Object3D | null = null;
  private shootingDebug: THREE.Object3D | null = null;
  private aimLines: THREE.Object3D | null = null;
  private deploymentZones: THREE.Object3D | null = null;
  private objectivesDebug: THREE.Object3D | null = null;
  private squadCoherency: THREE.Object3D | null = null;
  private casualtyPicks: THREE.Object3D | null = null;
  private keepAwayZones: THREE.Object3D | null = null;
  private placement: THREE.Object3D | null = null;
  private keepAwaySignature: string | null = null;
  private targetBadges: THREE.Object3D | null = null;
  private targetBadgesSignature: string | null = null;
  private thresholdRings: THREE.Object3D | null = null;
  private thresholdRingsSignature: string | null = null;
  private auras: THREE.Object3D | null = null;
  private aurasSignature: string | null = null;
  private blastSharing: THREE.Object3D | null = null;
  private outcome: THREE.Object3D | null = null;
  private outcomeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(scene: THREE.Scene, modelLoader: ModelLoader = new ModelLoader()) {
    this.markerGroup = new THREE.Group();
    this.markerGroup.name = 'markers';
    this.modelLoader = modelLoader;
    scene.add(this.markerGroup);
  }

  /** Indicator under the selected/active/hovered unit (blue circle under each model's feet). */
  setSelection(unit: MarkerUnit | null): void {
    this.removeMarker('selection');
    if (!unit) return;

    const positions =
      unit.models && unit.models.length > 0
        ? unit.models.map((m) => m.position)
        : [unit.position];

    if (positions.length === 1) {
      const pos = positions[0];
      const marker = this.modelLoader.createMarkerMesh('selection', () =>
        this.createFlatRing(SELECTION_COLOR, 0.55, 0.02)
      );
      this.applyTint(marker, SELECTION_COLOR);
      marker.name = 'marker-selection';
      marker.position.set(pos.x, (pos.y ?? 0) + 0.02, pos.z);
      this.markerGroup.add(marker);
      this.selection = marker;
      return;
    }

    const group = new THREE.Group();
    group.name = 'marker-selection';
    for (const pos of positions) {
      const ring = this.modelLoader.createMarkerMesh('selection', () =>
        this.createFlatRing(SELECTION_COLOR, 0.55, 0.02)
      );
      this.applyTint(ring, SELECTION_COLOR);
      ring.name = `marker-selection-${unit.id}`;
      ring.position.set(pos.x, (pos.y ?? 0) + 0.02, pos.z);
      group.add(ring);
    }
    this.markerGroup.add(group);
    this.selection = group;
  }

  /** Indicator under hovered or selected attack targets (bright red floor ring under each model). Supports single or split targets. */
  setTarget(unit: MarkerUnit | MarkerUnit[] | null): void {
    this.removeMarker('target');
    if (!unit) return;

    const targets = Array.isArray(unit) ? unit : [unit];
    if (targets.length === 0) return;

    if (targets.length === 1 && (!targets[0].models || targets[0].models.length <= 1)) {
      const pos = targets[0].models?.[0]?.position ?? targets[0].position;
      const marker = this.modelLoader.createMarkerMesh('target', () =>
        this.createFlatRing(TARGET_COLOR, 0.6, 0.025)
      );
      this.applyTint(marker, TARGET_COLOR);
      marker.name = 'marker-target';
      marker.position.set(pos.x, (pos.y ?? 0) + 0.025, pos.z);
      this.markerGroup.add(marker);
      this.target = marker;
      return;
    }

    const group = new THREE.Group();
    group.name = 'marker-target';
    for (const t of targets) {
      const positions =
        t.models && t.models.length > 0
          ? t.models.map((m) => m.position)
          : [t.position];
      for (const pos of positions) {
        const ring = this.modelLoader.createMarkerMesh('target', () =>
          this.createFlatRing(TARGET_COLOR, 0.6, 0.025)
        );
        this.applyTint(ring, TARGET_COLOR);
        ring.name = `marker-target-${t.id}`;
        ring.position.set(pos.x, (pos.y ?? 0) + 0.025, pos.z);
        group.add(ring);
      }
    }
    this.markerGroup.add(group);
    this.target = group;
  }

  /**
   * Shooting preview: one line per attacker model to the target model it aims at (blocked models faint red),
   * and a bright ring under the target model the player pointed at when a firing model can see it.
   */
  setAimLines(spec: AimLinesMarker | null): void {
    this.removeMarker('aimLines');
    if (!spec || (spec.lines.length === 0 && !spec.aimedModel)) return;

    const group = new THREE.Group();
    group.name = 'marker-aim-lines';
    spec.lines.forEach((line, i) => {
      const geo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(line.from.x, line.from.y ?? 0, line.from.z),
        new THREE.Vector3(line.to.x, line.to.y ?? 0, line.to.z),
      ]);
      // Firing: solid green. Blocked: faint dashed red (distinguishable without relying on hue alone).
      const mat = line.fires
        ? new THREE.LineBasicMaterial({ color: AIM_LINE_COLOR })
        : new THREE.LineDashedMaterial({
            color: AIM_BLOCKED_COLOR,
            dashSize: 0.4,
            gapSize: 0.3,
            transparent: true,
            opacity: 0.45,
          });
      const obj = new THREE.Line(geo, mat);
      if (!line.fires) obj.computeLineDistances();
      obj.name = line.fires ? `aim-line-${i}` : `aim-line-blocked-${i}`;
      group.add(obj);
      if (line.label) {
        const el = document.createElement('div');
        el.className = 'sl-aim-label';
        el.textContent = line.label;
        el.style.cssText =
          'pointer-events:none;user-select:none;white-space:nowrap;padding:1px 6px;border-radius:8px;' +
          `font:600 11px sans-serif;color:#fff;background:rgba(20,24,32,0.85);border:1px solid #${AIM_LINE_COLOR.toString(16)};`;
        const label = new CSS2DObject(el);
        label.name = `aim-label-${i}`;
        // A little way along the line from the shooter, so neighbouring labels do not stack on top of each other
        label.position.set(
          line.from.x + (line.to.x - line.from.x) * 0.15,
          (line.from.y ?? 0) + 0.5,
          line.from.z + (line.to.z - line.from.z) * 0.15
        );
        group.add(label);
      }
    });
    if (spec.aimedModel) {
      const ring = this.createFlatRing(AIMED_MODEL_COLOR, 0.62, 0.03);
      ring.name = 'aimed-model';
      ring.position.set(spec.aimedModel.x, (spec.aimedModel.y ?? 0) + 0.03, spec.aimedModel.z);
      group.add(ring);
    }
    this.markerGroup.add(group);
    this.aimLines = group;
  }

  /** Darker red floor rings under all enemy units within attack range (under each model's feet). */
  setReachableTargets(units: MarkerUnit[]): void {
    this.removeMarker('reachableTargets');
    if (!units || units.length === 0) return;

    const group = new THREE.Group();
    group.name = 'marker-reachable-targets';
    for (const unit of units) {
      const positions =
        unit.models && unit.models.length > 0
          ? unit.models.map((m) => m.position)
          : [unit.position];
      for (const pos of positions) {
        const ring = this.modelLoader.createMarkerMesh('reachable-target', () =>
          this.createFlatRing(REACHABLE_TARGET_COLOR, 0.55, 0.018)
        );
        this.applyTint(ring, REACHABLE_TARGET_COLOR);
        ring.name = `marker-reachable-${unit.id}`;
        const unitY = (pos.y ?? 0) + 0.018;
        ring.position.set(pos.x, unitY, pos.z);
        group.add(ring);
      }
    }
    this.markerGroup.add(group);
    this.reachableTargets = group;
  }

  /** Units that would share the hits of a Blast attack wear an orange ring (0xff9800, same style as target ring). */
  setBlastSharing(units: MarkerUnit[] | null): void {
    this.removeMarker('blastSharing');
    if (!units || units.length === 0) return;

    const group = new THREE.Group();
    group.name = 'marker-blast-sharing';
    for (const unit of units) {
      const positions =
        unit.models && unit.models.length > 0
          ? unit.models.map((m) => m.position)
          : [unit.position];
      for (const pos of positions) {
        const ring = this.modelLoader.createMarkerMesh('target', () =>
          this.createFlatRing(BLAST_SHARING_COLOR, 0.6, 0.025)
        );
        this.applyTint(ring, BLAST_SHARING_COLOR);
        ring.name = `marker-blast-sharing-${unit.id}`;
        ring.position.set(pos.x, (pos.y ?? 0) + 0.025, pos.z);
        group.add(ring);
      }
    }
    this.markerGroup.add(group);
    this.blastSharing = group;
  }

  /** Thin movement-range ring sized to the unit's remaining movement (or override radius, e.g. for Rush). */
  setMovementRange(unit: MarkerUnit | null, overrideRadius?: number, color?: number): void {
    this.removeMarker('range');
    if (!unit) return;
    const radius = Math.max(overrideRadius ?? unit.remainingMovement ?? 0, 0);
    if (radius <= 0) return;

    const ringColor = color ?? RANGE_COLOR;
    const normalizedThickness = Math.min(0.25, 0.08 / radius);
    const marker = this.modelLoader.createMarkerMesh(`movement-range-${ringColor.toString(16)}`, () =>
      this.createRangeRing(ringColor, 1, normalizedThickness)
    );
    this.applyTint(marker, ringColor);
    marker.name = 'marker-movement-range';
    const unitY = (unit.position.y ?? 0) + 0.03;
    marker.position.set(unit.position.x, unitY, unit.position.z);
    marker.scale.set(radius, 1, radius);
    this.markerGroup.add(marker);
    this.range = marker;
  }

  /**
   * Dark transparent red Line-of-Sight shadow fan sized to the weapon/charge
   * max range, cut out wherever LoS is blocked by terrain or fighters (no outer
   * ring outline).
   */
  setAttackRange(spec: AttackRangeMarker | null): void {
    this.removeMarker('attackRange');
    if (!spec || spec.range <= 0) return;

    const polygon =
      spec.losPolygon && spec.losPolygon.length >= 3
        ? spec.losPolygon
        : this.createDefaultCirclePolygon(spec.position, spec.range, 64);

    const marker = new THREE.Group();
    marker.add(this.createLosFanMesh(spec.position, spec.range, polygon));

    // Render soft concentric range rings for multi-range weapons
    const ranges = (spec.concentricRanges && spec.concentricRanges.length > 0
      ? spec.concentricRanges
      : [spec.range]
    ).filter((r) => r > 0);
    const uniqueRanges = Array.from(new Set(ranges)).sort((a, b) => a - b);
    for (const r of uniqueRanges) {
      const normR = r / spec.range;
      const segs = 64;
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= segs; i++) {
        const theta = (i / segs) * Math.PI * 2;
        pts.push(new THREE.Vector3(Math.cos(theta) * normR, 0, Math.sin(theta) * normR));
      }
      const ringGeo = new THREE.BufferGeometry().setFromPoints(pts);
      const ringMat = new THREE.LineBasicMaterial({
        color: 0xff7961,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
      });
      const ringLine = new THREE.Line(ringGeo, ringMat);
      ringLine.name = `attack-concentric-ring-${r}`;
      marker.add(ringLine);
    }

    marker.name = 'marker-attack-range';
    marker.position.set(spec.position.x, 0.035, spec.position.z);
    marker.scale.set(spec.range, 1, spec.range);
    this.markerGroup.add(marker);
    this.attackRange = marker;
  }

  /** Floating HTML label at a path leg's midpoint, styled like the HUD chips; never takes pointer events. */
  private createSegmentLabel(seg: MovePathSegment, color: number): CSS2DObject {
    const el = document.createElement('div');
    el.className = `sl-move-label sl-move-label-${seg.kind}`;
    el.textContent = seg.label ?? '';
    const css = `#${color.toString(16).padStart(6, '0')}`;
    el.style.cssText =
      'pointer-events:none;user-select:none;white-space:nowrap;padding:2px 8px;border-radius:10px;' +
      `font:600 12px sans-serif;color:#fff;background:rgba(20,24,32,0.85);border:1px solid ${css};`;
    const label = new CSS2DObject(el);
    label.name = `marker-move-label-${seg.kind}`;
    label.position.set(
      (seg.from.x + seg.to.x) / 2,
      ((seg.from.y ?? 0) + (seg.to.y ?? 0)) / 2 + 0.6,
      (seg.from.z + seg.to.z) / 2
    );
    return label;
  }

  /** Preview line + endpoint disc for a prospective move path. */
  setMovePath(path: MovePathMarker | null): void {
    this.removeMarker('movePath');
    if (!path) return;

    const group = new THREE.Group();
    group.name = 'marker-move-path';

    const pathColor = path.color ?? (path.isMeleeContact ? 0xff7043 : PATH_COLOR);
    const fromY = (path.from.y ?? 0) + 0.06;
    const allPts: THREE.Vector3[] = [new THREE.Vector3(path.from.x, fromY, path.from.z)];
    if (path.waypoints && path.waypoints.length > 0) {
      for (const wp of path.waypoints) {
        allPts.push(new THREE.Vector3(wp.x, (wp.y ?? 0) + 0.06, wp.z));
      }
    }
    const toY = (path.to.y ?? 0) + 0.06;
    allPts.push(new THREE.Vector3(path.to.x, toY, path.to.z));

    if (path.segments && path.segments.length > 0) {
      for (const seg of path.segments) {
        const style =
          path.flying && seg.kind !== 'fall' ? { color: FLYING_PATH_COLOR, dashed: true } : segmentStyle(seg.kind, pathColor);
        const geo = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(seg.from.x, (seg.from.y ?? 0) + 0.06, seg.from.z),
          new THREE.Vector3(seg.to.x, (seg.to.y ?? 0) + 0.06, seg.to.z),
        ]);
        const line = new THREE.Line(
          geo,
          style.dashed
            ? new THREE.LineDashedMaterial({ color: style.color, dashSize: 0.25, gapSize: 0.15 })
            : new THREE.LineBasicMaterial({ color: style.color })
        );
        if (style.dashed) line.computeLineDistances();
        line.name = `marker-move-segment-${seg.kind}`;
        group.add(line);
        if (seg.label) group.add(this.createSegmentLabel(seg, style.color));
      }
    } else {
      const lineGeo = new THREE.BufferGeometry().setFromPoints(allPts);
      const lineMat = path.flying
        ? new THREE.LineDashedMaterial({ color: FLYING_PATH_COLOR, dashSize: 0.25, gapSize: 0.15 })
        : new THREE.LineBasicMaterial({ color: pathColor });
      const line = new THREE.Line(lineGeo, lineMat);
      if (path.flying) {
        line.computeLineDistances();
        line.name = 'marker-move-flying';
      }
      group.add(line);
    }

    // Intermediate waypoint node dots
    if (path.waypoints && path.waypoints.length > 0) {
      for (const wp of path.waypoints) {
        const dot = this.createFlatRing(pathColor, 0.18, 0.05);
        dot.position.set(wp.x, (wp.y ?? 0) + 0.06, wp.z);
        group.add(dot);
      }
    }

    const endDisc = this.createFlatRing(path.flying ? FLYING_PATH_COLOR : pathColor, path.isMeleeContact ? 0.55 : 0.4, 0.06);
    endDisc.position.set(path.to.x, toY, path.to.z);
    group.add(endDisc);

    if (path.stop) {
      const ring = this.createFlatRing(STOP_COLOR, 0.65, 0.07);
      ring.name = 'marker-move-stop-ring';
      ring.position.set(path.stop.at.x, (path.stop.at.y ?? 0) + 0.07, path.stop.at.z);
      group.add(ring);
      const el = document.createElement('div');
      el.className = 'sl-move-label sl-move-label-stop';
      el.textContent = path.stop.text;
      el.style.cssText =
        'pointer-events:none;user-select:none;white-space:nowrap;padding:2px 8px;border-radius:10px;' +
        `font:600 12px sans-serif;color:#fff;background:rgba(20,24,32,0.85);border:1px solid #${STOP_COLOR.toString(16)};`;
      const label = new CSS2DObject(el);
      label.name = 'marker-move-label-stop';
      label.position.set(path.stop.at.x, (path.stop.at.y ?? 0) + 1.1, path.stop.at.z);
      group.add(label);
    }

    this.markerGroup.add(group);
    this.movePath = group;
  }

  /**
   * Melee engagement visual contact highlight: bright pulsing double ring
   * under an opposing unit in 1.0" base contact (under each model's feet).
   */
  setMeleeContact(unit: MarkerUnit | null): void {
    this.removeMarker('meleeContact');
    if (!unit) return;

    const group = new THREE.Group();
    group.name = 'marker-melee-contact';

    const positions =
      unit.models && unit.models.length > 0
        ? unit.models.map((m) => m.position)
        : [unit.position];

    if (positions.length === 1) {
      const outerRing = this.createFlatRing(0xff5252, 0.75, 0.08);
      const innerRing = this.createFlatRing(0xffab40, 0.55, 0.06);
      group.add(outerRing);
      group.add(innerRing);
      group.position.set(positions[0].x, (positions[0].y ?? 0) + 0.02, positions[0].z);
    } else {
      for (const pos of positions) {
        const outerRing = this.createFlatRing(0xff5252, 0.75, 0.08);
        const innerRing = this.createFlatRing(0xffab40, 0.55, 0.06);
        const pairGroup = new THREE.Group();
        pairGroup.add(outerRing);
        pairGroup.add(innerRing);
        pairGroup.position.set(pos.x, (pos.y ?? 0) + 0.02, pos.z);
        group.add(pairGroup);
      }
    }

    this.markerGroup.add(group);
    this.meleeContact = group;
  }

  /**
   * Wireframe debug boxes showing Line-of-Sight / obstacle footprints and
   * boundaries for all terrain pieces when F9 is active, with highlights
   * for hovered or active cover pieces.
   */
  setTerrainDebug(
    terrain: TerrainPiece[] | TerrainPiece | null,
    options?: { hoveredPieceId?: string; activeCoverPieceId?: string }
  ): void {
    this.removeMarker('terrainDebug');
    if (!terrain) return;

    const pieces = Array.isArray(terrain) ? terrain : [terrain];
    if (pieces.length === 0) return;

    const group = new THREE.Group();
    group.name = 'marker-terrain-debug';

    for (const piece of pieces) {
      const { hx, hz } = terrainHalfExtents(piece);
      const height = Math.max(0.5, piece.scale.y);
      const isHovered = piece.id === options?.hoveredPieceId;
      const isActiveCover = piece.id === options?.activeCoverPieceId;

      const pieceGroup = new THREE.Group();
      pieceGroup.name = `marker-terrain-${piece.id}`;
      pieceGroup.position.set(piece.position.x, 0, piece.position.z);
      pieceGroup.rotation.y = piece.rotation.y || 0;

      let wireColor = piece.blocksLineOfSight ? 0x00e5ff : 0xffb300;
      if (isActiveCover) {
        wireColor = 0xffd600;
      }

      if (isHovered || isActiveCover) {
        const floorPts = [
          new THREE.Vector3(-hx, 0.05, -hz),
          new THREE.Vector3(hx, 0.05, -hz),
          new THREE.Vector3(hx, 0.05, hz),
          new THREE.Vector3(-hx, 0.05, hz),
          new THREE.Vector3(-hx, 0.05, -hz),
        ];
        const floorGeo = new THREE.BufferGeometry().setFromPoints(floorPts);
        const floorMat = new THREE.LineBasicMaterial({
          color: isActiveCover ? 0xffd600 : 0xffeb3b,
        });
        pieceGroup.add(new THREE.Line(floorGeo, floorMat));
      }

      if (isStairPiece(piece)) {
        // Triangular prism (wedge) wireframe. Stair orientation is data: the head (top) end is always
        // local +Z (see getStairWaypoints), so the wireframe never infers direction from neighbours.
        const footZ = -hz;
        const headZ = hz;
        pieceGroup.position.y = piece.position.y ?? 0;

        const vertices = [
          // Bottom rectangle
          new THREE.Vector3(-hx, 0, footZ), new THREE.Vector3(hx, 0, footZ),
          new THREE.Vector3(hx, 0, footZ), new THREE.Vector3(hx, 0, headZ),
          new THREE.Vector3(hx, 0, headZ), new THREE.Vector3(-hx, 0, headZ),
          new THREE.Vector3(-hx, 0, headZ), new THREE.Vector3(-hx, 0, footZ),
          // Vertical rear riser at head
          new THREE.Vector3(-hx, 0, headZ), new THREE.Vector3(-hx, height, headZ),
          new THREE.Vector3(hx, 0, headZ), new THREE.Vector3(hx, height, headZ),
          new THREE.Vector3(-hx, height, headZ), new THREE.Vector3(hx, height, headZ),
          // Sloped hypotenuse incline
          new THREE.Vector3(-hx, 0, footZ), new THREE.Vector3(-hx, height, headZ),
          new THREE.Vector3(hx, 0, footZ), new THREE.Vector3(hx, height, headZ),
        ];

        const wedgeGeo = new THREE.BufferGeometry().setFromPoints(vertices);
        const wedgeLine = new THREE.LineSegments(
          wedgeGeo,
          new THREE.LineBasicMaterial({
            color: wireColor,
            transparent: true,
            opacity: isActiveCover ? 0.95 : isHovered ? 0.85 : 0.45,
          })
        );
        pieceGroup.add(wedgeLine);
      } else {
        // Per-box wireframes straight from the shared structure: solids in the piece colour
        // (cyan = blocks sight, amber = low cover, purple = walkable floor) and apertures (firing ports) in green.
        const structure = resolveTerrainStructure(piece);
        const baseY = piece.position.y ?? 0;
        const opacity = isActiveCover ? 0.95 : isHovered ? 0.85 : 0.45;
        const addBox = (
          b: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number },
          color: number
        ) => {
          const w = b.maxX - b.minX;
          const h = b.maxY - b.minY;
          const d = b.maxZ - b.minZ;
          const geo = new THREE.BoxGeometry(w, h, d);
          const line = new THREE.LineSegments(
            new THREE.EdgesGeometry(geo),
            new THREE.LineBasicMaterial({ color, transparent: true, opacity })
          );
          line.position.set((b.minX + b.maxX) / 2, baseY + b.minY + h / 2, (b.minZ + b.maxZ) / 2);
          pieceGroup.add(line);
          geo.dispose();
        };
        for (const solid of structure.solids) {
          addBox(
            solid,
            isActiveCover ? wireColor : solid.walkable ? 0xe040fb : solid.blocksLineOfSight ? 0x00e5ff : 0xffb300
          );
        }
        for (const ap of structure.apertures) {
          addBox(ap, isActiveCover ? wireColor : 0x76ff03);
        }
      }

      // Orange outline on the top face of every walkable floor of a climbable piece (models can climb
      // onto it without a ladder, rise up to 3").
      if (!isStairPiece(piece) && isClimbable(piece)) {
        for (const s of getWalkableSurfaces(piece)) {
          const y = s.topY + 0.03;
          const pts = [
            new THREE.Vector3(s.minX, y, s.minZ),
            new THREE.Vector3(s.maxX, y, s.minZ),
            new THREE.Vector3(s.maxX, y, s.maxZ),
            new THREE.Vector3(s.minX, y, s.maxZ),
            new THREE.Vector3(s.minX, y, s.minZ),
          ];
          const line = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints(pts),
            new THREE.LineBasicMaterial({ color: 0xff9800 })
          );
          line.name = 'climbable-outline';
          pieceGroup.add(line);
        }
      }

      // Footprint outline for ground that changes how models move: yellow = difficult, red = dangerous.
      // A piece that is both draws both outlines (the red one slightly higher so neither hides the other).
      const baseY = piece.position.y ?? 0;
      const flags: Array<[boolean, number, number]> = [
        [isDifficultPiece(piece), 0xffeb3b, 0.06],
        [isDangerousPiece(piece), 0xff1744, 0.09],
      ];
      for (const [on, color, lift] of flags) {
        if (!on) continue;
        const y = baseY + lift;
        const pts = [
          new THREE.Vector3(-hx, y, -hz),
          new THREE.Vector3(hx, y, -hz),
          new THREE.Vector3(hx, y, hz),
          new THREE.Vector3(-hx, y, hz),
          new THREE.Vector3(-hx, y, -hz),
        ];
        const outline = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(pts),
          new THREE.LineBasicMaterial({ color })
        );
        outline.name = 'area-outline';
        pieceGroup.add(outline);
      }

      group.add(pieceGroup);
    }

    this.markerGroup.add(group);
    this.terrainDebug = group;
  }

  /**
   * 3D shooting line, terrain entry/exit intersection rings, and target flank
   * rays showing Line-of-Sight and cover reasons when F9 is active.
   */
  setShootingDebugRay(debug: ShootingRayDebugInfo | null): void {
    this.removeMarker('shootingDebug');
    if (!debug) return;

    const group = new THREE.Group();
    group.name = 'marker-shooting-debug';

    // 1. Target flank rays (showing corner obscuration)
    if (debug.flankRays && debug.flankRays.length > 0) {
      for (const flank of debug.flankRays) {
        const pts = [
          new THREE.Vector3(flank.from.x, flank.from.y, flank.from.z),
          new THREE.Vector3(flank.to.x, flank.to.y, flank.to.z),
        ];
        const geo = new THREE.BufferGeometry().setFromPoints(pts);
        const mat = new THREE.LineBasicMaterial({
          color: flank.blocked ? 0xef5350 : 0x26a69a,
          transparent: true,
          opacity: flank.blocked ? 0.75 : 0.35,
        });
        group.add(new THREE.Line(geo, mat));
      }
    }

    // 1b. Squad shooting: one eye-level ray per attacker model (cyan = fires, faint red = cannot)
    if (debug.modelRays) {
      debug.modelRays.forEach((ray, i) => {
        const geo = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(ray.from.x, ray.from.y, ray.from.z),
          new THREE.Vector3(ray.to.x, ray.to.y, ray.to.z),
        ]);
        const line = new THREE.Line(
          geo,
          new THREE.LineBasicMaterial({
            color: ray.fires ? 0x00e5ff : 0xef5350,
            transparent: true,
            opacity: ray.fires ? 0.6 : 0.3,
          })
        );
        line.name = `model-ray-${i}`;
        group.add(line);
      });
    }

    // 2. Segmented shooting line & intersection discs
    // Eye-level ray (the shared engine traces LoS in 3D from the shooter's eye).
    const startPt = new THREE.Vector3(debug.from.x, debug.from.y, debug.from.z);
    const endPt = new THREE.Vector3(debug.to.x, debug.to.y, debug.to.z);

    if (debug.intersections.length === 0) {
      const geo = new THREE.BufferGeometry().setFromPoints([startPt, endPt]);
      const mat = new THREE.LineBasicMaterial({
        color: debug.hasLineOfSight ? 0x00e5ff : 0xef5350,
      });
      group.add(new THREE.Line(geo, mat));
    } else {
      let currentPt = startPt;
      let blockedEncountered = false;

      for (const inter of debug.intersections) {
        const entry = new THREE.Vector3(inter.entryPoint.x, inter.entryPoint.y, inter.entryPoint.z);
        const exit = new THREE.Vector3(inter.exitPoint.x, inter.exitPoint.y, inter.exitPoint.z);

        // Segment before this terrain piece
        if (currentPt.distanceTo(entry) > 0.05) {
          const segGeo = new THREE.BufferGeometry().setFromPoints([currentPt, entry]);
          const segMat = new THREE.LineBasicMaterial({
            color: blockedEncountered ? 0xef5350 : 0x00e5ff,
            transparent: blockedEncountered,
            opacity: blockedEncountered ? 0.35 : 0.9,
          });
          group.add(new THREE.Line(segGeo, segMat));
        }

        // Segment passing inside this terrain piece
        const pieceGeo = new THREE.BufferGeometry().setFromPoints([entry, exit]);
        const pieceColor = inter.isLoSBlocker
          ? 0xef5350
          : inter.isCoverProvider || inter.providesCover
          ? 0xffb300
          : 0x90caf9;
        const pieceMat = new THREE.LineBasicMaterial({
          color: pieceColor,
          transparent: true,
          opacity: 0.95,
        });
        group.add(new THREE.Line(pieceGeo, pieceMat));

        // Entry disc on terrain boundary
        const ringGeo = new THREE.RingGeometry(0.08, 0.16, 16);
        const ringMat = new THREE.MeshBasicMaterial({
          color: pieceColor,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.9,
        });
        const entryMesh = new THREE.Mesh(ringGeo, ringMat);
        entryMesh.position.copy(entry);
        entryMesh.rotation.x = -Math.PI / 2;
        group.add(entryMesh);

        // Exit disc on terrain boundary
        const exitMesh = new THREE.Mesh(ringGeo.clone(), ringMat.clone());
        exitMesh.position.copy(exit);
        exitMesh.rotation.x = -Math.PI / 2;
        group.add(exitMesh);

        if (inter.isLoSBlocker) {
          blockedEncountered = true;
        }
        currentPt = exit;
      }

      // Final segment from last exit to target
      if (currentPt.distanceTo(endPt) > 0.05) {
        const segGeo = new THREE.BufferGeometry().setFromPoints([currentPt, endPt]);
        const segMat = new THREE.LineBasicMaterial({
          color: blockedEncountered ? 0xef5350 : 0x00e5ff,
          transparent: blockedEncountered,
          opacity: blockedEncountered ? 0.35 : 0.9,
        });
        group.add(new THREE.Line(segGeo, segMat));
      }
    }

    this.markerGroup.add(group);
    this.shootingDebug = group;
  }

  /**
   * Wireframe cylinders showing the OPR Line of Sight blocking boundary
   * (`LOS_UNIT_RADIUS = 0.4`) for all living fighters when debug is active.
   */
  setUnitsDebug(units: Unit[] | null): void {
    this.removeMarker('unitsDebug');
    if (!units || units.length === 0) return;

    const group = new THREE.Group();
    group.name = 'marker-units-debug';

    for (const unit of units) {
      if (unit.isDestroyed) continue;
      const aliveModels = unit.models && unit.models.length > 0
        ? unit.models.filter((m) => !m.isDestroyed)
        : null;

      const positions = aliveModels && aliveModels.length > 0
        ? aliveModels.map((m) => m.position ?? unit.position)
        : [unit.position];

      for (const pos of positions) {
        const cylGeo = new THREE.CylinderGeometry(LOS_UNIT_RADIUS, LOS_UNIT_RADIUS, 1.4, 16, 1, true);
        const edges = new THREE.EdgesGeometry(cylGeo);
        const line = new THREE.LineSegments(
          edges,
          new THREE.LineBasicMaterial({ color: 0x00e5ff, transparent: true, opacity: 0.65 })
        );
        line.position.set(pos.x, (pos.y ?? 0) + 0.7, pos.z);
        group.add(line);
        cylGeo.dispose();
      }
    }

    this.markerGroup.add(group);
    this.unitsDebug = group;
  }

  /**
   * Wireframe cylinders showing the 3.0" horizontal and 3.0" vertical control volume
   * for each objective when F9 debug is active.
   */
  setObjectivesDebug(objectives: Objective[] | null): void {
    this.removeMarker('objectivesDebug');
    if (!objectives || objectives.length === 0) return;

    const group = new THREE.Group();
    group.name = 'marker-objectives-debug';

    const radius = OBJECTIVE_CONTROL_RADIUS;
    const halfH = OBJECTIVE_CONTROL_MAX_VERTICAL;

    for (const obj of objectives) {
      const objGroup = new THREE.Group();
      objGroup.name = `marker-objective-debug-${obj.id}`;
      const objY = obj.position.y ?? 0;
      objGroup.position.set(obj.position.x, objY, obj.position.z);

      const mat = new THREE.LineBasicMaterial({
        color: 0xffd54f, // warm gold / amber
        transparent: true,
        opacity: 0.65,
        depthWrite: false,
      });

      // Rings at +3.0", 0", and -3.0" relative to the objective center
      const segments = 32;
      for (const yLevel of [halfH, 0, -halfH]) {
        const pts: THREE.Vector3[] = [];
        for (let i = 0; i <= segments; i++) {
          const theta = (i / segments) * Math.PI * 2;
          pts.push(new THREE.Vector3(Math.cos(theta) * radius, yLevel, Math.sin(theta) * radius));
        }
        const ringGeo = new THREE.BufferGeometry().setFromPoints(pts);
        objGroup.add(new THREE.Line(ringGeo, mat));
      }

      // Vertical struts at 8 compass angles
      const strutPts: THREE.Vector3[] = [];
      const numStruts = 8;
      for (let i = 0; i < numStruts; i++) {
        const theta = (i / numStruts) * Math.PI * 2;
        const x = Math.cos(theta) * radius;
        const z = Math.sin(theta) * radius;
        strutPts.push(new THREE.Vector3(x, -halfH, z));
        strutPts.push(new THREE.Vector3(x, halfH, z));
      }
      const strutGeo = new THREE.BufferGeometry().setFromPoints(strutPts);
      objGroup.add(new THREE.LineSegments(strutGeo, mat));

      group.add(objGroup);
    }

    this.markerGroup.add(group);
    this.objectivesDebug = group;
  }

  /**
   * Renders translucent floor boundaries and border outlines for deployment zones
   * during the pre-match deployment phase.
   */
  setDeploymentZones(zones: DeploymentZoneMarker | null): void {
    this.removeMarker('deploymentZones');
    if (!zones) return;

    const group = new THREE.Group();
    group.name = 'marker-deployment-zones';

    const addZone = (
      bounds: DeploymentZoneBounds,
      color: number,
      opacity: number,
      borderOpacity: number
    ) => {
      const width = bounds.maxX - bounds.minX;
      const depth = bounds.maxZ - bounds.minZ;
      const centerX = (bounds.minX + bounds.maxX) / 2;
      const centerZ = (bounds.minZ + bounds.maxZ) / 2;

      // Semi-transparent ground fill
      const planeGeo = new THREE.PlaneGeometry(width, depth);
      const planeMat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const planeMesh = new THREE.Mesh(planeGeo, planeMat);
      planeMesh.rotation.x = -Math.PI / 2;
      planeMesh.position.set(centerX, 0.015, centerZ);
      group.add(planeMesh);

      // Boundary outline
      const halfW = width / 2;
      const halfD = depth / 2;
      const points = [
        new THREE.Vector3(centerX - halfW, 0.02, centerZ - halfD),
        new THREE.Vector3(centerX + halfW, 0.02, centerZ - halfD),
        new THREE.Vector3(centerX + halfW, 0.02, centerZ + halfD),
        new THREE.Vector3(centerX - halfW, 0.02, centerZ + halfD),
        new THREE.Vector3(centerX - halfW, 0.02, centerZ - halfD),
      ];
      const lineGeo = new THREE.BufferGeometry().setFromPoints(points);
      const lineMat = new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity: borderOpacity,
      });
      const line = new THREE.Line(lineGeo, lineMat);
      group.add(line);
    };

    // Host zone (Blue)
    addZone(zones.hostZone, 0x29b6f6, 0.12, 0.85);

    // Guest zone (Red)
    addZone(zones.guestZone, 0xef5350, 0.12, 0.85);

    // Preview unit zone (e.g. scout extension) if active
    if (zones.previewUnitZone) {
      addZone(zones.previewUnitZone, zones.previewUnitZone.color ?? 0xffd54f, 0.18, 0.95);
    }

    this.markerGroup.add(group);
    this.deploymentZones = group;
  }

  /**
   * Coherency zone rings (radius 2.0") around previously staged squad models
   * during sequential squad movement.
   */
  setSquadCoherency(positions: Vector3[] | null, radius: number = 2.0): void {
    this.removeMarker('squadCoherency');
    if (!positions || positions.length === 0) return;

    const group = new THREE.Group();
    group.name = 'marker-squad-coherency';

    const COHERENCY_COLOR = 0x26c6da;
    for (const pos of positions) {
      // 1. Crisp thin boundary ring matching movement/rush circles
      const ring = this.createRangeRing(COHERENCY_COLOR, radius, 0.06);
      ring.position.set(pos.x, (pos.y ?? 0) + 0.025, pos.z);
      group.add(ring);

      // 2. Soft translucent fill disc
      const discGeo = new THREE.CircleGeometry(radius, 32);
      const discMat = new THREE.MeshBasicMaterial({
        color: COHERENCY_COLOR,
        transparent: true,
        opacity: 0.12,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const discMesh = new THREE.Mesh(discGeo, discMat);
      discMesh.rotation.x = -Math.PI / 2;
      discMesh.position.set(pos.x, (pos.y ?? 0) + 0.024, pos.z);
      group.add(discMesh);

      // 3. Staged model placement pip
      const pip = this.createFlatRing(COHERENCY_COLOR, 0.35, 0.028);
      pip.position.set(pos.x, (pos.y ?? 0) + 0.028, pos.z);
      group.add(pip);
    }

    this.markerGroup.add(group);
    this.squadCoherency = group;
  }

  /**
   * The 1" keep-away no-go discs: red for a model another unit's base can't enter, green for the declared charge
   * target (allowed), faint for models 1" or more above/below the mover's start height (3D keep-away: they don't block from there). Rebuilt only when the zone list
   * changes, so a mouse-move re-emit of identical markers costs nothing.
   */
  setKeepAwayZones(zones: KeepAwayZoneMarker[] | null): void {
    if (!zones || zones.length === 0) {
      this.keepAwaySignature = null;
      this.removeMarker('keepAwayZones');
      return;
    }
    const signature = zones
      .map((z) => `${z.x.toFixed(2)},${z.y.toFixed(2)},${z.z.toFixed(2)},${z.radius.toFixed(2)},${z.exempt ? 1 : 0},${z.otherTier ? 1 : 0}`)
      .join('|');
    if (signature === this.keepAwaySignature && this.keepAwayZones) return;
    this.removeMarker('keepAwayZones');
    this.keepAwaySignature = signature;

    const group = new THREE.Group();
    group.name = 'marker-keep-away-zones';
    const discGeo = new THREE.CircleGeometry(1, 40);
    const ringGeo = new THREE.RingGeometry(0.97, 1, 48);
    const mats = new Map<string, THREE.MeshBasicMaterial>();
    const material = (color: number, opacity: number): THREE.MeshBasicMaterial => {
      const key = `${color}-${opacity}`;
      let m = mats.get(key);
      if (!m) {
        m = new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity,
          side: THREE.DoubleSide,
          depthWrite: false,
        });
        mats.set(key, m);
      }
      return m;
    };
    for (const zone of zones) {
      const color = zone.exempt ? KEEP_AWAY_ALLOWED_COLOR : KEEP_AWAY_COLOR;
      const faint = zone.otherTier && !zone.exempt;
      const disc = new THREE.Mesh(discGeo, material(color, faint ? 0.05 : 0.16));
      const ring = new THREE.Mesh(ringGeo, material(color, faint ? 0.2 : 0.75));
      for (const mesh of [disc, ring]) {
        mesh.rotation.x = -Math.PI / 2;
        mesh.scale.set(zone.radius, zone.radius, 1);
        mesh.position.set(zone.x, zone.y + 0.03, zone.z);
        mesh.renderOrder = 1;
        group.add(mesh);
      }
    }
    this.markerGroup.add(group);
    this.keepAwayZones = group;
  }

  /**
   * The setup placement preview (objectives, deployment, Scout and Ambush): a bold ring at the cursor that is green
   * where the host would accept the placement and red where it would not, the 9" circles around placed
   * objectives (gold) and the ground a Scout or Ambush unit may not use around enemy units (orange).
   */
  setPlacement(marker: PlacementMarker | null): void {
    this.removeMarker('placement');
    if (!marker || (!marker.cursor && marker.circles.length === 0)) return;

    const group = new THREE.Group();
    group.name = 'marker-placement';
    const addRing = (x: number, y: number, z: number, radius: number, color: number, ringOpacity: number, fillOpacity: number, thickness: number) => {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(Math.max(0.01, radius - thickness), radius, 64),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: ringOpacity, side: THREE.DoubleSide, depthWrite: false })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(x, y + 0.04, z);
      ring.renderOrder = 2;
      group.add(ring);
      if (fillOpacity > 0) {
        const disc = new THREE.Mesh(
          new THREE.CircleGeometry(radius, 64),
          new THREE.MeshBasicMaterial({ color, transparent: true, opacity: fillOpacity, side: THREE.DoubleSide, depthWrite: false })
        );
        disc.rotation.x = -Math.PI / 2;
        disc.position.set(x, y + 0.035, z);
        disc.renderOrder = 1;
        group.add(disc);
      }
    };
    for (const circle of marker.circles) {
      if (circle.kind === 'spacing') {
        addRing(circle.x, circle.y, circle.z, circle.radius, PLACEMENT_SPACING_COLOR, 0.7, 0.06, 0.08);
      } else {
        addRing(circle.x, circle.y, circle.z, circle.radius, PLACEMENT_EXCLUSION_COLOR, 0.6, 0.1, 0.08);
      }
    }
    if (marker.cursor) {
      const { position, valid, radius } = marker.cursor;
      addRing(position.x, position.y ?? 0, position.z, radius, valid ? PLACEMENT_VALID_COLOR : PLACEMENT_INVALID_COLOR, 0.95, 0.25, 0.18);
    }
    this.markerGroup.add(group);
    this.placement = group;
  }

  /**
   * Highlight for the models the owner has picked to remove as casualties: a bold orange ring on the floor
   * under each model plus a smaller ring at head height (so it reads from the side and on decks).
   */
  setCasualtyPicks(positions: Vector3[] | null): void {
    this.removeMarker('casualtyPicks');
    if (!positions || positions.length === 0) return;

    const group = new THREE.Group();
    group.name = 'marker-casualty-picks';
    for (const pos of positions) {
      const floor = this.createFlatRing(CASUALTY_PICK_COLOR, 0.62, 0.03);
      floor.position.set(pos.x, (pos.y ?? 0) + 0.03, pos.z);
      group.add(floor);
      const head = this.createFlatRing(CASUALTY_PICK_COLOR, 0.42, 0.03);
      head.position.set(pos.x, (pos.y ?? 0) + 1.3, pos.z);
      group.add(head);
    }
    this.markerGroup.add(group);
    this.casualtyPicks = group;
  }

  /**
   * Floating wound-count token above a position (supports 0 wounds for clean
   * attack feedback), auto-cleared after a short delay.
   */
  showOutcome(position: Vector3, wounds: number): void {
    if (wounds < 0) return;
    this.clearOutcome();

    const key = outcomeMarkerKey(wounds);
    const marker = this.modelLoader.createMarkerMesh(key, () =>
      this.createOutcomeToken(OUTCOME_COLOR, wounds)
    );
    this.applyTint(marker, wounds === 0 ? 0xb0bec5 : OUTCOME_COLOR);
    marker.name = `marker-${key}`;
    marker.position.set(position.x, (position.y ?? 0) + 1.6, position.z);
    marker.rotation.y = (-3 * Math.PI) / 4;
    this.markerGroup.add(marker);
    this.outcome = marker;

    this.outcomeTimer = setTimeout(() => this.clearOutcome(), 2500);
  }

  /**
   * Floating distance / gate badge above each target being aimed at or charged. One CSS2D label per badge, a
   * styled run per segment (on = bright, off = dim, negated = struck through); never takes pointer events.
   * Rebuilt only when the data changes, because hover re-emits markers often.
   */
  setTargetBadges(badges: TargetBadgeMarker[] | null): void {
    if (!badges || badges.length === 0) {
      this.targetBadgesSignature = null;
      this.removeMarker('targetBadges');
      return;
    }
    const signature = JSON.stringify(badges);
    if (signature === this.targetBadgesSignature && this.targetBadges) return;
    this.removeMarker('targetBadges');
    this.targetBadgesSignature = signature;

    const group = new THREE.Group();
    group.name = 'marker-target-badges';
    for (const badge of badges) {
      const el = document.createElement('div');
      el.className = 'sl-target-badge';
      el.style.cssText =
        'pointer-events:none;user-select:none;white-space:nowrap;padding:2px 8px;border-radius:10px;' +
        'font:600 12px sans-serif;color:#fff;background:rgba(20,24,32,0.85);border:1px solid #ff7961;';
      badge.segments.forEach((seg, i) => {
        if (i > 0) el.appendChild(document.createTextNode(' · '));
        const span = document.createElement('span');
        span.dataset.tone = seg.tone;
        span.textContent = seg.text;
        if (seg.tone === 'on') span.style.fontWeight = '700';
        if (seg.tone === 'off') span.style.opacity = '0.55';
        if (seg.tone === 'negated') {
          span.style.textDecoration = 'line-through';
          span.style.opacity = '0.75';
        }
        el.appendChild(span);
      });
      const label = new CSS2DObject(el);
      label.name = `marker-target-badge-${badge.unitId}`;
      label.position.set(badge.position.x, badge.position.y ?? 0, badge.position.z);
      group.add(label);
    }
    this.markerGroup.add(group);
    this.targetBadges = group;
  }

  /** Dashed rings (one small label each) for the attacker's own switch distances, at range-fan height. */
  setThresholdRings(spec: ThresholdRingsMarker | null, localSide: 'host' | 'guest' = 'host'): void {
    if (!spec || spec.rings.length === 0) {
      this.thresholdRingsSignature = null;
      this.removeMarker('thresholdRings');
      return;
    }
    const signature = JSON.stringify({ spec, localSide });
    if (signature === this.thresholdRingsSignature && this.thresholdRings) return;
    this.removeMarker('thresholdRings');
    this.thresholdRingsSignature = signature;

    const group = new THREE.Group();
    group.name = 'marker-threshold-rings';
    // Same plane as the range fan (drawn at a fixed 0.035 above the board), so an elevated attacker's rings don't float.
    const y = 0.045;
    for (const ring of spec.rings) {
      const segs = 96;
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= segs; i++) {
        const theta = (i / segs) * Math.PI * 2;
        pts.push(new THREE.Vector3(Math.cos(theta) * ring.radius, 0, Math.sin(theta) * ring.radius));
      }
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineDashedMaterial({
          color: THRESHOLD_RING_COLOR,
          dashSize: 0.5,
          gapSize: 0.3,
          transparent: true,
          opacity: 0.9,
          depthWrite: false,
        })
      );
      line.computeLineDistances();
      line.name = `threshold-ring-${ring.radius}`;
      line.position.set(spec.position.x, y, spec.position.z);
      group.add(line);

      const el = document.createElement('div');
      el.className = 'sl-threshold-label';
      el.textContent = ring.label;
      el.style.cssText =
        'pointer-events:none;user-select:none;white-space:nowrap;padding:1px 6px;border-radius:8px;' +
        'font:600 11px sans-serif;color:#fff;background:rgba(20,24,32,0.85);border:1px solid #ff7961;';
      const label = new CSS2DObject(el);
      label.name = `threshold-label-${ring.radius}`;
      const labelZ = localSide === 'guest' ? spec.position.z - ring.radius : spec.position.z + ring.radius;
      label.position.set(spec.position.x, y, labelZ);
      group.add(label);
    }
    this.markerGroup.add(group);
    this.thresholdRings = group;
  }

  /** Hero morale-aura rings (dashed, side colour) and Blast outlines (dashed orange), each with a floating CSS2D label. */
  setAuras(auras: AuraMarker[] | null, localSide: 'host' | 'guest' = 'host'): void {
    if (!auras || auras.length === 0) {
      this.aurasSignature = null;
      this.removeMarker('auras');
      return;
    }
    const signature = JSON.stringify({ auras, localSide });
    if (signature === this.aurasSignature && this.auras) return;
    this.removeMarker('auras');
    this.aurasSignature = signature;

    const group = new THREE.Group();
    group.name = 'marker-auras';
    const y = 0.04;
    for (const aura of auras) {
      const hero = aura.kind === 'hero';
      const color = hero
        ? (aura.side === 'guest' ? GUEST_HERO_AURA_COLOR : HOST_HERO_AURA_COLOR)
        : BLAST_AURA_COLOR;

      const segs = 96;
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= segs; i++) {
        const theta = (i / segs) * Math.PI * 2;
        pts.push(new THREE.Vector3(Math.cos(theta) * aura.radius, 0, Math.sin(theta) * aura.radius));
      }
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineDashedMaterial({
          color,
          dashSize: 0.5,
          gapSize: 0.3,
          transparent: true,
          opacity: aura.active ? 0.85 : 0.25,
          depthWrite: false,
        })
      );
      line.computeLineDistances();
      line.name = `aura-${aura.kind}`;
      line.position.set(aura.position.x, (aura.position.y ?? 0) + y, aura.position.z);
      group.add(line);

      if (aura.label) {
        const el = document.createElement('div');
        el.className = `sl-aura-label sl-aura-label-${aura.kind}`;
        el.textContent = aura.label;
        const hex = '#' + color.toString(16).padStart(6, '0');
        el.style.cssText =
          'pointer-events:none;user-select:none;white-space:nowrap;padding:1px 6px;border-radius:8px;' +
          `font:600 11px sans-serif;color:#fff;background:rgba(20,24,32,0.85);border:1px solid ${hex};`;
        const label = new CSS2DObject(el);
        label.name = `aura-label-${aura.kind}`;
        const labelZ = localSide === 'guest' ? aura.position.z - aura.radius : aura.position.z + aura.radius;
        label.position.set(aura.position.x, (aura.position.y ?? 0) + y, labelZ);
        group.add(label);
      }
    }
    this.markerGroup.add(group);
    this.auras = group;
  }

  /** Face the floating outcome token toward the active camera each frame. */
  orientOutcomeToCamera(camera: THREE.Camera | null): void {
    if (!this.outcome || !camera) return;
    const dx = camera.position.x - this.outcome.position.x;
    const dz = camera.position.z - this.outcome.position.z;
    // Kenney number GLBs have their readable front face pointing along -X,
    // so rotating -X toward (dx, dz) requires yaw = atan2(dz, -dx).
    this.outcome.rotation.y = Math.atan2(dz, -dx);
  }

  /**
   * Per-frame layout step for all marker CSS2D labels.
   * Projects each label to screen coordinates; going through them in a fixed order:
   * (1) target badges, (2) aura labels, (3) threshold ring labels,
   * (4) aim-line weapon labels, (5) move-path segment labels;
   * shifts any label whose box overlaps an already placed one upward by just enough to clear it.
   * Labels never take pointer events.
   */
  layoutLabels(camera: THREE.Camera, width: number, height: number): void {
    if (!camera || width <= 0 || height <= 0) return;

    const labelObjects: CSS2DObject[] = [];

    const collectLabels = (group: THREE.Object3D | null) => {
      if (!group || !group.visible) return;
      group.traverse((child) => {
        if (child instanceof CSS2DObject && child.visible) {
          labelObjects.push(child);
        }
      });
    };

    collectLabels(this.targetBadges);
    collectLabels(this.auras);
    collectLabels(this.thresholdRings);
    collectLabels(this.aimLines);
    collectLabels(this.movePath);

    if (labelObjects.length === 0) return;

    camera.updateMatrixWorld();

    const projVector = new THREE.Vector3();
    const activeLabels: Array<{
      object: CSS2DObject;
      screenX: number;
      screenY: number;
      width: number;
      height: number;
    }> = [];

    const boxes: LabelBox[] = [];

    for (const obj of labelObjects) {
      obj.element.style.pointerEvents = 'none';

      if (obj.element.style.display === 'none') continue;

      projVector.setFromMatrixPosition(obj.matrixWorld);
      projVector.project(camera);

      if (projVector.z < -1 || projVector.z > 1) continue;

      const screenX = (projVector.x * 0.5 + 0.5) * width;
      const screenY = (-projVector.y * 0.5 + 0.5) * height;

      const el = obj.element;
      const rect = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
      const w =
        rect && rect.width > 0
          ? rect.width
          : el.offsetWidth > 0
          ? el.offsetWidth
          : Math.max(40, (el.textContent?.length ?? 5) * 7.5 + 16);
      const h = rect && rect.height > 0 ? rect.height : el.offsetHeight > 0 ? el.offsetHeight : 20;

      const centerX = obj.center ? obj.center.x : 0.5;
      const centerY = obj.center ? obj.center.y : 0.5;

      const box: LabelBox = {
        x: screenX - w * centerX,
        y: screenY - h * centerY,
        width: w,
        height: h,
      };

      boxes.push(box);
      activeLabels.push({
        object: obj,
        screenX,
        screenY,
        width: w,
        height: h,
      });
    }

    if (activeLabels.length === 0) return;

    const offsets = labelLayout(boxes);

    for (let i = 0; i < activeLabels.length; i++) {
      const item = activeLabels[i];
      const offset = offsets[i];
      const centerX = item.object.center ? item.object.center.x : 0.5;
      const centerY = item.object.center ? item.object.center.y : 0.5;
      const finalY = item.screenY - offset;

      item.object.element.style.transform = `translate(${-100 * centerX}%, ${-100 * centerY}%) translate(${item.screenX}px, ${finalY}px)`;
    }
  }

  clearAll(): void {
    this.removeMarker('selection');
    this.removeMarker('target');
    this.removeMarker('reachableTargets');
    this.removeMarker('blastSharing');
    this.removeMarker('range');
    this.removeMarker('attackRange');
    this.removeMarker('movePath');
    this.removeMarker('meleeContact');
    this.removeMarker('terrainDebug');
    this.removeMarker('unitsDebug');
    this.removeMarker('shootingDebug');
    this.removeMarker('aimLines');
    this.removeMarker('deploymentZones');
    this.removeMarker('objectivesDebug');
    this.removeMarker('squadCoherency');
    this.removeMarker('casualtyPicks');
    this.keepAwaySignature = null;
    this.removeMarker('keepAwayZones');
    this.removeMarker('placement');
    for (const kind of ['targetBadges', 'thresholdRings', 'auras'] as const) this.removeMarker(kind);
    this.targetBadgesSignature = null;
    this.thresholdRingsSignature = null;
    this.aurasSignature = null;
    this.clearOutcome();
  }

  /** The markers currently rendered, by kind (for tests/debugging). */
  getRenderedMarkerNames(): string[] {
    return this.markerGroup.children.map((child) => child.name);
  }

  dispose(): void {
    this.clearAll();
  }

  private clearOutcome(): void {
    if (this.outcomeTimer) {
      clearTimeout(this.outcomeTimer);
      this.outcomeTimer = null;
    }
    if (this.outcome) {
      this.markerGroup.remove(this.outcome);
      disposeObject3D(this.outcome);
      this.outcome = null;
    }
  }

  private removeMarker(
    kind:
      | 'selection'
      | 'target'
      | 'reachableTargets'
      | 'blastSharing'
      | 'range'
      | 'attackRange'
      | 'movePath'
      | 'meleeContact'
      | 'terrainDebug'
      | 'unitsDebug'
      | 'shootingDebug'
      | 'aimLines'
      | 'deploymentZones'
      | 'objectivesDebug'
      | 'squadCoherency'
      | 'casualtyPicks'
      | 'keepAwayZones'
      | 'placement'
      | 'targetBadges'
      | 'thresholdRings'
      | 'auras'
  ): void {
    const current = this[kind];
    if (current) {
      if (
        kind === 'movePath' ||
        kind === 'aimLines' ||
        kind === 'targetBadges' ||
        kind === 'thresholdRings' ||
        kind === 'auras'
      ) {
        current.traverse((child) => {
          if (child instanceof CSS2DObject) child.element.remove();
        });
      }
      this.markerGroup.remove(current);
      disposeObject3D(current);
      this[kind] = null;
    }
  }

  private applyTint(marker: THREE.Object3D, color: number): void {
    marker.userData.tintColor = color;
    marker.userData.ignoreTextureMap = true;
    marker.traverse((child) => {
      const material = (child as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (material && material.color) {
        if (material.map) {
          material.map = null;
          material.needsUpdate = true;
        }
        material.color.setHex(color);
      }
    });
  }

  /** Flat ring fallback: two-tone annulus lying on the board. */
  private createFlatRing(color: number, radius: number, y: number): THREE.Object3D {
    const geometry = new THREE.RingGeometry(radius * 0.75, radius, 32);
    const material = new THREE.MeshBasicMaterial({
      color,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = y;
    return mesh;
  }

  /** Range-ring fallback: thin annulus scaled to the radius. */
  private createRangeRing(
    color: number,
    radius: number,
    thickness: number = 0.04
  ): THREE.Object3D {
    const geometry = new THREE.RingGeometry(
      Math.max(0.01, radius - thickness),
      radius,
      64
    );
    const material = new THREE.MeshBasicMaterial({
      color,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.8,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    return mesh;
  }

  /** Outcome-token fallback: floating 3D numeral / torus / octahedron. */
  private createOutcomeToken(color: number, wounds: number): THREE.Object3D {
    const geometry = new THREE.OctahedronGeometry(0.22 + 0.05 * wounds);
    const material = new THREE.MeshStandardMaterial({ color, roughness: 0.5 });
    return new THREE.Mesh(geometry, material);
  }

  /**
   * Build a 2D triangle-fan mesh (normalized to unit radius so the parent
   * container's `scale.set(range, 1, range)` sizes it to world space) that
   * fills visible Line of Sight with a dark transparent red shadow and leaves
   * blocked shadow wedges blank.
   */
  private createLosFanMesh(
    origin: Vector3,
    range: number,
    polygon: Array<{ x: number; z: number }>
  ): THREE.Mesh {
    const n = polygon.length;
    const vertices = new Float32Array(n * 3 * 3);
    for (let i = 0; i < n; i++) {
      const p1 = polygon[i];
      const p2 = polygon[(i + 1) % n];
      const base = i * 9;
      // Center vertex
      vertices[base + 0] = 0;
      vertices[base + 1] = -0.01;
      vertices[base + 2] = 0;
      // Perimeter vertex i
      vertices[base + 3] = (p1.x - origin.x) / range;
      vertices[base + 4] = -0.01;
      vertices[base + 5] = (p1.z - origin.z) / range;
      // Perimeter vertex i + 1
      vertices[base + 6] = (p2.x - origin.x) / range;
      vertices[base + 7] = -0.01;
      vertices[base + 8] = (p2.z - origin.z) / range;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    const material = new THREE.MeshBasicMaterial({
      color: 0xb71c1c,
      transparent: true,
      opacity: 0.22,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'los-shadow-fan';
    return mesh;
  }

  private createDefaultCirclePolygon(
    origin: Vector3,
    range: number,
    steps: number
  ): Array<{ x: number; z: number }> {
    const pts: Array<{ x: number; z: number }> = [];
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      pts.push({
        x: origin.x + Math.cos(a) * range,
        z: origin.z + Math.sin(a) * range,
      });
    }
    return pts;
  }
}
