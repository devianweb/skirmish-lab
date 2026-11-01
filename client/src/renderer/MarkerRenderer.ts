import * as THREE from 'three';
import {
  TerrainPiece,
  terrainHalfExtents,
  Vector3,
  Unit,
  LOS_UNIT_RADIUS,
  ShootingRayDebugInfo,
  Objective,
  OBJECTIVE_CONTROL_RADIUS,
  OBJECTIVE_CONTROL_MAX_VERTICAL,
  isStairPiece,
  getStairWaypoints,
} from '@skirmish-lab/shared';
import { ModelLoader } from './ModelLoader';
import { disposeObject3D } from './utils';
import { outcomeMarkerKey } from './assetManifest';

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

export interface MovePathMarker {
  from: Vector3;
  to: Vector3;
  waypoints?: Vector3[];
  color?: number;
  isMeleeContact?: boolean;
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
  private deploymentZones: THREE.Object3D | null = null;
  private objectivesDebug: THREE.Object3D | null = null;
  private squadCoherency: THREE.Object3D | null = null;
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

    const lineGeo = new THREE.BufferGeometry().setFromPoints(allPts);
    const lineMat = new THREE.LineBasicMaterial({ color: pathColor });
    group.add(new THREE.Line(lineGeo, lineMat));

    // Intermediate waypoint node dots
    if (path.waypoints && path.waypoints.length > 0) {
      for (const wp of path.waypoints) {
        const dot = this.createFlatRing(pathColor, 0.18, 0.05);
        dot.position.set(wp.x, (wp.y ?? 0) + 0.06, wp.z);
        group.add(dot);
      }
    }

    const endDisc = this.createFlatRing(pathColor, path.isMeleeContact ? 0.55 : 0.4, 0.06);
    endDisc.position.set(path.to.x, toY, path.to.z);
    group.add(endDisc);

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
        // Triangular prism (wedge) wireframe showing true incline profile from foot to head
        const waypoints = getStairWaypoints({ terrain: pieces } as any, piece);
        const fdx = waypoints.foot.x - piece.position.x;
        const fdz = waypoints.foot.z - piece.position.z;
        const flz = -fdx * Math.sin(piece.rotation.y || 0) + fdz * Math.cos(piece.rotation.y || 0);

        // Foot is at footZ (+hz or -hz), head is at headZ
        const footZ = flz > 0 ? hz : -hz;
        const headZ = -footZ;

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
        const boxGeo = new THREE.BoxGeometry(hx * 2, height, hz * 2);
        const edges = new THREE.EdgesGeometry(boxGeo);
        const boxLine = new THREE.LineSegments(
          edges,
          new THREE.LineBasicMaterial({
            color: wireColor,
            transparent: true,
            opacity: isActiveCover ? 0.95 : isHovered ? 0.85 : 0.45,
          })
        );
        boxLine.position.y = height / 2;
        pieceGroup.add(boxLine);
        boxGeo.dispose();
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
          new THREE.Vector3(flank.from.x, 0.45, flank.from.z),
          new THREE.Vector3(flank.to.x, 0.45, flank.to.z),
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

    // 2. Segmented shooting line & intersection discs
    const startPt = new THREE.Vector3(debug.from.x, 0.45, debug.from.z);
    const endPt = new THREE.Vector3(debug.to.x, 0.45, debug.to.z);

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
        const entry = new THREE.Vector3(inter.entryPoint.x, 0.45, inter.entryPoint.z);
        const exit = new THREE.Vector3(inter.exitPoint.x, 0.45, inter.exitPoint.z);

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

    // Preview unit zone (e.g. vanguard extension) if active
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
    marker.position.set(position.x, 1.6, position.z);
    marker.rotation.y = (-3 * Math.PI) / 4;
    this.markerGroup.add(marker);
    this.outcome = marker;

    this.outcomeTimer = setTimeout(() => this.clearOutcome(), 2500);
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

  clearAll(): void {
    this.removeMarker('selection');
    this.removeMarker('target');
    this.removeMarker('reachableTargets');
    this.removeMarker('range');
    this.removeMarker('attackRange');
    this.removeMarker('movePath');
    this.removeMarker('meleeContact');
    this.removeMarker('terrainDebug');
    this.removeMarker('unitsDebug');
    this.removeMarker('shootingDebug');
    this.removeMarker('deploymentZones');
    this.removeMarker('objectivesDebug');
    this.removeMarker('squadCoherency');
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
      | 'range'
      | 'attackRange'
      | 'movePath'
      | 'meleeContact'
      | 'terrainDebug'
      | 'unitsDebug'
      | 'shootingDebug'
      | 'deploymentZones'
      | 'objectivesDebug'
      | 'squadCoherency'
  ): void {
    const current = this[kind];
    if (current) {
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
    if (wounds === 0) {
      const group = new THREE.Group();
      // Three.js Torus lies in the XY plane; rotating 90° around Y makes its front face point along -X,
      // matching the Kenney number GLBs oriented by orientOutcomeToCamera.
      const geometry = new THREE.TorusGeometry(0.24, 0.065, 16, 32);
      const material = new THREE.MeshStandardMaterial({ color: 0xb0bec5, roughness: 0.4 });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.rotation.y = Math.PI / 2;
      mesh.scale.set(0.8, 1.2, 0.8);
      group.add(mesh);
      return group;
    }
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
