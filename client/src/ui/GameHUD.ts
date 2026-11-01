import {
  boardDistance,
  CombatModifierBreakdown,
  computeCombatModifiers,
  computeShootingRayDebug,
  computeSquadCentroid,
  createAction,
  describeTerrainPiece,
  describeTrait,
  detectPathFall,
  detectPathGapJump,
  findNavPath,
  findTerrainAtPosition,
  formatTraitLabel,
  GameState,
  GameAction,
  getDeployableUnits,
  getDeploymentZoneBounds,
  getEffectiveMaxMovement,
  getUnitTough,
  hasCoverAgainstAttack,
  hasLineOfSight,
  hasTrait,
  isPathDangerous,
  isPathDifficult,
  isUnitInObjectiveRange,
  Model,
  Objective,
  OBJECTIVE_CONTROL_MAX_VERTICAL,
  OBJECTIVE_CONTROL_RADIUS,
  pathLength,
  pathLength3D,
  ShootingRayDebugInfo,
  Unit,
  validateDeploymentPosition,
  validateMeleeVerticalReach,
  validateSquadCoherency,
  Vector3,
  Weapon,
} from '@skirmish-lab/shared';
import { soundFx } from '../audio/SoundFx';
import {
  DeploymentZoneBounds,
  DeploymentZoneMarker,
  MovePathMarker,
} from '../renderer/MarkerRenderer';

function escapeHtmlAttr(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** What the HUD needs from the game controller to submit confirmed actions. */
export interface HUDController {
  submitAction(action: GameAction): void;
  onReturnToLobby?(): void;
}

export interface GameHUDOptions {
  /** Player ID of the local player (host or guest perspective). */
  localPlayerId: string;
  /** Optional invite code for the room (displayed in the top-right header). */
  roomCode?: string;
  controller: HUDController;
}

/** Marker state the renderer reflects (selection, target, range, path, outcome). */
export interface MarkerSnapshot {
  selectedUnitId: string | null;
  targetUnitId: string | null;
  targetUnitIds?: string[];
  reachableTargetIds?: string[];
  movementRangeUnitId: string | null;
  movementRangePosition?: Vector3;
  movementRangeRadius?: number;
  movementRangeColor?: number;
  attackRange?: { unitId: string; range: number; concentricRanges?: number[] } | null;
  movePath?: MovePathMarker | null;
  engagedTargetId?: string | null;
  hoveredTerrainId?: string | null;
  outcome: { position: Vector3; wounds: number } | null;
  debugActive?: boolean;
  shootingDebugRay?: ShootingRayDebugInfo | null;
  deploymentZones?: DeploymentZoneMarker | null;
  squadCoherency?: { positions: Vector3[]; radius: number } | null;
}

export type PickTarget =
  | { kind: 'unit'; unitId: string; modelId?: string }
  | { kind: 'position'; position: Vector3; terrainId?: string };

type TargetingMode =
  | { mode: 'idle' }
  | { mode: 'waiting' }
  | { mode: 'targeting'; action: 'move' | 'rush' | 'shoot' | 'charge' | 'fight' }
  | { mode: 'confirming'; action: GameAction; summary: string };

/**
 * In-game HUD: round/turn header, unit list for the local player (plus enemy
 * status summary), action selection with explicit confirmation, dice result
 * display, and the action log. Pure view layer over confirmed game state — it
 * never mutates state and only submits confirmed actions to the controller
 * (host-authoritative).
 */
export class GameHUD {
  private container: HTMLElement;
  private localPlayerId: string;
  private roomCode: string | null;
  private controller: HUDController;
  private state: GameState | null = null;
  private flow: TargetingMode = { mode: 'idle' };
  /** Selected own unit (board click or list) pending activation, or active unit. */
  private selectedUnitId: string | null = null;
  /** Selected undeployed fighter pending placement during deployment phase. */
  private selectedDeployUnitId: string | null = null;
  /** Unit hovered in the fighter list or on the board. */
  private hoveredUnitId: string | null = null;
  /** Terrain piece hovered on the board (for terrain debug inspection). */
  private hoveredTerrainId: string | null = null;
  /** Objective hovered on the board within control radius. */
  private lastHoveredObjectiveId: string | null = null;
  /** Ground position hovered on the board (for debug raycast aiming). */
  private hoveredGroundPosition: Vector3 | null = null;
  /** Whether the F9 terrain hover debugger is enabled. */
  private terrainDebugEnabled = false;
  private keydownHandler: (event: KeyboardEvent) => void;
  /** Action button currently hovered in the action bar (e.g. 'move'). */
  private hoveredAction: string | null = null;
  /** Clamped move destination previewed under the cursor during move targeting. */
  private movePreview: Vector3 | null = null;
  /** Multi-segment waypoints previewed under cursor during move / rush / charge. */
  private movePathPreview: Vector3[] | null = null;
  /** Whether the currently previewed path encounters Difficult Terrain or vertical climb. */
  private movePreviewDifficult = false;
  /** Enemy unit currently highlighted in melee engagement contact. */
  private hoveredEngagedTargetId: string | null = null;
  /** Designated model in a multi-model squad to allocate hazard casualties to. */
  private selectedCasualtyModelId: string | null = null;
  /** For Shoot mode: map of weaponId -> targetUnitId | null */
  private shootAllocations: Map<string, string | null> = new Map();
  /** For Shoot mode: currently selected weapon chip for assignment */
  private selectedShootWeaponId: string | null = null;
  /** Staged model positions during squad movement (keyed by model ID) */
  private stagedSquadModelPositions: Map<string, Vector3> = new Map();
  /** Staged individual model navigation paths during squad movement (keyed by model ID) */
  private stagedSquadModelPaths: Map<string, Vector3[]> = new Map();
  /** ID of the squad model currently selected for placement */
  private selectedSquadModelId: string | null = null;
  private markerHandlers: Array<(markers: MarkerSnapshot) => void> = [];
  /** Log index already reflected (used for transient wound tokens). */
  private lastSeenLogIndex = 0;
  private lastRoundNumber: number | null = null;
  private toast: string | null = null;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private reactionTimerInterval: ReturnType<typeof setInterval> | null = null;
  private prevCurrentPlayerId: string | null = null;
  private prevPendingReactionId: string | null = null;
  private reactionReceivedAt: { id: string; timestamp: number } | null = null;
  private visible = false;
  private root: HTMLElement;

  constructor(container: HTMLElement, options: GameHUDOptions) {
    this.container = container;
    this.localPlayerId = options.localPlayerId;
    this.roomCode = options.roomCode ?? null;
    this.controller = options.controller;
    GameHUD.ensureStyles();

    this.root = document.createElement('div');
    this.root.className = 'sl-hud';
    this.root.style.display = 'none';
    this.container.appendChild(this.root);

    this.keydownHandler = (event: KeyboardEvent) => {
      if (event.key === 'F9') {
        event.preventDefault();
        this.toggleTerrainDebug();
      }
    };
    window.addEventListener('keydown', this.keydownHandler);
  }

  destroy(): void {
    if (this.reactionTimerInterval) {
      clearInterval(this.reactionTimerInterval);
      this.reactionTimerInterval = null;
    }
    if (this.toastTimer) {
      clearTimeout(this.toastTimer);
      this.toastTimer = null;
    }
    window.removeEventListener('keydown', this.keydownHandler);
    if (this.root.parentElement) {
      this.root.parentElement.removeChild(this.root);
    }
  }

  private peerState: 'connected' | 'disconnected' = 'connected';
  private signalingState: 'connected' | 'disconnected' | 'reconnecting' = 'connected';
  private disconnectedAt: number | null = null;

  setNetworkStatus(status: {
    peer?: 'connected' | 'disconnected';
    signaling?: 'connected' | 'disconnected' | 'reconnecting';
  }): void {
    if (status.peer !== undefined) {
      if (status.peer === 'disconnected' && this.peerState !== 'disconnected') {
        this.disconnectedAt = Date.now();
      } else if (status.peer === 'connected' && this.peerState === 'disconnected') {
        if (this.disconnectedAt && this.reactionReceivedAt) {
          const pausedDuration = Date.now() - this.disconnectedAt;
          this.reactionReceivedAt.timestamp += pausedDuration;
        }
        this.disconnectedAt = null;
      }
      this.peerState = status.peer;
    }
    if (status.signaling !== undefined) this.signalingState = status.signaling;
    if (this.visible) this.render();
  }

  /** Toggle the F9 terrain hover debugger (HUD inspector card + 3D wireframe bounds). */
  toggleTerrainDebug(force?: boolean): boolean {
    this.terrainDebugEnabled = force ?? !this.terrainDebugEnabled;
    this.showToast(
      this.terrainDebugEnabled
        ? 'Terrain debugger: ON (hover terrain to inspect, F9 to hide)'
        : 'Terrain debugger: OFF'
    );
    this.updateDataCardSlot();
    this.emitMarkers();
    return this.terrainDebugEnabled;
  }

  /** Re-render everything from the confirmed state (single source of truth). */
  syncFromState(state: GameState): void {
    const prevRound = this.lastRoundNumber;
    this.lastRoundNumber = state.turnState.roundNumber;
    this.state = state;
    if (this.flow.mode === 'waiting') {
      // Our action resolved into a new state — resume interacting.
      this.flow = { mode: 'idle' };
    }
    this.movePreview = null;
    this.movePathPreview = null;
    this.hoveredEngagedTargetId = null;
    this.selectedUnitId = state.turnState.activeUnitId ?? null;
    if (this.selectedDeployUnitId) {
      const unit = state.units.find((u) => u.id === this.selectedDeployUnitId);
      if (!unit || unit.isDeployed !== false) {
        this.selectedDeployUnitId = null;
      }
    }

    if (prevRound !== null && state.turnState.roundNumber > prevRound && state.status !== 'game-over') {
      const starter =
        state.turnState.currentPlayerId === this.localPlayerId
          ? 'You activate first'
          : 'Opponent activates first';
      this.showToast(`Round ${state.turnState.roundNumber} started — ${starter}!`);
      return;
    }

    // Audio cues for turn transitions and reaction prompts
    if (state.status !== 'game-over') {
      const pending = state.turnState.pendingReaction;
      if (
        pending &&
        pending.id !== this.prevPendingReactionId &&
        pending.promptingPlayerId === this.localPlayerId
      ) {
        soundFx.playReactionAlert();
      }
      this.prevPendingReactionId = pending?.id ?? null;

      const isMyTurn = state.turnState.currentPlayerId === this.localPlayerId && !pending;
      const wasMyTurn = this.prevCurrentPlayerId === this.localPlayerId;
      if (isMyTurn && !wasMyTurn) {
        soundFx.playTurnChime();
      }
      this.prevCurrentPlayerId = state.turnState.currentPlayerId;
    }

    if (state.turnState.pendingReaction) {
      if (!this.reactionTimerInterval) {
        this.reactionTimerInterval = setInterval(() => {
          this.updateReactionTimerDisplay();
        }, 250);
      }
    } else {
      this.reactionReceivedAt = null;
      if (this.reactionTimerInterval) {
        clearInterval(this.reactionTimerInterval);
        this.reactionTimerInterval = null;
      }
    }

    this.render();
  }

  private getReactionRemainingSec(pending: any): number {
    const now = this.disconnectedAt ?? Date.now();
    if (pending.durationMs) {
      if (!this.reactionReceivedAt || this.reactionReceivedAt.id !== pending.id) {
        this.reactionReceivedAt = { id: pending.id, timestamp: now };
      }
      const elapsed = now - this.reactionReceivedAt.timestamp;
      return Math.max(0, Math.ceil((pending.durationMs - elapsed) / 1000));
    }
    return Math.max(0, Math.ceil((pending.expiresAt - now) / 1000));
  }

  private updateReactionTimerDisplay(): void {
    const pending = this.state?.turnState.pendingReaction;
    if (!pending) {
      this.reactionReceivedAt = null;
      return;
    }
    const remainingSec = this.getReactionRemainingSec(pending);
    const timerEl = this.root.querySelector('.sl-hud-reaction-timer');
    if (timerEl) {
      timerEl.textContent = `${remainingSec}s`;
    }
    const waitingTimerEl = this.root.querySelector('.sl-hud-reaction-waiting-timer');
    if (waitingTimerEl) {
      waitingTimerEl.textContent = `${remainingSec}s`;
    }
  }

  /** Board/unit picks from GameView (see PickTarget in the renderer). */
  handleBoardPick(target: PickTarget): void {
    if (!this.state || this.state.status === 'game-over') return;

    if (this.state.turnState.phase === 'deployment') {
      if (!this.myTurn) {
        this.showToast("Wait for opponent's deployment turn");
        return;
      }
      if (target.kind === 'position') {
        const deployable = getDeployableUnits(this.state, this.localPlayerId);
        const unit = (this.selectedDeployUnitId
          ? this.state.units.find((u) => u.id === this.selectedDeployUnitId)
          : null) ?? deployable[0];
        if (!unit) {
          this.showToast('No deployable units remaining');
          return;
        }
        const val = validateDeploymentPosition(this.state, unit, target.position);
        if (!val.valid) {
          this.showToast(val.reason ?? 'Invalid deployment position');
          return;
        }
        this.flow = {
          mode: 'confirming',
          action: createAction(this.localPlayerId, 'deploy-unit', {
            type: 'deploy-unit',
            unitId: unit.id,
            position: target.position,
          }),
          summary: `Deploy ${unit.name} at (${target.position.x.toFixed(1)}, ${target.position.z.toFixed(1)})`,
        };
        this.render();
      }
      return;
    }

    const pendingReaction = this.state.turnState.pendingReaction;
    if (
      pendingReaction &&
      pendingReaction.type === 'melee-consolidation' &&
      pendingReaction.promptingPlayerId === this.localPlayerId
    ) {
      if (target.kind === 'position') {
        const victorId = pendingReaction.data?.unitId;
        const victor = this.state.units.find((u) => u.id === victorId);
        if (victor) {
          const maxDist = pendingReaction.data?.maxDistance ?? 3.0;
          const path = findNavPath(this.state, victor, target.position, maxDist);
          if (path.length >= 2) {
            const distance = pathLength3D(path);
            this.flow = {
              mode: 'confirming',
              action: createAction(this.localPlayerId, 'consolidate-move', {
                type: 'consolidate-move',
                unitId: victor.id,
                path,
              }),
              summary: `Consolidate ${victor.name} ${distance.toFixed(1)}" (max ${maxDist.toFixed(1)}")`,
            };
            this.movePathPreview = path;
            this.movePreview = path[path.length - 1];
            this.render();
            this.emitMarkers();
          }
        }
      }
      return;
    }

    if (this.flow.mode === 'targeting' && (this.flow.action === 'move' || this.flow.action === 'rush')) {
      const aliveSquad = this.activeAliveSquadModels;
      if (aliveSquad.length > 1 && this.activeUnit) {
        if (target.kind === 'unit' && target.unitId === this.activeUnit.id) {
          if (target.modelId) {
            this.selectSquadModel(target.modelId);
            return;
          }
        }
        if (target.kind === 'position') {
          this.handleSquadModelPick(target.position, this.flow.action);
          return;
        }
      } else if (target.kind === 'position') {
        if (this.flow.action === 'move') {
          this.prepareMove(target.position);
        } else {
          this.prepareRush(target.position);
        }
        return;
      }
      return;
    }

    if (
      this.flow.mode === 'targeting' &&
      this.flow.action !== 'move' &&
      this.flow.action !== 'rush'
    ) {
      if (target.kind === 'unit') {
        this.prepareAttack(target.unitId);
      }
      return;
    }

    if (
      this.flow.mode === 'confirming' &&
      this.flow.action.type === 'shoot' &&
      target.kind === 'unit'
    ) {
      this.prepareAttack(target.unitId);
      return;
    }

    // Allow switching to another unit when idle OR while confirming a unit
    // activation/hold, without forcing the player to click Cancel first.
    if (
      target.kind === 'unit' &&
      (this.flow.mode === 'idle' ||
        (this.flow.mode === 'confirming' &&
          (this.flow.action.type === 'activate-unit' ||
            (this.flow.action.type === 'hold' && !this.activeUnit))))
    ) {
      this.trySelectForActivation(target.unitId);
    }
  }

  /** Board hover events from GameView (for live movement path preview, target hover & terrain debug). */
  handleBoardHover(target: PickTarget | null): void {
    if (!this.state || this.state.status === 'game-over') return;

    const nextTerrainId =
      target?.kind === 'position'
        ? target.terrainId ?? findTerrainAtPosition(this.state, target.position)?.id ?? null
        : null;
    const terrainChanged = nextTerrainId !== this.hoveredTerrainId;
    this.hoveredTerrainId = nextTerrainId;

    const nextGroundPos = target?.kind === 'position' ? target.position : null;
    const groundPosChanged =
      (nextGroundPos === null && this.hoveredGroundPosition !== null) ||
      (nextGroundPos !== null && this.hoveredGroundPosition === null) ||
      (nextGroundPos !== null &&
        this.hoveredGroundPosition !== null &&
        (Math.abs(nextGroundPos.x - this.hoveredGroundPosition.x) > 0.05 ||
          Math.abs(nextGroundPos.z - this.hoveredGroundPosition.z) > 0.05));
    this.hoveredGroundPosition = nextGroundPos;

    const pendingReaction = this.state.turnState.pendingReaction;
    if (
      pendingReaction &&
      pendingReaction.type === 'melee-consolidation' &&
      pendingReaction.promptingPlayerId === this.localPlayerId
    ) {
      if (this.flow.mode === 'confirming') {
        return;
      }
      const victorId = pendingReaction.data?.unitId;
      const victor = this.state.units.find((u) => u.id === victorId);
      if (victor && target?.kind === 'position') {
        const maxDist = pendingReaction.data?.maxDistance ?? 3.0;
        const path = findNavPath(this.state, victor, target.position, maxDist);
        this.movePathPreview = path;
        this.movePreview = path.length > 0 ? path[path.length - 1] : null;
        this.emitMarkers();
      } else {
        this.movePathPreview = null;
        this.movePreview = null;
        this.emitMarkers();
      }
      return;
    }

    if (this.flow.mode === 'targeting' && (this.flow.action === 'move' || this.flow.action === 'rush')) {
      const active = this.activeUnit;
      if (active && target?.kind === 'position') {
        const alive = this.activeAliveSquadModels;
        const currentModel = alive.length > 1 ? this.selectedSquadModel : null;
        const startPos = currentModel ? (currentModel.position ?? active.position) : active.position;
        const isRush = this.flow.action === 'rush';
        const remainingBudget = active.isRushing
          ? active.remainingMovement
          : (isRush ? active.speed * 2 : (active.remainingMovement ?? active.speed));
        const nominalMax = remainingBudget;
        let path = findNavPath(this.state, active, target.position, nominalMax, {
          startPosition: startPos,
          stopBeforeDifficult: isRush || !!active.isRushing,
        });

        const targetTerrain = findTerrainAtPosition(this.state, target.position);
        const isTargetDifficult =
          targetTerrain &&
          (targetTerrain.isDifficult ||
            targetTerrain.terrainType === 'mud' ||
            targetTerrain.terrainType === 'trench' ||
            targetTerrain.terrainType === 'forest');

        const isElevationObstacle =
          path.length > 0 && (target.position.y ?? 0) - (path[path.length - 1].y ?? 0) > 0.5;

        const stoppedAtBase =
          (isRush || !!active.isRushing) &&
          path.length > 0 &&
          !hasTrait(active.specialRules, 'airborne') &&
          (isElevationObstacle ||
            (Boolean(isTargetDifficult) && boardDistance(path[path.length - 1], target.position) > 0.1));

        const isDifficult =
          !stoppedAtBase &&
          (path.length > 0
            ? isPathDifficult(this.state, path, active)
            : isPathDifficult(this.state, [startPos, target.position], active));

        const effectiveCap = getEffectiveMaxMovement(
          active,
          isRush || active.isRushing ? 'rush' : 'move',
          isDifficult
        );
        const cappedAllowance = Math.min(effectiveCap, remainingBudget);
        if (isDifficult && nominalMax > cappedAllowance) {
          path = findNavPath(this.state, active, target.position, cappedAllowance, {
            startPosition: startPos,
            stopBeforeDifficult: isRush || !!active.isRushing,
          });
        }

        this.movePreviewDifficult = isDifficult;
        this.movePathPreview = path;
        this.movePreview = path.length > 0 ? path[path.length - 1] : null;

        // Detect if move/rush destination places the fighter in melee engagement contact (<= 1.0" horizontal, <= 1.5" vertical)
        if (this.movePreview) {
          const enemy = this.enemyUnits.find(
            (e) =>
              !e.isDestroyed &&
              Math.hypot(e.position.x - this.movePreview!.x, e.position.z - this.movePreview!.z) <= 1.0 &&
              Math.abs((e.position.y ?? 0) - (this.movePreview!.y ?? 0)) <= 1.5
          );
          this.hoveredEngagedTargetId = enemy ? enemy.id : null;
        } else {
          this.hoveredEngagedTargetId = null;
        }
        this.updateMoveWarning(isDifficult, this.flow.action, stoppedAtBase, isElevationObstacle);
      } else {
        this.movePreview = null;
        this.movePathPreview = null;
        this.movePreviewDifficult = false;
        this.hoveredEngagedTargetId = null;
        this.updateMoveWarning(false, this.flow.action, false);
      }
      if (terrainChanged) {
        this.updateDataCardSlot();
      }
      this.emitMarkers();
      return;
    }

    if (this.flow.mode === 'targeting' && this.flow.action === 'charge') {
      const active = this.activeUnit;
      const targetUnitId = target?.kind === 'unit' ? target.unitId : null;
      const enemy = targetUnitId
        ? this.state.units.find((u) => u.id === targetUnitId && u.ownerId !== this.localPlayerId && !u.isDestroyed)
        : null;

      if (active && enemy) {
        const dx = active.position.x - enemy.position.x;
        const dz = active.position.z - enemy.position.z;
        const len = Math.hypot(dx, dz) || 1;
        const contactTarget = {
          x: Math.round((enemy.position.x + (dx / len) * 1.0) * 100) / 100,
          y: active.position.y ?? 0,
          z: Math.round((enemy.position.z + (dz / len) * 1.0) * 100) / 100,
        };
        const path = findNavPath(this.state, active, contactTarget, active.speed * 2, {
          ignoreUnitId: enemy.id,
        });
        const isDifficult = path.length > 0 && isPathDifficult(this.state, path, active);
        this.movePreviewDifficult = isDifficult;
        this.movePathPreview = path;
        this.movePreview = path.length > 0 ? path[path.length - 1] : null;
        this.hoveredEngagedTargetId = enemy.id;
        this.updateMoveWarning(isDifficult, this.flow.action);
      } else {
        this.movePathPreview = null;
        this.movePreview = null;
        this.movePreviewDifficult = false;
        this.hoveredEngagedTargetId = null;
        this.updateMoveWarning(false, this.flow.action);
      }
    }

    const nextHover = target?.kind === 'unit' ? target.unitId : null;
    const nextObjective = this.inspectedObjective;
    const objectiveChanged = nextObjective?.id !== this.lastHoveredObjectiveId;
    this.lastHoveredObjectiveId = nextObjective?.id ?? null;

    if (
      nextHover !== this.hoveredUnitId ||
      terrainChanged ||
      objectiveChanged ||
      (this.terrainDebugEnabled && groundPosChanged)
    ) {
      this.hoveredUnitId = nextHover;
      this.updateDataCardSlot();
      this.emitMarkers();
    }
  }

  /** Surface an action rejection (from the host) to the player. */
  notifyRejected(reason: string): void {
    if (this.flow.mode === 'waiting') {
      this.flow = { mode: 'idle' };
    }
    this.showToast(`Action rejected: ${reason}`);
  }

  /** Marker subscriptions (wired to GameView marker setters by the app). */
  onMarkers(handler: (markers: MarkerSnapshot) => void): () => void {
    this.markerHandlers.push(handler);
    return () => {
      this.markerHandlers = this.markerHandlers.filter((h) => h !== handler);
    };
  }

  show(): void {
    this.visible = true;
    this.root.style.display = '';
  }

  hide(): void {
    this.visible = false;
    this.root.style.display = 'none';
  }

  dispose(): void {
    window.removeEventListener('keydown', this.keydownHandler);
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.root.remove();
  }

  // --- internals ----------------------------------------------------------

  private get myTurn(): boolean {
    return !!this.state && this.state.turnState.currentPlayerId === this.localPlayerId;
  }

  private get activeUnit(): Unit | null {
    const id = this.state?.turnState.activeUnitId;
    return id ? (this.state?.units.find((u) => u.id === id) ?? null) : null;
  }

  private get myUnits(): Unit[] {
    return this.state?.units.filter((u) => u.ownerId === this.localPlayerId) ?? [];
  }

  private get enemyUnits(): Unit[] {
    return this.state?.units.filter((u) => u.ownerId !== this.localPlayerId) ?? [];
  }

  private get activeAliveSquadModels(): Model[] {
    const active = this.activeUnit;
    if (!active || !active.models || active.models.length === 0) return [];
    return active.models.filter((m) => !m.isDestroyed);
  }

  private get selectedSquadModel(): Model | null {
    const alive = this.activeAliveSquadModels;
    if (alive.length === 0) return null;
    if (this.selectedSquadModelId) {
      const found = alive.find((m) => m.id === this.selectedSquadModelId);
      if (found) return found;
    }
    const unplaced = alive.find((m) => !this.stagedSquadModelPositions.has(m.id));
    return unplaced ?? alive[0];
  }

  selectSquadModel(modelId: string): void {
    const alive = this.activeAliveSquadModels;
    const model = alive.find((m) => m.id === modelId);
    if (!model) return;
    this.selectedSquadModelId = model.id;
    this.movePreview = null;
    this.movePathPreview = null;
    this.render();
    this.emitMarkers();
  }

  /** Units the local player may activate right now. */
  private get activatableUnits(): Unit[] {
    if (!this.myTurn || this.activeUnit) return [];
    return this.myUnits.filter(
      (u) => !u.isDestroyed && !u.isActivated && !u.status.includes('routed')
    );
  }

  private canActivateUnit(unit: Unit): boolean {
    return this.activatableUnits.some((u) => u.id === unit.id);
  }

  private trySelectForActivation(unitId: string): void {
    const unit = this.state?.units.find((u) => u.id === unitId);
    if (!unit || unit.ownerId !== this.localPlayerId) return;
    if (!this.canActivateUnit(unit)) return;

    this.promptUnitActivation(unit);
  }

  private tryActivateFromList(unitId: string): void {
    if (
      this.flow.mode !== 'idle' &&
      !(
        this.flow.mode === 'confirming' &&
        (this.flow.action.type === 'activate-unit' ||
          (this.flow.action.type === 'hold' && !this.activeUnit))
      )
    ) {
      return;
    }
    const unit = this.state?.units.find((u) => u.id === unitId);
    if (!unit || !this.canActivateUnit(unit)) return;

    this.promptUnitActivation(unit);
  }

  private promptUnitActivation(unit: Unit): void {
    this.selectedUnitId = unit.id;
    if (unit.status.includes('stunned')) {
      this.beginConfirmation(
        createAction(this.localPlayerId, 'hold', {
          type: 'hold',
          unitId: unit.id,
        }),
        `Hold with ${unit.name} (clears stun)`
      );
      return;
    }
    this.beginConfirmation(
      createAction(this.localPlayerId, 'activate-unit', {
        type: 'activate-unit',
        unitId: unit.id,
      }),
      `Activate ${unit.name}`
    );
  }

  private beginActionTargeting(action: 'move' | 'rush' | 'shoot' | 'charge' | 'fight'): void {
    if (this.flow.mode !== 'idle') return;
    const active = this.activeUnit;
    if (!active || active.ownerId !== this.localPlayerId) return;
    this.movePreview = null;
    this.movePathPreview = null;
    this.hoveredEngagedTargetId = null;
    this.stagedSquadModelPositions.clear();
    this.stagedSquadModelPaths.clear();
    this.selectedSquadModelId = this.activeAliveSquadModels[0]?.id ?? null;
    this.flow = { mode: 'targeting', action };

    if (action === 'shoot') {
      this.shootAllocations.clear();
      const ranged = active.weapons.filter((w) => w.isEquipped && w.profile.type === 'ranged');
      for (const w of ranged) {
        this.shootAllocations.set(w.id, null);
      }
      this.selectedShootWeaponId = ranged[0]?.id ?? null;
    }

    // If fighting and there is only one enemy in engagement range, automatically
    // select that target and go straight to confirmation.
    if (action === 'fight') {
      const targets = this.reachableEnemies(active, 'fight');
      if (targets.length === 1) {
        this.prepareAttack(targets[0].id);
        return;
      }
    }

    this.render();
  }

  private handleSquadModelPick(rawDestination: Vector3, actionKind: 'move' | 'rush'): void {
    const active = this.activeUnit;
    if (!active || !this.state) return;

    const alive = this.activeAliveSquadModels;
    if (alive.length <= 1) return;

    const currentModel = this.selectedSquadModel;
    if (!currentModel) return;

    const startPos = currentModel.position ?? active.position;

    const isRush = actionKind === 'rush';
    const remainingBudget = active.isRushing
      ? active.remainingMovement
      : (isRush ? active.speed * 2 : (active.remainingMovement ?? active.speed));
    let maxAllowance = remainingBudget;
    let path = findNavPath(this.state, active, rawDestination, maxAllowance, {
      startPosition: startPos,
      stopBeforeDifficult: isRush || !!active.isRushing,
    });
    const isDifficult = path.length > 0 && isPathDifficult(this.state, path, active);
    const effectiveCap = getEffectiveMaxMovement(active, isRush || active.isRushing ? 'rush' : 'move', isDifficult);
    const cappedAllowance = Math.min(effectiveCap, remainingBudget);
    if (isDifficult && maxAllowance > cappedAllowance) {
      maxAllowance = cappedAllowance;
      path = findNavPath(this.state, active, rawDestination, maxAllowance, {
        startPosition: startPos,
        stopBeforeDifficult: isRush || !!active.isRushing,
      });
    }
    if (path.length < 2) {
      this.showToast('Pick a destination away from the model');
      return;
    }
    const destination = path[path.length - 1];
    const distance = pathLength3D(path);
    if (distance < 0.05) {
      this.showToast('Pick a destination away from the model');
      return;
    }

    if (isDifficult && actionKind === 'rush') {
      this.showToast('Difficult Terrain / Climb: Rush capped at 6.0" (speed bonus negated)');
    }

    const wouldEngage = this.enemyUnits.some(
      (e) =>
        !e.isDestroyed &&
        Math.hypot(e.position.x - destination.x, e.position.z - destination.z) <= 1.0 &&
        Math.abs((e.position.y ?? 0) - (destination.y ?? 0)) <= 1.5
    );
    if (wouldEngage) {
      this.showToast(`${actionKind === 'rush' ? 'Rush' : 'Move'} cannot end in melee contact — use Charge instead`);
      return;
    }

    // Minimum model separation check: models cannot physically overlap (bases must not overlap)
    for (let i = 0; i < alive.length; i++) {
      const m = alive[i];
      if (m.id === currentModel.id) continue;
      const otherPos = this.stagedSquadModelPositions.get(m.id) ?? m.position ?? active.position;
      const dist = Math.hypot(otherPos.x - destination.x, otherPos.z - destination.z);
      if (dist < 0.90) {
        this.showToast(`Cannot place model on top of Model ${i + 1} (bases would overlap)`);
        return;
      }
    }

    // Coherency checks against other placed models
    const otherPlaced: Array<{ id: string; pos: Vector3; name: string }> = [];
    for (let i = 0; i < alive.length; i++) {
      const m = alive[i];
      if (m.id !== currentModel.id && this.stagedSquadModelPositions.has(m.id)) {
        otherPlaced.push({ id: m.id, pos: this.stagedSquadModelPositions.get(m.id)!, name: `Model ${i + 1}` });
      }
    }

    if (otherPlaced.length > 0) {
      // 1. All models must remain within 6.0" max spread of all other placed models
      for (const placed of otherPlaced) {
        const d = Math.hypot(placed.pos.x - destination.x, placed.pos.z - destination.z);
        if (d > 6.0 + 0.02) {
          this.showToast(`Model spread of ${d.toFixed(1)}" exceeds max 6.0" coherency limit from ${placed.name}`);
          return;
        }
      }

      // 2. When placing the final model of the squad, full squad coherency must be satisfied
      const isPlacingLastModel = otherPlaced.length === alive.length - 1;
      if (isPlacingLastModel) {
        const candidatePositions = [...otherPlaced.map((p) => p.pos), destination];
        const coherency = validateSquadCoherency(candidatePositions, {
          maxMemberDistance: 2.0,
          maxSquadSpread: 6.0,
        });
        if (!coherency.coherent) {
          this.showToast(coherency.reason ?? 'Each model must be within 1.0" of at least one other squad member');
          return;
        }
      }
    }

    // Model placed successfully
    this.stagedSquadModelPositions.set(currentModel.id, destination);
    this.stagedSquadModelPaths.set(currentModel.id, path);

    if (this.stagedSquadModelPositions.size < alive.length) {
      // Auto-advance selection to the next unplaced model
      const nextUnplaced = alive.find((m) => !this.stagedSquadModelPositions.has(m.id));
      if (nextUnplaced) {
        this.selectedSquadModelId = nextUnplaced.id;
      }
      this.movePathPreview = null;
      this.movePreview = null;
      this.render();
      this.emitMarkers();
      return;
    }

    // All living models have been placed!
    const orderedPositions = alive.map((m) => this.stagedSquadModelPositions.get(m.id)!);
    const orderedPaths = alive.map((m) => this.stagedSquadModelPaths.get(m.id)!);
    const finalCentroid = computeSquadCentroid(orderedPositions);
    const isAnyModelDifficult = orderedPaths.some((p) =>
      isPathDifficult(this.state!, p, active)
    );
    let summary = `${actionKind === 'rush' || active.isRushing ? 'Rush' : 'Move'} ${active.name} (${alive.length} models) · ${
      actionKind === 'rush' || active.isRushing ? 'double move (ineligible to shoot)' : 'can shoot after moving'
    }`;
    if (isAnyModelDifficult) {
      summary += actionKind === 'rush'
        ? ' · [Difficult Terrain: capped at 6.0" (Rush speed bonus negated)]'
        : ' · [Difficult Terrain: 6.0" speed cap]';
    }

    const hasDangerous = orderedPaths.some((p) =>
      isPathDangerous(this.state!, p, active)
    );
    if (hasDangerous) {
      summary += ' · ⚠️ DANGEROUS TERRAIN: Hazard test (1s inflict wounds)!';
    }

    const maxDrop = Math.max(
      ...orderedPaths.map((p) => detectPathFall(p, this.state!).maxDrop)
    );
    if (maxDrop > 3.05 && !hasTrait(active.specialRules, 'airborne')) {
      summary += ` · ⚠️ HIGH DROP (${maxDrop.toFixed(1)}"): Falling damage (AP 1) · ends activation immediately!`;
    }

    this.selectedCasualtyModelId = alive.length > 0 ? alive[0].id : null;
    this.movePreview = finalCentroid;
    this.movePathPreview = null;

    this.beginConfirmation(
      createAction(this.localPlayerId, actionKind === 'rush' ? 'rush' : 'move-unit', {
        type: actionKind === 'rush' ? 'rush' : 'move-unit',
        unitId: active.id,
        path: [active.position, finalCentroid],
        finalPosition: finalCentroid,
        modelPositions: orderedPositions,
        modelPaths: orderedPaths,
        ...(this.selectedCasualtyModelId ? { casualtyModelIds: [this.selectedCasualtyModelId] } : {}),
      }),
      summary
    );
  }

  private prepareMove(rawDestination: Vector3): void {
    const active = this.activeUnit;
    if (!active || !this.state) return;

    const currentBudget = active.isRushing
      ? active.remainingMovement
      : Math.min(active.speed, active.remainingMovement ?? active.speed);
    let maxAllowance = currentBudget;
    let path = findNavPath(this.state, active, rawDestination, maxAllowance);
    const isDifficult = path.length > 0 && isPathDifficult(this.state, path, active);
    const effectiveCap = getEffectiveMaxMovement(active, active.isRushing ? 'rush' : 'move', isDifficult);
    const maxMove = Math.min(effectiveCap, currentBudget);
    if (isDifficult && maxAllowance > maxMove) {
      maxAllowance = maxMove;
      path = findNavPath(this.state, active, rawDestination, maxAllowance);
    }
    if (path.length < 2) {
      this.showToast('Pick a destination away from the unit');
      return;
    }
    const destination = path[path.length - 1];
    const distance = pathLength3D(path);
    if (distance < 0.05) {
      this.showToast('Pick a destination away from the unit');
      return;
    }

    const wouldEngage = this.enemyUnits.some(
      (e) =>
        !e.isDestroyed &&
        Math.hypot(e.position.x - destination.x, e.position.z - destination.z) <= 1.0 &&
        Math.abs((e.position.y ?? 0) - (destination.y ?? 0)) <= 1.5
    );
    if (wouldEngage) {
      this.showToast('Move cannot end in melee contact — use Charge instead');
      return;
    }

    const maxMoveStr = Number.isInteger(maxMove) ? `${maxMove}` : maxMove.toFixed(1);
    let summary = `Move ${active.name} ${distance.toFixed(1)}" (max ${maxMoveStr}") · ${
      active.isRushing ? 'rush move' : 'can shoot after moving'
    }`;
    if (isDifficult) {
      summary += ' · [Difficult Terrain: 6.0" speed cap]';
    }
    const fall = detectPathFall(path, this.state);
    if (fall.maxDrop > 3.05 && !hasTrait(active.specialRules, 'airborne')) {
      summary += ` · ⚠️ HIGH DROP (${fall.maxDrop.toFixed(1)}"): Falling damage (AP 1) · ends activation immediately!`;
    }
    if (isPathDangerous(this.state, path, active)) {
      summary += ' · ⚠️ DANGEROUS TERRAIN: Hazard test (1s inflict wounds)!';
    }
    const gapJump = detectPathGapJump(this.state, path, active);
    if (gapJump.isGapJump) {
      summary += ` · ⚠️ GAP JUMP (${gapJump.gapDistance.toFixed(1)}"): Quality Q${gapJump.targetQuality}+ check required or fall!`;
    }

    this.selectedCasualtyModelId =
      active.models && active.models.length > 1
        ? active.models.find((m) => !m.isDestroyed)?.id ?? null
        : null;

    this.movePreview = destination;
    this.movePathPreview = path;
    this.beginConfirmation(
      createAction(this.localPlayerId, 'move-unit', {
        type: 'move-unit',
        unitId: active.id,
        path,
        finalPosition: destination,
        ...(this.selectedCasualtyModelId ? { casualtyModelIds: [this.selectedCasualtyModelId] } : {}),
        ...(gapJump.isGapJump ? { gapJump: { gapDistance: gapJump.gapDistance } } : {}),
      }),
      summary
    );
  }

  private prepareRush(rawDestination: Vector3): void {
    const active = this.activeUnit;
    if (!active || !this.state) return;

    const currentRushBudget = active.isRushing ? active.remainingMovement : active.speed * 2;
    let maxAllowance = currentRushBudget;
    let path = findNavPath(this.state, active, rawDestination, maxAllowance, {
      stopBeforeDifficult: true,
    });

    const targetTerrain = findTerrainAtPosition(this.state, rawDestination);
    const isTargetDifficult =
      targetTerrain &&
      (targetTerrain.isDifficult ||
        targetTerrain.terrainType === 'mud' ||
        targetTerrain.terrainType === 'trench' ||
        targetTerrain.terrainType === 'forest');

    const isElevationObstacle =
      path.length > 0 && (rawDestination.y ?? 0) - (path[path.length - 1].y ?? 0) > 0.5;

    const stoppedAtBase =
      path.length > 0 &&
      !hasTrait(active.specialRules, 'airborne') &&
      (isElevationObstacle ||
        (Boolean(isTargetDifficult) && boardDistance(path[path.length - 1], rawDestination) > 0.1));

    const isDifficult =
      !stoppedAtBase &&
      path.length > 0 &&
      isPathDifficult(this.state, path, active);

    const effectiveCap = getEffectiveMaxMovement(active, 'rush', isDifficult);
    const maxRush = Math.min(effectiveCap, currentRushBudget);
    if (isDifficult && maxAllowance > maxRush) {
      maxAllowance = maxRush;
      path = findNavPath(this.state, active, rawDestination, maxAllowance, {
        stopBeforeDifficult: true,
      });
    }
    if (path.length < 2) {
      this.showToast('Pick a destination away from the unit');
      return;
    }
    const destination = path[path.length - 1];
    const distance = pathLength3D(path);
    if (distance < 0.05) {
      this.showToast('Pick a destination away from the unit');
      return;
    }

    const wouldEngage = this.enemyUnits.some(
      (e) =>
        !e.isDestroyed &&
        Math.hypot(e.position.x - destination.x, e.position.z - destination.z) <= 1.0 &&
        Math.abs((e.position.y ?? 0) - (destination.y ?? 0)) <= 1.5
    );
    if (wouldEngage) {
      this.showToast('Rush cannot end in melee contact — use Charge instead');
      return;
    }

    if (stoppedAtBase) {
      if (isElevationObstacle) {
        this.showToast('Rushed to wall base (sheer climb deferred to next turn)');
      } else {
        this.showToast('Rushed to obstacle edge (difficult terrain deferred to next turn)');
      }
    } else if (isDifficult) {
      this.showToast('Difficult Terrain / Climb: Rush capped at 6.0" (speed bonus negated)');
    }

    const maxRushStr = Number.isInteger(maxRush) ? `${maxRush}` : maxRush.toFixed(1);
    let summary = `Rush ${active.name} ${distance.toFixed(1)}" (max ${maxRushStr}") · double move (ineligible to shoot)`;
    if (stoppedAtBase) {
      if (isElevationObstacle) {
        summary += ' · [Stops at wall base; sheer climb deferred to next turn]';
      } else {
        summary += ' · [Stops at obstacle edge; difficult terrain deferred to next turn]';
      }
    } else if (isDifficult) {
      summary += ' · [Difficult Terrain: capped at 6.0" (Rush speed bonus negated)]';
    }
    const fall = detectPathFall(path, this.state);
    if (fall.maxDrop > 3.05 && !hasTrait(active.specialRules, 'airborne')) {
      summary += ` · ⚠️ HIGH DROP (${fall.maxDrop.toFixed(1)}"): Falling damage (AP 1) · ends activation immediately!`;
    }
    if (isPathDangerous(this.state, path, active)) {
      summary += ' · ⚠️ DANGEROUS TERRAIN: Hazard test (1s inflict wounds)!';
    }
    const gapJump = detectPathGapJump(this.state, path, active);
    if (gapJump.isGapJump) {
      summary += ` · ⚠️ GAP JUMP (${gapJump.gapDistance.toFixed(1)}"): Quality Q${gapJump.targetQuality}+ check required or fall!`;
    }

    this.selectedCasualtyModelId =
      active.models && active.models.length > 1
        ? active.models.find((m) => !m.isDestroyed)?.id ?? null
        : null;

    this.movePreview = destination;
    this.movePathPreview = path;
    this.movePreviewDifficult = isDifficult;
    this.beginConfirmation(
      createAction(this.localPlayerId, 'rush', {
        type: 'rush',
        unitId: active.id,
        path,
        finalPosition: destination,
        ...(this.selectedCasualtyModelId ? { casualtyModelIds: [this.selectedCasualtyModelId] } : {}),
        ...(gapJump.isGapJump ? { gapJump: { gapDistance: gapJump.gapDistance } } : {}),
      }),
      summary
    );
  }

  private prepareAttack(targetUnitId: string): void {
    let actionKind: string;
    if (this.flow.mode === 'targeting') {
      actionKind = this.flow.action;
    } else if (this.flow.mode === 'confirming' && this.flow.action.type === 'shoot') {
      actionKind = 'shoot';
    } else {
      return;
    }
    const active = this.activeUnit;
    if (!active) return;
    const target = this.state?.units.find((u) => u.id === targetUnitId);
    if (!target || target.ownerId === this.localPlayerId || target.isDestroyed) return;

    const distance = Math.hypot(
      target.position.x - active.position.x,
      target.position.z - active.position.z
    );

    if (actionKind === 'shoot') {
      const rangedWeapons = active.weapons.filter(
        (w) => w.isEquipped && w.profile.type === 'ranged'
      );
      if (rangedWeapons.length === 0) {
        this.showToast('No ranged weapon');
        return;
      }

      // Single ranged weapon: instant streamlined flow
      if (rangedWeapons.length === 1) {
        const weapon = rangedWeapons[0];
        if (distance > weapon.profile.range + 0.01) {
          this.showToast(`Out of range (${distance.toFixed(1)}" > ${weapon.profile.range}")`);
          return;
        }
        const isLobbed = hasTrait(weapon.profile.specialRules, 'lobbed');
        if (this.state && !isLobbed && !hasLineOfSight(this.state, active, target)) {
          this.showToast(`No line of sight to ${target.name}`);
          return;
        }
        this.shootAllocations.set(weapon.id, target.id);
        this.confirmShootTargets();
        return;
      }

      // Multi-weapon unit:
      const allUnassigned = [...this.shootAllocations.values()].every((v) => v === null);
      if (allUnassigned) {
        let assignedAny = false;
        let firstUnreachableWeaponId: string | null = null;
        for (const weapon of rangedWeapons) {
          const isLobbed = hasTrait(weapon.profile.specialRules, 'lobbed');
          const hasLos = isLobbed || (this.state && hasLineOfSight(this.state, active, target));
          if (distance <= weapon.profile.range + 0.01 && hasLos) {
            this.shootAllocations.set(weapon.id, target.id);
            assignedAny = true;
          } else {
            this.shootAllocations.set(weapon.id, null);
            if (!firstUnreachableWeaponId) firstUnreachableWeaponId = weapon.id;
          }
        }

        if (!assignedAny) {
          this.showToast(`Out of range or no line of sight to ${target.name}`);
          return;
        }

        this.selectedShootWeaponId = firstUnreachableWeaponId ?? rangedWeapons[0].id;
        this.confirmShootTargets();
        return;
      }

      // Reassigning or allocating selected weapon chip:
      const currentWeapon =
        (this.selectedShootWeaponId
          ? rangedWeapons.find((w) => w.id === this.selectedShootWeaponId)
          : null) ??
        rangedWeapons.find((w) => this.shootAllocations.get(w.id) === null) ??
        rangedWeapons[0];

      if (distance > currentWeapon.profile.range + 0.01) {
        this.showToast(
          `${currentWeapon.name} cannot reach ${target.name} (${distance.toFixed(1)}" > ${currentWeapon.profile.range}")`
        );
        return;
      }
      const isLobbed = hasTrait(currentWeapon.profile.specialRules, 'lobbed');
      if (this.state && !isLobbed && !hasLineOfSight(this.state, active, target)) {
        this.showToast(`No line of sight to ${target.name}`);
        return;
      }

      const otherTargets = new Set<string>();
      for (const [wid, tid] of this.shootAllocations.entries()) {
        if (wid !== currentWeapon.id && tid) otherTargets.add(tid);
      }
      otherTargets.add(target.id);
      if (otherTargets.size > 2) {
        this.showToast('Cannot split fire across more than 2 distinct targets');
        return;
      }

      this.shootAllocations.set(currentWeapon.id, target.id);

      const nextUnassigned = rangedWeapons.find(
        (w) => w.id !== currentWeapon.id && this.shootAllocations.get(w.id) === null
      );
      this.selectedShootWeaponId = nextUnassigned?.id ?? currentWeapon.id;

      this.confirmShootTargets();
      return;
    }

    if (actionKind === 'charge') {
      if (active.status.includes('engaged')) {
        this.showToast('Already engaged — fight instead');
        return;
      }
      const weapon = active.weapons.find((w) => w.isEquipped && w.profile.type === 'melee');
      if (!weapon) {
        this.showToast('No equipped melee weapon to charge with');
        return;
      }

      // Charge ends at true base contact (1.0" center-to-center for 0.5" radius bases).
      const dx = active.position.x - target.position.x;
      const dz = active.position.z - target.position.z;
      const len = Math.hypot(dx, dz) || 1;
      const contactTarget = {
        x: Math.round((target.position.x + (dx / len) * 1.0) * 100) / 100,
        y: active.position.y ?? 0,
        z: Math.round((target.position.z + (dz / len) * 1.0) * 100) / 100,
      };

      const path = findNavPath(this.state!, active, contactTarget, active.speed * 2, {
        ignoreUnitId: target.id,
      });
      const end = path[path.length - 1];
      const distToEnemy = Math.hypot(end.x - target.position.x, end.z - target.position.z);
      if (distToEnemy > 1.25) {
        this.showToast('Cannot reach engagement range of target');
        return;
      }
      if (!validateMeleeVerticalReach(end, target.position)) {
        this.showToast('Target is on a ledge outside vertical melee reach (> 4.0" vertical difference)');
        return;
      }
      const isDifficult = isPathDifficult(this.state!, path, active);
      const maxCharge = getEffectiveMaxMovement(active, 'charge', isDifficult);
      const chargeDistance = pathLength3D(path);
      if (chargeDistance > maxCharge + 0.01) {
        this.showToast(
          isDifficult
            ? `Charge in Difficult Terrain is capped at 6.0" (${chargeDistance.toFixed(1)}" exceeds 6.0")`
            : `Too far to charge: ${chargeDistance.toFixed(1)}" vs charge speed ${maxCharge.toFixed(1)}"`
        );
        return;
      }

      let traversalNotes = '';
      if (isDifficult) {
        traversalNotes += ' · [Difficult Terrain 6.0" cap]';
      }
      const fall = detectPathFall(path, this.state);
      if (fall.maxDrop > 3.05 && !hasTrait(active.specialRules, 'airborne')) {
        traversalNotes += ` · ⚠️ HIGH DROP (${fall.maxDrop.toFixed(1)}"): Falling damage (AP 1)`;
      }
      if (isPathDangerous(this.state!, path, active)) {
        traversalNotes += ' · ⚠️ DANGEROUS TERRAIN: Hazard test (1s wound)';
      }
      const gapJump = detectPathGapJump(this.state!, path, active);
      if (gapJump.isGapJump) {
        traversalNotes += ` · ⚠️ GAP JUMP (${gapJump.gapDistance.toFixed(1)}"): Quality Q${gapJump.targetQuality}+ check required`;
      }

      const isFatigued = active.status.includes('fatigued') || active.status.includes('shaken');
      const mods = computeCombatModifiers(
        {
          quality: active.quality,
          specialRules: active.specialRules,
          weaponRules: weapon.profile.specialRules,
          isMelee: true,
          isCharging: true,
          hasMoved: true,
          isFatigued,
          distance: distToEnemy,
        },
        {
          defense: target.defense,
          inCover: false,
          specialRules: target.specialRules,
          hasMoved: target.hasMoved,
        }
      );
      const hitModText = mods.hitModifiers.length ? ` · Q${mods.baseQuality} ${mods.hitModifiers.join(' ')}` : '';
      const defModText = mods.defenseModifiers.length ? ` · D${mods.baseDefense} ${mods.defenseModifiers.join(' ')}` : '';
      const livingCount = Math.max(1, active.models?.filter((m) => !m.isDestroyed).length ?? 1);
      const attacks = (weapon.profile.attacks as number) * livingCount;
      const diceText = `${attacks}d6 (Hit Q${mods.effectiveQuality}+${hitModText}, Def D${mods.effectiveDefense}+${defModText})`;

      this.movePreview = end;
      this.movePathPreview = path;
      this.hoveredEngagedTargetId = target.id;

      this.beginConfirmation(
        createAction(this.localPlayerId, 'charge', {
          type: 'charge',
          attackerId: active.id,
          targetId: target.id,
          path,
          weaponId: weapon.id,
          ...(gapJump.isGapJump ? { gapJump: { gapDistance: gapJump.gapDistance } } : {}),
        }),
        `${active.name} charges ${target.name} (${chargeDistance.toFixed(1)}" into base contact) & strikes with ${weapon.name} · ${diceText} (defender retaliates if surviving; 1" separation)`
      );
      return;
    }

    if (actionKind === 'fight') {
      if (!active.status.includes('engaged')) {
        this.showToast('Not engaged');
        return;
      }
      const weapon = active.weapons.find((w) => w.isEquipped && w.profile.type === 'melee');
      if (!weapon) {
        this.showToast('No melee weapon');
        return;
      }
      if (distance > 1.51) {
        this.showToast('Target not in engagement range');
        return;
      }
      const isFatigued = active.status.includes('fatigued') || active.status.includes('shaken');
      const mods = computeCombatModifiers(
        {
          quality: active.quality,
          specialRules: active.specialRules,
          weaponRules: weapon.profile.specialRules,
          isMelee: true,
          isCharging: active.hasMoved,
          hasMoved: active.hasMoved,
          isFatigued,
          distance,
        },
        {
          defense: target.defense,
          inCover: false,
          specialRules: target.specialRules,
          hasMoved: target.hasMoved,
        }
      );
      const hitModText = mods.hitModifiers.length ? ` · Q${mods.baseQuality} ${mods.hitModifiers.join(' ')}` : '';
      const defModText = mods.defenseModifiers.length ? ` · D${mods.baseDefense} ${mods.defenseModifiers.join(' ')}` : '';
      const livingCount = Math.max(1, active.models?.filter((m) => !m.isDestroyed).length ?? 1);
      const attacks = (weapon.profile.attacks as number) * livingCount;
      const diceText = `${attacks}d6 (Hit Q${mods.effectiveQuality}+${hitModText}, Def D${mods.effectiveDefense}+${defModText})`;
      this.beginConfirmation(
        createAction(this.localPlayerId, 'fight', {
          type: 'fight',
          attackerId: active.id,
          targetId: target.id,
          weaponId: weapon.id,
        }),
        `${active.name} strikes ${target.name} with ${weapon.name} · ${diceText}`
      );
    }
  }

  private confirmShootTargets(): void {
    const isShootFlow =
      (this.flow.mode === 'targeting' && this.flow.action === 'shoot') ||
      (this.flow.mode === 'confirming' && this.flow.action.type === 'shoot');
    if (!isShootFlow) return;
    const active = this.activeUnit;
    if (!active || !this.state) return;

    const allocations: Array<{ weapon: Weapon; target: Unit; mods: CombatModifierBreakdown; diceText: string }> = [];
    const rangedWeapons = active.weapons.filter((w) => w.isEquipped && w.profile.type === 'ranged');

    for (const weapon of rangedWeapons) {
      const targetId = this.shootAllocations.get(weapon.id);
      if (!targetId) continue;
      const target = this.state.units.find((u) => u.id === targetId && !u.isDestroyed);
      if (!target) continue;

      const distance = boardDistance(active.position, target.position);
      if (distance > weapon.profile.range + 0.01) {
        this.showToast(
          `${weapon.name} cannot reach ${target.name} (${distance.toFixed(1)}" > ${weapon.profile.range}")`
        );
        return;
      }
      const isLobbed = hasTrait(weapon.profile.specialRules, 'lobbed');
      if (!isLobbed && !hasLineOfSight(this.state, active, target)) {
        this.showToast(`No line of sight from ${weapon.name} to ${target.name}`);
        return;
      }

      const inCover =
        !hasTrait(weapon.profile.specialRules, 'blast') &&
        (target.status.includes('in-cover') ||
          (!isLobbed && hasCoverAgainstAttack(this.state, active, target)));
      const livingCount = Math.max(1, active.models?.filter((m) => !m.isDestroyed).length ?? 1);
      const attacks = (weapon.profile.attacks as number) * livingCount;
      const mods = computeCombatModifiers(
        {
          quality: active.quality,
          specialRules: active.specialRules,
          weaponRules: weapon.profile.specialRules,
          isMelee: false,
          distance,
          hasMoved: active.hasMoved,
        },
        {
          defense: target.defense,
          inCover: !!inCover,
          specialRules: target.specialRules,
          hasMoved: target.hasMoved,
        }
      );
      const hitModText = mods.hitModifiers.length ? ` · Q${mods.baseQuality} ${mods.hitModifiers.join(' ')}` : '';
      const defModText = mods.defenseModifiers.length ? ` · D${mods.baseDefense} ${mods.defenseModifiers.join(' ')}` : '';
      const diceText = `${attacks}d6 (Hit Q${mods.effectiveQuality}+${hitModText}, Def D${mods.effectiveDefense}+${defModText})`;
      allocations.push({ weapon, target, mods, diceText });
    }

    if (allocations.length === 0) {
      this.showToast('Please assign at least one target for your weapons');
      return;
    }

    const uniqueTargets = new Set(allocations.map((a) => a.target.id));
    if (uniqueTargets.size > 2) {
      this.showToast('Cannot split fire across more than 2 distinct targets');
      return;
    }

    let summary: string;
    if (uniqueTargets.size === 1) {
      const target = allocations[0].target;
      const distance = boardDistance(active.position, target.position);
      const weaponNames = allocations.map((a) => a.weapon.name).join(' & ');
      const diceSummaries = allocations.map((a) => `${a.weapon.name}: ${a.diceText}`).join(' | ');
      summary = `${active.name} fires ${weaponNames} at ${target.name} (${distance.toFixed(1)}") · ${diceSummaries}`;
    } else {
      const splitSummaries = allocations
        .map(
          (a) =>
            `${a.weapon.name} at ${a.target.name} (${boardDistance(active.position, a.target.position).toFixed(1)}") [${a.diceText}]`
        )
        .join(' · ');
      summary = `${active.name} split fires: ${splitSummaries}`;
    }

    this.beginConfirmation(
      createAction(this.localPlayerId, 'shoot', {
        type: 'shoot',
        attackerId: active.id,
        targetId: allocations[0].target.id,
        weaponId: allocations[0].weapon.id,
        allocations: allocations.map((a) => ({
          weaponId: a.weapon.id,
          targetId: a.target.id,
        })),
      }),
      summary
    );
  }

  private beginConfirmation(action: GameAction, summary: string): void {
    this.flow = { mode: 'confirming', action, summary };
    this.render();
  }

  private confirmPending(): void {
    if (this.flow.mode !== 'confirming') return;
    const action = this.flow.action;
    this.movePreview = null;
    this.movePathPreview = null;
    this.movePreviewDifficult = false;
    this.hoveredEngagedTargetId = null;
    this.shootAllocations.clear();
    this.selectedShootWeaponId = null;
    this.flow = { mode: 'waiting' };
    this.render();
    // Only confirmed actions ever leave the HUD — no optimistic dispatch.
    this.controller.submitAction(action);
  }

  private cancel(): void {
    if (this.flow.mode === 'waiting') return; // already sent, nothing to cancel
    this.movePreview = null;
    this.movePathPreview = null;
    this.movePreviewDifficult = false;
    this.hoveredEngagedTargetId = null;
    this.shootAllocations.clear();
    this.selectedShootWeaponId = null;
    this.stagedSquadModelPositions.clear();
    this.stagedSquadModelPaths.clear();
    this.selectedSquadModelId = null;
    this.selectedUnitId = this.state?.turnState.activeUnitId ?? null;
    this.flow = { mode: 'idle' };
    this.render();
  }

  private showToast(message: string): void {
    this.toast = message;
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      this.toast = null;
      this.render();
    }, 2600);
    this.render();
  }

  // --- rendering ----------------------------------------------------------

  private render(): void {
    if (!this.state || !this.visible) {
      this.emitMarkers();
      return;
    }
    this.root.innerHTML = this.renderHTML();
    this.bindEvents();
    this.emitMarkers();
  }

  private renderHTML(): string {
    const state = this.state!;
    const myPlayer = state.players.find((p) => p.id === this.localPlayerId);
    const myName = myPlayer?.name ?? 'You';
    const opponent = state.players.find((p) => p.id !== this.localPlayerId);
    const opponentName = opponent?.name ?? 'Opponent';

    const isHost = myPlayer?.role === 'host';
    const myTeamClass = isHost ? 'team-blue' : 'team-red';
    const enemyTeamClass = isHost ? 'team-red' : 'team-blue';
    const myTeamHex = isHost ? '#29b6f6' : '#ef5350';
    const enemyTeamHex = isHost ? '#ef5350' : '#29b6f6';

    const myUnactivated = this.myUnits.filter((u) => !u.isDestroyed && !u.isActivated).length;
    const enemyUnactivated = this.enemyUnits.filter((u) => !u.isDestroyed && !u.isActivated).length;

    const objectives = state.objectives ?? [];
    const hostScore = objectives.filter((o) => o.controllingPlayerId === state.hostId).length;
    const guestScore = objectives.filter((o) => o.controllingPlayerId === state.guestId).length;

    const alerts: string[] = [];
    if (this.peerState === 'disconnected') {
      alerts.push('<div class="sl-hud-alert sl-hud-alert-error">⚠️ Opponent disconnected — waiting for peer to reconnect... (Grace period: 5m)</div>');
    } else if (this.signalingState === 'reconnecting') {
      alerts.push('<div class="sl-hud-alert sl-hud-alert-warn">⚠️ Signaling disconnected — reconnecting to room...</div>');
    } else if (this.signalingState === 'disconnected') {
      alerts.push('<div class="sl-hud-alert sl-hud-alert-warn">⚠️ Signaling offline</div>');
    }
    const alertsHtml = alerts.length ? `<div class="sl-hud-alerts">${alerts.join('')}</div>` : '';

    const isDeployPhase = state.turnState.phase === 'deployment';
    const roundBadge = isDeployPhase
      ? `<span class="sl-hud-round" style="background: #ffd54f; color: #12161c; font-weight: 700; padding: 2px 8px; border-radius: 4px;">Deployment</span>`
      : `<span class="sl-hud-round">Round ${state.turnState.roundNumber} / 4</span>`;

    const turnLabel =
      state.status === 'game-over'
        ? this.gameOverText(opponentName)
        : isDeployPhase
        ? this.myTurn
          ? 'Your turn to deploy'
          : `${opponentName}'s turn to deploy`
        : this.myTurn
        ? 'Your turn'
        : `${opponentName}'s turn`;

    const header = `
      <div class="sl-hud-header">
        <span class="sl-hud-title">SkirmishLab</span>
        ${roundBadge}
        <span class="sl-hud-objectives-score">
          Objectives: <span class="score-team-host" style="color: #29b6f6; font-weight: 700;">Host ${hostScore}</span> — <span class="score-team-guest" style="color: #ef5350; font-weight: 700;">Guest ${guestScore}</span>
        </span>
        <span class="sl-hud-turn ${this.myTurn ? 'mine' : 'theirs'}">${turnLabel}</span>
        ${this.roomCode ? `<span class="sl-hud-room">Room: ${this.roomCode}</span>` : ''}
      </div>`;

    const units = `
      <div class="sl-hud-panel sl-hud-units">
        <h3 style="color: ${myTeamHex};">${myName} — Fighters (${myUnactivated} ready)</h3>
        ${this.myUnits.map((unit) => this.renderUnitRow(unit, myTeamClass)).join('')}
        <h3 style="margin-top: 10px; color: ${enemyTeamHex};">${opponentName} — Enemy (${enemyUnactivated} ready)</h3>
        ${this.enemyUnits.map((unit) => this.renderEnemyRow(unit, enemyTeamClass)).join('')}
      </div>`;

    const right = `
      <div class="sl-hud-panel sl-hud-side">
        <h3>Dice</h3>
        ${this.renderDice()}
        <h3>Log</h3>
        <div class="sl-hud-log">${this.renderLog()}</div>
      </div>`;

    const gameOverModal =
      state.status === 'game-over'
        ? `
      <div class="sl-hud-gameover">
        <h2>${this.gameOverText(opponentName)}</h2>
        <p class="sl-hud-gameover-reason">${state.endReason ?? 'Game ended'}</p>
        <div class="sl-hud-gameover-score" style="margin: 14px 0 16px; font-size: 13px;">
          <div style="font-weight: 600; margin-bottom: 6px; color: #ffd54f;">Final Objective Score</div>
          <div style="display: flex; justify-content: center; gap: 16px; font-size: 15px; font-weight: 700;">
            <span style="color: #29b6f6;">Host: ${hostScore}</span>
            <span style="color: #888;">—</span>
            <span style="color: #ef5350;">Guest: ${guestScore}</span>
          </div>
          ${
            objectives.length > 0
              ? `<div class="sl-hud-gameover-breakdown" style="margin-top: 10px; font-size: 12px; color: #b0bec5; display: flex; flex-direction: column; gap: 3px;">
                  ${objectives
                    .map((o) => {
                      const ctrlText = o.isContested
                        ? '<span style="color: #ff9800; font-weight: 600;">Contested</span>'
                        : o.controllingPlayerId === state.hostId
                        ? '<span style="color: #29b6f6; font-weight: 600;">Host</span>'
                        : o.controllingPlayerId === state.guestId
                        ? '<span style="color: #ef5350; font-weight: 600;">Guest</span>'
                        : '<span style="color: #ffd54f;">Neutral</span>';
                      return `<div>${o.name}: ${ctrlText}</div>`;
                    })
                    .join('')}
                </div>`
              : ''
          }
        </div>
        <button class="sl-hud-btn primary" data-action="return-lobby">Return to Lobby</button>
      </div>`
        : '';

    return `${alertsHtml}${header}${units}${right}${this.renderBottomBar()}${gameOverModal}${
      this.toast ? `<div class="sl-hud-toast">${this.toast}</div>` : ''
    }`;
  }

  private gameOverText(opponentName: string): string {
    const state = this.state!;
    if (state.winner === this.localPlayerId) return 'Victory';
    if (state.winner) return 'Defeat';
    return `Game over — ${state.endReason ?? 'draw'} vs ${opponentName}`;
  }

  private renderUnitRow(unit: Unit, teamClass: string = 'team-blue'): string {
    const statusTags: string[] = [];
    if (unit.status.includes('shaken')) statusTags.push('SHAKEN');
    else if (unit.status.includes('stunned')) statusTags.push('STUNNED');
    if (unit.status.includes('fatigued')) statusTags.push('FATIGUED');
    if (unit.status.includes('routed')) statusTags.push('ROUTED');
    if (unit.status.includes('engaged')) statusTags.push('ENGAGED');
    if (unit.status.includes('in-cover')) statusTags.push('COVER');
    const tough = getUnitTough(unit);
    if (unit.traumaTokens && unit.traumaTokens > 0) {
      if (tough > 1 && unit.traumaTokens < tough) {
        statusTags.push(`${unit.traumaTokens}/${tough} WT`);
      } else {
        statusTags.push(`+${unit.traumaTokens} WT`);
      }
    }
    if (unit.isActivated) statusTags.push('ACTIVATED');

    const isDeployPhase = this.state?.turnState.phase === 'deployment';
    if (unit.isDeployed === false) {
      if (hasTrait(unit.specialRules, 'drop-reserve')) {
        statusTags.push('DROP RESERVE (RD 2+)');
      } else if (hasTrait(unit.specialRules, 'vanguard')) {
        statusTags.push('VANGUARD');
      } else {
        statusTags.push('UNDEPLOYED');
      }
    }

    const deployableList =
      isDeployPhase && this.state ? getDeployableUnits(this.state, this.localPlayerId) : [];
    const isDeployable = isDeployPhase && deployableList.some((u) => u.id === unit.id);
    const isDeploySelected =
      isDeployPhase &&
      (this.selectedDeployUnitId === unit.id ||
        (!this.selectedDeployUnitId && deployableList[0]?.id === unit.id));

    const canActivate = this.canActivateUnit(unit);
    const isActive = this.activeUnit?.id === unit.id;
    const weaponSummary = unit.weapons
      .filter((w) => w.isEquipped)
      .map((w) => {
        const traits = w.profile.specialRules
          .map((r) => `<span class="sl-trait-badge" title="${escapeHtmlAttr(describeTrait(r))}">${formatTraitLabel(r)}</span>`)
          .join(', ');
        const suffix = traits ? `, ${traits}` : '';
        return w.profile.type === 'ranged'
          ? `${w.name} (${w.profile.range}", A${w.profile.attacks}${suffix})`
          : `${w.name} (A${w.profile.attacks}${suffix})`;
      })
      .join(', ');

    const classes = [
      'sl-hud-unit',
      teamClass,
      unit.isDestroyed ? 'destroyed' : '',
      canActivate ? 'activatable' : '',
      isActive ? 'active' : '',
      isDeployable ? 'deployable' : '',
      isDeploySelected ? 'deploy-selected' : '',
    ]
      .filter(Boolean)
      .join(' ');

    const totalModels = unit.models ? unit.models.length : 1;
    const aliveModels = unit.models ? unit.models.filter((m) => !m.isDestroyed).length : 1;
    const casualties = totalModels - aliveModels;
    const modelText = totalModels > 1
      ? ` · Models: ${aliveModels}/${totalModels}${casualties > 0 ? ` (${casualties} casualty${casualties > 1 ? 'ies' : ''})` : ''}`
      : '';

    return `
      <div class="${classes}" data-unit-id="${unit.id}">
        <span class="sl-hud-unit-name">${unit.name}${isActive ? ' ●' : ''}</span>
        <span class="sl-hud-unit-stats">Q${unit.quality}+ D${unit.defense}+ · Tough(${tough})${modelText}</span>
        ${weaponSummary ? `<span class="sl-hud-unit-weapons">${weaponSummary}</span>` : ''}
        ${statusTags.length ? `<span class="sl-hud-unit-tags">${statusTags.join(' ')}</span>` : ''}
      </div>`;
  }

  private renderEnemyRow(unit: Unit, teamClass: string = 'team-red'): string {
    const statusTags: string[] = [];
    if (unit.status.includes('shaken')) statusTags.push('SHAKEN');
    else if (unit.status.includes('stunned')) statusTags.push('STUNNED');
    if (unit.status.includes('fatigued')) statusTags.push('FATIGUED');
    if (unit.status.includes('engaged')) statusTags.push('ENGAGED');
    if (unit.status.includes('in-cover')) statusTags.push('COVER');
    const enemyTough = getUnitTough(unit);
    if (unit.traumaTokens && unit.traumaTokens > 0) {
      if (enemyTough > 1 && unit.traumaTokens < enemyTough) {
        statusTags.push(`${unit.traumaTokens}/${enemyTough} WT`);
      } else {
        statusTags.push(`+${unit.traumaTokens} WT`);
      }
    }
    if (unit.isActivated) statusTags.push('ACTIVATED');

    if (unit.isDeployed === false) {
      if (hasTrait(unit.specialRules, 'drop-reserve')) {
        statusTags.push('DROP RESERVE');
      } else if (hasTrait(unit.specialRules, 'vanguard')) {
        statusTags.push('VANGUARD');
      } else {
        statusTags.push('UNDEPLOYED');
      }
    }

    const enemyTotal = unit.models ? unit.models.length : 1;
    const enemyAlive = unit.models ? unit.models.filter((m) => !m.isDestroyed).length : 1;
    const enemyCasualties = enemyTotal - enemyAlive;
    const enemyModelText = enemyTotal > 1
      ? ` · Models: ${enemyAlive}/${enemyTotal}${enemyCasualties > 0 ? ` (${enemyCasualties} casualty${enemyCasualties > 1 ? 'ies' : ''})` : ''}`
      : '';

    const classes = ['sl-hud-unit', 'enemy', teamClass, unit.isDestroyed ? 'destroyed' : '']
      .filter(Boolean)
      .join(' ');

    return `
      <div class="${classes}" data-unit-id="${unit.id}">
        <span class="sl-hud-unit-name">${unit.name}</span>
        <span class="sl-hud-unit-stats">Q${unit.quality}+ D${unit.defense}+ · Tough(${enemyTough})${enemyModelText}</span>
        ${statusTags.length ? `<span class="sl-hud-unit-tags">${statusTags.join(' ')}</span>` : ''}
      </div>`;
  }

  private renderDice(): string {
    const state = this.state!;
    for (let i = state.actionLog.length - 1; i >= 0; i--) {
      const entry = state.actionLog[i];
      if (!entry.dice) continue;

      const attacker = state.units.find((u) => u.id === entry.dice!.context.attackerId);
      const target = state.units.find((u) => u.id === entry.dice!.context.targetId);
      const toHit = entry.dice.results.find((r) => r.purpose === 'to-hit');
      const defense = entry.dice.results.find((r) => r.purpose === 'defense');
      const { outcome } = entry.dice;

      const effectiveQ = outcome.effectiveQuality ?? attacker?.quality ?? 4;
      const targetD = outcome.effectiveDefense ?? target?.defense ?? 5;

      const weapon = attacker?.weapons.find((w) => w.id === entry.dice?.context.weaponId);
      const allAttackerRules = [
        ...(attacker?.specialRules ?? []),
        ...(weapon?.profile.specialRules ?? []),
      ];
      const hasRupture = hasTrait(allAttackerRules, 'rupture');
      const hasShred = hasTrait(allAttackerRules, 'shred');

      if (entry.action.type === 'respond-reaction') {
        const payload = entry.action.payload as { choiceId: string };
        if (payload.choiceId === 'decline') {
          return `
            <div class="sl-hud-dice">
              <div class="sl-hud-dice-title">Retaliation Declined: ${attacker?.name ?? 'Defender'} held ground</div>
              <div class="sl-hud-dice-summary">0 attacks · No fatigue applied</div>
              <div class="sl-hud-pushback-notice" style="margin-top: 6px; font-size: 11px; color: #4ade80; font-style: italic;">Charger pushed back 1" — Defender declined retaliation (no Fatigue)</div>
            </div>`;
        }
      }

      if (outcome.allocations && outcome.allocations.length > 1) {
        const allocsHtml = outcome.allocations
          .map((alloc, idx) => {
            const allocToHit = entry.dice!.results.find((r) => r.purpose === `alloc_${idx}_to-hit`) ?? toHit;
            const allocDef = entry.dice!.results.find((r) => r.purpose === `alloc_${idx}_defense`) ?? defense;
            const aHitDice = allocToHit
              ? allocToHit.rolls
                  .map((r) => {
                    const isHit = r > 1 && (r >= 6 || r >= (alloc.effectiveQuality ?? 4));
                    return `<span class="sl-die ${isHit ? 'hit-pass' : 'hit-miss'}">${r}</span>`;
                  })
                  .join('')
              : '';
            const usedDef = allocDef ? allocDef.rolls.slice(0, alloc.hitCount) : [];
            const aDefDice =
              usedDef.length > 0
                ? usedDef
                    .map((r, di) => {
                      const isBlocked = alloc.blockedRolls
                        ? (alloc.blockedRolls[di] ?? false)
                        : r > 1 && r >= (alloc.effectiveDefense ?? 5);
                      return `<span class="sl-die ${isBlocked ? 'def-pass' : 'def-fail'}">${r}</span>`;
                    })
                    .join('')
                : '<span class="sl-hud-dice-empty">no hits</span>';

            const allocTraumaHtml =
              alloc.traumaRoll !== undefined
                ? `<div class="sl-hud-dice-label" style="font-size:10px;">Wound Effect (roll ${alloc.traumaRoll} + ${alloc.traumaTokens ?? 0} WT = ${alloc.traumaTotal}):</div>
                   <div class="sl-hud-dice-row">
                     <span class="sl-die ${alloc.traumaOutcome === 'knocked-out' ? 'def-fail' : 'hit-pass'}">${alloc.traumaRoll}</span>
                     <span class="sl-hud-dice-summary">${alloc.traumaOutcome === 'knocked-out' ? 'KNOCKED OUT' : 'SHAKEN'}</span>
                   </div>`
                : '';

            return `
              <div class="sl-hud-alloc-block" style="margin-top: 6px; padding-top: 6px; border-top: 1px dashed rgba(255,255,255,0.15);">
                <div class="sl-hud-dice-label" style="color: #93c5fd; font-weight: bold; font-size: 11px;">
                  ${alloc.weaponName ?? alloc.weaponId} → ${alloc.targetName ?? alloc.targetId}
                </div>
                <div class="sl-hud-dice-row">
                  <span class="sl-hud-dice-sublabel" style="font-size:10px; margin-right:4px;">Hit (Q${alloc.effectiveQuality ?? 4}+):</span> ${aHitDice}
                  <span class="sl-hud-dice-sublabel" style="font-size:10px; margin: 0 4px 0 8px;">Def (D${alloc.effectiveDefense ?? 5}+):</span> ${aDefDice}
                </div>
                ${allocTraumaHtml}
                <div class="sl-hud-dice-summary" style="font-size: 10px; margin-top: 2px;">
                  ${alloc.hitCount} hit${alloc.hitCount === 1 ? '' : 's'} · ${alloc.blockedCount} blocked ·
                  <strong>${alloc.wounds} wound${alloc.wounds === 1 ? '' : 's'}</strong>
                  ${alloc.targetDestroyed ? ' · target down' : alloc.targetShaken ? ' · shaken' : ''}
                </div>
              </div>`;
          })
          .join('');

        return `
          <div class="sl-hud-dice">
            <div class="sl-hud-dice-title">${attacker?.name ?? 'Attacker'} Salvo (${outcome.allocations.length} weapons)</div>
            ${allocsHtml}
            <div class="sl-hud-dice-summary" style="margin-top: 6px; font-weight: bold; border-top: 1px solid rgba(255,255,255,0.25); padding-top: 4px;">
              Total: ${outcome.hitCount} hits · ${outcome.blockedCount} blocked · ${outcome.wounds} unsaved wounds
            </div>
          </div>`;
      }

      const hitDiceHtml = toHit
        ? toHit.rolls
            .map((r) => {
              const isHit = r > 1 && (r >= 6 || r >= effectiveQ);
              const traitNote = r >= 6 && hasRupture ? ' · Rupture (+2 AP)' : r >= 6 && hasShred ? ' · Shred (AP 4)' : '';
              const title = isHit ? `Hit (${r} >= ${effectiveQ})${traitNote}` : `Miss (${r} < ${effectiveQ})`;
              return `<span class="sl-die ${isHit ? 'hit-pass' : 'hit-miss'}" title="${title}">${r}${
                r >= 6 && hasRupture ? '<span class="sl-die-sub" style="font-size:9px;display:block;line-height:1">RUP</span>' : ''
              }</span>`;
            })
            .join('')
        : '';

      // Defense dice only pair with actual hits (first `outcome.hitCount` rolls).
      const usedDefRolls = defense ? defense.rolls.slice(0, outcome.hitCount) : [];
      const defDiceHtml =
        usedDefRolls.length > 0
          ? usedDefRolls
              .map((r, i) => {
                const isBlocked = outcome.blockedRolls
                  ? (outcome.blockedRolls[i] ?? false)
                  : (r > 1 && (r >= 6 || r >= targetD));
                return `<span class="sl-die ${isBlocked ? 'def-pass' : 'def-fail'}" title="${
                  isBlocked ? `Blocked (${r})` : `Failed (${r}) → Wound`
                }">${r}</span>`;
              })
              .join('')
          : '<span class="sl-hud-dice-empty">no hits to defend</span>';

      const toHitMods = outcome.hitModifiers && outcome.hitModifiers.length
        ? ` · Base Q${outcome.baseQuality ?? attacker?.quality ?? 4} ${outcome.hitModifiers.join(' ')}`
        : '';
      const ruptureNote = hasRupture ? ' · Rupture (+2 AP on 6)' : '';
      const defMods = (outcome.defenseModifiers && outcome.defenseModifiers.length
        ? ` · Base D${outcome.baseDefense ?? target?.defense ?? 5} ${outcome.defenseModifiers.join(' ')}`
        : outcome.coverApplied ? ' w/ cover' : '') + ruptureNote;

      const targetTough = target ? getUnitTough(target) : 1;
      const koThreshold = 5 + targetTough;
      const traumaTokensCount = outcome.traumaTokens ?? 0;
      const traumaDreadText = outcome.traumaDreadBonus ? ` + ${outcome.traumaDreadBonus} dread` : '';
      const traumaHtml =
        outcome.traumaRoll !== undefined
          ? `<div class="sl-hud-dice-label">Wound Effect (roll ${outcome.traumaRoll} + ${traumaTokensCount} wound tokens${traumaDreadText} = ${outcome.traumaTotal} — need ${koThreshold}+ to KO):</div>
             <div class="sl-hud-dice-row">
               <span class="sl-die ${outcome.traumaOutcome === 'knocked-out' ? 'def-fail' : 'hit-pass'}">${outcome.traumaRoll}</span>
               <span class="sl-hud-dice-summary">${
                 outcome.traumaOutcome === 'knocked-out' ? 'KNOCKED OUT' : 'SHAKEN'
               }</span>
             </div>`
          : '';

      const totalWoundsText = traumaTokensCount > 0 ? ` · ${traumaTokensCount} wound tokens total` : '';
      const outcomeStatus = outcome.targetDestroyed ? ' · target down' : outcome.targetShaken ? ' · shaken' : '';
      const summaryWounds = outcome.wounds > 0
        ? `<strong>${outcome.wounds} unsaved wound${outcome.wounds === 1 ? '' : 's'}${totalWoundsText}</strong>${outcomeStatus}`
        : '<strong>0 wounds</strong>';

      let retaliationHtml = '';
      if (outcome.retaliation) {
        const ret = outcome.retaliation;
        const retToHit = entry.dice.results.find((r) => r.purpose === 'retaliation-to-hit');
        const retDefense = entry.dice.results.find((r) => r.purpose === 'retaliation-defense');
        const retEffectiveQ = ret.effectiveQuality ?? target?.quality ?? 4;
        const retChargerD = ret.effectiveDefense ?? attacker?.defense ?? 5;

        const retWeapon = target?.weapons.find((w) => w.id === entry.dice?.context.retaliationWeaponId);
        const retAttackerRules = [
          ...(target?.specialRules ?? []),
          ...(retWeapon?.profile.specialRules ?? []),
        ];
        const retHasRupture = hasTrait(retAttackerRules, 'rupture');
        const retHasShred = hasTrait(retAttackerRules, 'shred');

        const retHitDiceHtml = retToHit
          ? retToHit.rolls
              .map((r) => {
                const isHit = r > 1 && (r >= 6 || r >= retEffectiveQ);
                const traitNote = r >= 6 && retHasRupture ? ' · Rupture (+2 AP)' : r >= 6 && retHasShred ? ' · Shred (AP 4)' : '';
                const title = isHit ? `Hit (${r} >= ${retEffectiveQ})${traitNote}` : `Miss (${r} < ${retEffectiveQ})`;
                return `<span class="sl-die ${isHit ? 'hit-pass' : 'hit-miss'}" title="${title}">${r}${
                  r >= 6 && retHasRupture ? '<span class="sl-die-sub" style="font-size:9px;display:block;line-height:1">RUP</span>' : ''
                }</span>`;
              })
              .join('')
          : '';

        const retUsedDefRolls = retDefense ? retDefense.rolls.slice(0, ret.hitCount) : [];
        const retDefDiceHtml =
          retUsedDefRolls.length > 0
            ? retUsedDefRolls
                .map((r, i) => {
                  const isBlocked = ret.blockedRolls
                    ? (ret.blockedRolls[i] ?? false)
                    : (r > 1 && (r >= 6 || r >= retChargerD));
                  return `<span class="sl-die ${isBlocked ? 'def-pass' : 'def-fail'}" title="${
                    isBlocked ? `Blocked (${r})` : `Failed (${r}) → Wound`
                  }">${r}</span>`;
                })
                .join('')
            : '<span class="sl-hud-dice-empty">no hits to defend</span>';

        const retToHitMods = ret.hitModifiers && ret.hitModifiers.length
          ? ` · Base Q${ret.baseQuality ?? target?.quality ?? 4} ${ret.hitModifiers.join(' ')}`
          : '';
        const retRuptureNote = retHasRupture ? ' · Rupture (+2 AP on 6)' : '';
        const retDefMods = (ret.defenseModifiers && ret.defenseModifiers.length
          ? ` · Base D${ret.baseDefense ?? attacker?.defense ?? 5} ${ret.defenseModifiers.join(' ')}`
          : '') + retRuptureNote;

        const chargerTough = attacker ? getUnitTough(attacker) : 1;
        const retKoThreshold = 5 + chargerTough;
        const retTraumaTokens = ret.traumaTokens ?? 0;
        const retTraumaDreadText = ret.traumaDreadBonus ? ` + ${ret.traumaDreadBonus} dread` : '';
        const retTraumaHtml =
          ret.traumaRoll !== undefined
            ? `<div class="sl-hud-dice-label">Wound Effect (roll ${ret.traumaRoll} + ${retTraumaTokens} wound tokens${retTraumaDreadText} = ${ret.traumaTotal} — need ${retKoThreshold}+ to KO):</div>
               <div class="sl-hud-dice-row">
                 <span class="sl-die ${ret.traumaOutcome === 'knocked-out' ? 'def-fail' : 'hit-pass'}">${ret.traumaRoll}</span>
                 <span class="sl-hud-dice-summary">${
                   ret.traumaOutcome === 'knocked-out' ? 'KNOCKED OUT' : 'SHAKEN'
                 }</span>
               </div>`
            : '';

        const retTotalWoundsText = retTraumaTokens > 0 ? ` · ${retTraumaTokens} wound tokens total` : '';
        const retStatus = ret.targetDestroyed ? ' · charger down' : ret.targetShaken ? ' · charger shaken' : '';
        const retSummaryWounds = ret.wounds > 0
          ? `<strong>${ret.wounds} unsaved wound${ret.wounds === 1 ? '' : 's'}${retTotalWoundsText}</strong>${retStatus}`
          : '<strong>0 wounds</strong>';

        retaliationHtml = `
          <div class="sl-hud-dice-retaliation" style="margin-top: 8px; border-top: 1px dashed rgba(255,255,255,0.2); padding-top: 6px;">
            <div class="sl-hud-dice-title" style="font-size: 11px; opacity: 0.9;">Defender Retaliation: ${target?.name ?? 'Defender'} → ${attacker?.name ?? 'Charger'}</div>
            <div class="sl-hud-dice-label">To-Hit (need Q${retEffectiveQ}+${retToHitMods}):</div>
            <div class="sl-hud-dice-row">${retHitDiceHtml}</div>
            <div class="sl-hud-dice-label">Defense (need D${retChargerD}+${retDefMods}):</div>
            <div class="sl-hud-dice-row">${retDefDiceHtml}</div>
            ${retTraumaHtml}
            <div class="sl-hud-dice-summary">
              ${ret.hitCount} hit${ret.hitCount === 1 ? '' : 's'} ·
              ${ret.blockedCount} blocked ·
              ${retSummaryWounds}
            </div>
          </div>`;
      }

      let pushBackHtml = '';
      if (outcome.pushedBack) {
        pushBackHtml = `<div class="sl-hud-pushback-notice" style="margin-top: 6px; font-size: 11px; color: #4ade80; font-style: italic;">Charger pushed back 1" — both units Fatigued</div>`;
      }

      const titleText =
        entry.action.type === 'respond-reaction'
          ? `Defender Retaliation: ${attacker?.name ?? 'Defender'} → ${target?.name ?? 'Charger'}`
          : `${attacker?.name ?? 'Attacker'} → ${target?.name ?? 'target'}`;

      return `
        <div class="sl-hud-dice">
          <div class="sl-hud-dice-title">${titleText}</div>
          <div class="sl-hud-dice-label">To-Hit (need Q${effectiveQ}+${toHitMods}):</div>
          <div class="sl-hud-dice-row">${hitDiceHtml}</div>
          <div class="sl-hud-dice-label">Defense (need D${targetD}+${defMods}):</div>
          <div class="sl-hud-dice-row">${defDiceHtml}</div>
          ${traumaHtml}
          <div class="sl-hud-dice-summary">
            ${outcome.hitCount} hit${outcome.hitCount === 1 ? '' : 's'} ·
            ${outcome.blockedCount} blocked ·
            ${summaryWounds}
          </div>
          ${retaliationHtml}
          ${pushBackHtml}
        </div>`;
    }
    return '<div class="sl-hud-dice-empty">No dice rolled yet</div>';
  }

  private renderLog(): string {
    const state = this.state!;
    const entries = state.actionLog.slice(-8).reverse();
    if (entries.length === 0) return '<div class="sl-hud-log-empty">—</div>';
    return entries
      .map((entry) => {
        const actor = state.players.find((p) => p.id === entry.action.actorId);
        return `<div class="sl-hud-log-entry">${actor?.name ?? '?'} ${this.logVerb(entry.action)}</div>`;
      })
      .join('');
  }

  private logVerb(action: GameAction): string {
    switch (action.type) {
      case 'deploy-unit':
        return `deployed ${this.unitName((action.payload as any).unitId)}`;
      case 'activate-unit':
        return `activated ${this.unitName((action.payload as any).unitId)}`;
      case 'hold':
        return `held with ${this.unitName((action.payload as any).unitId)}`;
      case 'move-unit':
        return `moved ${this.unitName((action.payload as any).unitId)}`;
      case 'rush':
        return `rushed ${this.unitName((action.payload as any).unitId)}`;
      case 'shoot':
        return `shot ${this.unitName((action.payload as any).targetId)}`;
      case 'charge':
        return `charged ${this.unitName((action.payload as any).targetId)}`;
      case 'fight':
        return `fought ${this.unitName((action.payload as any).targetId)}`;
      case 'respond-reaction': {
        const p = action.payload as { choiceId: string };
        return p.choiceId === 'strike-back' ? 'struck back in retaliation' : 'declined retaliation';
      }
      case 'end-activation':
        return 'ended an activation';
      case 'end-round':
        return 'ended the round';
      default:
        return action.type;
    }
  }

  private unitName(unitId: string): string {
    return this.state?.units.find((u) => u.id === unitId)?.name ?? 'unknown unit';
  }

  private renderBottomBar(): string {
    if (!this.state || this.state.status === 'game-over') return '';

    const active = this.activeUnit;
    const activeIsMine = active?.ownerId === this.localPlayerId;
    const dataCardSlot = `<div class="sl-hud-datacard-slot">${this.renderDataCard()}</div>`;

    if (this.flow.mode === 'confirming') {
      let casualtySelectorHtml = '';
      if (
        this.state &&
        active &&
        active.models &&
        active.models.filter((m) => !m.isDestroyed).length > 1
      ) {
        const path = (this.flow.action.payload as any)?.path;
        if (path && isPathDangerous(this.state, path, active)) {
          const livingModels = active.models.filter((m) => !m.isDestroyed);
          casualtySelectorHtml = `
            <div class="sl-hud-casualty-selector" style="display: flex; align-items: center; justify-content: center; gap: 8px; margin-bottom: 8px; font-size: 12px; color: #ffd54f;">
              <span>Hazard Casualty Priority:</span>
              <div style="display: flex; gap: 6px;">
                ${livingModels
                  .map(
                    (m, idx) => `
                  <button class="sl-hud-btn sl-hud-chip ${
                    (this.selectedCasualtyModelId ?? livingModels[0].id) === m.id ? 'primary' : ''
                  }" data-casualty-model-id="${m.id}" style="padding: 2px 8px; font-size: 11px;">
                    ${m.name ?? `Model ${idx + 1}`} (${m.wounds}W)
                  </button>`
                  )
                  .join('')}
              </div>
            </div>`;
        }
      }

      let shootChipsHtml = '';
      if (this.flow.action.type === 'shoot' && active) {
        const rangedWeapons = active.weapons.filter((w) => w.isEquipped && w.profile.type === 'ranged');
        if (rangedWeapons.length > 1) {
          const chips = rangedWeapons
            .map((w) => {
              const assignedId = this.shootAllocations.get(w.id);
              const assignedUnit = assignedId ? this.state?.units.find((u) => u.id === assignedId) : null;
              const isSelected = w.id === this.selectedShootWeaponId;
              return `
                <button class="sl-hud-weapon-chip ${isSelected ? 'selected' : ''} ${assignedUnit ? 'assigned' : ''}" data-weapon-id="${w.id}">
                  <span class="sl-chip-weapon-name">${w.name} (${w.profile.range}")</span>
                  <span class="sl-chip-target ${assignedUnit ? '' : 'unassigned'}">${
                assignedUnit ? `➔ ${assignedUnit.name}` : '➔ Unassigned'
              }</span>
                </button>`;
            })
            .join('');
          shootChipsHtml = `
            <div class="sl-hud-chips-bar" style="display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; margin-bottom: 8px;">
              ${chips}
            </div>`;
        }
      }

      let difficultWarningHtml = '';
      const payloadPath = (this.flow.action.payload as any)?.path;
      const isActionDifficult =
        this.movePreviewDifficult ||
        (this.state && active && payloadPath ? isPathDifficult(this.state, payloadPath, active) : false);

      const stoppedAtBase =
        this.flow.action.type === 'rush' &&
        (this.flow.summary.includes('Stops at wall base') ||
          this.flow.summary.includes('Stops at obstacle edge'));

      if (stoppedAtBase) {
        difficultWarningHtml = `
          <div class="sl-hud-warning-badge" style="background: rgba(41, 182, 246, 0.18); border: 1px solid #29b6f6; color: #81d4fa; padding: 4px 12px; border-radius: 6px; font-size: 12px; font-weight: 500; margin-bottom: 8px; display: flex; align-items: center; gap: 6px;">
            <span>ℹ️</span>
            <span><strong>Rush to Obstacle:</strong> Moving at full Rush speed to obstacle; sheer climb / crossing deferred to next turn.</span>
          </div>`;
      } else if (isActionDifficult && active) {
        if (this.flow.action.type === 'rush' || this.flow.action.type === 'charge') {
          const actionLabel = this.flow.action.type === 'rush' ? 'Rush' : 'Charge';
          difficultWarningHtml = `
            <div class="sl-hud-warning-badge" style="background: rgba(255, 152, 0, 0.18); border: 1px solid #ffa726; color: #ffb74d; padding: 4px 12px; border-radius: 6px; font-size: 12px; font-weight: 500; margin-bottom: 8px; display: flex; align-items: center; gap: 6px;">
              <span>⚠️</span>
              <span><strong>Difficult Terrain / Vertical Climb:</strong> ${actionLabel} speed bonus negated — total movement capped at 6.0".</span>
            </div>`;
        } else if ((active.speed ?? 6) > 6) {
          difficultWarningHtml = `
            <div class="sl-hud-warning-badge" style="background: rgba(255, 152, 0, 0.18); border: 1px solid #ffa726; color: #ffb74d; padding: 4px 12px; border-radius: 6px; font-size: 12px; font-weight: 500; margin-bottom: 8px; display: flex; align-items: center; gap: 6px;">
              <span>⚠️</span>
              <span><strong>Difficult Terrain / Vertical Climb:</strong> Movement capped at 6.0".</span>
            </div>`;
        }
      }

      return `
        <div class="sl-hud-bottom-dock">
          ${dataCardSlot}
          <div class="sl-hud-bottom sl-hud-confirm" style="display: flex; flex-direction: column; align-items: center;">
            ${casualtySelectorHtml}
            ${shootChipsHtml}
            ${difficultWarningHtml}
            <div style="display: flex; align-items: center; gap: 12px; width: 100%; justify-content: center;">
              <span class="sl-hud-confirm-summary">${this.flow.summary}</span>
              <button class="sl-hud-btn primary" data-action="confirm">Confirm</button>
              <button class="sl-hud-btn" data-action="cancel">Cancel</button>
            </div>
          </div>
        </div>`;
    }

    if (this.state.turnState.phase === 'deployment') {
      const deployable = getDeployableUnits(this.state, this.localPlayerId);
      const selectedUnit =
        (this.selectedDeployUnitId
          ? this.state.units.find((u) => u.id === this.selectedDeployUnitId)
          : null) ?? deployable[0];

      return `
        <div class="sl-hud-bottom-dock">
          ${dataCardSlot}
          <div class="sl-hud-bottom sl-hud-deployment-bar" style="display: flex; align-items: center; justify-content: center; padding: 12px 20px; background: rgba(18, 22, 28, 0.95); border: 1px solid #ffd54f; border-radius: 8px;">
            <span class="sl-hud-deploy-prompt" style="font-size: 14px; color: #e0e6ed;">
              ${
                !this.myTurn
                  ? `<span style="color: #ffd54f;">⏳ Waiting for opponent to deploy...</span>`
                  : selectedUnit
                  ? `📍 Deploying <strong style="color: #29b6f6;">${selectedUnit.name}</strong> — Click any legal position within your 12" deployment zone`
                  : `Select an undeployed fighter from the left panel to place on the battlefield`
              }
            </span>
          </div>
        </div>`;
    }

    if (this.flow.mode === 'waiting') {
      return `
        <div class="sl-hud-bottom-dock">
          ${dataCardSlot}
          <div class="sl-hud-bottom"><span class="sl-hud-hint">Waiting for the host…</span></div>
        </div>`;
    }

    const pendingReaction = this.state.turnState.pendingReaction;
    if (pendingReaction) {
      const remainingSec = this.getReactionRemainingSec(pendingReaction);
      if (pendingReaction.promptingPlayerId === this.localPlayerId) {
        const warningHtml = pendingReaction.warning
          ? `<div class="sl-hud-reaction-warning">${pendingReaction.warning}</div>`
          : '';
        const optionsHtml = (pendingReaction.options ?? [])
          .map((opt) => {
            const btnClass = opt.style === 'primary' ? 'primary' : opt.style === 'danger' ? 'danger' : '';
            return `<button class="sl-hud-btn ${btnClass}" data-reaction-choice="${opt.id}" data-reaction-id="${pendingReaction.id}">${opt.label}</button>`;
          })
          .join('');

        return `
          <div class="sl-hud-bottom-dock">
            ${dataCardSlot}
            <div class="sl-hud-bottom sl-hud-reaction">
              <div class="sl-hud-reaction-header">
                <span class="sl-hud-reaction-title">${pendingReaction.title}</span>
                <span class="sl-hud-reaction-timer">${remainingSec}s</span>
              </div>
              <div class="sl-hud-reaction-desc">${pendingReaction.description}</div>
              ${warningHtml}
              <div class="sl-hud-reaction-actions">
                ${optionsHtml}
              </div>
            </div>
          </div>`;
      }

      return `
        <div class="sl-hud-bottom-dock">
          ${dataCardSlot}
          <div class="sl-hud-bottom sl-hud-reaction-waiting">
            <span class="sl-hud-hint">Waiting for opponent: ${pendingReaction.title} (<span class="sl-hud-reaction-waiting-timer">${remainingSec}s</span>)…</span>
          </div>
        </div>`;
    }

    if (this.flow.mode === 'targeting') {
      const rangedWeapons =
        this.flow.action === 'shoot' && active
          ? active.weapons.filter((w) => w.isEquipped && w.profile.type === 'ranged')
          : [];

      if (this.flow.action === 'shoot' && rangedWeapons.length > 1) {
        const chipsHtml = rangedWeapons
          .map((w) => {
            const assignedId = this.shootAllocations.get(w.id);
            const assignedUnit = assignedId ? this.state?.units.find((u) => u.id === assignedId) : null;
            const isSelected = w.id === this.selectedShootWeaponId;
            return `
              <button class="sl-hud-weapon-chip ${isSelected ? 'selected' : ''} ${assignedUnit ? 'assigned' : ''}" data-weapon-id="${w.id}">
                <span class="sl-chip-weapon-name">${w.name} (${w.profile.range}")</span>
                <span class="sl-chip-target ${assignedUnit ? '' : 'unassigned'}">${
              assignedUnit ? `➔ ${assignedUnit.name}` : '➔ Unassigned'
            }</span>
              </button>`;
          })
          .join('');

        const assignedCount = [...this.shootAllocations.values()].filter((v) => v !== null).length;
        const uniqueTargets = new Set([...this.shootAllocations.values()].filter((v) => v !== null));
        const hint =
          assignedCount === 0
            ? 'Click an enemy target to assign all weapons, or click a weapon chip to target independently'
            : uniqueTargets.size > 1
            ? 'Split fire active. Click Confirm Attack to proceed, or click a weapon chip to reassign'
            : 'Click Confirm Attack to fire, or click another weapon chip to split fire';

        return `
          <div class="sl-hud-bottom-dock">
            ${dataCardSlot}
            <div class="sl-hud-bottom sl-hud-shoot-dock" style="display: flex; flex-direction: column; align-items: center; gap: 8px;">
              <div class="sl-hud-chips-bar" style="display: flex; gap: 8px; flex-wrap: wrap; justify-content: center;">
                ${chipsHtml}
              </div>
              <div style="display: flex; align-items: center; gap: 10px;">
                <span class="sl-hud-hint" style="font-size: 11px;">${hint}</span>
                ${
                  assignedCount > 0
                    ? '<button class="sl-hud-btn primary" data-action="confirm-shoot-targets">Confirm Attack</button>'
                    : ''
                }
                <button class="sl-hud-btn" data-action="cancel">Cancel</button>
              </div>
            </div>
          </div>`;
      }

      let instruction =
        this.flow.action === 'move'
          ? 'Click a destination on the board (auto-paths around obstacles)'
          : this.flow.action === 'rush'
          ? 'Click a destination to Rush (double move, auto-paths around obstacles)'
          : this.flow.action === 'charge'
          ? 'Click an enemy unit within charge range to Charge into melee and strike'
          : `Select an enemy target within the red range ring (${this.flow.action})`;

      const isSquadMovement =
        (this.flow.action === 'move' || this.flow.action === 'rush') &&
        this.activeAliveSquadModels.length > 1;

      let squadChipsHtml = '';
      if (isSquadMovement && active) {
        const alive = this.activeAliveSquadModels;
        const allowance = this.flow.action === 'rush' ? active.speed * 2 : active.speed;
        const currentModel = this.selectedSquadModel;
        const currentModelIndex = alive.findIndex((m) => m.id === currentModel?.id);
        const placedCount = this.stagedSquadModelPositions.size;

        if (placedCount === 0) {
          instruction = `Place Model ${(currentModelIndex >= 0 ? currentModelIndex : 0) + 1} of ${alive.length} (${active.name}) within ${allowance}"`;
        } else {
          instruction = `Place Model ${(currentModelIndex >= 0 ? currentModelIndex : 0) + 1} of ${alive.length} (within 6" of squad; pairs within 1")`;
        }

        squadChipsHtml = `
          <div class="sl-hud-squad-chips" style="display: flex; gap: 6px; align-items: center; margin-bottom: 4px;">
            <span style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; opacity: 0.7;">Select Model:</span>
            ${alive
              .map((m, idx) => {
                const isPlaced = this.stagedSquadModelPositions.has(m.id);
                const isSelected = m.id === currentModel?.id;
                return `
                  <button class="sl-hud-btn sl-hud-chip ${isSelected ? 'active' : ''}"
                    data-action="select-squad-model"
                    data-model-id="${m.id}"
                    style="${
                      isSelected
                        ? 'background: #00bcd4; color: #000; font-weight: bold;'
                        : isPlaced
                        ? 'background: rgba(76, 175, 80, 0.25); border-color: #4caf50; color: #a5d6a7;'
                        : ''
                    }">
                    ${isPlaced ? '✓ ' : ''}Model ${idx + 1}
                  </button>
                `;
              })
              .join('')}
          </div>
        `;
      }

      return `
        <div class="sl-hud-bottom-dock">
          ${dataCardSlot}
          <div class="sl-hud-bottom" style="display: flex; flex-direction: column; align-items: center; gap: 6px;">
            <div class="sl-hud-move-warning" style="display: none; background: rgba(255, 152, 0, 0.2); border: 1px solid #ff9800; color: #ffb74d; padding: 4px 12px; border-radius: 6px; font-size: 12px; font-weight: 500; text-align: center;"></div>
            ${squadChipsHtml}
            <div style="display: flex; align-items: center; gap: 10px;">
              <span class="sl-hud-hint">${instruction}</span>
              ${
                isSquadMovement && this.stagedSquadModelPositions.size > 0
                  ? '<button class="sl-hud-btn" data-action="reset-squad-move">Reset Placement</button>'
                  : ''
              }
              <button class="sl-hud-btn" data-action="cancel">Cancel</button>
            </div>
          </div>
        </div>`;
    }

    if (this.myTurn && activeIsMine && active) {
      const engaged = active.status.includes('engaged');
      const hasAttacked = !!active.hasAttacked;
      const hasMoved = !!active.hasMoved;
      const isRushing = !!active.isRushing;
      const hasMovementLeft = (active.remainingMovement ?? active.speed) > 0.05;
      const hasActed = hasMoved || hasAttacked || isRushing;

      const canMove = !active.isDestroyed && !engaged && hasMovementLeft && (!hasAttacked || isRushing);
      const canRush =
        !active.isDestroyed &&
        !engaged &&
        ((!hasMoved && !hasAttacked) || (isRushing && hasMovementLeft));
      const rangedWeapon = active.weapons.find((w) => w.isEquipped && w.profile.type === 'ranged');
      const meleeWeapon = active.weapons.find((w) => w.isEquipped && w.profile.type === 'melee');
      const canShoot = !active.isDestroyed && !engaged && !hasAttacked && !isRushing && !!rangedWeapon;
      const canCharge = !active.isDestroyed && !engaged && !hasMoved && !hasAttacked && !isRushing && !!meleeWeapon;

      // Before moving/attacking, show Hold (stay put & end activation).
      // Once the unit has moved or attacked, show End Activation instead.
      const finishBtn = !hasActed
        ? `<button class="sl-hud-btn" data-action="hold">Hold</button>`
        : `<button class="sl-hud-btn primary" data-action="end-activation">End Activation</button>`;

      return `
        <div class="sl-hud-bottom-dock">
          ${dataCardSlot}
          <div class="sl-hud-bottom sl-hud-actions">
            <span class="sl-hud-active-name">${active.name}</span>
            <button class="sl-hud-btn" data-action="move" ${canMove ? '' : 'disabled'}>Move</button>
            <button class="sl-hud-btn" data-action="rush" ${canRush ? '' : 'disabled'}>Rush</button>
            <button class="sl-hud-btn" data-action="shoot" ${canShoot ? '' : 'disabled'}>Shoot</button>
            <button class="sl-hud-btn" data-action="charge" ${canCharge ? '' : 'disabled'}>Charge</button>
            ${finishBtn}
          </div>
        </div>`;
    }

    if (this.myTurn) {
      const n = this.activatableUnits.length;
      return `
        <div class="sl-hud-bottom-dock">
          ${dataCardSlot}
          <div class="sl-hud-bottom">
            <span class="sl-hud-hint">Your turn — activate a unit (${
              n > 0 ? `${n} available` : 'none available'
            })</span>
          </div>
        </div>`;
    }

    const opponentActive = active ? `${active.name} is activating` : 'waiting to activate';
    return `
      <div class="sl-hud-bottom-dock">
        ${dataCardSlot}
        <div class="sl-hud-bottom"><span class="sl-hud-hint">Opponent's turn — ${opponentActive}</span></div>
      </div>`;
  }

  /** Unit shown in the RTS data card above the bottom bar (hovered, active, or selected). */
  private get inspectedUnit(): Unit | null {
    if (!this.state) return null;
    if (this.hoveredUnitId) {
      const hovered = this.state.units.find((u) => u.id === this.hoveredUnitId && !u.isDestroyed);
      if (hovered) return hovered;
    }
    if (this.activeUnit) return this.activeUnit;
    if (this.selectedUnitId) {
      return this.state.units.find((u) => u.id === this.selectedUnitId && !u.isDestroyed) ?? null;
    }
    return null;
  }

  /** Objective shown in the RTS data card when hovering within its 3" horizontal and 3" vertical control volume. */
  private get inspectedObjective(): Objective | null {
    if (!this.state?.objectives || !this.hoveredGroundPosition) return null;
    const pos = this.hoveredGroundPosition;
    for (const obj of this.state.objectives) {
      const dist = Math.hypot(pos.x - obj.position.x, pos.z - obj.position.z);
      const dy = Math.abs((pos.y ?? 0) - (obj.position.y ?? 0));
      if (dist <= OBJECTIVE_CONTROL_RADIUS && dy <= OBJECTIVE_CONTROL_MAX_VERTICAL) return obj;
    }
    return null;
  }

  private renderObjectiveCard(obj: Objective): string {
    const isHost = obj.controllingPlayerId === this.state?.hostId;
    const isGuest = obj.controllingPlayerId === this.state?.guestId;
    const teamClass = obj.isContested
      ? 'contested'
      : isHost
      ? 'team-blue'
      : isGuest
      ? 'team-red'
      : 'neutral';
    const statusText = obj.isContested
      ? 'Contested'
      : isHost
      ? 'Controlled by Host'
      : isGuest
      ? 'Controlled by Guest'
      : 'Neutral (Unclaimed)';
    const statusColor = obj.isContested
      ? '#ff9800'
      : isHost
      ? '#29b6f6'
      : isGuest
      ? '#ef5350'
      : '#ffd54f';

    const hostCount = (this.state?.units ?? []).filter(
      (u) => u.ownerId === this.state?.hostId && isUnitInObjectiveRange(u, obj)
    ).length;
    const guestCount = (this.state?.units ?? []).filter(
      (u) => u.ownerId === this.state?.guestId && isUnitInObjectiveRange(u, obj)
    ).length;

    return `
      <div class="sl-hud-datacard ${teamClass}">
        <div class="sl-hud-datacard-header">
          <span class="sl-hud-datacard-name">🎯 ${obj.name}</span>
          <span class="sl-hud-datacard-meta">Objective (${OBJECTIVE_CONTROL_RADIUS.toFixed(1)}" control radius, ±${OBJECTIVE_CONTROL_MAX_VERTICAL.toFixed(1)}" vertical)</span>
          <span class="sl-hud-datacard-tags" style="color: ${statusColor}; font-weight: 700;">${statusText}</span>
        </div>
        <div style="font-size: 12px; margin-top: 4px; font-weight: 600; color: #eceff1;">
          Unit Presence: <span style="color: #29b6f6;">Host: ${hostCount}</span> · <span style="color: #ef5350;">Guest: ${guestCount}</span>
        </div>
        <div style="font-size: 11px; color: #b0bec5; margin-top: 2px;">
          End-of-round control: friendly unit in 3", zero enemy units in 3". Persistent until seized or contested.
        </div>
      </div>`;
  }

  private renderDataCard(): string {
    const terrainHtml = this.renderTerrainDebugCard();
    // Hovering an objective beacon takes precedence for inspection
    const hoveredObj = this.inspectedObjective;
    if (hoveredObj) {
      return `${terrainHtml}${this.renderObjectiveCard(hoveredObj)}`;
    }
    const unit = this.inspectedUnit;
    if (!unit) {
      return terrainHtml;
    }

    const isMine = unit.ownerId === this.localPlayerId;
    const statusTags: string[] = [];
    if (unit.status.includes('shaken')) statusTags.push('SHAKEN');
    else if (unit.status.includes('stunned')) statusTags.push('STUNNED');
    if (unit.status.includes('fatigued')) statusTags.push('FATIGUED');
    if (unit.status.includes('routed')) statusTags.push('ROUTED');
    if (unit.status.includes('engaged')) statusTags.push('ENGAGED');
    if (unit.status.includes('in-cover')) statusTags.push('IN COVER');
    const cardTough = getUnitTough(unit);
    if (unit.traumaTokens && unit.traumaTokens > 0) {
      if (cardTough > 1 && unit.traumaTokens < cardTough) {
        statusTags.push(`${unit.traumaTokens}/${cardTough} WOUND TOKENS`);
      } else {
        statusTags.push(`+${unit.traumaTokens} WOUND TOKENS`);
      }
    }
    if (unit.isActivated) statusTags.push('ACTIVATED');
    else statusTags.push('READY');

    const owner = this.state?.players.find((p) => p.id === unit.ownerId);
    const isHostUnit = owner?.role === 'host';
    const cardTeamClass = isHostUnit ? 'team-blue' : 'team-red';

    const unitTraits = unit.specialRules
      .map((r) => `<span class="sl-trait-badge" title="${escapeHtmlAttr(describeTrait(r))}">${formatTraitLabel(r)}</span>`)
      .join(' · ');
    const weaponRows = unit.weapons
      .filter((w) => w.isEquipped)
      .map(
        (w) => `
          <tr>
            <td>${w.name}</td>
            <td>${w.profile.type === 'ranged' ? 'Ranged' : 'Melee'}</td>
            <td>${w.profile.type === 'ranged' ? `${w.profile.range}"` : '1"'}</td>
            <td>${w.profile.attacks}d6</td>
            <td>${
              w.profile.specialRules
                .map((r) => `<span class="sl-trait-badge" title="${escapeHtmlAttr(describeTrait(r))}">${formatTraitLabel(r)}</span>`)
                .join(', ') || '—'
            }</td>
          </tr>`
      )
      .join('');

    const totalModels = unit.models ? unit.models.length : 1;
    const aliveModels = unit.models ? unit.models.filter((m) => !m.isDestroyed).length : 1;
    const casualties = totalModels - aliveModels;
    const modelMeta = totalModels > 1
      ? ` · Models: ${aliveModels}/${totalModels}${casualties > 0 ? ` (${casualties} casualty${casualties > 1 ? 'ies' : ''})` : ''}`
      : '';

    return `${terrainHtml}
      <div class="sl-hud-datacard ${isMine ? 'mine' : 'enemy'} ${cardTeamClass}">
        <div class="sl-hud-datacard-header">
          <span class="sl-hud-datacard-name">${unit.name}</span>
          <span class="sl-hud-datacard-meta">${isMine ? 'Friendly' : 'Enemy'} (${isHostUnit ? 'Host / Blue' : 'Guest / Red'}) · ${unit.unitType}${modelMeta}${unitTraits ? ` · ${unitTraits}` : ''}</span>
          <span class="sl-hud-datacard-tags">${statusTags.join(' · ')}</span>
        </div>
        <div class="sl-hud-datacard-tables">
          <table class="sl-hud-table">
            <thead>
              <tr><th>Quality</th><th>Defense</th><th>Toughness</th><th>Models</th><th>Move</th><th>Charge</th></tr>
            </thead>
            <tbody>
              <tr>
                <td>Q${unit.quality}+</td>
                <td>D${unit.defense}+</td>
                <td>${cardTough}</td>
                <td>${aliveModels}/${totalModels}</td>
                <td>${unit.speed}"</td>
                <td>${unit.speed * 2}"</td>
              </tr>
            </tbody>
          </table>
          <table class="sl-hud-table">
            <thead>
              <tr><th>Weapon</th><th>Type</th><th>Range</th><th>Dice</th><th>Traits</th></tr>
            </thead>
            <tbody>
              ${weaponRows}
            </tbody>
          </table>
        </div>
      </div>`;
  }

  private getActiveShootingDebug(): ShootingRayDebugInfo | null {
    if (!this.terrainDebugEnabled || !this.state) return null;

    let shooter: Unit | null = null;
    let targetOrPoint: Unit | Vector3 | null = null;

    if (this.flow.mode === 'confirming' && this.flow.action.type === 'shoot') {
      const payload = this.flow.action.payload as { attackerId?: string; targetId?: string };
      shooter = this.state.units.find((u) => u.id === payload.attackerId) ?? this.activeUnit;
      if (payload.targetId) {
        targetOrPoint = this.state.units.find((u) => u.id === payload.targetId) ?? null;
      }
    } else if (this.flow.mode === 'targeting' && this.flow.action === 'shoot') {
      shooter = this.activeUnit;
      if (this.hoveredUnitId) {
        targetOrPoint = this.state.units.find((u) => u.id === this.hoveredUnitId && !u.isDestroyed) ?? null;
      }
      if (!targetOrPoint && this.hoveredGroundPosition) {
        targetOrPoint = this.hoveredGroundPosition;
      }
    } else if (
      (this.flow.mode === 'idle' || this.hoveredAction === 'shoot') &&
      this.activeUnit
    ) {
      shooter = this.activeUnit;
      if (this.hoveredUnitId && this.hoveredUnitId !== shooter.id) {
        targetOrPoint = this.state.units.find((u) => u.id === this.hoveredUnitId && !u.isDestroyed) ?? null;
      }
    }

    if (!shooter || !targetOrPoint) return null;
    return computeShootingRayDebug(this.state, shooter, targetOrPoint);
  }

  private renderTerrainDebugCard(): string {
    if (!this.terrainDebugEnabled || !this.state) return '';
    const cards: string[] = [];

    const ray = this.getActiveShootingDebug();
    if (ray) {
      const shooter = this.state.units.find((u) => u.id === ray.attackerId);
      const targetUnit = ray.targetId ? this.state.units.find((u) => u.id === ray.targetId) : null;
      const targetName = targetUnit
        ? targetUnit.name
        : `Ground (${ray.to.x.toFixed(1)}, ${ray.to.z.toFixed(1)})`;
      const shooterName = shooter ? shooter.name : ray.attackerId;

      const losTag = ray.hasLineOfSight
        ? '<span style="color:#00e5ff;">LoS: CLEAR</span>'
        : `<span style="color:#ef5350;">LoS: BLOCKED (${
            ray.blockedByPieceId
              ? `Piece: ${ray.blockedByPieceId}`
              : ray.blockedByUnitId
              ? `Unit: ${ray.blockedByUnitId}`
              : 'Obstacle'
          })</span>`;

      const coverTag = ray.providesCover
        ? `<span style="color:#ffd600;">Cover: IN COVER (+1 Def${
            ray.coverPieceId ? ` via ${ray.coverPieceId}` : ''
          })</span>`
        : '<span style="color:#90a4ae;">Cover: OPEN (No Cover)</span>';

      const flankText =
        ray.flankRays && ray.flankRays.length > 0
          ? ray.flankRays
              .map(
                (f) =>
                  `${f.side.toUpperCase()}: ${
                    f.blocked
                      ? '<span style="color:#ef5350;">Blocked</span>'
                      : '<span style="color:#26a69a;">Clear</span>'
                  }`
              )
              .join(' · ')
          : null;

      const interRows =
        ray.intersections.length === 0
          ? '<tr><td colspan="5" style="color:#78909c; font-style:italic;">No terrain intersected along shooting line</td></tr>'
          : ray.intersections
              .map((i) => {
                const tag = i.isLoSBlocker
                  ? '<span style="color:#ef5350;">Blocks LoS</span>'
                  : i.isCoverProvider
                  ? '<span style="color:#ffd600;">Provides Cover</span>'
                  : i.ignoredAsAdjacentShooterCover
                  ? '<span style="color:#78909c;">Shooter Touch (Ignored)</span>'
                  : '<span style="color:#90caf9;">Passable</span>';
                return `<tr>
                  <td><code>${i.pieceId}</code></td>
                  <td>${i.terrainType}</td>
                  <td>(${i.entryPoint.x.toFixed(1)}, ${i.entryPoint.z.toFixed(1)})</td>
                  <td>(${i.exitPoint.x.toFixed(1)}, ${i.exitPoint.z.toFixed(1)})</td>
                  <td>${tag}</td>
                </tr>`;
              })
              .join('');

      cards.push(`
        <div class="sl-hud-datacard sl-hud-terrain-debug">
          <div class="sl-hud-datacard-header">
            <span class="sl-hud-datacard-name">Shooting Ray Debug (F9)</span>
            <span class="sl-hud-datacard-meta">${shooterName} ➔ ${targetName} (${ray.distance.toFixed(1)}")</span>
            <span class="sl-hud-datacard-tags">${losTag} · ${coverTag}</span>
          </div>
          <div class="sl-hud-datacard-tables">
            <table class="sl-hud-table">
              <thead>
                <tr><th>Terrain Piece</th><th>Type</th><th>Entry (X, Z)</th><th>Exit (X, Z)</th><th>Status</th></tr>
              </thead>
              <tbody>
                ${interRows}
              </tbody>
            </table>
            ${
              flankText
                ? `<div style="font-size:11px; margin-top:4px; color:#b0bec5;">Flank rays: ${flankText}${
                    ray.coverReason ? ` · <em>${ray.coverReason}</em>` : ''
                  }</div>`
                : ''
            }
          </div>
        </div>`);
    }

    if (this.hoveredTerrainId) {
      const piece = this.state.terrain.find((t) => t.id === this.hoveredTerrainId);
      if (piece) {
        const info = describeTerrainPiece(piece);
        const flags = [
          info.blocksLineOfSight ? 'Blocks LoS' : 'No LoS Block',
          info.isObstacle ? 'Obstacle' : 'Passable',
          info.providesCover ? 'Cover' : 'No Cover',
        ].join(' · ');

        cards.push(`
          <div class="sl-hud-datacard sl-hud-terrain-debug">
            <div class="sl-hud-datacard-header">
              <span class="sl-hud-datacard-name">${info.id}</span>
              <span class="sl-hud-datacard-meta">Terrain · ${info.terrainType} · <code>${info.modelFile}</code></span>
              <span class="sl-hud-datacard-tags">${flags}</span>
            </div>
            <div class="sl-hud-datacard-tables">
              <table class="sl-hud-table">
                <thead>
                  <tr><th>Position</th><th>Scale</th><th>Rot Y</th><th>Footprint (X×Z)</th><th>Half-Extents</th><th>Raw GLB Size</th></tr>
                </thead>
                <tbody>
                  <tr>
                    <td>(${info.position.x.toFixed(1)}, ${info.position.y.toFixed(1)}, ${info.position.z.toFixed(1)})</td>
                    <td>(${info.scale.x}, ${info.scale.y}, ${info.scale.z})</td>
                    <td>${info.rotationDeg}°</td>
                    <td>${info.worldFootprint.width.toFixed(2)}" × ${info.worldFootprint.depth.toFixed(2)}"</td>
                    <td>hx=${info.halfExtents.hx.toFixed(2)}", hz=${info.halfExtents.hz.toFixed(2)}"</td>
                    <td>${info.rawGlbSize}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>`);
      }
    }

    return cards.join('');
  }

  private updateDataCardSlot(): void {
    const slot = this.root.querySelector('.sl-hud-datacard-slot');
    if (slot) {
      slot.innerHTML = this.renderDataCard();
    }
  }

  private updateMoveWarning(
    isDifficult: boolean,
    actionKind: string,
    stoppedAtBase: boolean = false,
    isElevationObstacle: boolean = true
  ): void {
    const warningEl = this.root.querySelector('.sl-hud-move-warning') as HTMLElement | null;
    if (!warningEl) return;
    if (stoppedAtBase && actionKind === 'rush') {
      if (isElevationObstacle) {
        warningEl.innerHTML =
          'ℹ️ <strong>Rushing to wall base:</strong> Stops before sheer climb (climb available next turn with full movement)';
      } else {
        warningEl.innerHTML =
          'ℹ️ <strong>Rushing to obstacle edge:</strong> Stops before difficult terrain (crossing available next turn with full movement)';
      }
      warningEl.style.display = 'block';
      warningEl.style.background = 'rgba(41, 182, 246, 0.2)';
      warningEl.style.borderColor = '#29b6f6';
      warningEl.style.color = '#81d4fa';
    } else if (isDifficult && (actionKind === 'rush' || actionKind === 'charge')) {
      const actionLabel = actionKind === 'rush' ? 'Rush' : 'Charge';
      warningEl.innerHTML = `⚠️ <strong>Difficult Terrain / Vertical Climb:</strong> ${actionLabel} speed bonus negated (maximum movement capped at 6.0")`;
      warningEl.style.display = 'block';
      warningEl.style.background = 'rgba(255, 152, 0, 0.2)';
      warningEl.style.borderColor = '#ff9800';
      warningEl.style.color = '#ffb74d';
    } else if (isDifficult && actionKind === 'move' && (this.activeUnit?.speed ?? 6) > 6) {
      warningEl.innerHTML = '⚠️ <strong>Difficult Terrain / Vertical Climb:</strong> Movement capped at 6.0"';
      warningEl.style.display = 'block';
      warningEl.style.background = 'rgba(255, 152, 0, 0.2)';
      warningEl.style.borderColor = '#ff9800';
      warningEl.style.color = '#ffb74d';
    } else {
      warningEl.style.display = 'none';
      warningEl.textContent = '';
    }
  }

  private bindEvents(): void {
    // Unit rows: hover highlights the unit on the board; click activates an activatable unit
    // (or targets an enemy unit when in shoot/charge/fight targeting mode).
    for (const row of Array.from(this.root.querySelectorAll('.sl-hud-unit'))) {
      const el = row as HTMLElement;
      const unitId = el.dataset.unitId!;
      el.addEventListener('mouseenter', () => {
        this.hoveredUnitId = unitId;
        this.updateDataCardSlot();
        this.emitMarkers();
      });
      el.addEventListener('mouseleave', () => {
        if (this.hoveredUnitId === unitId) {
          this.hoveredUnitId = null;
          this.updateDataCardSlot();
          this.emitMarkers();
        }
      });
      el.addEventListener('click', () => {
        if (this.state?.turnState.phase === 'deployment') {
          if (el.classList.contains('deployable')) {
            this.selectedDeployUnitId = unitId;
            this.render();
          }
          return;
        }
        if (this.flow.mode === 'targeting' && this.flow.action !== 'move') {
          this.prepareAttack(unitId);
        } else if (el.classList.contains('activatable')) {
          this.tryActivateFromList(unitId);
        }
      });
    }

    for (const button of Array.from(this.root.querySelectorAll('.sl-hud-btn'))) {
      const el = button as HTMLButtonElement;
      if (el.disabled) continue;
      const actionKey = el.dataset.action ?? '';
      if (
        actionKey === 'move' ||
        actionKey === 'rush' ||
        actionKey === 'shoot' ||
        actionKey === 'charge' ||
        actionKey === 'fight'
      ) {
        el.addEventListener('mouseenter', () => {
          this.hoveredAction = actionKey;
          this.emitMarkers();
        });
        el.addEventListener('mouseleave', () => {
          if (this.hoveredAction === actionKey) {
            this.hoveredAction = null;
            this.emitMarkers();
          }
        });
      }
      el.addEventListener('click', () => {
        this.hoveredAction = null;
        switch (el.dataset.action) {
          case 'confirm':
            this.confirmPending();
            break;
          case 'confirm-shoot-targets':
            this.confirmShootTargets();
            break;
          case 'select-squad-model': {
            const modelId = el.dataset.modelId;
            if (modelId) {
              this.selectSquadModel(modelId);
            }
            break;
          }
          case 'reset-squad-move':
            this.stagedSquadModelPositions.clear();
            this.stagedSquadModelPaths.clear();
            this.selectedSquadModelId = this.activeAliveSquadModels[0]?.id ?? null;
            this.movePathPreview = null;
            this.movePreview = null;
            this.render();
            this.emitMarkers();
            break;
          case 'cancel':
            this.cancel();
            break;
          case 'return-lobby':
            this.controller.onReturnToLobby?.();
            break;
          case 'move':
          case 'rush':
          case 'shoot':
          case 'charge':
          case 'fight':
            this.beginActionTargeting(
              el.dataset.action as 'move' | 'rush' | 'shoot' | 'charge' | 'fight'
            );
            break;
          case 'hold': {
            const active = this.activeUnit;
            if (active) {
              this.beginConfirmation(
                createAction(this.localPlayerId, 'hold', { type: 'hold', unitId: active.id }),
                `${active.name} holds position`
              );
            }
            break;
          }
          case 'end-activation': {
            this.beginConfirmation(
              createAction(this.localPlayerId, 'end-activation', { type: 'end-activation' }),
              `End ${this.activeUnit?.name ?? 'the'} activation`
            );
            break;
          }
        }
      });
    }

    const reactionBtns = this.root.querySelectorAll<HTMLButtonElement>('[data-reaction-choice]');
    for (const btn of reactionBtns) {
      btn.addEventListener('click', () => {
        const choiceId = btn.dataset.reactionChoice;
        const reactionId = btn.dataset.reactionId;
        if (choiceId && reactionId) {
          this.flow = { mode: 'waiting' };
          this.render();
          this.controller.submitAction(
            createAction(this.localPlayerId, 'respond-reaction', {
              type: 'respond-reaction',
              reactionId,
              choiceId,
            })
          );
        }
      });
    }

    const casualtyBtns = this.root.querySelectorAll<HTMLButtonElement>('[data-casualty-model-id]');
    for (const btn of casualtyBtns) {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const modelId = btn.dataset.casualtyModelId;
        if (modelId && this.flow.mode === 'confirming') {
          this.selectedCasualtyModelId = modelId;
          (this.flow.action.payload as any).casualtyModelIds = [modelId];
          this.render();
        }
      });
    }

    const weaponChipBtns = this.root.querySelectorAll<HTMLButtonElement>('[data-weapon-id]');
    for (const btn of weaponChipBtns) {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const wid = btn.dataset.weaponId;
        if (wid) {
          this.selectedShootWeaponId = wid;
          this.render();
          this.emitMarkers();
        }
      });
    }
  }

  private emitMarkers(): void {
    // Transient wound token: the newest unseen dice resolution with wounds.
    let outcome: MarkerSnapshot['outcome'] = null;
    if (this.state) {
      for (let i = this.state.actionLog.length - 1; i >= this.lastSeenLogIndex; i--) {
        const entry = this.state.actionLog[i];
        if (entry.dice && entry.dice.outcome.wounds !== undefined) {
          const target = this.state.units.find((u) => u.id === entry.dice!.context.targetId);
          if (target) {
            outcome = { position: { ...target.position }, wounds: entry.dice.outcome.wounds };
          }
          break;
        }
      }
      this.lastSeenLogIndex = this.state.actionLog.length;
    }

    const hoveredUnit = this.hoveredUnitId
      ? this.state?.units.find((u) => u.id === this.hoveredUnitId && !u.isDestroyed) ?? null
      : null;

    // Selection marker highlights a hovered friendly unit, or the currently selected/active unit.
    const selectedId =
      hoveredUnit && hoveredUnit.ownerId === this.localPlayerId
        ? hoveredUnit.id
        : this.selectedUnitId;

    const shootingDebugRay = this.getActiveShootingDebug();

    const markers: MarkerSnapshot = {
      selectedUnitId: selectedId,
      targetUnitId: null,
      reachableTargetIds: [],
      movementRangeUnitId: null,
      attackRange: null,
      movePath: null,
      engagedTargetId: this.hoveredEngagedTargetId,
      hoveredTerrainId: this.terrainDebugEnabled ? this.hoveredTerrainId : null,
      outcome,
      debugActive: this.terrainDebugEnabled,
      shootingDebugRay,
      deploymentZones: null,
    };

    if (this.state && this.state.turnState.phase === 'deployment') {
      const hostZone = getDeploymentZoneBounds(this.state, this.state.hostId, false);
      const guestZone = getDeploymentZoneBounds(this.state, this.state.guestId, false);
      let previewUnitZone: (DeploymentZoneBounds & { color?: number }) | undefined = undefined;

      const deployable = getDeployableUnits(this.state, this.localPlayerId);
      const currentDeployUnit =
        (this.selectedDeployUnitId
          ? this.state.units.find((u) => u.id === this.selectedDeployUnitId)
          : null) ?? deployable[0];

      if (this.myTurn && currentDeployUnit && hasTrait(currentDeployUnit.specialRules, 'vanguard')) {
        const vBounds = getDeploymentZoneBounds(this.state, currentDeployUnit.ownerId, true);
        previewUnitZone = {
          ...vBounds,
          color: currentDeployUnit.ownerId === this.state.hostId ? 0x29b6f6 : 0xef5350,
        };
      }

      markers.deploymentZones = {
        hostZone,
        guestZone,
        previewUnitZone,
      };
    }

    // If hovering an enemy unit, show the bright red target ring under that enemy.
    if (hoveredUnit && hoveredUnit.ownerId !== this.localPlayerId) {
      markers.targetUnitId = hoveredUnit.id;
    }

    // While in shoot targeting, reflect assigned targets
    if (this.flow.mode === 'targeting' && this.flow.action === 'shoot') {
      const assigned = Array.from(
        new Set([...this.shootAllocations.values()].filter((id): id is string => id !== null))
      );
      if (hoveredUnit && hoveredUnit.ownerId !== this.localPlayerId && !assigned.includes(hoveredUnit.id)) {
        assigned.push(hoveredUnit.id);
      }
      if (assigned.length > 0) {
        markers.targetUnitIds = assigned;
        markers.targetUnitId = assigned[0];
      }
    }

    // While confirming an attack/charge/rush/move, reflect markers
    if (this.flow.mode === 'confirming') {
      const payload = this.flow.action.payload as {
        targetId?: string;
        allocations?: Array<{ weaponId: string; targetId: string }>;
        path?: Vector3[];
      };
      if (payload.allocations && payload.allocations.length > 0) {
        markers.targetUnitIds = Array.from(new Set(payload.allocations.map((a) => a.targetId)));
        markers.targetUnitId = payload.allocations[0].targetId;
      } else if (payload.targetId) {
        markers.targetUnitId = payload.targetId;
      }
      if (
        (this.flow.action.type === 'move-unit' ||
          this.flow.action.type === 'rush' ||
          this.flow.action.type === 'charge' ||
          this.flow.action.type === 'consolidate-move') &&
        payload.path &&
        payload.path.length >= 2
      ) {
        const isDifficult =
          this.movePreviewDifficult ||
          (this.state && this.activeUnit
            ? isPathDifficult(this.state, payload.path, this.activeUnit)
            : false);
        markers.movePath = {
          from: payload.path[0],
          to: payload.path[payload.path.length - 1],
          waypoints: payload.path,
          isMeleeContact: this.flow.action.type === 'charge',
          color: isDifficult ? 0xffa726 : undefined,
        };
      }
      if (this.flow.action.type === 'charge' && payload.targetId) {
        markers.engagedTargetId = payload.targetId;
      }
    }

    // While targeting or hovering an attack action, show the thin red max-range circle
    // (with LoS shadow fill), darker red rings under all reachable enemy targets, and
    // a bright red ring under any hovered target.
    const attackAction =
      this.flow.mode === 'targeting' &&
      this.flow.action !== 'move' &&
      this.flow.action !== 'rush'
        ? this.flow.action
        : this.flow.mode === 'idle' &&
          (this.hoveredAction === 'shoot' ||
            this.hoveredAction === 'charge' ||
            this.hoveredAction === 'fight')
        ? this.hoveredAction
        : null;

    if (attackAction && this.state) {
      const active = this.activeUnit;
      if (active) {
        const maxRange = this.actionMaxRange(active, attackAction);
        if (maxRange > 0) {
          const concentricRanges =
            attackAction === 'shoot'
              ? Array.from(
                  new Set(
                    active.weapons
                      .filter((w) => w.isEquipped && w.profile.type === 'ranged')
                      .map((w) => w.profile.range)
                  )
                ).sort((a, b) => a - b)
              : undefined;
          markers.attackRange = { unitId: active.id, range: maxRange, concentricRanges };
        }
        const reachable = this.reachableEnemies(active, attackAction);
        const targetedIds = new Set(
          markers.targetUnitIds ?? (markers.targetUnitId ? [markers.targetUnitId] : [])
        );
        markers.reachableTargetIds = reachable
          .filter((enemy) => !targetedIds.has(enemy.id))
          .map((enemy) => enemy.id);
      }
    }

    // Movement-range ring when Move or Rush is hovered, clicked (targeting), or confirming.
    const isRushMode =
      (this.flow.mode === 'targeting' && this.flow.action === 'rush') ||
      (this.flow.mode === 'confirming' && this.flow.action.type === 'rush') ||
      (this.flow.mode === 'idle' && this.hoveredAction === 'rush');
    const isMoveMode =
      (this.flow.mode === 'targeting' && this.flow.action === 'move') ||
      (this.flow.mode === 'confirming' && this.flow.action.type === 'move-unit') ||
      (this.flow.mode === 'idle' && this.hoveredAction === 'move');

    const pendingConsolidation = this.state?.turnState.pendingReaction;
    const isConsolidationMode =
      pendingConsolidation &&
      pendingConsolidation.type === 'melee-consolidation' &&
      pendingConsolidation.promptingPlayerId === this.localPlayerId;

    if (isConsolidationMode && pendingConsolidation) {
      const victorId = pendingConsolidation.data?.unitId;
      const victor = this.state?.units.find((u) => u.id === victorId);
      if (victor) {
        markers.selectedUnitId = victor.id;
        markers.movementRangeUnitId = victor.id;
        markers.movementRangeRadius = pendingConsolidation.data?.maxDistance ?? 3.0;
        if (this.movePathPreview && this.movePathPreview.length >= 2) {
          markers.movePath = {
            from: this.movePathPreview[0],
            to: this.movePathPreview[this.movePathPreview.length - 1],
            waypoints: this.movePathPreview,
          };
        }
      }
    } else if ((isMoveMode || isRushMode) && this.activeUnit) {
      markers.movementRangeUnitId = this.activeUnit.id;
      if (isRushMode) {
        const remainingRush = this.activeUnit.isRushing
          ? this.activeUnit.remainingMovement
          : this.activeUnit.speed * 2 - (this.activeUnit.hasMoved ? (this.activeUnit.speed - this.activeUnit.remainingMovement) : 0);
        markers.movementRangeRadius = Math.max(0, remainingRush);
        markers.movementRangeColor = 0xffb74d; // Distinct gold/amber ring for Rush
      } else {
        markers.movementRangeRadius = this.activeUnit.remainingMovement ?? this.activeUnit.speed;
        markers.movementRangeColor = undefined; // Default cyan for Advance move
      }

      const alive = this.activeAliveSquadModels;
      if (alive.length > 1 && this.flow.mode === 'targeting') {
        const currentModel = this.selectedSquadModel;
        if (currentModel) {
          markers.movementRangePosition = currentModel.position ?? this.activeUnit.position;
        }
        if (this.stagedSquadModelPositions.size > 0) {
          markers.squadCoherency = {
            positions: Array.from(this.stagedSquadModelPositions.values()),
            radius: 2.0,
          };
        }
      }

      if (this.movePathPreview && this.movePathPreview.length >= 2) {
        markers.movePath = {
          from: this.movePathPreview[0],
          to: this.movePathPreview[this.movePathPreview.length - 1],
          waypoints: this.movePathPreview,
          isMeleeContact: !!this.hoveredEngagedTargetId,
          color: this.movePreviewDifficult ? 0xffa726 : undefined,
        };
      } else if (this.movePreview) {
        markers.movePath = {
          from: { ...this.activeUnit.position },
          to: { ...this.movePreview },
        };
      }
    } else if (
      this.flow.mode === 'targeting' &&
      this.flow.action === 'charge' &&
      this.activeUnit &&
      this.movePathPreview &&
      this.movePathPreview.length >= 2
    ) {
      markers.movePath = {
        from: this.movePathPreview[0],
        to: this.movePathPreview[this.movePathPreview.length - 1],
        waypoints: this.movePathPreview,
        isMeleeContact: true,
      };
    }

    for (const handler of this.markerHandlers) {
      handler(markers);
    }
  }

  private actionMaxRange(unit: Unit, action: 'shoot' | 'charge' | 'fight'): number {
    if (action === 'shoot') {
      return Math.max(
        ...unit.weapons
          .filter((w) => w.isEquipped && w.profile.type === 'ranged')
          .map((w) => w.profile.range),
        0
      );
    }
    if (action === 'charge') {
      // Charge moves up to double speed (12") to reach engagement range of target.
      return unit.speed * 2;
    }
    return 1.5;
  }

  /** All living enemy units within max range and Line of Sight of the given action. */
  private reachableEnemies(unit: Unit, action: 'shoot' | 'charge' | 'fight'): Unit[] {
    if (!this.state) return [];
    const limit = this.actionMaxRange(unit, action);
    return this.state.units.filter((candidate) => {
      if (candidate.ownerId === this.localPlayerId || candidate.isDestroyed) return false;
      const distance = Math.hypot(
        candidate.position.x - unit.position.x,
        candidate.position.z - unit.position.z
      );
      if (distance > limit + 0.01) return false;
      if (action === 'shoot') {
        const weaponToCheck = this.selectedShootWeaponId
          ? unit.weapons.find((w) => w.id === this.selectedShootWeaponId)
          : null;
        if (weaponToCheck && weaponToCheck.profile.type === 'ranged') {
          if (distance > weaponToCheck.profile.range + 0.01) return false;
          if (hasTrait(weaponToCheck.profile.specialRules, 'lobbed')) return true;
          return hasLineOfSight(this.state!, unit, candidate);
        }
        const rangedWeapons = unit.weapons.filter((w) => w.isEquipped && w.profile.type === 'ranged');
        return rangedWeapons.some((w) => {
          if (distance > w.profile.range + 0.01) return false;
          if (hasTrait(w.profile.specialRules, 'lobbed')) return true;
          return hasLineOfSight(this.state!, unit, candidate);
        });
      }
      if (action === 'charge') {
        // Verify pathfinder reaches within engagement range under double speed
        const dx = unit.position.x - candidate.position.x;
        const dz = unit.position.z - candidate.position.z;
        const len = Math.hypot(dx, dz) || 1;
        const contactTarget = {
          x: candidate.position.x + (dx / len) * 0.9,
          y: 0,
          z: candidate.position.z + (dz / len) * 0.9,
        };
        const path = findNavPath(this.state!, unit, contactTarget, unit.speed * 2, {
          ignoreUnitId: candidate.id,
        });
        const end = path[path.length - 1];
        const distToEnd = Math.hypot(end.x - candidate.position.x, end.z - candidate.position.z);
        return distToEnd <= 1.25 && pathLength(path) <= unit.speed * 2 + 0.01;
      }
      return true;
    });
  }

  // --- styles -------------------------------------------------------------

  private static stylesInjected = false;

  private static ensureStyles(): void {
    if (GameHUD.stylesInjected) return;
    GameHUD.stylesInjected = true;

    const style = document.createElement('style');
    style.id = 'sl-hud-styles';
    style.textContent = `
.sl-hud { position: fixed; inset: 0; pointer-events: none; z-index: 5;
  font-family: system-ui, sans-serif; color: #eee; }
.sl-hud-header { position: absolute; top: 0; left: 0; right: 0; height: 44px;
  display: flex; align-items: center; gap: 16px; padding: 0 16px;
  background: rgba(10, 12, 16, 0.82); border-bottom: 1px solid #2a2f3a; }
.sl-hud-title { font-weight: 700; letter-spacing: 0.5px; }
.sl-hud-round { color: #ffd54f; font-weight: 600; }
.sl-hud-objectives-score { display: flex; align-items: center; gap: 6px; font-size: 13px; color: #b0bec5; margin-left: 4px; padding-left: 12px; border-left: 1px solid #37474f; }
.sl-hud-turn.mine { color: #69f0ae; font-weight: 600; }
.sl-hud-turn.theirs { color: #ff8a65; }
.sl-hud-room { margin-left: auto; font-family: monospace; font-size: 13px;
  font-weight: 700; color: #90caf9; background: #1a2330; border: 1px solid #2e3f52;
  padding: 3px 10px; border-radius: 5px; letter-spacing: 1px; pointer-events: auto;
  user-select: all; }
.sl-hud-panel { position: absolute; pointer-events: auto; background: rgba(10, 12, 16, 0.82);
  border: 1px solid #2a2f3a; border-radius: 8px; padding: 10px; min-width: 220px; }
.sl-hud-panel h3 { margin: 2px 0 8px; font-size: 12px; text-transform: uppercase;
  letter-spacing: 1px; color: #90caf9; }
.sl-hud-alerts { position: absolute; top: 48px; left: 0; right: 0; display: flex; flex-direction: column; align-items: center; pointer-events: none; z-index: 100; }
.sl-hud-alert { padding: 8px 24px; font-weight: 600; font-size: 13px; text-align: center; width: 100%; box-shadow: 0 2px 10px rgba(0,0,0,0.5); }
.sl-hud-alert-error { background: #b71c1c; color: #fff; }
.sl-hud-alert-warn { background: #e65100; color: #fff; }
.sl-trait-badge { cursor: help; border-bottom: 1px dotted #90a4ae; }
.sl-hud-units { top: 60px; left: 12px; max-width: 290px; max-height: 75vh; overflow-y: auto; }
.sl-hud-side { top: 60px; right: 12px; width: 270px; max-height: 60vh; overflow-y: auto; }
.sl-hud-unit { padding: 6px 8px; margin-bottom: 4px; border-radius: 6px; background: #1a1f29;
  display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.sl-hud-unit.team-blue { background: #162436; border-left: 3px solid #29b6f6; }
.sl-hud-unit.team-red { background: #26161b; border-left: 3px solid #ef5350; }
.sl-hud-unit.team-blue:hover { background: #1c3048; }
.sl-hud-unit.team-red:hover { background: #351e24; }
.sl-hud-unit.activatable { cursor: pointer; outline: 1px solid #69f0ae; }
.sl-hud-unit.activatable:hover { background: #213028; }
.sl-hud-unit.deployable { cursor: pointer; outline: 1px dashed #ffd54f; }
.sl-hud-unit.deployable:hover { background: #332b1a; }
.sl-hud-unit.deploy-selected { outline: 2px solid #ffd54f; background: #3d3215 !important; }
.sl-hud-unit.enemy { cursor: pointer; }
.sl-hud-unit.active { outline: 2px solid #69f0ae; }
.sl-hud-unit.destroyed { opacity: 0.35; text-decoration: line-through; }
.sl-hud-unit-name { font-weight: 600; }
.sl-hud-unit-stats { font-size: 11px; color: #b0bec5; }
.sl-hud-unit-weapons { font-size: 10px; color: #90caf9; width: 100%; }
.sl-hud-unit-tags { font-size: 10px; color: #ff8a65; }
.sl-hud-bottom-dock { position: absolute; bottom: 16px; left: 50%; transform: translateX(-50%);
  display: flex; flex-direction: column; align-items: center; gap: 8px; max-width: 88vw; }
.sl-hud-datacard { pointer-events: auto; background: rgba(12, 15, 22, 0.92);
  border: 1px solid #37474f; border-radius: 10px; padding: 8px 14px; min-width: 440px; }
.sl-hud-datacard.mine { border-color: #29b6f6; }
.sl-hud-datacard.enemy { border-color: #ef5350; }
.sl-hud-datacard.contested { border-color: #ff9800; }
.sl-hud-datacard.neutral { border-color: #ffd54f; }
.sl-hud-datacard.team-blue { border-color: #29b6f6; }
.sl-hud-datacard.team-blue .sl-hud-datacard-meta { color: #90caf9; }
.sl-hud-datacard.team-red { border-color: #ef5350; }
.sl-hud-datacard.team-red .sl-hud-datacard-meta { color: #ef9a9a; }
.sl-hud-datacard.sl-hud-terrain-debug { border-color: #00e5ff; margin-bottom: 6px; }
.sl-hud-datacard.sl-hud-terrain-debug code { color: #ffd54f; font-size: 11px; }
.sl-hud-datacard-header { display: flex; align-items: center; gap: 10px; margin-bottom: 6px;
  border-bottom: 1px solid #263238; padding-bottom: 4px; }
.sl-hud-datacard-name { font-weight: 700; font-size: 14px; color: #fff; }
.sl-hud-datacard-meta { font-size: 11px; color: #90caf9; text-transform: capitalize; }
.sl-hud-datacard-tags { margin-left: auto; font-size: 10px; color: #ffd54f; font-weight: 600; }
.sl-hud-datacard-tables { display: flex; gap: 14px; align-items: flex-start; }
.sl-hud-table { border-collapse: collapse; font-size: 11px; }
.sl-hud-table th { text-align: left; color: #90a4ae; font-weight: 600; padding: 2px 8px 2px 0;
  border-bottom: 1px solid #263238; text-transform: uppercase; font-size: 10px; }
.sl-hud-table td { padding: 3px 10px 2px 0; color: #eceff1; font-weight: 500; }
.sl-hud-bottom { pointer-events: auto; display: flex; align-items: center; gap: 10px;
  background: rgba(10, 12, 16, 0.88); border: 1px solid #2a2f3a; border-radius: 10px;
  padding: 10px 16px; }
.sl-hud-btn { pointer-events: auto; background: #263238; color: #eee; border: 1px solid #37474f;
  border-radius: 6px; padding: 6px 14px; cursor: pointer; font-size: 13px; }
.sl-hud-btn:hover:not([disabled]) { background: #37474f; }
.sl-hud-btn[disabled] { opacity: 0.4; cursor: default; }
.sl-hud-btn.primary { background: #2e7d32; border-color: #43a047; font-weight: 600; }
.sl-hud-btn.primary:hover { background: #43a047; }
.sl-hud-btn.danger { background: #b71c1c; border-color: #d32f2f; font-weight: 600; }
.sl-hud-btn.danger:hover { background: #d32f2f; }
.sl-hud-reaction { flex-direction: column; align-items: stretch; gap: 8px; min-width: 440px; border-color: #ffd54f; background: rgba(18, 22, 30, 0.94); box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5); }
.sl-hud-reaction-header { display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #37474f; padding-bottom: 4px; }
.sl-hud-reaction-title { font-weight: 700; font-size: 14px; color: #ffd54f; text-transform: uppercase; letter-spacing: 0.5px; }
.sl-hud-reaction-timer { font-family: monospace; font-size: 13px; font-weight: 700; color: #ffab40; background: #263238; padding: 2px 8px; border-radius: 4px; border: 1px solid #455a64; }
.sl-hud-reaction-desc { font-size: 13px; color: #eceff1; }
.sl-hud-reaction-warning { font-size: 11px; color: #ff8a65; font-style: italic; }
.sl-hud-reaction-actions { display: flex; gap: 10px; justify-content: flex-end; margin-top: 4px; }
.sl-hud-reaction-waiting { border-color: #ffd54f; }
.sl-hud-hint { color: #b0bec5; }
.sl-hud-active-name { font-weight: 700; color: #69f0ae; margin-right: 8px; }
.sl-hud-confirm-summary { color: #fff; margin-right: 8px; }
.sl-hud-dice-title { font-size: 12px; color: #90caf9; margin-bottom: 4px; font-weight: 600; }
.sl-hud-dice-label { font-size: 11px; color: #b0bec5; margin: 4px 0 2px; }
.sl-hud-dice-row { display: flex; gap: 4px; margin-bottom: 4px; flex-wrap: wrap; }
.sl-die { display: inline-flex; align-items: center; justify-content: center; width: 24px;
  height: 24px; border-radius: 4px; background: #37474f; font-weight: 700; font-size: 13px; }
.sl-die.hit-pass { background: #2e7d32; border: 1px solid #66bb6a; color: #fff; }
.sl-die.hit-miss { background: #263238; color: #78909c; opacity: 0.65; }
.sl-die.def-pass { background: #1565c0; border: 1px solid #42a5f5; color: #fff; }
.sl-die.def-fail { background: #c62828; border: 1px solid #ef5350; color: #fff; }
.sl-hud-dice-summary { font-size: 12px; color: #b0bec5; margin-top: 4px; }
.sl-hud-dice-empty, .sl-hud-log-empty { color: #607d8b; font-size: 12px; }
.sl-hud-log-entry { font-size: 12px; color: #b0bec5; padding: 2px 0; }
.sl-hud-toast { position: absolute; top: 56px; left: 50%; transform: translateX(-50%);
  background: #263238; color: #ffd54f; border: 1px solid #4f5b62; border-radius: 8px;
  padding: 8px 16px; font-size: 13px; pointer-events: none; }
.sl-hud-gameover { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
  pointer-events: auto; background: rgba(10, 12, 16, 0.94); border: 2px solid #ffd54f;
  border-radius: 12px; padding: 24px 36px; text-align: center; box-shadow: 0 12px 32px rgba(0,0,0,0.6); }
.sl-hud-gameover h2 { margin: 0 0 8px; font-size: 28px; color: #ffd54f; }
.sl-hud-gameover p { margin: 0 0 18px; color: #b0bec5; }
.sl-hud-shoot-dock { display: flex; flex-direction: column; align-items: center; gap: 8px; }
.sl-hud-chips-bar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: center; }
.sl-hud-weapon-chip { pointer-events: auto; display: flex; align-items: center; gap: 6px; background: #1e2633; color: #cfd8dc; border: 1px solid #37474f; border-radius: 6px; padding: 5px 12px; cursor: pointer; font-size: 12px; transition: all 0.15s ease; }
.sl-hud-weapon-chip:hover { background: #2a374a; border-color: #607d8b; }
.sl-hud-weapon-chip.selected { background: #1a365d; border-color: #42a5f5; color: #fff; box-shadow: 0 0 8px rgba(66, 165, 245, 0.4); }
.sl-hud-weapon-chip.assigned { border-color: #43a047; }
.sl-chip-weapon-name { font-weight: 600; color: #90caf9; }
.sl-chip-target { font-size: 11px; color: #ffd54f; }
.sl-chip-target.unassigned { color: #90a4ae; font-style: italic; }
`;
    document.head.appendChild(style);
  }
}
