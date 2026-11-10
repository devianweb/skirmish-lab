import {
  boardDistance,
  ChargeState,
  CombatModifierBreakdown,
  computeCombatModifiers,
  computeShootingRayDebug,
  computeSquadShootingRayDebug,
  squadAim,
  computeSquadCentroid,
  createAction,
  describeTerrainPiece,
  PUSH_CONFIRM_CHOICE,
  PUSH_DECLINE_CHOICE,
  PUSH_RANGE,
  planPush,
  describeTrait,
  MeleeResultRecord,
  MoraleTestRecord,
  BlastSplashOutcome,
  BlastSplitRecord,
  classifySegment,
  findNavPath,
  JumpOption,
  planFollowerCrossing,
  findTerrainAtPosition,
  formatTraitLabel,
  GameState,
  GameAction,
  getDeployableUnits,
  getDeploymentZoneBounds,
  getEffectiveMaxMovement,
  getUnitTough,
  hasTrait,
  isPathDangerous,
  isPathDifficult,
  isUnitInObjectiveRange,
  Model,
  Objective,
  OBJECTIVE_CONTROL_MAX_VERTICAL,
  OBJECTIVE_CONTROL_RADIUS,
  pathLength,
  pathMovementCost,
  describeDrop,
  ShootingRayDebugInfo,
  Unit,
  validateDeploymentPosition,
  validateSquadCoherency,
  isRegroupingMove,
  SQUAD_COHERENCY_SPREAD,
  SQUAD_COHERENCY_SPREAD_EDGE,
  baseRadius,
  markerGap,
  modelGap,
  unitDistance,
  validateAction,
  pointEngagesUnit,
  chargeContact,
  chargeDestination,
  CHARGE_END_EDGE_GAP,
  MELEE_STRIKE_EDGE_GAP,
  edgeGapToCentre,
  livingModelPositions,
  MELEE_MAX_VERTICAL_REACH,
  firingModels,
  ignoresSight,
  targetCoverByMajority,
  ENGAGEMENT_EDGE_GAP,
  Vector3,
  Weapon,
  modelRemainingMovement,
  closestApproach,
  PILE_IN_DISTANCE,
  autoPickCasualties,
  PendingReaction,
  summarizeMatch,
  MAX_ROUNDS,
} from '@skirmish-lab/shared';
import {
  PreviewSegment,
  describePathSegments,
  jumpChip,
  resolveMoveTarget,
  tooWideText,
  type MoveTarget,
  segmentSummary,
} from './movePreview';
import { rushStopReason, rushStopText } from './rushStop';
import { soundFx } from '../audio/SoundFx';
import {
  DeploymentZoneBounds,
  DeploymentZoneMarker,
  MovePathMarker,
  AimLinesMarker,
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
  aimLines?: AimLinesMarker | null;
  engagedTargetId?: string | null;
  hoveredTerrainId?: string | null;
  outcome: { position: Vector3; wounds: number } | null;
  debugActive?: boolean;
  shootingDebugRay?: ShootingRayDebugInfo | null;
  deploymentZones?: DeploymentZoneMarker | null;
  squadCoherency?: { positions: Vector3[]; radius: number } | null;
  /** Floor positions of the models picked as casualties (highlighted). */
  casualtyPicks?: Vector3[] | null;
}

export type PickTarget =
  | { kind: 'unit'; unitId: string; modelId?: string }
  | { kind: 'position'; position: Vector3; terrainId?: string };

/** What the pile-in prompt works from (see GameHUD.pileInContext). */
interface PileInContext {
  pending: PendingReaction;
  defender: Unit;
  charger: Unit;
  alive: Model[];
  modelIds: string[];
  maxDistance: number;
}

/** What the push prompt works from (see GameHUD.pushContext). */
interface PushContext {
  pending: PendingReaction;
  shaken: Unit;
  attacker: Unit;
  alive: Model[];
}

/** What the casualty-pick prompt works from (see GameHUD.casualtyContext). */
interface CasualtyContext {
  pending: PendingReaction;
  unit: Unit;
  alive: Model[];
  count: number;
}

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
  /** Model of the hovered unit the cursor is over (squads); drives the "aimed at" highlight. */
  private hoveredModelId: string | null = null;
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
  /**
   * Hover-only memo of `findNavPath` results. The pathfinder costs tens of milliseconds, mouse moves arrive far
   * faster than that, and a squad charge leg with a jump preview repeated it on every pixel of movement (owner
   * report: frame rate drops when jumping and charging). Keyed by state object, unit, start, budget, options and
   * the cursor on a 0.1" grid; cleared whenever the state object changes. Clicks never use it.
   */
  private hoverNavMemo = new Map<string, Vector3[]>();
  private hoverNavMemoState: GameState | null = null;
  /** Clamped move destination previewed under the cursor during move targeting. */
  private movePreview: Vector3 | null = null;
  /** Multi-segment waypoints previewed under cursor during move / rush / charge. */
  private movePathPreview: Vector3[] | null = null;
  /** Whether the currently previewed path encounters Difficult Terrain or vertical climb. */
  private movePreviewDifficult = false;
  private readonly rushStopTexts = (['height', 'budget', 'difficult'] as const).map(rushStopText);
  /** The declared jump/fall the engine offers for the previewed target (null: safe path preview). */
  private moveJump: JumpOption | null = null;
  /** Set while hovering across a gap over the 6" jump limit (hint only; nothing is offered). */
  private moveTooWide: { distance: number } | null = null;
  /** Engine classification of each leg of the previewed path (for styling and labels). */
  private moveSegments: PreviewSegment[] | null = null;
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
  /** Jumps/falls declared for individual squad models while staging (model id -> the declared leap). */
  private stagedSquadModelTraversals: Map<string, JumpOption> = new Map();
  /** Squad models that could not be routed to the leader's crossing (model id -> why), shown on their chip. */
  private squadBlockedModels: Map<string, string> = new Map();
  /** The squad model the player declared the jump with (its crossing sizes the roll; it falls on a failure). */
  private squadJumpLeaderId: string | null = null;
  /** ID of the squad model currently selected for placement */
  private selectedSquadModelId: string | null = null;
  /** Defender pile-in staging: spots and walks chosen so far (model id -> value), for one pending reaction. */
  private pileInStaged: Map<string, Vector3> = new Map();
  private pileInPaths: Map<string, Vector3[]> = new Map();
  private pileInSelectedId: string | null = null;
  private pileInReactionId: string | null = null;
  /** Push prompt (attacker): Confirm pressed, the model picked, the spot staged, and what the host will make of it. */
  private pushReactionId: string | null = null;
  private pushPicking = false;
  private pushModelId: string | null = null;
  private pushStaged: Vector3 | null = null;
  private pushNote: { text: string; ok: boolean } | null = null;
  private casualtyPicked: string[] = [];
  private casualtyReactionId: string | null = null;
  private markerHandlers: Array<(markers: MarkerSnapshot) => void> = [];
  /** Log index already reflected (used for transient wound tokens). */
  private lastSeenLogIndex = 0;
  private lastRoundNumber: number | null = null;
  private toast: string | null = null;
  /** Concede confirmation dialog is open. */
  private concedeConfirmOpen = false;
  /** A concede was sent and we are waiting for the host's confirmed state. */
  private concedePending = false;
  /** Play Again was pressed and the host has not confirmed it yet. */
  private rematchPending = false;
  private concedeTimer: ReturnType<typeof setTimeout> | null = null;
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
    this.clearConcedeTimer();
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
    const newMatch = this.state !== null && this.state.gameId !== state.gameId;
    if (newMatch) this.resetForNewMatch();
    const prevRound = this.lastRoundNumber;
    this.lastRoundNumber = state.turnState.roundNumber;
    this.state = state;
    if (newMatch) this.showToast('Rematch started — same armies, same map');
    if (state.status === 'game-over') {
      this.concedeConfirmOpen = false;
      this.concedePending = false;
      this.clearConcedeTimer();
    }
    if (this.flow.mode === 'waiting') {
      // Our action resolved into a new state — resume interacting.
      this.flow = { mode: 'idle' };
    }
    this.movePreview = null;
    this.movePathPreview = null;
    this.moveJump = null;
    this.moveSegments = null;
    this.hoveredEngagedTargetId = null;
    // A declared charge can't be undone: keep the player in the charge legs flow
    if (this.flow.mode === 'idle' && this.declaredCharge && this.myTurn) {
      this.flow = { mode: 'targeting', action: 'charge' };
    }
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

  /** A different gameId means a rematch: drop every piece of per-match local state. */
  private resetForNewMatch(): void {
    this.flow = { mode: 'idle' };
    this.selectedUnitId = null;
    this.selectedDeployUnitId = null;
    this.hoveredUnitId = null;
    this.hoveredModelId = null;
    this.lastHoveredObjectiveId = null;
    this.hoveredGroundPosition = null;
    this.hoveredAction = null;
    this.movePreview = null;
    this.movePathPreview = null;
    this.movePreviewDifficult = false;
    this.moveJump = null;
    this.moveTooWide = null;
    this.moveSegments = null;
    this.hoveredEngagedTargetId = null;
    this.selectedCasualtyModelId = null;
    this.shootAllocations.clear();
    this.selectedShootWeaponId = null;
    this.stagedSquadModelPositions.clear();
    this.stagedSquadModelPaths.clear();
    this.stagedSquadModelTraversals.clear();
    this.squadBlockedModels.clear();
    this.squadJumpLeaderId = null;
    this.selectedSquadModelId = null;
    this.pileInStaged.clear();
    this.pileInPaths.clear();
    this.pileInSelectedId = null;
    this.pileInReactionId = null;
    this.resetPushState(null);
    this.casualtyPicked = [];
    this.casualtyReactionId = null;
    this.lastSeenLogIndex = 0;
    this.lastRoundNumber = null;
    this.prevCurrentPlayerId = null;
    this.prevPendingReactionId = null;
    this.reactionReceivedAt = null;
    this.concedeConfirmOpen = false;
    this.concedePending = false;
    this.clearConcedeTimer();
    this.rematchPending = false;
    this.toast = null;
    if (this.toastTimer) {
      clearTimeout(this.toastTimer);
      this.toastTimer = null;
    }
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
            const distance = pathMovementCost(this.state!, path, victor);
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

    const casualties = this.casualtyContext();
    if (casualties) {
      if (target.kind === 'unit' && target.unitId === casualties.unit.id && target.modelId) {
        this.toggleCasualtyModel(target.modelId);
      }
      return;
    }

    const pushing = this.pushContext();
    if (pushing) {
      if (!this.pushPicking) return;
      if (target.kind === 'unit' && target.unitId === pushing.shaken.id && target.modelId) {
        this.selectPushModel(target.modelId);
      } else if (target.kind === 'position') {
        this.stagePushSpot(target.position);
      }
      return;
    }

    const pileIn = this.pileInContext();
    if (pileIn) {
      if (target.kind === 'unit' && target.unitId === pileIn.defender.id && target.modelId) {
        this.selectPileInModel(target.modelId);
      } else if (target.kind === 'unit' && target.unitId === pileIn.charger.id) {
        this.placePileInContact(target.modelId);
      } else if (target.kind === 'position') {
        this.placePileInModel(target.position);
      }
      return;
    }

    if (this.isSquadChargeFlow && this.activeUnit && this.declaredCharge) {
      const declared = this.declaredCharge;
      if (target.kind === 'unit' && target.unitId === this.activeUnit.id && target.modelId) {
        this.selectSquadModel(target.modelId);
        return;
      }
      if (target.kind === 'unit' && target.unitId === declared.targetId) {
        // Clicking the target moves the selected model into base contact with it
        const enemy = this.state?.units.find((u) => u.id === declared.targetId);
        const model = this.selectedSquadModel;
        if (enemy && model) {
          this.handleSquadModelPick(this.contactSpotFor(model.position ?? this.activeUnit.position, enemy), 'charge');
        }
        return;
      }
      if (target.kind === 'position') {
        this.handleSquadModelPick(target.position, 'charge');
        return;
      }
      if (target.kind === 'unit') {
        this.prepareAttack(target.unitId); // another unit: explains the lock
        return;
      }
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
      } else if (target.kind === 'position' && this.flow.action === 'charge' && this.declaredCharge) {
        this.prepareChargeLeg(target.position);
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

  /** Memoised `findNavPath` for the hover preview (see `hoverNavMemo`). */
  private hoverNav(
    unit: Unit,
    cursor: Vector3,
    budget: number,
    options: Parameters<typeof findNavPath>[4] = {}
  ): Vector3[] {
    const state = this.state!;
    if (this.hoverNavMemoState !== state) {
      this.hoverNavMemo.clear();
      this.hoverNavMemoState = state;
    }
    const q = (v: number): number => Math.round(v * 10);
    const start = options.startPosition ?? unit.position;
    const key = [
      unit.id,
      q(start.x), q(start.z), q(start.y ?? 0),
      q(cursor.x), q(cursor.z), q(cursor.y ?? 0),
      Math.round(budget * 100),
      options.keepAway ? 1 : 0,
      options.stopBeforeDifficult ? 1 : 0,
      options.ignoreUnitId ?? '',
    ].join('|');
    const hit = this.hoverNavMemo.get(key);
    if (hit) return hit;
    const path = findNavPath(state, unit, cursor, budget, options);
    if (this.hoverNavMemo.size > 64) this.hoverNavMemo.clear();
    this.hoverNavMemo.set(key, path);
    return path;
  }

  /** Board hover events from GameView (for live movement path preview, target hover & terrain debug). */
  handleBoardHover(target: PickTarget | null): void {
    if (!this.state || this.state.status === 'game-over') return;
    this.moveTooWide = null;

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

    const pushHover = this.pushContext();
    if (pushHover) {
      const model = this.pushSelectedModel(pushHover);
      if (this.pushPicking && model && !this.pushStaged && target?.kind === 'position') {
        const note = this.previewPush(pushHover, model, target.position);
        this.movePathPreview = note.spot ? [model.position ?? pushHover.shaken.position, note.spot] : null;
        this.movePreview = note.spot;
        if (this.pushNote?.text !== note.text) {
          this.pushNote = { text: note.text, ok: note.ok };
          this.render();
        }
      } else if (!this.pushStaged) {
        this.movePathPreview = null;
        this.movePreview = null;
      }
      this.emitMarkers();
      return;
    }

    const pileInHover = this.pileInContext();
    if (pileInHover) {
      const model = this.pileInSelectedModel(pileInHover);
      if (model && target?.kind === 'position') {
        const path = findNavPath(this.state, pileInHover.defender, target.position, pileInHover.maxDistance, {
          keepAway: true,
          startPosition: model.position ?? pileInHover.defender.position,
          ignoreUnitId: pileInHover.charger.id,
        });
        this.movePathPreview = path.length >= 2 ? path : null;
        this.movePreview = path.length >= 2 ? path[path.length - 1] : null;
      } else {
        this.movePathPreview = null;
        this.movePreview = null;
      }
      this.emitMarkers();
      return;
    }

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
        this.moveJump = null;
        this.moveSegments = null;
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
        const remainingBudget = this.distanceLeft(active, isRush ? 'rush' : 'move', currentModel);
        const nominalMax = remainingBudget;
        const resolved = resolveMoveTarget(this.state, active, startPos, target.position, true);
        const cursor = resolved.target;
        let path = resolved.jump
          ? resolved.jump.path
          : this.hoverNav(active, cursor, nominalMax, {
              keepAway: true,
              startPosition: startPos,
              stopBeforeDifficult: isRush || !!active.isRushing,
            });

        // The planner stops a Rush just outside difficult ground on the way to the cursor (inside it, or past it)
        const pathEnd = path.length > 0 ? path[path.length - 1] : null;
        const stoppedBeforeDifficult =
          !!pathEnd &&
          boardDistance(pathEnd, cursor) > 0.1 &&
          isPathDifficult(this.state, [pathEnd, cursor], active) &&
          !isPathDifficult(this.state, path, active);

        const isElevationObstacle =
          !resolved.jump &&
          path.length > 0 && (cursor.y ?? 0) - (path[path.length - 1].y ?? 0) > 0.5;

        const stoppedAtBase =
          !resolved.jump &&
          (isRush || !!active.isRushing) &&
          path.length > 0 &&
          !hasTrait(active.specialRules, 'flying') &&
          (isElevationObstacle ||
            stoppedBeforeDifficult);

        const isDifficult =
          !resolved.jump &&
          !stoppedAtBase &&
          (path.length > 0
            ? isPathDifficult(this.state, path, active)
            : isPathDifficult(this.state, [startPos, cursor], active));

        const effectiveCap = getEffectiveMaxMovement(
          active,
          isRush || active.isRushing ? 'rush' : 'move',
          isDifficult
        );
        const cappedAllowance = Math.min(effectiveCap, remainingBudget);
        if (isDifficult && nominalMax > cappedAllowance) {
          path = this.hoverNav(active, cursor, cappedAllowance, {
            keepAway: true,
            startPosition: startPos,
            stopBeforeDifficult: isRush || !!active.isRushing,
          });
        }

        this.movePreviewDifficult = isDifficult;
        this.moveJump = resolved.jump;
        this.moveTooWide = this.tooWideHint(resolved, path);
        this.moveSegments = describePathSegments(this.state, active, path);
        this.movePathPreview = path;
        this.movePreview = path.length > 0 ? path[path.length - 1] : null;

        // Detect if move/rush destination places the fighter in melee engagement contact (base edges <= 0.5" apart, <= 1.5" vertical)
        if (this.movePreview) {
          const enemy = this.enemyUnits.find(
            (e) =>
              !e.isDestroyed &&
              pointEngagesUnit(this.movePreview!, e)
          );
          this.hoveredEngagedTargetId = enemy ? enemy.id : null;
        } else {
          this.hoveredEngagedTargetId = null;
        }
        const stopText = stoppedAtBase
          ? rushStopText(
              rushStopReason({
                heightShort: isElevationObstacle,
                pathCost: pathMovementCost(this.state, path, active),
                budget: remainingBudget,
              })
            )
          : '';
        this.updateMoveWarning(isDifficult, this.flow.action, stopText);
        this.showTraversalChip();
      } else {
        this.movePreview = null;
        this.movePathPreview = null;
        this.moveJump = null;
        this.moveSegments = null;
        this.movePreviewDifficult = false;
        this.hoveredEngagedTargetId = null;
        this.updateMoveWarning(false, this.flow.action);
      }
      if (terrainChanged) {
        this.updateDataCardSlot();
      }
      this.emitMarkers();
      return;
    }

    if (this.isSquadChargeFlow && this.activeUnit && this.declaredCharge) {
      // Preview the selected model's path (to the cursor, or into contact when hovering the target)
      const active = this.activeUnit;
      const declared = this.declaredCharge;
      const model = this.selectedSquadModel;
      const startPos = model?.position ?? active.position;
      const enemy = this.state.units.find((u) => u.id === declared.targetId);
      let cursor: Vector3 | null = null;
      let jump = null as JumpOption | null;
      let tooWide: { distance: number } | null = null;
      if (target?.kind === 'position') {
        const resolved = resolveMoveTarget(this.state, active, startPos, target.position, true);
        cursor = resolved.target;
        jump = resolved.jump;
        tooWide = resolved.tooWide;
      } else if (target?.kind === 'unit' && target.unitId === declared.targetId && enemy) {
        cursor = this.contactSpotFor(startPos, enemy);
      }
      if (cursor && model) {
        const path = jump
          ? jump.path
          : this.hoverNav(active, cursor, this.distanceLeft(active, 'charge', model), {
              ignoreUnitId: declared.targetId,
              keepAway: true,
              startPosition: startPos,
            });
        this.movePathPreview = path;
        this.movePreview = path.length > 0 ? path[path.length - 1] : null;
        this.moveJump = jump;
        this.moveTooWide = tooWide && cursor ? this.tooWideHint({ target: cursor, jump, tooWide }, path) : null;
        this.moveSegments = describePathSegments(this.state, active, path);
        this.movePreviewDifficult = !jump && path.length > 0 && isPathDifficult(this.state, path, active);
        this.hoveredEngagedTargetId = target?.kind === 'unit' ? declared.targetId : null;
        this.updateMoveWarning(this.movePreviewDifficult, 'charge');
        this.showTraversalChip();
      } else {
        this.movePathPreview = null;
        this.movePreview = null;
        this.moveJump = null;
        this.moveSegments = null;
        this.hoveredEngagedTargetId = null;
        this.updateMoveWarning(false, 'charge');
      }
      this.emitMarkers();
      return;
    }

    if (this.flow.mode === 'targeting' && this.flow.action === 'charge') {
      const active = this.activeUnit;
      const declared = this.declaredCharge;
      const budget = active ? (declared ? active.remainingMovement : active.speed * 2) : 0;
      const targetUnitId = target?.kind === 'unit' ? target.unitId : null;
      const enemy = targetUnitId
        ? this.state.units.find((u) => u.id === targetUnitId && u.ownerId !== this.localPlayerId && !u.isDestroyed)
        : null;

      if (active && enemy && (!declared || enemy.id === declared.targetId) && this.activeAliveSquadModels.length <= 1) {
        const contactTarget = chargeDestination(active, enemy);
        const path = this.hoverNav(active, contactTarget, budget, {
          ignoreUnitId: enemy.id,
          keepAway: true,
        });
        const isDifficult = path.length > 0 && isPathDifficult(this.state, path, active);
        this.movePreviewDifficult = isDifficult;
        this.movePathPreview = path;
        this.movePreview = path.length > 0 ? path[path.length - 1] : null;
        this.moveJump = null;
        this.moveSegments = null;
        this.hoveredEngagedTargetId = enemy.id;
        this.updateMoveWarning(isDifficult, this.flow.action);
      } else if (active && declared && target?.kind === 'position') {
        // A leg: walk toward the cursor, or declare a jump when standing at an edge (same as a move)
        const resolved = resolveMoveTarget(this.state, active, active.position, target.position, true);
        const path = resolved.jump
          ? resolved.jump.path
          : this.hoverNav(active, resolved.target, budget, {
              ignoreUnitId: declared.targetId,
              keepAway: true,
            });
        const isDifficult = !resolved.jump && path.length > 0 && isPathDifficult(this.state, path, active);
        this.movePreviewDifficult = isDifficult;
        this.moveJump = resolved.jump;
        this.moveTooWide = this.tooWideHint(resolved, path);
        this.moveSegments = describePathSegments(this.state, active, path);
        this.movePathPreview = path;
        this.movePreview = path.length > 0 ? path[path.length - 1] : null;
        this.hoveredEngagedTargetId = null;
        this.updateMoveWarning(isDifficult, this.flow.action);
        this.showTraversalChip();
        this.emitMarkers();
        return;
      } else {
        this.movePathPreview = null;
        this.moveJump = null;
        this.moveSegments = null;
        this.movePreview = null;
        this.movePreviewDifficult = false;
        this.hoveredEngagedTargetId = null;
        this.updateMoveWarning(false, this.flow.action);
      }
    }

    const nextHover = target?.kind === 'unit' ? target.unitId : null;
    const nextHoverModel = target?.kind === 'unit' ? target.modelId ?? null : null;
    const modelChanged = nextHoverModel !== this.hoveredModelId;
    this.hoveredModelId = nextHoverModel;
    const nextObjective = this.inspectedObjective;
    const objectiveChanged = nextObjective?.id !== this.lastHoveredObjectiveId;
    this.lastHoveredObjectiveId = nextObjective?.id ?? null;

    if (
      nextHover !== this.hoveredUnitId ||
      modelChanged ||
      terrainChanged ||
      objectiveChanged ||
      (this.terrainDebugEnabled && groundPosChanged)
    ) {
      this.hoveredUnitId = nextHover;
      this.updateDataCardSlot();
      this.updateAimChip();
      this.emitMarkers();
    }
  }

  /** Surface an action rejection (from the host) to the player. */
  notifyRejected(reason: string): void {
    if (this.concedePending) {
      this.concedePending = false;
      this.clearConcedeTimer();
    }
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
    this.clearConcedeTimer();
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

  /** The local player's declared (in-progress) charge on the active unit, if any. */
  private get declaredCharge(): ChargeState | null {
    const charge = this.state?.turnState.charge;
    const active = this.activeUnit;
    return charge && active && charge.unitId === active.id && active.ownerId === this.localPlayerId ? charge : null;
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

  /** True while a multi-model squad stages the models of its declared charge (each model is placed in turn). */
  private get isSquadChargeFlow(): boolean {
    return (
      this.flow.mode === 'targeting' &&
      this.flow.action === 'charge' &&
      !!this.declaredCharge &&
      this.activeAliveSquadModels.length > 1
    );
  }

  /** Where a model at `from` would stand in base contact with the nearest model of `target`. */
  private contactSpotFor(from: Vector3, target: Unit): Vector3 {
    const models = livingModelPositions(target);
    let nearest = models[0] ?? target.position;
    let best = Infinity;
    for (const m of models) {
      const d = boardDistance(from, m);
      if (d < best) {
        best = d;
        nearest = m;
      }
    }
    const dx = from.x - nearest.x;
    const dz = from.z - nearest.z;
    const len = Math.hypot(dx, dz) || 1;
    const contact = edgeGapToCentre(0);
    return {
      x: Math.round((nearest.x + (dx / len) * contact) * 100) / 100,
      y: nearest.y ?? 0,
      z: Math.round((nearest.z + (dz / len) * contact) * 100) / 100,
    };
  }

  /**
   * How far the unit can still walk in this action. For a squad, pass the model to get that model's own
   * distance (what it has walked in earlier legs counts, a squad-mate's walk does not).
   */
  private distanceLeft(active: Unit, kind: 'move' | 'rush' | 'charge', model: Model | null = null): number {
    const unitLeft =
      kind === 'charge'
        ? (this.declaredCharge ? active.remainingMovement : active.speed * 2)
        : kind === 'rush'
        ? (active.isRushing ? active.remainingMovement : active.speed * 2)
        : (active.isRushing ? active.remainingMovement : Math.min(active.speed, active.remainingMovement ?? active.speed));
    return model ? modelRemainingMovement(active, model, unitLeft) : unitLeft;
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
    this.moveJump = null;
    this.moveSegments = null;
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
    if (unit.status.includes('shaken')) {
      // A Shaken unit may only spend its activation idle, which clears Shaken
      this.beginConfirmation(
        createAction(this.localPlayerId, 'hold', {
          type: 'hold',
          unitId: unit.id,
        }),
        `End activation with ${unit.name} (idle: clears Shaken)`
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
    this.moveJump = null;
    this.moveSegments = null;
    this.hoveredEngagedTargetId = null;
    this.stagedSquadModelPositions.clear();
    this.stagedSquadModelPaths.clear();
    this.stagedSquadModelTraversals.clear();
    this.squadBlockedModels.clear();
    this.squadJumpLeaderId = null;
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

  // --- casualty picks -------------------------------------------------------

  /** The pending casualty pick when the local player owns the damaged unit, else null. */
  private casualtyContext(): CasualtyContext | null {
    const pending = this.state?.turnState.pendingReaction;
    if (!this.state || !pending || pending.type !== 'pick-casualties' || pending.promptingPlayerId !== this.localPlayerId) {
      return null;
    }
    const unit = this.state.units.find((u) => u.id === pending.data?.entry?.unitId);
    if (!unit) return null;
    if (this.casualtyReactionId !== pending.id) {
      this.casualtyReactionId = pending.id;
      this.casualtyPicked = [];
    }
    return {
      pending,
      unit,
      alive: (unit.models ?? []).filter((m) => !m.isDestroyed),
      count: pending.data?.entry?.count ?? 0,
    };
  }

  private toggleCasualtyModel(modelId: string): void {
    const ctx = this.casualtyContext();
    if (!ctx || !ctx.alive.some((m) => m.id === modelId)) return;
    if (this.casualtyPicked.includes(modelId)) {
      this.casualtyPicked = this.casualtyPicked.filter((id) => id !== modelId);
    } else if (this.casualtyPicked.length >= ctx.count) {
      this.showToast(`Already ${ctx.count} chosen: unpick one first`);
      return;
    } else {
      this.casualtyPicked = [...this.casualtyPicked, modelId];
    }
    this.render();
    this.emitMarkers();
  }

  private autoPickCasualtyModels(): void {
    const ctx = this.casualtyContext();
    if (!ctx) return;
    this.casualtyPicked = autoPickCasualties(ctx.unit, ctx.count);
    this.render();
    this.emitMarkers();
  }

  private confirmCasualties(): void {
    const ctx = this.casualtyContext();
    if (!ctx || !this.state) return;
    const action = createAction(this.localPlayerId, 'pick-casualties', {
      type: 'pick-casualties',
      unitId: ctx.unit.id,
      modelIds: [...this.casualtyPicked],
    });
    const check = validateAction(this.state, action);
    if (!check.valid) {
      this.showToast(check.reason ?? 'Those casualties are not allowed');
      return;
    }
    this.flow = { mode: 'waiting' };
    this.render();
    this.controller.submitAction(action);
  }

  /** True when taking `removed` out of a coherent unit would leave it broken (a note only, never blocks). */
  private casualtySplits(ctx: CasualtyContext, removed: string[]): boolean {
    const spot = (m: Model) => m.position ?? ctx.unit.position;
    if (ctx.alive.length < 2 || !validateSquadCoherency(ctx.alive.map(spot)).coherent) return false;
    const rest = ctx.alive.filter((m) => !removed.includes(m.id)).map(spot);
    return rest.length > 1 && !validateSquadCoherency(rest).coherent;
  }

  private casualtyPromptHtml(ctx: CasualtyContext, remainingSec: number, dataCardSlot: string): string {
    const chips = ctx.alive
      .map((m, idx) => {
        const picked = this.casualtyPicked.includes(m.id);
        const removal = picked ? this.casualtyPicked : [...this.casualtyPicked, m.id];
        const splits = this.casualtySplits(ctx, removal);
        return `<button class="sl-hud-btn sl-hud-chip ${picked ? 'active' : ''}" data-action="toggle-casualty-model" data-model-id="${m.id}" style="${
          picked ? 'background: #ff9800; color: #000; font-weight: bold;' : ''
        }">${picked ? '✕ ' : ''}${m.name ?? `Model ${idx + 1}`} (${m.wounds}W)${
          splits ? ' <span style="font-size: 10px; opacity: 0.8;">· splits the squad</span>' : ''
        }</button>`;
      })
      .join('');
    const ready = this.casualtyPicked.length === ctx.count;
    return `
      <div class="sl-hud-bottom-dock">
        ${dataCardSlot}
        <div class="sl-hud-bottom sl-hud-reaction" style="display: flex; flex-direction: column; align-items: center; gap: 6px;">
          <div class="sl-hud-reaction-header">
            <span class="sl-hud-reaction-title">Remove ${ctx.count} model${ctx.count === 1 ? '' : 's'} from ${ctx.unit.name}</span>
            <span class="sl-hud-reaction-timer">${remainingSec}s</span>
          </div>
          <div class="sl-hud-reaction-desc">Choose the casualties (${this.casualtyPicked.length}/${ctx.count}): click a model on the board or a button below. Any model may be picked, even one the enemy cannot see.</div>
          <div class="sl-hud-squad-chips" style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap; justify-content: center;">
            ${chips}
          </div>
          <div class="sl-hud-reaction-actions">
            <button class="sl-hud-btn" data-action="auto-pick-casualties">Auto pick</button>
            <button class="sl-hud-btn primary" data-action="confirm-casualties" ${ready ? '' : 'disabled'}>Confirm</button>
          </div>
        </div>
      </div>`;
  }

  // --- push prompt (attacker) -----------------------------------------------

  private resetPushState(reactionId: string | null): void {
    this.pushReactionId = reactionId;
    this.pushPicking = false;
    this.pushModelId = null;
    this.pushStaged = null;
    this.pushNote = null;
  }

  /** The pending push when the local player is the attacker who may move a model, else null. */
  private pushContext(): PushContext | null {
    const pending = this.state?.turnState.pendingReaction;
    if (!this.state || !pending || pending.type !== 'push' || pending.promptingPlayerId !== this.localPlayerId) {
      return null;
    }
    const shaken = this.state.units.find((u) => u.id === pending.targetUnitId);
    const attacker = this.state.units.find((u) => u.id === pending.sourceUnitId);
    if (!shaken || !attacker) return null;
    if (this.pushReactionId !== pending.id) this.resetPushState(pending.id);
    return { pending, shaken, attacker, alive: (shaken.models ?? []).filter((m) => !m.isDestroyed) };
  }

  private pushSelectedModel(ctx: PushContext): Model | null {
    return ctx.alive.find((m) => m.id === this.pushModelId) ?? (ctx.alive.length === 1 ? ctx.alive[0] : null);
  }

  /** Clamp a hovered spot to the push ring and say what the host would make of it (including a fall). */
  private previewPush(ctx: PushContext, model: Model, raw: Vector3): { spot: Vector3 | null; text: string; ok: boolean } {
    if (!this.state) return { spot: null, text: '', ok: false };
    const from = model.position ?? ctx.shaken.position;
    const dx = raw.x - from.x;
    const dz = raw.z - from.z;
    const len = Math.hypot(dx, dz);
    const k = len > PUSH_RANGE ? PUSH_RANGE / len : 1;
    const dest = { x: from.x + dx * k, z: from.z + dz * k };
    const plan = planPush(this.state, ctx.shaken, model, dest);
    if (!plan.ok) return { spot: null, text: plan.reason, ok: false };
    const fall =
      plan.fallHeight > 0
        ? plan.fallDice > 0
          ? ` · falls ${plan.fallHeight.toFixed(1)}" (${plan.fallDice} dice, 1-3 wound; the rest of the unit comes down with it)`
          : ` · drops ${plan.fallHeight.toFixed(1)}" (no fall dice)`
        : '';
    return { spot: plan.position, text: `Push ${Math.hypot(dest.x - from.x, dest.z - from.z).toFixed(1)}"${fall}`, ok: true };
  }

  private beginPushPicking(): void {
    const ctx = this.pushContext();
    if (!ctx) return;
    this.pushPicking = true;
    this.pushModelId = ctx.alive.length === 1 ? ctx.alive[0].id : null;
    this.pushStaged = null;
    this.pushNote = null;
    this.render();
    this.emitMarkers();
  }

  private selectPushModel(modelId: string): void {
    const ctx = this.pushContext();
    if (!ctx || !ctx.alive.some((m) => m.id === modelId)) return;
    this.pushModelId = modelId;
    this.pushStaged = null;
    this.pushNote = null;
    this.movePreview = null;
    this.movePathPreview = null;
    this.render();
    this.emitMarkers();
  }

  private stagePushSpot(raw: Vector3): void {
    const ctx = this.pushContext();
    if (!ctx) return;
    const model = this.pushSelectedModel(ctx);
    if (!model) {
      this.showToast('Pick a model of the Shaken unit first');
      return;
    }
    const note = this.previewPush(ctx, model, raw);
    if (!note.spot) {
      this.showToast(note.text || 'That spot is not allowed');
      return;
    }
    this.pushStaged = note.spot;
    this.pushNote = { text: note.text, ok: true };
    this.movePreview = note.spot;
    this.movePathPreview = [model.position ?? ctx.shaken.position, note.spot];
    this.render();
    this.emitMarkers();
  }

  private backFromPush(): void {
    const ctx = this.pushContext();
    if (!ctx) return;
    if (this.pushStaged) this.pushStaged = null;
    else this.pushPicking = false;
    this.pushNote = null;
    this.movePreview = null;
    this.movePathPreview = null;
    this.render();
    this.emitMarkers();
  }

  /** Run the host's check on the staged push; show its refusal as a toast, or send `push-move`. */
  private confirmPush(): void {
    const ctx = this.pushContext();
    if (!ctx || !this.state || !this.pushStaged) return;
    const model = this.pushSelectedModel(ctx);
    if (!model) return;
    const action = createAction(this.localPlayerId, 'push-move', {
      type: 'push-move',
      modelId: model.id,
      destination: this.pushStaged,
    });
    const check = validateAction(this.state, action);
    if (!check.valid) {
      this.showToast(check.reason ?? 'That push is not allowed');
      return;
    }
    this.flow = { mode: 'waiting' };
    this.render();
    this.controller.submitAction(action);
  }

  private pushPromptHtml(ctx: PushContext, remainingSec: number, dataCardSlot: string): string {
    const reactionId = ctx.pending.id;
    const choiceBtn = (id: string, label: string, cls = '') =>
      `<button class="sl-hud-btn ${cls}" data-reaction-choice="${id}" data-reaction-id="${reactionId}">${label}</button>`;
    let body: string;
    if (!this.pushPicking) {
      body = `
          <div class="sl-hud-reaction-desc">${ctx.pending.description}</div>
          <div class="sl-hud-reaction-actions">
            ${ctx.pending.options
              .map((o) =>
                o.id === PUSH_CONFIRM_CHOICE
                  ? `<button class="sl-hud-btn" data-action="push-confirm">${o.label}</button>`
                  : choiceBtn(o.id, o.label, o.style === 'primary' ? 'primary' : o.style === 'danger' ? 'danger' : '')
              )
              .join('')}
          </div>`;
    } else {
      const model = this.pushSelectedModel(ctx);
      const chips = ctx.alive
        .map(
          (m, idx) =>
            `<button class="sl-hud-btn sl-hud-chip ${m.id === model?.id ? 'active' : ''}" data-action="select-push-model" data-model-id="${m.id}" style="${
              m.id === model?.id ? 'background: #00bcd4; color: #000; font-weight: bold;' : ''
            }">Model ${idx + 1}</button>`
        )
        .join('');
      const hint = !model
        ? 'Pick one model of the Shaken unit: click it on the board or a button below.'
        : this.pushStaged
        ? 'Spot chosen. Push to apply it, or Back to pick another spot.'
        : `Click a spot within ${PUSH_RANGE}" of the highlighted model (the ring).`;
      const note = this.pushNote
        ? `<div class="sl-hud-reaction-desc" style="color: ${this.pushNote.ok ? '#a5d6a7' : '#ef9a9a'};">${this.pushNote.text}</div>`
        : '';
      body = `
          <div class="sl-hud-reaction-desc">${hint}</div>
          <div class="sl-hud-squad-chips" style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap; justify-content: center;">${chips}</div>
          ${note}
          <div class="sl-hud-reaction-actions">
            <button class="sl-hud-btn primary" data-action="push-send" ${this.pushStaged ? '' : 'disabled'}>Push</button>
            <button class="sl-hud-btn" data-action="push-back">Back</button>
            ${choiceBtn(PUSH_DECLINE_CHOICE, "Don't push", 'danger')}
          </div>`;
    }
    return `
      <div class="sl-hud-bottom-dock">
        ${dataCardSlot}
        <div class="sl-hud-bottom sl-hud-reaction" style="display: flex; flex-direction: column; align-items: center; gap: 6px;">
          <div class="sl-hud-reaction-header">
            <span class="sl-hud-reaction-title">${ctx.pending.title}</span>
            <span class="sl-hud-reaction-timer">${remainingSec}s</span>
          </div>
          ${body}
        </div>
      </div>`;
  }

  // --- defender pile-in -----------------------------------------------------

  /** The pending pile-in when the local player is the defender who has to place the models, else null. */
  private pileInContext(): PileInContext | null {
    const pending = this.state?.turnState.pendingReaction;
    if (!this.state || !pending || pending.type !== 'pile-in' || pending.promptingPlayerId !== this.localPlayerId) {
      return null;
    }
    const defender = this.state.units.find((u) => u.id === pending.targetUnitId);
    const charger = this.state.units.find((u) => u.id === pending.sourceUnitId);
    if (!defender || !charger) return null;
    if (this.pileInReactionId !== pending.id) {
      this.pileInReactionId = pending.id;
      this.pileInStaged.clear();
      this.pileInPaths.clear();
      this.pileInSelectedId = null;
    }
    return {
      pending,
      defender,
      charger,
      alive: (defender.models ?? []).filter((m) => !m.isDestroyed),
      modelIds: pending.data?.modelIds ?? [],
      maxDistance: pending.data?.maxDistance ?? PILE_IN_DISTANCE,
    };
  }

  private pileInSelectedModel(ctx: PileInContext): Model | null {
    const listed = ctx.alive.filter((m) => ctx.modelIds.includes(m.id));
    return (
      listed.find((m) => m.id === this.pileInSelectedId) ??
      listed.find((m) => !this.pileInStaged.has(m.id)) ??
      listed[0] ??
      null
    );
  }

  /** Where each living model stands now: its staged spot, else where it is. */
  private pileInPositions(ctx: PileInContext): Vector3[] {
    return ctx.alive.map((m) => this.pileInStaged.get(m.id) ?? m.position ?? ctx.defender.position);
  }

  private selectPileInModel(modelId: string): void {
    const ctx = this.pileInContext();
    if (!ctx) return;
    if (!ctx.modelIds.includes(modelId)) {
      if (ctx.alive.some((m) => m.id === modelId)) this.showToast('That model is already in contact and stays put');
      return;
    }
    this.pileInSelectedId = modelId;
    this.movePreview = null;
    this.movePathPreview = null;
    this.render();
    this.emitMarkers();
  }

  /** Click on a charging model (or the unit): walk the selected model into base contact with it, or say why not. */
  private placePileInContact(chargerModelId?: string): void {
    const ctx = this.pileInContext();
    if (!ctx) return;
    const model = this.pileInSelectedModel(ctx);
    if (!model) return;
    const from = model.position ?? ctx.defender.position;
    const foeModel = chargerModelId ? (ctx.charger.models ?? []).find((m) => m.id === chargerModelId && !m.isDestroyed) : null;
    let spot: Vector3;
    if (foeModel) {
      const fp = foeModel.position ?? ctx.charger.position;
      const dx = from.x - fp.x;
      const dz = from.z - fp.z;
      const len = Math.hypot(dx, dz) || 1;
      const contact = edgeGapToCentre(0);
      spot = { x: fp.x + (dx / len) * contact, y: fp.y ?? 0, z: fp.z + (dz / len) * contact };
    } else {
      spot = this.contactSpotFor(from, ctx.charger);
    }
    this.placePileInModel(spot, true);
  }

  private placePileInModel(rawDestination: Vector3, needExact = false): void {
    const ctx = this.pileInContext();
    if (!ctx || !this.state) return;
    const model = this.pileInSelectedModel(ctx);
    if (!model) return;
    const start = model.position ?? ctx.defender.position;
    const path = findNavPath(this.state, ctx.defender, rawDestination, ctx.maxDistance, {
      keepAway: true,
      startPosition: start,
      ignoreUnitId: ctx.charger.id,
    });
    if (path.length < 2) {
      this.showToast(
        needExact
          ? `Cannot reach base contact there: it is beyond ${ctx.maxDistance}" or the way is blocked`
          : 'Pick a destination away from the model'
      );
      return;
    }
    const destination = path[path.length - 1];
    if (needExact && boardDistance(destination, rawDestination) > 0.1) {
      this.showToast(`Cannot reach base contact there: it is beyond ${ctx.maxDistance}" or the way is blocked`);
      return;
    }
    const idx = ctx.alive.findIndex((m) => m.id === model.id);
    const positions = this.pileInPositions(ctx);
    for (let i = 0; i < positions.length; i++) {
      if (i !== idx && boardDistance(positions[i], destination) < 0.9) {
        this.showToast(`Cannot place model on top of Model ${i + 1} (bases would overlap)`);
        return;
      }
    }
    if (livingModelPositions(ctx.charger).some((c) => boardDistance(c, destination) < 0.9)) {
      this.showToast('Cannot place a model on top of an enemy model (bases would overlap)');
      return;
    }
    this.pileInStaged.set(model.id, destination);
    this.pileInPaths.set(model.id, path);
    positions[idx] = destination;
    const coherency = validateSquadCoherency(positions);
    if (positions.length > 1 && !coherency.coherent) {
      this.showToast(
        (coherency.reason ?? 'Each model must be within 1" of another squad member') + ' (fix this before confirming)'
      );
    }
    const next = ctx.alive.find((m) => ctx.modelIds.includes(m.id) && !this.pileInStaged.has(m.id));
    if (next) this.pileInSelectedId = next.id;
    this.movePreview = null;
    this.movePathPreview = null;
    this.render();
    this.emitMarkers();
  }

  /** Fill every listed model that has not been placed with its `closestApproach` spot (nearest the chargers first). */
  private autoPlacePileIn(): void {
    const ctx = this.pileInContext();
    if (!ctx || !this.state) return;
    const foes = livingModelPositions(ctx.charger);
    const positions = this.pileInPositions(ctx);
    const order = ctx.alive
      .map((m, i) => ({ m, i, d: Math.min(...foes.map((f) => boardDistance(positions[i], f))) }))
      .filter(({ m }) => ctx.modelIds.includes(m.id) && !this.pileInStaged.has(m.id))
      .sort((a, b) => a.d - b.d || a.i - b.i);
    let moved = 0;
    for (const { m, i } of order) {
      const best = closestApproach(
        this.state,
        ctx.defender,
        i,
        m.position ?? ctx.defender.position,
        ctx.maxDistance,
        ctx.charger,
        positions.filter((_, j) => j !== i)
      );
      if (best && best.path.length >= 2) {
        positions[i] = best.position;
        this.pileInStaged.set(m.id, best.position);
        this.pileInPaths.set(m.id, best.path);
        moved++;
      }
    }
    if (moved === 0) this.showToast('No model can get any closer');
    this.movePreview = null;
    this.movePathPreview = null;
    this.render();
    this.emitMarkers();
  }

  private resetPileIn(): void {
    this.pileInStaged.clear();
    this.pileInPaths.clear();
    this.pileInSelectedId = null;
    this.movePreview = null;
    this.movePathPreview = null;
    this.render();
    this.emitMarkers();
  }

  /** Run the host's check on the staged placement; show its refusal as a toast, or send `pile-in-move`. */
  private confirmPileIn(): void {
    const ctx = this.pileInContext();
    if (!ctx || !this.state) return;
    const positions = this.pileInPositions(ctx);
    const action = createAction(this.localPlayerId, 'pile-in-move', {
      type: 'pile-in-move',
      modelPositions: positions,
      modelPaths: ctx.alive.map((m, i) => this.pileInPaths.get(m.id) ?? [positions[i]]),
    });
    const check = validateAction(this.state, action);
    if (!check.valid) {
      this.showToast(check.reason ?? 'That pile-in is not allowed');
      return;
    }
    this.flow = { mode: 'waiting' };
    this.render();
    this.controller.submitAction(action);
  }

  private pileInPromptHtml(ctx: PileInContext, remainingSec: number, dataCardSlot: string): string {
    const current = this.pileInSelectedModel(ctx);
    const chips = ctx.alive
      .map((m, idx) => ({ m, idx }))
      .filter(({ m }) => ctx.modelIds.includes(m.id))
      .map(({ m, idx }) => {
        const placed = this.pileInStaged.has(m.id);
        const selected = m.id === current?.id;
        return `<button class="sl-hud-btn sl-hud-chip ${selected ? 'active' : ''}" data-action="select-pile-in-model" data-model-id="${m.id}" style="${
          selected
            ? 'background: #00bcd4; color: #000; font-weight: bold;'
            : placed
            ? 'background: rgba(76, 175, 80, 0.25); border-color: #4caf50; color: #a5d6a7;'
            : ''
        }">${placed ? '✓ ' : ''}Model ${idx + 1}</button>`;
      })
      .join('');
    return `
      <div class="sl-hud-bottom-dock">
        ${dataCardSlot}
        <div class="sl-hud-bottom sl-hud-reaction" style="display: flex; flex-direction: column; align-items: center; gap: 6px;">
          <div class="sl-hud-reaction-header">
            <span class="sl-hud-reaction-title">Pile in</span>
            <span class="sl-hud-reaction-timer">${remainingSec}s</span>
          </div>
          <div class="sl-hud-reaction-desc">${ctx.charger.name} charged ${ctx.defender.name}. Move each model that is not touching up to ${ctx.maxDistance}" toward the attackers: pick a model, then click a spot. The attacks are rolled after you confirm.</div>
          <div class="sl-hud-squad-chips" style="display: flex; gap: 6px; align-items: center;">
            <span style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; opacity: 0.7;">Select Model:</span>
            ${chips}
          </div>
          <div class="sl-hud-reaction-actions">
            <button class="sl-hud-btn" data-action="auto-pile-in">Auto place</button>
            <button class="sl-hud-btn primary" data-action="confirm-pile-in">Confirm</button>
            <button class="sl-hud-btn" data-action="reset-pile-in">Reset</button>
          </div>
        </div>
      </div>`;
  }

  /** Why a squad model's spot was refused: no move left, the spot is the model itself, or the way is blocked. */
  private refusedSquadSpotReason(start: Vector3, destination: Vector3, budget: number): string {
    if (budget < 0.05) return 'This model has no move left';
    if (boardDistance(start, destination) < 0.05) return 'Pick a destination away from the model';
    return `This model cannot move there: the way is blocked or the spot is not reachable (it has ${budget.toFixed(1)}" of move left)`;
  }

  private handleSquadModelPick(rawDestination: Vector3, actionKind: 'move' | 'rush' | 'charge'): void {
    const active = this.activeUnit;
    if (!active || !this.state) return;

    const alive = this.activeAliveSquadModels;
    if (alive.length <= 1) return;

    const currentModel = this.selectedSquadModel;
    if (!currentModel) return;

    const startPos = currentModel.position ?? active.position;
    // The cursor snaps to floor edges; a model standing at an edge may declare its own jump or fall
    const resolved = resolveMoveTarget(this.state, active, startPos, rawDestination, true);
    const jump = resolved.jump;
    rawDestination = resolved.target;

    const isRush = actionKind === 'rush';
    const isCharge = actionKind === 'charge';
    const chargeTargetId = isCharge ? this.declaredCharge?.targetId : undefined;
    const chargeTarget = chargeTargetId ? this.state.units.find((u) => u.id === chargeTargetId) : undefined;
    if (isCharge && !chargeTarget) return;
    const remainingBudget = this.distanceLeft(active, isCharge ? 'charge' : isRush ? 'rush' : 'move', currentModel);
    // This model's earlier charge legs come off the Difficult Terrain cap too
    const chargeSpentSoFar = isCharge ? getEffectiveMaxMovement(active, 'charge', false) - remainingBudget : 0;
    let maxAllowance = remainingBudget;
    const navOptions = {
      keepAway: true,
      startPosition: startPos,
      stopBeforeDifficult: !isCharge && (isRush || !!active.isRushing),
      ...(chargeTargetId ? { ignoreUnitId: chargeTargetId } : {}),
    };
    let path = jump
      ? jump.path
      : findNavPath(this.state, active, rawDestination, maxAllowance, navOptions);
    const isDifficult = !jump && path.length > 0 && isPathDifficult(this.state, path, active);
    const effectiveCap = isCharge
      ? Math.max(0, getEffectiveMaxMovement(active, 'charge', isDifficult) - chargeSpentSoFar)
      : getEffectiveMaxMovement(active, isRush || active.isRushing ? 'rush' : 'move', isDifficult);
    const cappedAllowance = Math.min(effectiveCap, remainingBudget);
    if (isDifficult && maxAllowance > cappedAllowance) {
      maxAllowance = cappedAllowance;
      path = findNavPath(this.state, active, rawDestination, maxAllowance, navOptions);
    }
    if (path.length < 2) {
      this.showToast(this.refusedSquadSpotReason(startPos, rawDestination, remainingBudget));
      return;
    }
    const destination = path[path.length - 1];
    const distance = pathMovementCost(this.state!, path, active);
    if (distance < 0.05 && !jump) {
      this.showToast(this.refusedSquadSpotReason(startPos, rawDestination, remainingBudget));
      return;
    }

    if (isDifficult && actionKind === 'rush') {
      this.showToast('Difficult Terrain / Climb: Rush capped at 6.0" (speed bonus negated)');
    }

    if (isCharge) {
      // A charging model may end in contact with the target, but not on top of one of its models
      if (livingModelPositions(chargeTarget!).some((t) => boardDistance(t, destination) < 0.9)) {
        this.showToast('Cannot place a model on top of an enemy model (bases would overlap)');
        return;
      }
    } else {
      const wouldEngage = this.enemyUnits.some(
        (e) =>
          !e.isDestroyed &&
          pointEngagesUnit(destination, e)
      );
      if (wouldEngage) {
        this.showToast(`${actionKind === 'rush' ? 'Rush' : 'Advance'} cannot end in melee contact — use Charge instead`);
        return;
      }
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

    // A squad that started the action out of coherency may end it closer to coherent (regrouping)
    const startPositions = alive.map((m) => m.position ?? active.position);
    const startedIncoherent = !validateSquadCoherency(startPositions).coherent;

    if (otherPlaced.length > 0) {
      // 1. All models must remain within 6" (base edge to base edge) of all other placed models
      //    (a regrouping squad is judged as a whole when the last model is placed)
      for (const placed of startedIncoherent ? [] : otherPlaced) {
        const d = Math.hypot(placed.pos.x - destination.x, placed.pos.z - destination.z);
        if (d > SQUAD_COHERENCY_SPREAD + 0.02) {
          this.showToast(`Model spread of ${modelGap(placed.pos, destination).toFixed(1)}" (edge to edge) exceeds max ${SQUAD_COHERENCY_SPREAD_EDGE.toFixed(1)}" coherency limit from ${placed.name}`);
          return;
        }
      }

      // 2. When placing the final model of the squad, full squad coherency must be satisfied
      const isPlacingLastModel = otherPlaced.length === alive.length - 1;
      if (isPlacingLastModel) {
        const candidatePositions = [...otherPlaced.map((p) => p.pos), destination];
        const coherency = validateSquadCoherency(candidatePositions);
        if (!coherency.coherent) {
          // Candidate positions are in placement order, not model order: compare as a set of positions
          const regrouping = startedIncoherent && isRegroupingMove(startPositions, candidatePositions);
          if (!regrouping) {
            this.showToast(
              (coherency.reason ??
                'Each model must be within 1" of another squad member (3" if they are on different levels)') +
                (startedIncoherent
                  ? ' (the squad started out of coherency: it must end closer to coherent than it began)'
                  : '')
            );
            return;
          }
        }
      }
    }

    // Model placed successfully
    this.stagedSquadModelPositions.set(currentModel.id, destination);
    this.stagedSquadModelPaths.set(currentModel.id, path);
    this.squadBlockedModels.delete(currentModel.id);
    if (jump) {
      this.stagedSquadModelTraversals.set(currentModel.id, jump);
      if (!this.squadJumpLeaderId || !this.stagedSquadModelTraversals.has(this.squadJumpLeaderId)) {
        this.squadJumpLeaderId = currentModel.id;
      }
      const followed = this.autoRouteFollowers(actionKind, currentModel, jump);
      this.showToast(
        `Model ${alive.findIndex((m) => m.id === currentModel.id) + 1}: ${jumpChip(jump).text}${followed ? ` · ${followed}` : ''}`
      );
    } else {
      this.stagedSquadModelTraversals.delete(currentModel.id);
    }

    if (this.stagedSquadModelPositions.size < alive.length) {
      // Auto-advance selection to the next unplaced model
      const nextUnplaced = alive.find((m) => !this.stagedSquadModelPositions.has(m.id));
      if (nextUnplaced) {
        this.selectedSquadModelId = nextUnplaced.id;
      }
      this.movePathPreview = null;
      this.moveJump = null;
      this.moveSegments = null;
      this.movePreview = null;
      this.render();
      this.emitMarkers();
      return;
    }

    // All living models have been placed!
    this.finishSquadMove(actionKind);
  }

  /** `{ jumpLeader }` for a squad payload: the living-model index of the model the jump was declared with. */
  private jumpLeaderPayload(alive: Model[]): { jumpLeader?: number } {
    const idx = this.squadJumpLeaderId ? alive.findIndex((m) => m.id === this.squadJumpLeaderId) : -1;
    return idx >= 0 && this.stagedSquadModelTraversals.has(alive[idx].id) ? { jumpLeader: idx } : {};
  }

  /**
   * Follow the leader (14C-2 PR 4B): when a squad model declares a jump, route every model not yet placed to the
   * same crossing: it walks to a spot along the take-off edge with its own move and hops from there. Models
   * already beyond the crossing (or Flying) are left for the player to move normally; a model that cannot reach
   * the edge is marked on its chip and left where it stands. The host re-checks every route. Returns a short
   * note for the toast.
   */
  private autoRouteFollowers(actionKind: 'move' | 'rush' | 'charge', leader: Model, jump: JumpOption): string {
    const active = this.activeUnit;
    const state = this.state;
    if (!active || !state || jump.kind === 'fall') return '';
    const alive = this.activeAliveSquadModels;
    const isCharge = actionKind === 'charge';
    const isRush = actionKind === 'rush' || !!active.isRushing;
    const moveKind: 'move' | 'rush' | 'charge' = isCharge ? 'charge' : isRush ? 'rush' : 'move';
    const chargeTarget =
      isCharge && this.declaredCharge ? state.units.find((u) => u.id === this.declaredCharge!.targetId) : undefined;
    const declared = { kind: jump.kind, takeoff: jump.takeoff, landing: jump.landing };
    const taken: Vector3[] = [jump.takeoff, jump.landing];
    for (const m of alive) {
      if (m.id === leader.id) continue;
      const staged = this.stagedSquadModelPositions.get(m.id);
      const stagedJump = this.stagedSquadModelTraversals.get(m.id);
      if (staged) taken.push(staged);
      if (stagedJump) taken.push(stagedJump.takeoff);
      if (!staged) taken.push(m.position ?? active.position);
    }
    const followed: number[] = [];
    const blocked: string[] = [];
    alive.forEach((m, idx) => {
      if (m.id === leader.id || this.stagedSquadModelPositions.has(m.id)) return;
      const start = m.position ?? active.position;
      const remaining = this.distanceLeft(active, moveKind, m);
      const spent = isCharge ? getEffectiveMaxMovement(active, 'charge', false) - remaining : 0;
      const budget = Math.min(remaining, getEffectiveMaxMovement(active, moveKind, false) - spent);
      const difficultBudget = Math.min(remaining, getEffectiveMaxMovement(active, moveKind, true) - spent);
      // The model's own current spot is not "taken" against itself
      const others = taken.filter((t) => Math.hypot(t.x - start.x, t.z - start.z) > 1e-6);
      const plan = planFollowerCrossing(state, active, start, declared, {
        budget: Math.max(0, budget),
        difficultBudget: Math.max(0, difficultBudget),
        taken: others,
        navOptions: {
          keepAway: true,
          stopBeforeDifficult: !isCharge && isRush,
          ...(chargeTarget ? { ignoreUnitId: chargeTarget.id } : {}),
        },
        landingAllowed: (p) =>
          isCharge
            ? !chargeTarget || livingModelPositions(chargeTarget).every((t) => boardDistance(t, p) >= 0.9)
            : !this.enemyUnits.some((e) => !e.isDestroyed && pointEngagesUnit(p, e)),
      });
      if (plan.status === 'route') {
        const { path, option } = plan.route;
        this.stagedSquadModelPositions.set(m.id, option.landing);
        this.stagedSquadModelPaths.set(m.id, path);
        this.stagedSquadModelTraversals.set(m.id, option);
        this.squadBlockedModels.delete(m.id);
        taken.push(option.takeoff, option.landing);
        followed.push(idx + 1);
      } else if (plan.status === 'unreachable') {
        this.squadBlockedModels.set(m.id, plan.reason);
        blocked.push(`Model ${idx + 1} (${plan.reason})`);
      }
    });
    const notes: string[] = [];
    if (followed.length > 0) {
      notes.push(
        `Model${followed.length > 1 ? 's' : ''} ${followed.join(', ')} follow${followed.length > 1 ? '' : 's'} across (one roll for the squad)`
      );
    }
    if (blocked.length > 0) {
      notes.push(`can't follow: ${blocked.join('; ')}. They stay behind unless you place them`);
    }
    return notes.join(' · ');
  }

  /**
   * Build the squad move/rush confirmation from the staged models. Models that were not
   * staged keep their position with a one-point path (they move 0"). Called automatically
   * once every model is placed, or from the early "Confirm move" button.
   */
  private finishSquadMove(actionKind: 'move' | 'rush' | 'charge'): void {
    const active = this.activeUnit;
    if (!active || !this.state) return;
    const alive = this.activeAliveSquadModels;
    if (alive.length <= 1 || this.stagedSquadModelPositions.size === 0) return;

    let orderedPositions = alive.map(
      (m) => this.stagedSquadModelPositions.get(m.id) ?? m.position ?? active.position
    );
    let orderedPaths = alive.map(
      (m, i) => this.stagedSquadModelPaths.get(m.id) ?? [orderedPositions[i]]
    );
    // A final charge moves the models the player did not place as close as they can get
    let autoPlaced: number[] = [];
    if (actionKind === 'charge' && this.stagedSquadModelPositions.size < alive.length) {
      const filled = this.autoPlaceChargers(alive, orderedPositions, orderedPaths);
      if (filled) {
        orderedPositions = filled.positions;
        orderedPaths = filled.paths;
        autoPlaced = filled.autoPlaced;
      }
    }
    if (this.stagedSquadModelPositions.size < alive.length && autoPlaced.length === 0) {
      const coherency = validateSquadCoherency(orderedPositions);
      const startPositions = alive.map((m) => m.position ?? active.position);
      if (!coherency.coherent && !isRegroupingMove(startPositions, orderedPositions)) {
        this.showToast(
          `Unplaced models stay where they are: ${
            coherency.reason ?? 'the squad would not be in coherency'
          }.${
            this.squadBlockedModels.size > 0
              ? ` ${alive
                  .map((m, i) => (this.squadBlockedModels.has(m.id) ? `Model ${i + 1} cannot reach the take-off edge (${this.squadBlockedModels.get(m.id)})` : ''))
                  .filter(Boolean)
                  .join('; ')}.`
              : ''
          } Place more models or reset.`
        );
        return;
      }
    }
    const finalCentroid = computeSquadCentroid(orderedPositions);
    if (actionKind === 'charge') {
      this.finishSquadCharge(alive, orderedPositions, orderedPaths, finalCentroid, autoPlaced);
      return;
    }
    const isAnyModelDifficult = orderedPaths.some((p) =>
      isPathDifficult(this.state!, p, active)
    );
    let summary = `${actionKind === 'rush' || active.isRushing ? 'Rush' : 'Advance'} ${active.name} (${alive.length} models) · ${
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

    const orderedJumps = alive.map((m) => this.stagedSquadModelTraversals.get(m.id) ?? null);
    const orderedTraversals = orderedJumps.map((j) =>
      j ? { kind: j.kind, takeoff: j.takeoff, landing: j.landing } : null
    );
    orderedJumps.forEach((j, i) => {
      if (j) summary += ` · Model ${i + 1}: ${jumpChip(j).text}`;
    });
    orderedPaths.forEach((p, i) => {
      if (orderedTraversals[i]) return; // the declared jump is already described
      const warning = this.dropWarning(active, p, null);
      if (warning) summary += ` · ${warning}`;
    });

    this.selectedCasualtyModelId = alive.length > 0 ? alive[0].id : null;
    this.movePreview = finalCentroid;
    this.movePathPreview = null;
    this.moveJump = null;
    this.moveSegments = null;

    this.beginConfirmation(
      createAction(this.localPlayerId, actionKind === 'rush' ? 'rush' : 'advance', {
        type: actionKind === 'rush' ? 'rush' : 'advance',
        unitId: active.id,
        path: [active.position, finalCentroid],
        finalPosition: finalCentroid,
        modelPositions: orderedPositions,
        modelPaths: orderedPaths,
        ...(orderedTraversals.some((t) => t) ? { modelTraversals: orderedTraversals } : {}),
        ...this.jumpLeaderPayload(alive),
        ...(this.selectedCasualtyModelId ? { casualtyModelIds: [this.selectedCasualtyModelId] } : {}),
      }),
      summary
    );
  }

  /**
   * On a final squad charge, fill in the models the player did not place: each (in model order) goes to its
   * `closestApproach` spot given the others' positions so far. Only when a placed model already touches the
   * target (otherwise the confirmation is a leg and unplaced models stay put). Returns null when nothing applies.
   */
  private autoPlaceChargers(
    alive: Model[],
    positions: Vector3[],
    paths: Vector3[][]
  ): { positions: Vector3[]; paths: Vector3[][]; autoPlaced: number[] } | null {
    const active = this.activeUnit;
    const declared = this.declaredCharge;
    const state = this.state;
    if (!active || !declared || !state) return null;
    const target = state.units.find((u) => u.id === declared.targetId);
    if (!target) return null;
    const targetModels = livingModelPositions(target);
    const touches = (pos: Vector3): boolean =>
      targetModels.some(
        (t) =>
          modelGap(pos, t) <= CHARGE_END_EDGE_GAP + 0.001 &&
          Math.abs((pos.y ?? 0) - (t.y ?? 0)) <= MELEE_MAX_VERTICAL_REACH
      );
    if (!alive.some((m, i) => this.stagedSquadModelPositions.has(m.id) && touches(positions[i]))) return null;

    const outPositions = [...positions];
    const outPaths = [...paths];
    const autoPlaced: number[] = [];
    // Models still waiting to be filled in have no final spot yet: they do not count as "the others"
    const settled = alive.map((m) => this.stagedSquadModelPositions.has(m.id));
    alive.forEach((m, i) => {
      if (settled[i]) return;
      const start = m.position ?? active.position;
      const remaining = this.distanceLeft(active, 'charge', m);
      const spent = getEffectiveMaxMovement(active, 'charge', false) - remaining;
      const best = closestApproach(
        state,
        active,
        i,
        start,
        remaining,
        target,
        outPositions.filter((_, j) => j !== i && settled[j]),
        { difficultBudget: Math.max(0, getEffectiveMaxMovement(active, 'charge', true) - spent) }
      );
      if (best && best.cost > 0.05) {
        outPositions[i] = best.position;
        outPaths[i] = best.path;
        autoPlaced.push(i);
      }
      settled[i] = true;
    });
    return { positions: outPositions, paths: outPaths, autoPlaced };
  }

  /**
   * Build the confirmation for a squad charge from the staged models: a final charge into contact when at least
   * one model ends touching the target, otherwise a leg (the rest of the budget stays). The host check runs first
   * so the player sees why a placement is refused.
   */
  private finishSquadCharge(
    alive: Model[],
    orderedPositions: Vector3[],
    orderedPaths: Vector3[][],
    centroid: Vector3,
    autoPlaced: number[] = []
  ): void {
    const active = this.activeUnit;
    const declared = this.declaredCharge;
    const state = this.state;
    if (!active || !declared || !state) return;
    const target = state.units.find((u) => u.id === declared.targetId);
    const weapon = active.weapons.find((w) => w.isEquipped && w.profile.type === 'melee');
    if (!target || !weapon) return;

    const targetModels = livingModelPositions(target);
    const inContact = orderedPositions.some((pos) =>
      targetModels.some(
        (t) =>
          modelGap(pos, t) <= CHARGE_END_EDGE_GAP + 0.001 &&
          Math.abs((pos.y ?? 0) - (t.y ?? 0)) <= MELEE_MAX_VERTICAL_REACH
      )
    );
    const strikers = orderedPositions.filter((pos) =>
      targetModels.some((t) => modelGap(pos, t) <= MELEE_STRIKE_EDGE_GAP + 0.001)
    ).length;

    const orderedTraversals = alive.map((m) => {
      const j = this.stagedSquadModelTraversals.get(m.id);
      return j ? { kind: j.kind, takeoff: j.takeoff, landing: j.landing } : null;
    });
    const common = {
      attackerId: active.id,
      path: [{ ...active.position }, centroid],
      modelPositions: orderedPositions,
      modelPaths: orderedPaths,
      ...(orderedTraversals.some((t) => t) ? { modelTraversals: orderedTraversals } : {}),
      ...this.jumpLeaderPayload(alive),
    };
    const action = inContact
      ? createAction(this.localPlayerId, 'charge', {
          type: 'charge',
          ...common,
          targetId: target.id,
          weaponId: weapon.id,
        })
      : createAction(this.localPlayerId, 'charge-leg', { type: 'charge-leg', ...common });

    const check = validateAction(state, action);
    if (!check.valid) {
      this.showToast(check.reason ?? 'The host would refuse this charge placement');
      return;
    }

    const cost = Math.max(...orderedPaths.map((p) => pathMovementCost(state, p, active)), 0);
    let summary: string;
    if (inContact) {
      const attacks = (weapon.profile.attacks as number) * Math.max(1, strikers);
      summary = `${active.name} charges ${target.name} (${alive.length} models, furthest walk ${cost.toFixed(1)}") & strikes with ${weapon.name} · ${strikers} of ${alive.length} models within ${MELEE_STRIKE_EDGE_GAP}" strike (${attacks} attacks before the defenders pile in up to 3") · defender retaliates if surviving; chargers step back 1"`;
    } else {
      // Each model keeps its own distance: report the most any model has left after this leg
      const left = Math.max(
        0,
        ...alive.map((m, i) => this.distanceLeft(active, 'charge', m) - pathMovementCost(state, orderedPaths[i], active))
      );
      summary = `Charge leg for ${active.name} (${alive.length} models) · furthest walk ${cost.toFixed(1)}" · each model keeps its own distance (up to ${left.toFixed(1)}" left after this leg; no melee yet)`;
    }
    if (autoPlaced.length > 0) {
      summary += ` · moved up as close as they can: ${autoPlaced.map((i) => `Model ${i + 1}`).join(', ')}`;
    }
    alive.forEach((m, i) => {
      const j = this.stagedSquadModelTraversals.get(m.id);
      if (j) summary += ` · Model ${i + 1}: ${jumpChip(j).text}`;
    });
    if (orderedPaths.some((p) => isPathDangerous(state, p, active))) {
      summary += ' · ⚠️ DANGEROUS TERRAIN: Hazard test (1s inflict wounds)!';
    }

    this.selectedCasualtyModelId = alive.length > 0 ? alive[0].id : null;
    this.movePreview = centroid;
    this.movePathPreview = null;
    this.moveJump = null;
    this.moveSegments = null;
    this.hoveredEngagedTargetId = inContact ? target.id : null;
    this.beginConfirmation(action, summary);
  }

  private prepareMove(rawDestination: Vector3): void {
    const active = this.activeUnit;
    if (!active || !this.state) return;

    const currentBudget = active.isRushing
      ? active.remainingMovement
      : Math.min(active.speed, active.remainingMovement ?? active.speed);
    let maxAllowance = currentBudget;
    const resolved = resolveMoveTarget(this.state, active, active.position, rawDestination, true);
    const jump = resolved.jump;
    rawDestination = resolved.target;
    let path = jump ? jump.path : findNavPath(this.state, active, rawDestination, maxAllowance, { keepAway: true });
    const isDifficult = !jump && path.length > 0 && isPathDifficult(this.state, path, active);
    const effectiveCap = getEffectiveMaxMovement(active, active.isRushing ? 'rush' : 'move', isDifficult);
    const maxMove = Math.min(effectiveCap, currentBudget);
    if (isDifficult && maxAllowance > maxMove) {
      maxAllowance = maxMove;
      path = findNavPath(this.state, active, rawDestination, maxAllowance, { keepAway: true });
    }
    if (path.length < 2) {
      this.showToast('Pick a destination away from the unit');
      return;
    }
    const destination = path[path.length - 1];
    const distance = pathMovementCost(this.state!, path, active);
    if (distance < 0.05 && !jump) {
      this.showToast('Pick a destination away from the unit');
      return;
    }

    const wouldEngage = this.enemyUnits.some(
      (e) =>
        !e.isDestroyed &&
        pointEngagesUnit(destination, e)
    );
    if (wouldEngage) {
      this.showToast('Advance cannot end in melee contact — use Charge instead');
      return;
    }

    const maxMoveStr = Number.isInteger(maxMove) ? `${maxMove}` : maxMove.toFixed(1);
    let summary = `Advance ${active.name} ${distance.toFixed(1)}" (max ${maxMoveStr}") · ${
      active.isRushing ? 'rush move' : 'can shoot after moving'
    }`;
    if (isDifficult) {
      summary += ' · [Difficult Terrain: 6.0" speed cap]';
    }
    const dropNote = this.dropWarning(active, path, jump);
    if (dropNote) summary += ` · ${dropNote}`;
    if (isPathDangerous(this.state, path, active)) {
      summary += ' · ⚠️ DANGEROUS TERRAIN: Hazard test (1s inflict wounds)!';
    }
    summary += this.traversalSummary(active, path, jump);

    this.selectedCasualtyModelId =
      active.models && active.models.length > 1
        ? active.models.find((m) => !m.isDestroyed)?.id ?? null
        : null;

    this.movePreview = destination;
    this.movePathPreview = path;
    this.moveJump = jump;
    this.moveSegments = describePathSegments(this.state, active, path);
    this.beginConfirmation(
      createAction(this.localPlayerId, 'advance', {
        type: 'advance',
        unitId: active.id,
        path,
        finalPosition: destination,
        ...(this.selectedCasualtyModelId ? { casualtyModelIds: [this.selectedCasualtyModelId] } : {}),
        ...(jump ? { traversal: { kind: jump.kind, takeoff: jump.takeoff, landing: jump.landing } } : {}),
      }),
      summary
    );
  }

  private prepareRush(rawDestination: Vector3): void {
    const active = this.activeUnit;
    if (!active || !this.state) return;

    const currentRushBudget = active.isRushing ? active.remainingMovement : active.speed * 2;
    let maxAllowance = currentRushBudget;
    const resolved = resolveMoveTarget(this.state, active, active.position, rawDestination, true);
    const jump = resolved.jump;
    rawDestination = resolved.target;
    let path = jump
      ? jump.path
      : findNavPath(this.state, active, rawDestination, maxAllowance, {
          keepAway: true,
          stopBeforeDifficult: true,
        });

    // The planner stops a Rush just outside difficult ground on the way to the cursor (inside it, or past it)
    const pathEnd = path.length > 0 ? path[path.length - 1] : null;
    const stoppedBeforeDifficult =
      !!pathEnd &&
      boardDistance(pathEnd, rawDestination) > 0.1 &&
      isPathDifficult(this.state, [pathEnd, rawDestination], active) &&
      !isPathDifficult(this.state, path, active);

    const isElevationObstacle =
      !jump &&
      path.length > 0 && (rawDestination.y ?? 0) - (path[path.length - 1].y ?? 0) > 0.5;

    const stoppedAtBase =
      !jump &&
      path.length > 0 &&
      !hasTrait(active.specialRules, 'flying') &&
      (isElevationObstacle ||
        stoppedBeforeDifficult);

    const isDifficult =
      !jump &&
      !stoppedAtBase &&
      path.length > 0 &&
      isPathDifficult(this.state, path, active);

    const effectiveCap = getEffectiveMaxMovement(active, 'rush', isDifficult);
    const maxRush = Math.min(effectiveCap, currentRushBudget);
    if (isDifficult && maxAllowance > maxRush) {
      maxAllowance = maxRush;
      path = findNavPath(this.state, active, rawDestination, maxAllowance, {
        keepAway: true,
        stopBeforeDifficult: true,
      });
    }
    if (path.length < 2) {
      this.showToast('Pick a destination away from the unit');
      return;
    }
    const destination = path[path.length - 1];
    const distance = pathMovementCost(this.state!, path, active);
    if (distance < 0.05 && !jump) {
      this.showToast('Pick a destination away from the unit');
      return;
    }

    const wouldEngage = this.enemyUnits.some(
      (e) =>
        !e.isDestroyed &&
        pointEngagesUnit(destination, e)
    );
    if (wouldEngage) {
      this.showToast('Rush cannot end in melee contact — use Charge instead');
      return;
    }

    const stopText = stoppedAtBase
      ? rushStopText(
          rushStopReason({
            heightShort: isElevationObstacle,
            pathCost: pathMovementCost(this.state!, path, active),
            budget: currentRushBudget,
          })
        )
      : '';
    if (stoppedAtBase) {
      this.showToast(stopText);
    } else if (isDifficult) {
      this.showToast('Difficult Terrain / Climb: Rush capped at 6.0" (speed bonus negated)');
    }

    const maxRushStr = Number.isInteger(maxRush) ? `${maxRush}` : maxRush.toFixed(1);
    let summary = `Rush ${active.name} ${distance.toFixed(1)}" (max ${maxRushStr}") · double move (ineligible to shoot)`;
    if (stoppedAtBase) {
      summary += ` · [${stopText}]`;
    } else if (isDifficult) {
      summary += ' · [Difficult Terrain: capped at 6.0" (Rush speed bonus negated)]';
    }
    const dropNote = this.dropWarning(active, path, jump);
    if (dropNote) summary += ` · ${dropNote}`;
    if (isPathDangerous(this.state, path, active)) {
      summary += ' · ⚠️ DANGEROUS TERRAIN: Hazard test (1s inflict wounds)!';
    }
    summary += this.traversalSummary(active, path, jump);

    this.selectedCasualtyModelId =
      active.models && active.models.length > 1
        ? active.models.find((m) => !m.isDestroyed)?.id ?? null
        : null;

    this.movePreview = destination;
    this.movePathPreview = path;
    this.moveJump = jump;
    this.moveSegments = describePathSegments(this.state, active, path);
    this.movePreviewDifficult = isDifficult;
    this.beginConfirmation(
      createAction(this.localPlayerId, 'rush', {
        type: 'rush',
        unitId: active.id,
        path,
        finalPosition: destination,
        ...(this.selectedCasualtyModelId ? { casualtyModelIds: [this.selectedCasualtyModelId] } : {}),
        ...(jump ? { traversal: { kind: jump.kind, takeoff: jump.takeoff, landing: jump.landing } } : {}),
      }),
      summary
    );
  }

  /** A leg of a declared charge: a safe path toward the cursor, or a declared jump from an edge. */
  private prepareChargeLeg(rawDestination: Vector3): void {
    const active = this.activeUnit;
    const declared = this.declaredCharge;
    if (!active || !declared || !this.state) return;
    const target = this.state.units.find((u) => u.id === declared.targetId);
    if (!target) return;

    const resolved = resolveMoveTarget(this.state, active, active.position, rawDestination, true);
    const jump = resolved.jump;
    const dest = resolved.target;
    let allowance = active.remainingMovement;
    let path = jump
      ? jump.path
      : findNavPath(this.state, active, dest, allowance, { ignoreUnitId: target.id, keepAway: true });
    const isDifficult = !jump && path.length > 0 && isPathDifficult(this.state, path, active);
    if (isDifficult) {
      const spent = getEffectiveMaxMovement(active, 'charge', false) - active.remainingMovement;
      const cap = Math.max(0, getEffectiveMaxMovement(active, 'charge', true) - spent);
      if (allowance > cap) {
        allowance = cap;
        path = findNavPath(this.state, active, dest, allowance, { ignoreUnitId: target.id, keepAway: true });
      }
    }
    if (path.length < 2) {
      this.showToast('Pick a spot to walk to, or click the target to make contact');
      return;
    }
    const end = path[path.length - 1];
    const cost = pathMovementCost(this.state, path, active);
    if (cost < 0.05 && !jump) {
      this.showToast('Pick a spot away from the unit');
      return;
    }
    if (!jump && chargeContact(active, target, end, MELEE_MAX_VERTICAL_REACH) === 'ok') {
      this.showToast(`Click ${target.name} to make contact and strike`);
      return;
    }

    const left = Math.max(0, active.remainingMovement - cost);
    let summary = `Charge leg ${cost.toFixed(1)}" · ${left.toFixed(1)}" of the charge left after it (no melee yet)`;
    if (isDifficult) summary += ' · [Difficult Terrain 6.0" cap]';
    const dropNote = this.dropWarning(active, path, jump);
    if (dropNote) summary += ` · ${dropNote}`;
    if (isPathDangerous(this.state, path, active)) {
      summary += ' · ⚠️ DANGEROUS TERRAIN: Hazard test (1s inflict wounds)!';
    }
    summary += this.traversalSummary(active, path, jump);
    if (jump) summary += ' · a failed jump falls and ends the activation with no melee';

    this.movePreview = end;
    this.movePathPreview = path;
    this.moveJump = jump;
    this.moveSegments = describePathSegments(this.state, active, path);
    this.beginConfirmation(
      createAction(this.localPlayerId, 'charge-leg', {
        type: 'charge-leg',
        attackerId: active.id,
        path,
        ...(jump ? { traversal: { kind: jump.kind, takeoff: jump.takeoff, landing: jump.landing } } : {}),
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

    const distance = unitDistance(active, target);

    if (actionKind === 'shoot') {
      const canFire = (w: Weapon): boolean =>
        !!this.state && firingModels(this.state, active, target, w).length > 0;
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
        if (!canFire(weapon)) {
          this.showToast(
            distance > weapon.profile.range + 0.01
              ? `Out of range (${distance.toFixed(1)}" > ${weapon.profile.range}")`
              : `No line of sight to ${target.name}`
          );
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
          if (canFire(weapon)) {
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

      if (!canFire(currentWeapon)) {
        this.showToast(
          distance > currentWeapon.profile.range + 0.01
            ? `${currentWeapon.name} cannot reach ${target.name} (${distance.toFixed(1)}" > ${currentWeapon.profile.range}")`
            : `No line of sight to ${target.name}`
        );
        return;
      }

      // Weapons with the same name are one group: they follow each other onto the new target
      const group = rangedWeapons.filter((w) => w.name === currentWeapon.name);
      for (const mate of group) {
        if (mate.id !== currentWeapon.id && !canFire(mate)) {
          this.showToast(`${mate.name} cannot reach ${target.name}, and all ${mate.name} weapons must share a target`);
          return;
        }
      }
      const resultingTargets = new Set<string>([target.id]);
      for (const [wid, tid] of this.shootAllocations.entries()) {
        if (tid && !group.some((w) => w.id === wid)) resultingTargets.add(tid);
      }
      if (resultingTargets.size > 2) {
        this.showToast('Cannot split fire across more than 2 distinct targets');
        return;
      }

      for (const mate of group) this.shootAllocations.set(mate.id, target.id);

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

      const declared = this.declaredCharge;
      if (declared && declared.targetId !== target.id) {
        this.showToast(`The charge is locked to ${this.unitName(declared.targetId)}`);
        return;
      }
      if (this.activeAliveSquadModels.length > 1) {
        // A squad charges model by model: declare first, then place each model (legs share one budget)
        const begin = createAction(this.localPlayerId, 'begin-charge', {
          type: 'begin-charge',
          attackerId: active.id,
          targetId: target.id,
        });
        const check = validateAction(this.state!, begin);
        if (!check.valid) {
          this.showToast(check.reason ?? 'Cannot declare this charge');
          return;
        }
        this.beginConfirmation(
          begin,
          `Declare a charge on ${target.name}: then place each model of ${active.name} (up to ${(active.speed * 2).toFixed(0)}" each, into base contact with ${target.name} or as close as you can get, staying in coherency). The charge can't be undone: end the activation to abandon it (no melee)`
        );
        return;
      }
      // Charge ends at true base contact (centre distance = both base radii).
      const contactTarget = chargeDestination(active, target);
      // After legs, the final move may only use what the legs left of the one charge budget
      const chargeLeft = declared ? active.remainingMovement : active.speed * 2;
      const chargeSpent = declared ? active.speed * 2 - active.remainingMovement : 0;

      const path = findNavPath(this.state!, active, contactTarget, chargeLeft, {
        ignoreUnitId: target.id,
        keepAway: true,
      });
      const end = path[path.length - 1];
      const contact = chargeContact(active, target, end, MELEE_MAX_VERTICAL_REACH);
      const pathCharge = pathMovementCost(this.state!, path, active);
      const isDifficult = isPathDifficult(this.state!, path, active);
      const maxCharge = getEffectiveMaxMovement(active, 'charge', isDifficult);
      // The host must accept this exact path (the pathfinder can fall back to a straight line across a gap)
      const reachesInOne =
        contact === 'ok' &&
        pathCharge + chargeSpent <= maxCharge + 0.01 &&
        pathCharge <= chargeLeft + 0.01 &&
        validateAction(
          this.state!,
          createAction(this.localPlayerId, 'charge', {
            type: 'charge',
            attackerId: active.id,
            targetId: target.id,
            path,
            weaponId: weapon.id,
          })
        ).valid;
      if (!reachesInOne && !declared && contact !== 'too-high' && boardDistance(active.position, contactTarget) <= active.speed * 2 + 0.01) {
        // Not reachable by one safe path, but within reach in a straight line: offer to make it in legs
        this.beginConfirmation(
          createAction(this.localPlayerId, 'begin-charge', {
            type: 'begin-charge',
            attackerId: active.id,
            targetId: target.id,
          }),
          `Declare a charge on ${target.name}: no single safe path reaches it, so you make the charge in legs (walk to an edge, jump a gap), then click ${target.name} to make contact. The charge can't be undone: end the activation to abandon it (no melee). Budget ${(active.speed * 2).toFixed(0)}"`
        );
        return;
      }
      if (contact === 'too-far') {
        this.showToast('Cannot reach engagement range of target');
        return;
      }
      if (contact === 'too-high') {
        this.showToast('Target is on a ledge outside vertical melee reach (> 4.0" vertical difference)');
        return;
      }
      const chargeDistance = pathCharge;
      if (chargeDistance + chargeSpent > maxCharge + 0.01 || chargeDistance > chargeLeft + 0.01) {
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
      const dropNote = this.dropWarning(active, path, null);
      if (dropNote) traversalNotes += ` · ${dropNote}`;
      if (isPathDangerous(this.state!, path, active)) {
        traversalNotes += ' · ⚠️ DANGEROUS TERRAIN: Hazard test (1s wound)';
      }
      const chargeLegs = segmentSummary(describePathSegments(this.state!, active, path));
      if (chargeLegs) {
        traversalNotes += ` · ${chargeLegs}`;
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
          distance: 0,
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
      this.moveJump = null;
      this.moveSegments = describePathSegments(this.state!, active, path);
      this.hoveredEngagedTargetId = target.id;

      this.beginConfirmation(
        createAction(this.localPlayerId, 'charge', {
          type: 'charge',
          attackerId: active.id,
          targetId: target.id,
          path,
          weaponId: weapon.id,
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

      const distance = unitDistance(active, target);
      const firing = firingModels(this.state, active, target, weapon);
      if (firing.length === 0) {
        this.showToast(
          distance > weapon.profile.range + 0.01
            ? `${weapon.name} cannot reach ${target.name} (${distance.toFixed(1)}" > ${weapon.profile.range}")`
            : `No line of sight from ${weapon.name} to ${target.name}`
        );
        return;
      }
      // Indirect fired from a Hold ignores cover from sight blockers; after a move it is a normal shot
      const sightless = ignoresSight(active, weapon);

      const inCover =
        !hasTrait(weapon.profile.specialRules, 'blast') &&
        (target.status.includes('in-cover') ||
          (!sightless && targetCoverByMajority(this.state, firing, active, target)));
      const attacks = (weapon.profile.attacks as number) * firing.length;
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
    const sameNameSplit = allocations.find((a) =>
      allocations.some((b) => b.weapon.name === a.weapon.name && b.target.id !== a.target.id)
    );
    if (sameNameSplit) {
      this.showToast(`All ${sameNameSplit.weapon.name} weapons must shoot the same target`);
      return;
    }
    if (uniqueTargets.size > 2) {
      this.showToast('Cannot split fire across more than 2 distinct targets');
      return;
    }

    let summary: string;
    if (uniqueTargets.size === 1) {
      const target = allocations[0].target;
      const distance = unitDistance(active, target);
      const weaponNames = allocations.map((a) => a.weapon.name).join(' & ');
      const diceSummaries = allocations.map((a) => `${a.weapon.name}: ${a.diceText}`).join(' | ');
      summary = `${active.name} fires ${weaponNames} at ${target.name} (${distance.toFixed(1)}") · ${diceSummaries}`;
    } else {
      const splitSummaries = allocations
        .map(
          (a) =>
            `${a.weapon.name} at ${a.target.name} (${unitDistance(active, a.target).toFixed(1)}") [${a.diceText}]`
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
    this.stagedSquadModelPositions.clear();
    this.stagedSquadModelPaths.clear();
    this.stagedSquadModelTraversals.clear();
    this.squadBlockedModels.clear();
    this.squadJumpLeaderId = null;
    this.selectedSquadModelId = null;
    this.movePreview = null;
    this.movePathPreview = null;
    this.moveJump = null;
    this.moveSegments = null;
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
    this.moveJump = null;
    this.moveSegments = null;
    this.movePreviewDifficult = false;
    this.hoveredEngagedTargetId = null;
    this.shootAllocations.clear();
    this.selectedShootWeaponId = null;
    this.stagedSquadModelPositions.clear();
    this.stagedSquadModelPaths.clear();
    this.stagedSquadModelTraversals.clear();
    this.squadBlockedModels.clear();
    this.squadJumpLeaderId = null;
    this.selectedSquadModelId = null;
    this.selectedUnitId = this.state?.turnState.activeUnitId ?? null;
    // A declared charge can't be cancelled: back to choosing its next leg
    this.flow = this.declaredCharge ? { mode: 'targeting', action: 'charge' } : { mode: 'idle' };
    this.render();
  }

  private requestRematch(): void {
    const state = this.state;
    if (!state || state.status !== 'game-over' || this.rematchPending) return;
    if (this.peerState === 'disconnected') return;
    if (state.rematchRequestedBy?.includes(this.localPlayerId)) return;
    this.rematchPending = true;
    this.controller.submitAction(createAction(this.localPlayerId, 'request-rematch', { type: 'request-rematch' }));
    this.render();
  }

  private clearConcedeTimer(): void {
    if (this.concedeTimer) {
      clearTimeout(this.concedeTimer);
      this.concedeTimer = null;
    }
  }

  /** Send the concede. The host applies it locally; a guest waits up to 5 s for the host's confirmed state. */
  private submitConcede(): void {
    if (!this.state || this.state.status === 'game-over' || this.concedePending) return;
    this.concedeConfirmOpen = false;
    this.concedePending = true;
    this.controller.submitAction(createAction(this.localPlayerId, 'concede', { type: 'concede' }));
    const me = this.state.players.find((p) => p.id === this.localPlayerId);
    if (me?.role !== 'host') {
      this.concedeTimer = setTimeout(() => {
        this.concedeTimer = null;
        if (!this.concedePending) return;
        this.concedePending = false;
        this.showToast("Couldn't reach your opponent; the concede wasn't sent.");
      }, 5000);
    }
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
    if (this.peerState === 'disconnected' && state.status !== 'game-over') {
      alerts.push('<div class="sl-hud-alert sl-hud-alert-error">⚠️ Opponent disconnected — waiting for peer to reconnect... (Grace period: 5m)</div>');
    } else if (this.signalingState === 'reconnecting') {
      alerts.push('<div class="sl-hud-alert sl-hud-alert-warn">⚠️ Signaling disconnected — reconnecting to room...</div>');
    } else if (this.signalingState === 'disconnected') {
      alerts.push('<div class="sl-hud-alert sl-hud-alert-warn">⚠️ Signaling offline</div>');
    }
    // A toast shown while a banner is up stacks underneath it instead of being hidden behind it.
    const toastHtml = this.toast ? `<div class="sl-hud-toast">${this.toast}</div>` : '';
    const alertsHtml = alerts.length ? `<div class="sl-hud-alerts">${alerts.join('')}${toastHtml}</div>` : '';

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
        ${
          state.status === 'game-over'
            ? ''
            : `<button class="sl-hud-btn sl-hud-concede" data-action="concede-open" ${
                this.concedePending ? 'disabled' : ''
              }>${this.concedePending ? 'Conceding…' : 'Concede'}</button>`
        }
      </div>`;

    const concedeDialog =
      this.concedeConfirmOpen && state.status !== 'game-over'
        ? `
      <div class="sl-hud-concede-dialog">
        <p>Concede the match? You lose and your opponent wins.</p>
        <div class="sl-hud-gameover-actions">
          <button class="sl-hud-btn sl-hud-concede-confirm" data-action="concede-confirm">Concede</button>
          <button class="sl-hud-btn" data-action="concede-cancel">Cancel</button>
        </div>
      </div>`
        : '';

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

    const summary = state.status === 'game-over' ? summarizeMatch(state) : null;
    const sideLine = (playerId: string, colour: string): string => {
      const l = summary!.losses[playerId];
      const name = state.players.find((p) => p.id === playerId)?.name ?? 'Player';
      return `<div class="sl-hud-gameover-loss" style="color: ${colour};">${name} lost ${l.unitsLost} of ${l.unitsTotal} units (${l.modelsLost} of ${l.modelsTotal} models)</div>`;
    };
    const opponentAsked = !!state.rematchRequestedBy?.includes(opponent?.id ?? '');
    const iAsked = this.rematchPending || !!state.rematchRequestedBy?.includes(this.localPlayerId);
    const opponentLeft = this.peerState === 'disconnected';
    let rematchButton = '';
    let rematchNote = '';
    if (summary) {
      if (opponentLeft) {
        rematchButton = '<button class="sl-hud-btn" data-action="play-again" disabled>Opponent has left</button>';
      } else if (iAsked) {
        rematchButton = `<button class="sl-hud-btn" data-action="play-again" disabled>Waiting for ${opponentName}…</button>`;
      } else if (opponentAsked) {
        rematchNote = `<div class="sl-hud-gameover-rematch" style="margin-bottom: 12px; font-size: 13px; color: #ffd54f;">${opponentName} wants a rematch</div>`;
        rematchButton = '<button class="sl-hud-btn primary" data-action="play-again">Accept rematch</button>';
      } else {
        rematchButton = '<button class="sl-hud-btn primary" data-action="play-again">Play Again</button>';
      }
    }
    const gameOverModal = summary
      ? `
      <div class="sl-hud-gameover">
        <h2>${this.resultTitle()}</h2>
        <p class="sl-hud-gameover-reason">${state.endReason ?? 'Game ended'}</p>
        <div class="sl-hud-gameover-rounds" style="font-size: 12px; color: #b0bec5; margin-bottom: 8px;">Rounds played: ${summary.roundsPlayed} of ${MAX_ROUNDS}</div>
        <div class="sl-hud-gameover-score" style="margin: 14px 0 16px; font-size: 13px;">
          <div style="font-weight: 600; margin-bottom: 6px; color: #ffd54f;">Final Objective Score</div>
          <div style="display: flex; justify-content: center; gap: 16px; font-size: 15px; font-weight: 700;">
            <span style="color: #29b6f6;">Host: ${summary.objectiveScore[state.hostId] ?? 0}</span>
            <span style="color: #888;">—</span>
            <span style="color: #ef5350;">Guest: ${summary.objectiveScore[state.guestId] ?? 0}</span>
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
        <div class="sl-hud-gameover-losses" style="margin-bottom: 16px; font-size: 13px; display: flex; flex-direction: column; gap: 3px;">
          ${sideLine(state.hostId, '#29b6f6')}
          ${sideLine(state.guestId, '#ef5350')}
        </div>
        ${
          this.peerState === 'disconnected'
            ? `<div class="sl-hud-gameover-left" style="margin-bottom: 12px; font-size: 12px; color: #78909c;">${opponentName} has left.</div>`
            : ''
        }
        ${rematchNote}
        <div class="sl-hud-gameover-actions">
          ${rematchButton}
          <button class="sl-hud-btn" data-action="return-lobby">Return to Lobby</button>
        </div>
      </div>`
      : '';

    return `${alertsHtml}${header}${units}${right}${this.renderBottomBar()}${gameOverModal}${concedeDialog}${
      alerts.length ? '' : toastHtml
    }`;
  }

  private resultTitle(): string {
    const state = this.state!;
    if (state.winner === this.localPlayerId) return 'Victory';
    if (state.winner) return 'Defeat';
    return 'Draw';
  }

  private gameOverText(opponentName: string): string {
    const state = this.state!;
    if (state.winner === this.localPlayerId) return 'Victory';
    if (state.winner) return 'Defeat';
    return `Game over — ${state.endReason ?? 'draw'} vs ${opponentName}`;
  }

  /** "2/3 W": wounds a single tough model has taken so far (nothing for squads of Tough 1 models). */
  private woundTag(unit: Unit, tough: number): string | null {
    const living = (unit.models ?? []).filter((m) => !m.isDestroyed);
    if (tough <= 1 || living.length !== 1) return null;
    const taken = tough - Math.max(0, living[0].wounds);
    return taken > 0 ? `${taken}/${tough} W` : null;
  }

  private renderUnitRow(unit: Unit, teamClass: string = 'team-blue'): string {
    const statusTags: string[] = [];
    if (unit.status.includes('shaken')) statusTags.push('SHAKEN');
    if (unit.status.includes('fatigued')) statusTags.push('FATIGUED');
    if (unit.status.includes('routed')) statusTags.push('ROUTED');
    if (unit.status.includes('engaged')) statusTags.push('ENGAGED');
    if (unit.status.includes('in-cover')) statusTags.push('COVER');
    const tough = getUnitTough(unit);
    const woundTag = this.woundTag(unit, tough);
    if (woundTag) statusTags.push(woundTag);
    if (unit.isActivated) statusTags.push('ACTIVATED');

    const isDeployPhase = this.state?.turnState.phase === 'deployment';
    if (unit.isDeployed === false) {
      if (hasTrait(unit.specialRules, 'ambush')) {
        statusTags.push('DROP RESERVE (RD 2+)');
      } else if (hasTrait(unit.specialRules, 'scout')) {
        statusTags.push('SCOUT');
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
    if (unit.status.includes('fatigued')) statusTags.push('FATIGUED');
    if (unit.status.includes('engaged')) statusTags.push('ENGAGED');
    if (unit.status.includes('in-cover')) statusTags.push('COVER');
    const enemyTough = getUnitTough(unit);
    const enemyWoundTag = this.woundTag(unit, enemyTough);
    if (enemyWoundTag) statusTags.push(enemyWoundTag);
    if (unit.isActivated) statusTags.push('ACTIVATED');

    if (unit.isDeployed === false) {
      if (hasTrait(unit.specialRules, 'ambush')) {
        statusTags.push('DROP RESERVE');
      } else if (hasTrait(unit.specialRules, 'scout')) {
        statusTags.push('SCOUT');
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

  /** "X took 3 wounds, Y took 1 (+1 Fear): X loses" for one melee result. */
  private meleeResultText(r: MeleeResultRecord): string {
    const side = (x: MeleeResultRecord['sides'][number]) =>
      `${x.unitName} took ${x.wounds} wound${x.wounds === 1 ? '' : 's'}${x.fearBonus ? ` (+${x.fearBonus} Fear)` : ''}`;
    const loser = r.sides.find((x) => x.unitId === r.loserId);
    return `${side(r.sides[0])}, ${side(r.sides[1])}: ${loser ? `${loser.unitName} loses` : 'tied, nobody tests Morale'}`;
  }

  private meleeResultsHtml(results: MeleeResultRecord[]): string {
    return results
      .map((r) => `<div class="sl-hud-dice-label">Melee: ${this.meleeResultText(r)}</div>`)
      .join('');
  }

  /** One line per Morale Test: the die, the Quality it needed and the result (Passed, Shaken, Routed). */
  private moraleTestsHtml(tests: MoraleTestRecord[]): string {
    return tests
      .map((t) => {
        const result = t.outcome === 'passed' ? 'passed' : t.outcome === 'routed' ? 'Routed' : 'Shaken';
        const dieHtml =
          t.roll !== undefined
            ? `<span class="sl-die ${t.passed || t.fearlessRoll !== undefined && t.fearlessRoll >= 4 ? 'hit-pass' : 'hit-miss'}">${t.roll}</span>`
            : '';
        const fearlessHtml =
          t.fearlessRoll !== undefined
            ? `<span class="sl-hud-dice-sublabel" style="margin: 0 4px 0 8px;">Fearless (4+):</span><span class="sl-die ${
                t.fearlessRoll >= 4 ? 'hit-pass' : 'hit-miss'
              }">${t.fearlessRoll}</span>`
            : '';
        const note = t.roll === undefined ? ' (already Shaken: fails without a roll)' : '';
        return `
          <div class="sl-hud-dice-label">${t.unitName} Morale (need Q${t.effectiveQuality}+)${note}:</div>
          <div class="sl-hud-dice-row">${dieHtml}${fearlessHtml}<span class="sl-hud-dice-summary" style="margin-left:8px;">${result}</span></div>`;
      })
      .join('');
  }

  /**
   * How each Blast weapon's hits were multiplied and shared out, e.g.
   * "Frag Launcher Blast(3): 1 hit × 3 = 3 hits → Test Squad A 2 · Test Squad B 1".
   */
  private blastSplitHtml(splits: BlastSplitRecord[] | undefined): string {
    if (!splits || splits.length === 0) return '';
    const plural = (n: number) => `${n} hit${n === 1 ? '' : 's'}`;
    return splits
      .map((s) => {
        const base = s.multiplier > 0 ? Math.round(s.totalHits / s.multiplier) : s.totalHits;
        const shares = s.shares
          .map((p) => `${p.targetName} <strong>${p.hits}</strong>${p.hits >= p.cap && s.shares.length > 1 ? ` (max ${p.cap})` : ''}`)
          .join(' · ');
        const where = s.shares.length > 1 ? ` → ${shares}` : ` (max ${s.shares[0]?.cap ?? 0}: one per model)`;
        const lost = s.lostHits > 0 ? ` · ${plural(s.lostHits)} lost (every unit at its max)` : '';
        return `<div class="sl-hud-dice-summary sl-hud-blast-split" style="font-size: 11px; color: #fbbf24;">${s.weaponName} Blast(${s.multiplier}): ${plural(base)} × ${s.multiplier} = ${plural(s.totalHits)}${where}${lost}</div>`;
      })
      .join('');
  }

  /** Blast hits that spilled onto other units: one block per unit with its own Defense dice and result. */
  private blastSplashHtml(splash: BlastSplashOutcome[] | undefined): string {
    if (!splash || splash.length === 0) return '';
    const lines = splash
      .map((b) => {
        const status = b.targetDestroyed ? ' · down' : b.targetShaken ? ' · shaken' : '';
        const dice = (b.defenseRolls ?? [])
          .map((r, di) => {
            const blocked = b.blockedRolls ? (b.blockedRolls[di] ?? false) : r > 1 && r >= (b.effectiveDefense ?? 5);
            return `<span class="sl-die ${blocked ? 'def-pass' : 'def-fail'}">${r}</span>`;
          })
          .join('');
        return `<div class="sl-hud-dice-label">Blast spill on ${b.targetName ?? b.targetId}: Defense (need D${b.effectiveDefense ?? '?'}+):</div>
          ${dice ? `<div class="sl-hud-dice-row">${dice}</div>` : ''}
          <div class="sl-hud-dice-summary" style="font-size: 11px;">${b.hitCount} hit${
          b.hitCount === 1 ? '' : 's'
        } · ${b.blockedCount} blocked · <strong>${b.wounds} wound${b.wounds === 1 ? '' : 's'}</strong>${status}</div>`;
      })
      .join('');
    return `<div style="margin-top: 6px; padding-top: 4px; border-top: 1px dashed rgba(255,255,255,0.2);">${lines}</div>`;
  }

  private renderDice(): string {
    const state = this.state!;
    for (let i = state.actionLog.length - 1; i >= 0; i--) {
      const entry = state.actionLog[i];
      if (!entry.dice) continue;

      // Movement hazards (jumps, falls, dangerous terrain): a dice story with no attack
      const traversal = entry.dice.outcome.traversal;
      if (traversal && traversal.length > 0 && entry.dice.outcome.attackCount === 0) {
        const mover = this.unitName(entry.dice.context.attackerId);
        const eventsHtml = traversal
          .map((e) => {
            const dieHtml = (e.rolls ?? [])
              .map((r) => {
                const ok =
                  e.type === 'hazard' ? r !== 1 : e.target !== undefined ? r >= e.target : r === 6 || r >= 2;
                return `<span class="sl-die ${ok ? 'hit-pass' : 'hit-miss'}">${r}</span>`;
              })
              .join('');
            return `<div class="sl-hud-dice-label">${e.text}</div>${
              dieHtml ? `<div class="sl-hud-dice-row">${dieHtml}</div>` : ''
            }`;
          })
          .join('');
        return `
          <div class="sl-hud-dice">
            <div class="sl-hud-dice-title">Movement hazards: ${mover}</div>
            ${eventsHtml}
            ${entry.dice.outcome.moraleTests?.length ? this.moraleTestsHtml(entry.dice.outcome.moraleTests) : ''}
          </div>`;
      }

      // End of an activation: the melee results and Morale Tests it triggered (no attack in this entry)
      if (
        (entry.dice.outcome.moraleTests?.length || entry.dice.outcome.meleeResults?.length) &&
        entry.dice.outcome.attackCount === 0
      ) {
        return `
          <div class="sl-hud-dice">
            <div class="sl-hud-dice-title">${entry.dice.outcome.meleeResults?.length ? 'Melee result & Morale' : 'Morale'}</div>
            ${this.meleeResultsHtml(entry.dice.outcome.meleeResults ?? [])}
            ${this.moraleTestsHtml(entry.dice.outcome.moraleTests ?? [])}
          </div>`;
      }

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
      const hasRending = hasTrait(allAttackerRules, 'rending');

      // A casualty pick (the owner's, or the host's on timeout) that also ended the melee with the step back
      if (
        entry.action.type === 'pick-casualties' ||
        (entry.action.type === 'respond-reaction' &&
          (entry.action.payload as { choiceId?: string }).choiceId === 'auto-pick-casualties')
      ) {
        const stepBack = outcome.pushedBack
          ? `<div class="sl-hud-pushback-notice" style="margin-top: 6px; font-size: 11px; color: #4ade80; font-style: italic;">Charger pushed back 1" — both units Fatigued</div>`
          : '';
        return `
          <div class="sl-hud-dice">
            <div class="sl-hud-dice-title">Casualties removed: ${target?.name ?? 'unit'}</div>
            ${stepBack}
          </div>`;
      }

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

            return `
              <div class="sl-hud-alloc-block" style="margin-top: 6px; padding-top: 6px; border-top: 1px dashed rgba(255,255,255,0.15);">
                <div class="sl-hud-dice-label" style="color: #93c5fd; font-weight: bold; font-size: 11px;">
                  ${alloc.weaponName ?? alloc.weaponId} → ${alloc.targetName ?? alloc.targetId}
                </div>
                <div class="sl-hud-dice-row">
                  <span class="sl-hud-dice-sublabel" style="font-size:10px; margin-right:4px;">Hit (Q${alloc.effectiveQuality ?? 4}+):</span> ${aHitDice}
                  <span class="sl-hud-dice-sublabel" style="font-size:10px; margin: 0 4px 0 8px;">Def (D${alloc.effectiveDefense ?? 5}+):</span> ${aDefDice}
                </div>
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
            ${this.blastSplitHtml(outcome.blastSplits)}
            ${this.blastSplashHtml(outcome.blastSplash)}
          </div>`;
      }

      const hitDiceHtml = toHit
        ? toHit.rolls
            .map((r) => {
              const isHit = r > 1 && (r >= 6 || r >= effectiveQ);
              const traitNote = r >= 6 && hasRupture ? ' · Rupture (+2 AP)' : r >= 6 && hasRending ? ' · Rending (AP 4)' : '';
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

      const outcomeStatus = outcome.targetDestroyed ? ' · target down' : outcome.targetShaken ? ' · shaken' : '';
      const summaryWounds = outcome.wounds > 0
        ? `<strong>${outcome.wounds} unsaved wound${outcome.wounds === 1 ? '' : 's'}</strong>${outcomeStatus}`
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
        const retHasRending = hasTrait(retAttackerRules, 'rending');

        const retHitDiceHtml = retToHit
          ? retToHit.rolls
              .map((r) => {
                const isHit = r > 1 && (r >= 6 || r >= retEffectiveQ);
                const traitNote = r >= 6 && retHasRupture ? ' · Rupture (+2 AP)' : r >= 6 && retHasRending ? ' · Rending (AP 4)' : '';
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

        const retStatus = ret.targetDestroyed ? ' · charger down' : ret.targetShaken ? ' · charger shaken' : '';
        const retSummaryWounds = ret.wounds > 0
          ? `<strong>${ret.wounds} unsaved wound${ret.wounds === 1 ? '' : 's'}</strong>${retStatus}`
          : '<strong>0 wounds</strong>';

        retaliationHtml = `
          <div class="sl-hud-dice-retaliation" style="margin-top: 8px; border-top: 1px dashed rgba(255,255,255,0.2); padding-top: 6px;">
            <div class="sl-hud-dice-title" style="font-size: 11px; opacity: 0.9;">Defender Retaliation: ${target?.name ?? 'Defender'} → ${attacker?.name ?? 'Charger'}</div>
            <div class="sl-hud-dice-label">To-Hit (need Q${retEffectiveQ}+${retToHitMods}):</div>
            <div class="sl-hud-dice-row">${retHitDiceHtml}</div>
            <div class="sl-hud-dice-label">Defense (need D${retChargerD}+${retDefMods}):</div>
            <div class="sl-hud-dice-row">${retDefDiceHtml}</div>
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
        entry.action.type === 'respond-reaction' &&
        (entry.action.payload as { choiceId?: string }).choiceId !== 'auto-pile-in'
          ? `Defender Retaliation: ${attacker?.name ?? 'Defender'} → ${target?.name ?? 'Charger'}`
          : `${attacker?.name ?? 'Attacker'} → ${target?.name ?? 'target'}`;

      return `
        <div class="sl-hud-dice">
          <div class="sl-hud-dice-title">${titleText}</div>
          <div class="sl-hud-dice-label">To-Hit (need Q${effectiveQ}+${toHitMods}):</div>
          <div class="sl-hud-dice-row">${hitDiceHtml}</div>
          ${this.blastSplitHtml(outcome.blastSplits)}
          <div class="sl-hud-dice-label">${outcome.blastSplash?.length ? `${target?.name ?? 'Target'} ` : ''}Defense (need D${targetD}+${defMods}):</div>
          <div class="sl-hud-dice-row">${defDiceHtml}</div>
          <div class="sl-hud-dice-summary">
            ${outcome.hitCount} hit${outcome.hitCount === 1 ? '' : 's'} ·
            ${outcome.blockedCount} blocked ·
            ${summaryWounds}
          </div>
          ${this.blastSplashHtml(outcome.blastSplash)}
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
        const hazards = entry.dice?.outcome.traversal;
        const hazardText = hazards && hazards.length > 0 ? ` — ${hazards.map((e) => e.text).join('; ')}` : '';
        const morale = entry.dice?.outcome.moraleTests;
        const moraleText =
          morale && morale.length > 0
            ? ` — Morale: ${morale
                .map((t) => `${t.unitName} ${t.outcome === 'passed' ? 'passed' : t.outcome === 'routed' ? 'Routed' : 'Shaken'}`)
                .join(', ')}`
            : '';
        const melee = entry.dice?.outcome.meleeResults;
        const meleeText = melee && melee.length > 0 ? ` — ${melee.map((r) => this.meleeResultText(r)).join('; ')}` : '';
        return `<div class="sl-hud-log-entry">${actor?.name ?? '?'} ${this.logVerb(entry.action)}${hazardText}${meleeText}${moraleText}</div>`;
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
      case 'advance':
        return `advanced ${this.unitName((action.payload as any).unitId)}`;
      case 'rush':
        return `rushed ${this.unitName((action.payload as any).unitId)}`;
      case 'shoot':
        return `shot ${this.unitName((action.payload as any).targetId)}`;
      case 'begin-charge':
        return `declared a charge on ${this.unitName((action.payload as any).targetId)}`;
      case 'charge-leg':
        return 'made a charge leg';
      case 'charge':
        return `charged ${this.unitName((action.payload as any).targetId)}`;
      case 'fight':
        return `fought ${this.unitName((action.payload as any).targetId)}`;
      case 'pile-in-move':
        return 'piled in';
      case 'pick-casualties':
        return `removed casualties from ${this.unitName((action.payload as any).unitId)}`;
      case 'respond-reaction': {
        const p = action.payload as { choiceId: string };
        if (p.choiceId === 'auto-pile-in') return 'piled in (auto)';
        if (p.choiceId === 'auto-pick-casualties') return 'casualties picked (auto)';
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

      const flowSummary = this.flow.summary;
      const stopText =
        this.flow.action.type === 'rush'
          ? this.rushStopTexts.find((t) => flowSummary.includes(`[${t}]`))
          : undefined;
      const stoppedAtBase = stopText !== undefined;

      if (stoppedAtBase) {
        difficultWarningHtml = `
          <div class="sl-hud-warning-badge" style="background: rgba(41, 182, 246, 0.18); border: 1px solid #29b6f6; color: #81d4fa; padding: 4px 12px; border-radius: 6px; font-size: 12px; font-weight: 500; margin-bottom: 8px; display: flex; align-items: center; gap: 6px;">
            <span>ℹ️</span>
            <span><strong>Rush stops short:</strong> ${stopText}</span>
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
      const casualtyPrompt = this.casualtyContext();
      if (casualtyPrompt) return this.casualtyPromptHtml(casualtyPrompt, remainingSec, dataCardSlot);
      if (pendingReaction.type === 'pick-casualties' && pendingReaction.promptingPlayerId !== this.localPlayerId) {
        const ownerName = this.state.players.find((p) => p.id === pendingReaction.promptingPlayerId)?.name ?? 'opponent';
        return `
        <div class="sl-hud-bottom-dock">
          ${dataCardSlot}
          <div class="sl-hud-bottom sl-hud-reaction-waiting">
            <span class="sl-hud-hint">Waiting for ${ownerName} to remove casualties (<span class="sl-hud-reaction-waiting-timer">${remainingSec}s</span>)…</span>
          </div>
        </div>`;
      }
      const pushPrompt = this.pushContext();
      if (pushPrompt) return this.pushPromptHtml(pushPrompt, remainingSec, dataCardSlot);
      const pileInPrompt = this.pileInContext();
      if (pileInPrompt) return this.pileInPromptHtml(pileInPrompt, remainingSec, dataCardSlot);
      if (pendingReaction.type === 'pile-in' && pendingReaction.promptingPlayerId !== this.localPlayerId) {
        const defenderName = this.state.players.find((p) => p.id === pendingReaction.promptingPlayerId)?.name ?? 'opponent';
        return `
        <div class="sl-hud-bottom-dock">
          ${dataCardSlot}
          <div class="sl-hud-bottom sl-hud-reaction-waiting">
            <span class="sl-hud-hint">Waiting for ${defenderName} to pile in (<span class="sl-hud-reaction-waiting-timer">${remainingSec}s</span>)…</span>
          </div>
        </div>`;
      }
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
              ${this.aimChipHtml()}
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

      // After a first leg, say how much of the move or rush is left (a declared charge always does)
      const splitLeft =
        active && (this.flow.action === 'move' || this.flow.action === 'rush') && (active.hasMoved || active.isRushing)
          ? ` — ${this.distanceLeft(active, this.flow.action).toFixed(1)}" left`
          : '';
      let instruction =
        this.flow.action === 'move'
          ? `Click a destination on the board (auto-paths around obstacles)${splitLeft}`
          : this.flow.action === 'rush'
          ? `Click a destination to Rush (double move, auto-paths around obstacles)${splitLeft}`
          : this.flow.action === 'charge'
          ? this.declaredCharge && active
            ? `Charge declared on ${this.unitName(this.declaredCharge.targetId)}: ${active.remainingMovement.toFixed(1)}" left. Click a spot to walk a leg (at an edge, click across the gap to jump), or click the target to make contact`
            : 'Click an enemy unit within charge range to Charge into melee and strike'
          : `Select an enemy target within the red range ring (${this.flow.action})`;

      const isSquadChargePlacing = this.isSquadChargeFlow;
      const isSquadMovement =
        ((this.flow.action === 'move' || this.flow.action === 'rush') &&
          this.activeAliveSquadModels.length > 1) ||
        isSquadChargePlacing;

      let squadChipsHtml = '';
      if (isSquadMovement && active) {
        const alive = this.activeAliveSquadModels;
        const currentModel = this.selectedSquadModel;
        // The selected model's own distance: it may differ from its squad-mates' after a split move
        const allowance = this.distanceLeft(active, this.flow.action === 'rush' ? 'rush' : 'move', currentModel);
        const allowanceText = Number.isInteger(allowance) ? String(allowance) : allowance.toFixed(1);
        const currentModelIndex = alive.findIndex((m) => m.id === currentModel?.id);
        const placedCount = this.stagedSquadModelPositions.size;

        if (isSquadChargePlacing && this.declaredCharge) {
          const modelNo = (currentModelIndex >= 0 ? currentModelIndex : 0) + 1;
          instruction = `Charge on ${this.unitName(this.declaredCharge.targetId)}: place Model ${modelNo} of ${alive.length} (${this.distanceLeft(active, 'charge', currentModel).toFixed(1)}" left): click a spot, or click the target for base contact. Models you skip move up as close as they can once one of yours touches the target (Confirm charge)`;
        } else if (placedCount === 0) {
          instruction = `Place Model ${(currentModelIndex >= 0 ? currentModelIndex : 0) + 1} of ${alive.length} (${active.name}) within ${allowanceText}"`;
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
                const blockedWhy = !isPlaced ? this.squadBlockedModels.get(m.id) : undefined;
                return `
                  <button class="sl-hud-btn sl-hud-chip ${isSelected ? 'active' : ''}"
                    data-action="select-squad-model"
                    data-model-id="${m.id}"
                    ${blockedWhy ? `title="Cannot reach the take-off edge: ${blockedWhy.replace(/"/g, '&quot;')}"` : ''}
                    style="${
                      blockedWhy
                        ? 'background: rgba(244, 67, 54, 0.25); border-color: #f44336; color: #ef9a9a;'
                        : isSelected
                        ? 'background: #00bcd4; color: #000; font-weight: bold;'
                        : isPlaced
                        ? 'background: rgba(76, 175, 80, 0.25); border-color: #4caf50; color: #a5d6a7;'
                        : ''
                    }">
                    ${isPlaced ? '✓ ' : blockedWhy ? '✗ ' : ''}Model ${idx + 1}
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
            ${this.aimChipHtml()}
            <div class="sl-hud-move-warning" style="display: none; background: rgba(255, 152, 0, 0.2); border: 1px solid #ff9800; color: #ffb74d; padding: 4px 12px; border-radius: 6px; font-size: 12px; font-weight: 500; text-align: center;"></div>
            ${squadChipsHtml}
            <div style="display: flex; align-items: center; gap: 10px;">
              <span class="sl-hud-hint">${instruction}</span>
              ${
                isSquadMovement && this.stagedSquadModelPositions.size > 0
                  ? `${
                      this.stagedSquadModelPositions.size < this.activeAliveSquadModels.length
                        ? `<button class="sl-hud-btn primary" data-action="confirm-squad-move">${
                            isSquadChargePlacing ? 'Confirm charge' : 'Confirm move'
                          }</button>`
                        : ''
                    }<button class="sl-hud-btn" data-action="reset-squad-move">Reset Placement</button>`
                  : ''
              }
              ${
                this.flow.action === 'charge' && this.declaredCharge
                  ? '<button class="sl-hud-btn" data-action="end-activation" title="Abandon the charge and end the activation with no melee">Abandon charge</button>'
                  : '<button class="sl-hud-btn" data-action="cancel">Cancel</button>'
              }
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

      const isShaken = active.status.includes('shaken');
      const canMove = !active.isDestroyed && !isShaken && !engaged && hasMovementLeft && (!hasAttacked || isRushing);
      const canRush =
        !active.isDestroyed &&
        !isShaken &&
        !engaged &&
        ((!hasMoved && !hasAttacked) || (isRushing && hasMovementLeft));
      const rangedWeapon = active.weapons.find((w) => w.isEquipped && w.profile.type === 'ranged');
      const meleeWeapon = active.weapons.find((w) => w.isEquipped && w.profile.type === 'melee');
            const canCharge = !active.isDestroyed && !isShaken && !engaged && !hasMoved && !hasAttacked && !isRushing && !!meleeWeapon;

      // Before moving/attacking, show Hold (stay put & end activation).
      // Once the unit has moved or attacked, show End Activation instead.
      const squadPositions = (active.models ?? [])
        .filter((m) => !m.isDestroyed)
        .map((m) => m.position ?? active.position);
      const outOfCoherency =
        !hasActed &&
        !active.status.includes('shaken') &&
        squadPositions.length > 1 &&
        !validateSquadCoherency(squadPositions).coherent;
      // Shooting without moving is a Hold: an out-of-coherency squad must move first
      const canShoot =
        !active.isDestroyed && !isShaken && !engaged && !hasAttacked && !isRushing && !!rangedWeapon && !outOfCoherency;
      const finishBtn = isShaken
        ? `<button class="sl-hud-btn primary" data-action="end-activation" title="A Shaken unit can only end its activation idle, which clears Shaken">End Activation (idle)</button>`
        : !hasActed
        ? `<button class="sl-hud-btn" data-action="hold" ${outOfCoherency ? 'disabled' : ''}>Hold</button>`
        : `<button class="sl-hud-btn primary" data-action="end-activation">End Activation</button>`;

      return `
        <div class="sl-hud-bottom-dock">
          ${dataCardSlot}
          <div class="sl-hud-bottom sl-hud-actions">
            <span class="sl-hud-active-name">${active.name}</span>
            ${
              outOfCoherency
                ? `<span class="sl-hud-hint" style="color:#ffb74d">Squad is out of coherency: this activation's move must bring it back together</span>`
                : ''
            }
            <button class="sl-hud-btn" data-action="move" ${canMove ? '' : 'disabled'}>Advance</button>
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
      const dist = markerGap(pos, obj.position, 0); // hover point, no base
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
    if (unit.status.includes('fatigued')) statusTags.push('FATIGUED');
    if (unit.status.includes('routed')) statusTags.push('ROUTED');
    if (unit.status.includes('engaged')) statusTags.push('ENGAGED');
    if (unit.status.includes('in-cover')) statusTags.push('IN COVER');
    const cardTough = getUnitTough(unit);
    const cardWoundTag = this.woundTag(unit, cardTough);
    if (cardWoundTag) statusTags.push(cardWoundTag);
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
              <tr><th>Quality</th><th>Defense</th><th>Tough</th><th>Models</th><th>Move</th><th>Charge</th></tr>
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
    if ('id' in targetOrPoint && 'weapons' in targetOrPoint) {
      const weapon = this.shootPreviewWeapon(shooter, targetOrPoint);
      if (weapon) return computeSquadShootingRayDebug(this.state, shooter, targetOrPoint, weapon);
    }
    return computeShootingRayDebug(this.state, shooter, targetOrPoint);
  }

  /** The ranged weapon the shooting preview uses: the selected one, else the first that can fire, else the first. */
  private shootPreviewWeapon(attacker: Unit, target: Unit): Weapon | null {
    const ranged = attacker.weapons.filter((w) => w.isEquipped && w.profile.type === 'ranged');
    if (ranged.length === 0) return null;
    const selected = this.selectedShootWeaponId ? ranged.find((w) => w.id === this.selectedShootWeaponId) : null;
    if (selected) return selected;
    if (this.state) {
      const state = this.state;
      const canFire = ranged.find((w) => firingModels(state, attacker, target, w).length > 0);
      if (canFire) return canFire;
    }
    return ranged[0];
  }

  /** Shooter, enemy unit and weapon for the live shooting preview (aim lines, "N of M" chip), or null. */
  private shootPreview(): { attacker: Unit; target: Unit; weapon: Weapon } | null {
    if (!this.state) return null;
    const attacker = this.activeUnit;
    if (!attacker || attacker.ownerId !== this.localPlayerId) return null;
    let targetId: string | null = null;
    if (this.flow.mode === 'targeting' && this.flow.action === 'shoot') {
      targetId = this.hoveredUnitId;
    } else if (this.flow.mode === 'confirming' && this.flow.action.type === 'shoot') {
      targetId = (this.flow.action.payload as { targetId?: string }).targetId ?? null;
    }
    if (!targetId) return null;
    const target = this.state.units.find(
      (u) => u.id === targetId && u.ownerId !== this.localPlayerId && !u.isDestroyed
    );
    if (!target) return null;
    const weapon = this.shootPreviewWeapon(attacker, target);
    return weapon ? { attacker, target, weapon } : null;
  }

  /** "N of M models can fire" for the previewed weapon and target; empty when nothing is being aimed. */
  private aimChipText(): string {
    const preview = this.shootPreview();
    if (!preview || !this.state) return '';
    const aim = squadAim(this.state, preview.attacker, preview.target, preview.weapon);
    if (aim.shooterCount <= 1) return '';
    return `${aim.firingCount} of ${aim.shooterCount} models can fire (${preview.weapon.name})`;
  }

  private aimChipHtml(): string {
    const text = this.aimChipText();
    return `<div class="sl-hud-aim-chip" style="display: ${
      text ? 'block' : 'none'
    }; background: rgba(255, 112, 67, 0.18); border: 1px solid #ff7043; color: #ffab91; padding: 4px 12px; border-radius: 6px; font-size: 12px; font-weight: 500; text-align: center;">${text}</div>`;
  }

  private updateAimChip(): void {
    const el = this.root.querySelector('.sl-hud-aim-chip') as HTMLElement | null;
    if (!el) return;
    const text = this.aimChipText();
    el.textContent = text;
    el.style.display = text ? 'block' : 'none';
  }

  /** Aim lines per attacker model (and the aimed-at target model) for the shooting preview. */
  private computeAimLines(): AimLinesMarker | null {
    const preview = this.shootPreview();
    if (!preview || !this.state) return null;
    const aim = squadAim(this.state, preview.attacker, preview.target, preview.weapon, this.hoveredModelId ?? undefined);
    return {
      lines: aim.aims.map((a) => ({ from: a.from, to: a.to, fires: a.fires })),
      ...(aim.aimedModel ? { aimedModel: aim.aimedModel } : {}),
    };
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
            <span class="sl-hud-datacard-tags">${losTag} · ${coverTag}${
              ray.modelRays
                ? ` · <span style="color:#ffab91;">${ray.firingCount ?? 0} of ${ray.shooterCount ?? 0} models fire · ${
                    ray.coveredModelCount ?? 0
                  }/${ray.targetModelCount ?? 0} target models in cover</span>`
                : ''
            }</span>
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

  /**
   * The one extra warning a previewed path needs beyond its jump chip / leg labels: only the too-high "fall"
   * leg. Jumps and gap jumps are already described, with the engine's distance and dice, by the chip or the
   * leg label, so they never get a second line here.
   */
  private dropWarning(active: Unit, path: Vector3[], jump: JumpOption | null): string {
    if (jump) return '';
    for (let i = 1; i < path.length; i++) {
      const cls = classifySegment(this.state!, path[i - 1], path[i], active, path[i - 2], path[i + 1]);
      if (cls.kind === 'fall') return describeDrop(cls.height, active);
    }
    return '';
  }

  /** Summary text for the traversal part of a previewed move: the declared jump, or the labelled legs. */
  private traversalSummary(active: Unit, path: Vector3[], jump: JumpOption | null): string {
    if (jump) return ` · ${jumpChip(jump).text}`;
    const legs = segmentSummary(describePathSegments(this.state!, active, path));
    return legs ? ` · ${legs}` : '';
  }

  /** The too-wide hint, unless ordinary movement still reaches the cursor (another way round). */
  private tooWideHint(resolved: MoveTarget, path: Vector3[]): { distance: number } | null {
    if (!resolved.tooWide || resolved.jump) return null;
    const end = path.length > 0 ? path[path.length - 1] : null;
    if (end && boardDistance(end, resolved.target) <= 0.5 && Math.abs((end.y ?? 0) - (resolved.target.y ?? 0)) <= 0.5) {
      return null;
    }
    return resolved.tooWide;
  }

  /** Hover chip for the previewed move: the declared jump / fall, or the labelled legs (climb, drop). */
  private showTraversalChip(): void {
    const el = this.root.querySelector('.sl-hud-move-warning') as HTMLElement | null;
    if (!el) return;
    if (this.moveTooWide && !this.moveJump) {
      el.textContent = tooWideText(this.moveTooWide.distance);
      el.style.display = 'block';
      el.style.background = 'rgba(244, 67, 54, 0.25)';
      el.style.borderColor = '#f44336';
      el.style.color = '#ff8a80';
      return;
    }
    if (this.moveJump) {
      const chip = jumpChip(this.moveJump);
      el.textContent = chip.text;
      el.style.display = 'block';
      el.style.background = chip.warning ? 'rgba(244, 67, 54, 0.25)' : 'rgba(255, 112, 67, 0.2)';
      el.style.borderColor = chip.warning ? '#f44336' : '#ff7043';
      el.style.color = chip.warning ? '#ff8a80' : '#ffab91';
      return;
    }
    const legs = this.moveSegments ? segmentSummary(this.moveSegments) : '';
    if (!legs) return;
    if (el.style.display === 'none') {
      el.textContent = legs;
      el.style.display = 'block';
      el.style.background = 'rgba(255, 193, 7, 0.15)';
      el.style.borderColor = '#ffc107';
      el.style.color = '#ffd54f';
    } else {
      el.insertAdjacentText('beforeend', ` · ${legs}`);
    }
  }

  private updateMoveWarning(
    isDifficult: boolean,
    actionKind: string,
    stopText: string = ''
  ): void {
    const warningEl = this.root.querySelector('.sl-hud-move-warning') as HTMLElement | null;
    if (!warningEl) return;
    if (stopText && actionKind === 'rush') {
      warningEl.textContent = `ℹ️ ${stopText}`;
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
          case 'toggle-casualty-model':
            if (el.dataset.modelId) this.toggleCasualtyModel(el.dataset.modelId);
            break;
          case 'auto-pick-casualties':
            this.autoPickCasualtyModels();
            break;
          case 'confirm-casualties':
            this.confirmCasualties();
            break;
          case 'push-confirm':
            this.beginPushPicking();
            break;
          case 'select-push-model':
            if (el.dataset.modelId) this.selectPushModel(el.dataset.modelId);
            break;
          case 'push-send':
            this.confirmPush();
            break;
          case 'push-back':
            this.backFromPush();
            break;
          case 'select-pile-in-model':
            if (el.dataset.modelId) this.selectPileInModel(el.dataset.modelId);
            break;
          case 'auto-pile-in':
            this.autoPlacePileIn();
            break;
          case 'confirm-pile-in':
            this.confirmPileIn();
            break;
          case 'reset-pile-in':
            this.resetPileIn();
            break;
          case 'confirm-squad-move':
            if (this.flow.mode === 'targeting' && (this.flow.action === 'move' || this.flow.action === 'rush')) {
              this.finishSquadMove(this.flow.action);
            } else if (this.isSquadChargeFlow) {
              this.finishSquadMove('charge');
            }
            break;
          case 'reset-squad-move':
            this.stagedSquadModelPositions.clear();
            this.stagedSquadModelPaths.clear();
    this.stagedSquadModelTraversals.clear();
    this.squadBlockedModels.clear();
    this.squadJumpLeaderId = null;
            this.selectedSquadModelId = this.activeAliveSquadModels[0]?.id ?? null;
            this.movePathPreview = null;
            this.moveJump = null;
            this.moveSegments = null;
            this.movePreview = null;
            this.render();
            this.emitMarkers();
            break;
          case 'cancel':
            this.cancel();
            break;
          case 'concede-open':
            this.concedeConfirmOpen = true;
            this.render();
            break;
          case 'concede-cancel':
            this.concedeConfirmOpen = false;
            this.render();
            break;
          case 'concede-confirm':
            this.submitConcede();
            break;
          case 'play-again':
            this.requestRematch();
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
              this.declaredCharge
                ? `Abandon the charge and end ${this.activeUnit?.name ?? 'the'} activation: no melee`
                : `End ${this.activeUnit?.name ?? 'the'} activation`
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
        if (
          entry.dice &&
          entry.dice.outcome.wounds !== undefined &&
          !(entry.dice.outcome.traversal && entry.dice.outcome.attackCount === 0 && entry.dice.outcome.wounds === 0) &&
          !(entry.dice.outcome.moraleTests && entry.dice.outcome.attackCount === 0 && entry.dice.outcome.wounds === 0)
        ) {
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
      aimLines: this.computeAimLines(),
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

      if (this.myTurn && currentDeployUnit && hasTrait(currentDeployUnit.specialRules, 'scout')) {
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
        (this.flow.action.type === 'advance' ||
          this.flow.action.type === 'rush' ||
          this.flow.action.type === 'charge' ||
          this.flow.action.type === 'charge-leg' ||
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
        // A declared squad charge shows only the selected model's own ring (below): the unit-wide disc, centred on
        // the squad's middle with the most any model has left, would disagree with it after the first leg.
        if (maxRange > 0 && !this.isSquadChargeFlow) {
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
          // Shooting range is measured from the shooter's base edge, so the ring sits one base radius out
          // from the model centre and shows where an enemy base edge can be.
          const ringPad = attackAction === 'shoot' ? baseRadius(active) : 0;
          markers.attackRange = {
            unitId: active.id,
            range: maxRange + ringPad,
            concentricRanges: concentricRanges?.map((r) => r + ringPad),
          };
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
      (this.flow.mode === 'confirming' && this.flow.action.type === 'advance') ||
      (this.flow.mode === 'idle' && this.hoveredAction === 'move');

    const pendingConsolidation = this.state?.turnState.pendingReaction;
    const isConsolidationMode =
      pendingConsolidation &&
      pendingConsolidation.type === 'melee-consolidation' &&
      pendingConsolidation.promptingPlayerId === this.localPlayerId;

    const casualtyMarkers = this.casualtyContext();
    if (casualtyMarkers) {
      markers.selectedUnitId = casualtyMarkers.unit.id;
      markers.casualtyPicks = casualtyMarkers.alive
        .filter((m) => this.casualtyPicked.includes(m.id))
        .map((m) => m.position ?? casualtyMarkers.unit.position);
    }

    const pushMarkers = this.pushContext();
    const pushModel = pushMarkers ? this.pushSelectedModel(pushMarkers) : null;
    if (pushMarkers && this.pushPicking) {
      markers.selectedUnitId = pushMarkers.shaken.id;
      if (pushModel) {
        markers.movementRangeUnitId = pushMarkers.shaken.id;
        markers.movementRangeRadius = PUSH_RANGE;
        markers.movementRangePosition = pushModel.position ?? pushMarkers.shaken.position;
        markers.movementRangeColor = 0xffb74d;
      }
      const path = this.movePathPreview;
      if (path && path.length >= 2) {
        markers.movePath = { from: path[0], to: path[path.length - 1], waypoints: path };
      }
    }

    const pileInMarkers = this.pileInContext();
    if (pileInMarkers) {
      const model = this.pileInSelectedModel(pileInMarkers);
      markers.selectedUnitId = pileInMarkers.defender.id;
      markers.movementRangeUnitId = pileInMarkers.defender.id;
      markers.movementRangeRadius = pileInMarkers.maxDistance;
      if (model) markers.movementRangePosition = model.position ?? pileInMarkers.defender.position;
      markers.squadCoherency = { positions: this.pileInPositions(pileInMarkers), radius: 2.0 };
      const path = this.movePathPreview ?? this.pileInPaths.get(model?.id ?? '') ?? null;
      if (path && path.length >= 2) {
        markers.movePath = { from: path[0], to: path[path.length - 1], waypoints: path };
      }
    } else if (isConsolidationMode && pendingConsolidation) {
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
    } else if ((isMoveMode || isRushMode || this.isSquadChargeFlow) && this.activeUnit) {
      markers.movementRangeUnitId = this.activeUnit.id;
      // While staging a squad the ring is the selected model's own distance, not the unit's best
      const ringAlive = this.activeAliveSquadModels;
      const ringModel = ringAlive.length > 1 ? this.selectedSquadModel : null;
      if (isRushMode) {
        markers.movementRangeRadius = Math.max(0, this.distanceLeft(this.activeUnit, 'rush', ringModel));
        markers.movementRangeColor = 0xffb74d; // Distinct gold/amber ring for Rush
      } else if (this.isSquadChargeFlow) {
        markers.movementRangeRadius = Math.max(0, this.distanceLeft(this.activeUnit, 'charge', ringModel));
        markers.movementRangeColor = undefined;
      } else {
        markers.movementRangeRadius = Math.max(0, this.distanceLeft(this.activeUnit, 'move', ringModel));
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
          segments: this.moveSegments ?? undefined,
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
        segments: this.moveSegments ?? undefined,
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
      // Charge moves up to double speed (12") to reach engagement range of target; after legs, what is left.
      return this.declaredCharge ? unit.remainingMovement : unit.speed * 2;
    }
    return 1.5;
  }

  /** All living enemy units within max range and Line of Sight of the given action. */
  private reachableEnemies(unit: Unit, action: 'shoot' | 'charge' | 'fight'): Unit[] {
    if (!this.state) return [];
    const declared = action === 'charge' ? this.declaredCharge : null;
    if (declared) {
      // A declared charge is locked to its target
      return this.state.units.filter((u) => u.id === declared.targetId && !u.isDestroyed);
    }
    const limit = this.actionMaxRange(unit, action);
    return this.state.units.filter((candidate) => {
      if (candidate.ownerId === this.localPlayerId || candidate.isDestroyed) return false;
      if (action === 'shoot') {
        const weaponToCheck = this.selectedShootWeaponId
          ? unit.weapons.find((w) => w.id === this.selectedShootWeaponId)
          : null;
        if (weaponToCheck && weaponToCheck.profile.type === 'ranged') {
          return firingModels(this.state!, unit, candidate, weaponToCheck).length > 0;
        }
        const rangedWeapons = unit.weapons.filter((w) => w.isEquipped && w.profile.type === 'ranged');
        return rangedWeapons.some((w) => firingModels(this.state!, unit, candidate, w).length > 0);
      }
      const distance = unitDistance(unit, candidate);
      // A charge is refined by the pathfinder below; melee uses the engagement gap.
      if (distance > (action === 'fight' ? ENGAGEMENT_EDGE_GAP : limit) + 0.01) return false;
      if (action === 'charge') {
        // Verify pathfinder reaches within engagement range under double speed
        const contactTarget = chargeDestination(unit, candidate);
        const path = findNavPath(this.state!, unit, contactTarget, unit.speed * 2, {
          ignoreUnitId: candidate.id,
          keepAway: true,
        });
        const end = path[path.length - 1];
        return (
          chargeContact(unit, candidate, end, MELEE_MAX_VERTICAL_REACH) === 'ok' &&
          pathLength(path) <= unit.speed * 2 + 0.01
        );
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
.sl-hud-alerts .sl-hud-toast { position: static; transform: none; margin-top: 8px; }
.sl-hud-gameover { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
  pointer-events: auto; background: rgba(10, 12, 16, 0.94); border: 2px solid #ffd54f;
  border-radius: 12px; padding: 24px 36px; text-align: center; box-shadow: 0 12px 32px rgba(0,0,0,0.6); }
.sl-hud-concede { margin-left: 12px; pointer-events: auto; font-size: 12px; padding: 3px 10px;
  background: transparent; color: #ef9a9a; border: 1px solid #7a3b3b; border-radius: 5px; cursor: pointer; }
.sl-hud-concede:hover:not(:disabled) { background: #3a1d1d; }
.sl-hud-concede:disabled { opacity: 0.6; cursor: default; }
.sl-hud-concede-dialog { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
  pointer-events: auto; background: rgba(10, 12, 16, 0.96); border: 2px solid #7a3b3b;
  border-radius: 12px; padding: 20px 28px; text-align: center; z-index: 120; }
.sl-hud-concede-dialog p { margin: 0 0 14px; color: #cfd8dc; }
.sl-hud-concede-confirm { background: #c62828; color: #fff; border-color: #c62828; }
.sl-hud-gameover-actions { display: flex; justify-content: center; gap: 10px; }
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
