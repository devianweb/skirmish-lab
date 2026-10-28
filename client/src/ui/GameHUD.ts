import {
  createAction,
  GameState,
  GameAction,
  Unit,
  Vector3,
} from '@skirmish-lab/shared';

/** What the HUD needs from the game controller to submit confirmed actions. */
export interface HUDController {
  submitAction(action: GameAction): void;
  onReturnToLobby?(): void;
}

export interface GameHUDOptions {
  /** Player ID of the local player (host or guest perspective). */
  localPlayerId: string;
  controller: HUDController;
}

/** Marker state the renderer reflects (selection, target, range, path, outcome). */
export interface MarkerSnapshot {
  selectedUnitId: string | null;
  targetUnitId: string | null;
  movementRangeUnitId: string | null;
  attackRange?: { unitId: string; range: number } | null;
  movePath?: { from: Vector3; to: Vector3 } | null;
  outcome: { position: Vector3; wounds: number } | null;
}

export type PickTarget =
  | { kind: 'unit'; unitId: string }
  | { kind: 'position'; position: Vector3 };

type TargetingMode =
  | { mode: 'idle' }
  | { mode: 'waiting' }
  | { mode: 'targeting'; action: 'move' | 'shoot' | 'charge' | 'fight' }
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
  private controller: HUDController;
  private state: GameState | null = null;
  private flow: TargetingMode = { mode: 'idle' };
  /** Selected own unit (board click or list) pending activation, or active unit. */
  private selectedUnitId: string | null = null;
  /** Unit hovered in the fighter list or on the board. */
  private hoveredUnitId: string | null = null;
  /** Clamped move destination previewed under the cursor during move targeting. */
  private movePreview: Vector3 | null = null;
  private markerHandlers: Array<(markers: MarkerSnapshot) => void> = [];
  /** Log index already reflected (used for transient wound tokens). */
  private lastSeenLogIndex = 0;
  private lastRoundNumber: number | null = null;
  private toast: string | null = null;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private visible = false;
  private root: HTMLElement;

  constructor(container: HTMLElement, options: GameHUDOptions) {
    this.container = container;
    this.localPlayerId = options.localPlayerId;
    this.controller = options.controller;
    GameHUD.ensureStyles();

    this.root = document.createElement('div');
    this.root.className = 'sl-hud';
    this.root.style.display = 'none';
    this.container.appendChild(this.root);
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
    this.selectedUnitId = state.turnState.activeUnitId ?? null;

    if (prevRound !== null && state.turnState.roundNumber > prevRound && state.status !== 'game-over') {
      const starter =
        state.turnState.currentPlayerId === this.localPlayerId
          ? 'You activate first'
          : 'Opponent activates first';
      this.showToast(`Round ${state.turnState.roundNumber} started — ${starter}!`);
      return;
    }

    this.render();
  }

  /** Board/unit picks from GameView (see PickTarget in the renderer). */
  handleBoardPick(target: PickTarget): void {
    if (!this.state || this.state.status === 'game-over') return;

    if (this.flow.mode === 'targeting' && this.flow.action === 'move') {
      if (target.kind === 'position') {
        this.prepareMove(target.position);
      }
      return;
    }

    if (this.flow.mode === 'targeting' && this.flow.action !== 'move') {
      if (target.kind === 'unit') {
        this.prepareAttack(target.unitId);
      }
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

  /** Board hover events from GameView (for live movement path preview & target hover). */
  handleBoardHover(target: PickTarget | null): void {
    if (!this.state || this.state.status === 'game-over') return;

    if (this.flow.mode === 'targeting' && this.flow.action === 'move') {
      const active = this.activeUnit;
      if (active && target?.kind === 'position') {
        this.movePreview = this.clampMoveDestination(active, target.position);
      } else {
        this.movePreview = null;
      }
      this.emitMarkers();
      return;
    }

    const nextHover = target?.kind === 'unit' ? target.unitId : null;
    if (nextHover !== this.hoveredUnitId) {
      this.hoveredUnitId = nextHover;
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

  private beginActionTargeting(action: 'move' | 'shoot' | 'charge' | 'fight'): void {
    if (this.flow.mode !== 'idle') return;
    const active = this.activeUnit;
    if (!active || active.ownerId !== this.localPlayerId) return;
    this.movePreview = null;
    this.flow = { mode: 'targeting', action };
    this.render();
  }

  /**
   * Clamp a ground point to the unit's remaining movement allowance (and board
   * bounds) so clicking beyond the movement ring moves as far as possible
   * toward the cursor instead of failing.
   */
  private clampMoveDestination(unit: Unit, raw: Vector3): Vector3 {
    const dx = raw.x - unit.position.x;
    const dz = raw.z - unit.position.z;
    const rawDist = Math.hypot(dx, dz);
    const maxMove = Math.max(0, unit.remainingMovement);
    let x = raw.x;
    let z = raw.z;
    if (rawDist > maxMove && rawDist > 0) {
      const ratio = maxMove / rawDist;
      x = unit.position.x + dx * ratio;
      z = unit.position.z + dz * ratio;
    }
    if (this.state) {
      const halfW = (this.state.board.width * this.state.board.gridSize) / 2;
      const halfH = (this.state.board.height * this.state.board.gridSize) / 2;
      x = Math.max(-halfW, Math.min(halfW, x));
      z = Math.max(-halfH, Math.min(halfH, z));
    }
    return {
      x: Math.round(x * 100) / 100,
      y: 0,
      z: Math.round(z * 100) / 100,
    };
  }

  private prepareMove(rawDestination: Vector3): void {
    const active = this.activeUnit;
    if (!active) return;

    const destination = this.clampMoveDestination(active, rawDestination);
    const distance = Math.hypot(
      destination.x - active.position.x,
      destination.z - active.position.z
    );
    if (distance < 0.05) {
      this.showToast('Pick a destination away from the unit');
      return;
    }

    this.movePreview = destination;
    const path: Vector3[] = [
      { ...active.position },
      { x: destination.x, y: 0, z: destination.z },
    ];
    const left = Math.max(0, active.remainingMovement - distance);
    this.beginConfirmation(
      createAction(this.localPlayerId, 'move-unit', {
        type: 'move-unit',
        unitId: active.id,
        path,
        finalPosition: path[path.length - 1],
      }),
      `Move ${active.name} ${distance.toFixed(1)}" — ${left > 0.05 ? `${left.toFixed(1)}" left` : 'all movement spent'}`
    );
  }

  private prepareAttack(targetUnitId: string): void {
    if (this.flow.mode !== 'targeting') return;
    const active = this.activeUnit;
    if (!active) return;
    const target = this.state?.units.find((u) => u.id === targetUnitId);
    if (!target || target.ownerId === this.localPlayerId || target.isDestroyed) return;

    const distance = Math.hypot(
      target.position.x - active.position.x,
      target.position.z - active.position.z
    );
    const effectiveQ = active.quality + (target.status.includes('in-cover') ? 1 : 0);

    if (this.flow.action === 'shoot') {
      const weapon = active.weapons.find((w) => w.isEquipped && w.profile.type === 'ranged');
      if (!weapon) {
        this.showToast('No ranged weapon');
        return;
      }
      if (distance > weapon.profile.range + 0.01) {
        this.showToast(`Out of range: ${distance.toFixed(1)}" vs ${weapon.profile.range}"`);
        return;
      }
      const attacks = weapon.profile.attacks;
      const diceText = `${attacks}d6 (Hit Q${effectiveQ}+${target.status.includes('in-cover') ? ' cover' : ''}, Def D${target.defense}+)`;
      this.beginConfirmation(
        createAction(this.localPlayerId, 'shoot', {
          type: 'shoot',
          attackerId: active.id,
          targetId: target.id,
          weaponId: weapon.id,
        }),
        `${active.name} fires ${weapon.name} at ${target.name} (${distance.toFixed(1)}") · ${diceText}`
      );
      return;
    }

    if (this.flow.action === 'charge') {
      if (active.status.includes('engaged')) {
        this.showToast('Already engaged — fight instead');
        return;
      }
      // Charge ends at 1" engagement distance of the target.
      const dx = active.position.x - target.position.x;
      const dz = active.position.z - target.position.z;
      const len = Math.hypot(dx, dz) || 1;
      const end = {
        x: Math.round((target.position.x + (dx / len) * 1) * 100) / 100,
        y: 0,
        z: Math.round((target.position.z + (dz / len) * 1) * 100) / 100,
      };
      const chargeDistance = Math.hypot(end.x - active.position.x, end.z - active.position.z);
      if (chargeDistance > active.speed + 0.01) {
        this.showToast(`Too far to charge: ${chargeDistance.toFixed(1)}" vs speed ${active.speed}"`);
        return;
      }
      this.beginConfirmation(
        createAction(this.localPlayerId, 'charge', {
          type: 'charge',
          attackerId: active.id,
          targetId: target.id,
          path: [end],
        }),
        `${active.name} charges ${target.name} (${chargeDistance.toFixed(1)}" into melee — then Fight)`
      );
      return;
    }

    if (this.flow.action === 'fight') {
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
      const attacks = weapon.profile.attacks;
      const diceText = `${attacks}d6 (Hit Q${active.quality}+, Def D${target.defense}+)`;
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

  private beginConfirmation(action: GameAction, summary: string): void {
    this.flow = { mode: 'confirming', action, summary };
    this.render();
  }

  private confirmPending(): void {
    if (this.flow.mode !== 'confirming') return;
    const action = this.flow.action;
    this.movePreview = null;
    this.flow = { mode: 'waiting' };
    this.render();
    // Only confirmed actions ever leave the HUD — no optimistic dispatch.
    this.controller.submitAction(action);
  }

  private cancel(): void {
    if (this.flow.mode === 'waiting') return; // already sent, nothing to cancel
    this.movePreview = null;
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
    const myName =
      state.players.find((p) => p.id === this.localPlayerId)?.name ?? 'You';
    const opponent = state.players.find((p) => p.id !== this.localPlayerId);
    const opponentName = opponent?.name ?? 'Opponent';

    const myUnactivated = this.myUnits.filter((u) => !u.isDestroyed && !u.isActivated).length;
    const enemyUnactivated = this.enemyUnits.filter((u) => !u.isDestroyed && !u.isActivated).length;

    const header = `
      <div class="sl-hud-header">
        <span class="sl-hud-title">SkirmishLab</span>
        <span class="sl-hud-round">Round ${state.turnState.roundNumber}</span>
        <span class="sl-hud-turn ${this.myTurn ? 'mine' : 'theirs'}">${
      state.status === 'game-over'
        ? this.gameOverText(opponentName)
        : this.myTurn
        ? 'Your turn'
        : `${opponentName}'s turn`
    }</span>
        <span class="sl-hud-round-progress">Unactivated: You ${myUnactivated} · ${opponentName} ${enemyUnactivated}</span>
      </div>`;

    const units = `
      <div class="sl-hud-panel sl-hud-units">
        <h3>${myName} — Fighters (${myUnactivated} ready)</h3>
        ${this.myUnits.map((unit) => this.renderUnitRow(unit)).join('')}
        <h3 style="margin-top: 10px; color: #ef9a9a;">${opponentName} — Enemy (${enemyUnactivated} ready)</h3>
        ${this.enemyUnits.map((unit) => this.renderEnemyRow(unit)).join('')}
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
        <p>${state.endReason ?? 'Game ended'}</p>
        <button class="sl-hud-btn primary" data-action="return-lobby">Return to Lobby</button>
      </div>`
        : '';

    return `${header}${units}${right}${this.renderBottomBar()}${gameOverModal}${
      this.toast ? `<div class="sl-hud-toast">${this.toast}</div>` : ''
    }`;
  }

  private gameOverText(opponentName: string): string {
    const state = this.state!;
    if (state.winner === this.localPlayerId) return 'Victory';
    if (state.winner) return 'Defeat';
    return `Game over — ${state.endReason ?? 'draw'} vs ${opponentName}`;
  }

  private renderUnitRow(unit: Unit): string {
    const statusTags: string[] = [];
    if (unit.status.includes('stunned')) statusTags.push('STUNNED');
    if (unit.status.includes('routed')) statusTags.push('ROUTED');
    if (unit.status.includes('engaged')) statusTags.push('ENGAGED');
    if (unit.status.includes('in-cover')) statusTags.push('COVER');
    if (unit.isActivated) statusTags.push('ACTIVATED');

    const canActivate = this.canActivateUnit(unit);
    const isActive = this.activeUnit?.id === unit.id;
    const weaponSummary = unit.weapons
      .filter((w) => w.isEquipped)
      .map((w) =>
        w.profile.type === 'ranged'
          ? `${w.name} (${w.profile.range}", A${w.profile.attacks})`
          : `${w.name} (A${w.profile.attacks})`
      )
      .join(', ');

    const classes = [
      'sl-hud-unit',
      unit.isDestroyed ? 'destroyed' : '',
      canActivate ? 'activatable' : '',
      isActive ? 'active' : '',
    ]
      .filter(Boolean)
      .join(' ');

    return `
      <div class="${classes}" data-unit-id="${unit.id}">
        <span class="sl-hud-unit-name">${unit.name}${isActive ? ' ●' : ''}</span>
        <span class="sl-hud-unit-stats">Q${unit.quality}+ D${unit.defense}+ · ${unit.wounds}/${unit.maxWounds}W${
      !unit.isDestroyed && !unit.isActivated ? ` · ${unit.remainingMovement}"` : ''
    }</span>
        ${weaponSummary ? `<span class="sl-hud-unit-weapons">${weaponSummary}</span>` : ''}
        ${statusTags.length ? `<span class="sl-hud-unit-tags">${statusTags.join(' ')}</span>` : ''}
      </div>`;
  }

  private renderEnemyRow(unit: Unit): string {
    const statusTags: string[] = [];
    if (unit.status.includes('stunned')) statusTags.push('STUNNED');
    if (unit.status.includes('engaged')) statusTags.push('ENGAGED');
    if (unit.status.includes('in-cover')) statusTags.push('COVER');
    if (unit.isActivated) statusTags.push('ACTIVATED');

    const classes = ['sl-hud-unit', 'enemy', unit.isDestroyed ? 'destroyed' : '']
      .filter(Boolean)
      .join(' ');

    return `
      <div class="${classes}" data-unit-id="${unit.id}">
        <span class="sl-hud-unit-name">${unit.name}</span>
        <span class="sl-hud-unit-stats">Q${unit.quality}+ D${unit.defense}+ · ${unit.wounds}/${unit.maxWounds}W</span>
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

      const effectiveQ =
        (attacker?.quality ?? 4) + (target?.status.includes('in-cover') ? 1 : 0);
      const targetD = target?.defense ?? 5;

      const hitDiceHtml = toHit
        ? toHit.rolls
            .map((r) => {
              const isHit = r >= effectiveQ;
              return `<span class="sl-die ${isHit ? 'hit-pass' : 'hit-miss'}" title="${
                isHit ? `Hit (${r} >= ${effectiveQ})` : `Miss (${r} < ${effectiveQ})`
              }">${r}</span>`;
            })
            .join('')
        : '';

      // Defense dice only pair with actual hits (first `outcome.hitCount` rolls).
      const usedDefRolls = defense ? defense.rolls.slice(0, outcome.hitCount) : [];
      const defDiceHtml =
        usedDefRolls.length > 0
          ? usedDefRolls
              .map((r) => {
                const isBlocked = r >= targetD;
                return `<span class="sl-die ${isBlocked ? 'def-pass' : 'def-fail'}" title="${
                  isBlocked ? `Blocked (${r} >= ${targetD})` : `Failed (${r} < ${targetD}) → Wound`
                }">${r}</span>`;
              })
              .join('')
          : '<span class="sl-hud-dice-empty">no hits to defend</span>';

      return `
        <div class="sl-hud-dice">
          <div class="sl-hud-dice-title">${attacker?.name ?? 'Attacker'} → ${
        target?.name ?? 'target'
      }</div>
          <div class="sl-hud-dice-label">To-Hit (need Q${effectiveQ}+):</div>
          <div class="sl-hud-dice-row">${hitDiceHtml}</div>
          <div class="sl-hud-dice-label">Defense (need D${targetD}+):</div>
          <div class="sl-hud-dice-row">${defDiceHtml}</div>
          <div class="sl-hud-dice-summary">
            ${outcome.hitCount} hit${outcome.hitCount === 1 ? '' : 's'} ·
            ${outcome.blockedCount} blocked ·
            <strong>${outcome.wounds} wound${outcome.wounds === 1 ? '' : 's'}</strong>
            ${outcome.targetDestroyed ? ' · target down' : ''}
          </div>
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
      case 'activate-unit':
        return `activated ${this.unitName((action.payload as any).unitId)}`;
      case 'hold':
        return `held with ${this.unitName((action.payload as any).unitId)}`;
      case 'move-unit':
        return `moved ${this.unitName((action.payload as any).unitId)}`;
      case 'shoot':
        return `shot ${this.unitName((action.payload as any).targetId)}`;
      case 'charge':
        return `charged ${this.unitName((action.payload as any).targetId)}`;
      case 'fight':
        return `fought ${this.unitName((action.payload as any).targetId)}`;
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

    if (this.flow.mode === 'confirming') {
      return `
        <div class="sl-hud-bottom sl-hud-confirm">
          <span class="sl-hud-confirm-summary">${this.flow.summary}</span>
          <button class="sl-hud-btn primary" data-action="confirm">Confirm</button>
          <button class="sl-hud-btn" data-action="cancel">Cancel</button>
        </div>`;
    }

    if (this.flow.mode === 'waiting') {
      return `
        <div class="sl-hud-bottom"><span class="sl-hud-hint">Waiting for the host…</span></div>`;
    }

    if (this.flow.mode === 'targeting') {
      const instruction =
        this.flow.action === 'move'
          ? 'Click a destination on the board (auto-clamps to max move)'
          : `Select an enemy target within the red range ring (${this.flow.action})`;
      return `
        <div class="sl-hud-bottom">
          <span class="sl-hud-hint">${instruction}</span>
          <button class="sl-hud-btn" data-action="cancel">Cancel</button>
        </div>`;
    }

    if (this.myTurn && activeIsMine && active) {
      const engaged = active.status.includes('engaged');
      const hasAttacked = !!active.hasAttacked;
      const hasActed = active.hasMoved || hasAttacked;
      const canMove = !engaged && active.remainingMovement > 0.01;
      const rangedWeapon = active.weapons.find((w) => w.isEquipped && w.profile.type === 'ranged');
      const meleeWeapon = active.weapons.find((w) => w.isEquipped && w.profile.type === 'melee');
      const canShoot = !engaged && !hasAttacked && !!rangedWeapon;
      const canCharge = !engaged && !active.hasMoved && !hasAttacked;
      const canFight = engaged && !hasAttacked && !!meleeWeapon;

      const shootLabel = rangedWeapon
        ? `Shoot (${rangedWeapon.profile.attacks}d6, ${rangedWeapon.profile.range}")`
        : 'Shoot';
      const fightLabel = meleeWeapon
        ? `Fight (${meleeWeapon.profile.attacks}d6)`
        : 'Fight';

      // Before moving/attacking, show Hold (stay put & end activation).
      // Once the unit has moved or attacked, show End Activation instead.
      const finishBtn = !hasActed
        ? `<button class="sl-hud-btn" data-action="hold">Hold</button>`
        : `<button class="sl-hud-btn primary" data-action="end-activation">End Activation</button>`;

      return `
        <div class="sl-hud-bottom sl-hud-actions">
          <span class="sl-hud-active-name">${active.name}</span>
          <button class="sl-hud-btn" data-action="move" ${canMove ? '' : 'disabled'}>Move (${active.remainingMovement.toFixed(1)}")</button>
          <button class="sl-hud-btn" data-action="shoot" ${canShoot ? '' : 'disabled'}>${shootLabel}</button>
          <button class="sl-hud-btn" data-action="charge" ${canCharge ? '' : 'disabled'}>Charge (${active.speed}")</button>
          <button class="sl-hud-btn" data-action="fight" ${canFight ? '' : 'disabled'}>${fightLabel}</button>
          ${finishBtn}
        </div>`;
    }

    if (this.myTurn) {
      const n = this.activatableUnits.length;
      return `
        <div class="sl-hud-bottom">
          <span class="sl-hud-hint">Your turn — activate a unit (${
            n > 0 ? `${n} available` : 'none available'
          })</span>
        </div>`;
    }

    const opponentActive = active ? `${active.name} is activating` : 'waiting to activate';
    return `<div class="sl-hud-bottom"><span class="sl-hud-hint">Opponent's turn — ${opponentActive}</span></div>`;
  }

  private bindEvents(): void {
    // Unit rows: hover highlights the unit on the board; click activates an activatable unit
    // (or targets an enemy unit when in shoot/charge/fight targeting mode).
    for (const row of Array.from(this.root.querySelectorAll('.sl-hud-unit'))) {
      const el = row as HTMLElement;
      const unitId = el.dataset.unitId!;
      el.addEventListener('mouseenter', () => {
        this.hoveredUnitId = unitId;
        this.emitMarkers();
      });
      el.addEventListener('mouseleave', () => {
        if (this.hoveredUnitId === unitId) {
          this.hoveredUnitId = null;
          this.emitMarkers();
        }
      });
      el.addEventListener('click', () => {
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
      el.addEventListener('click', () => {
        switch (el.dataset.action) {
          case 'confirm':
            this.confirmPending();
            break;
          case 'cancel':
            this.cancel();
            break;
          case 'return-lobby':
            this.controller.onReturnToLobby?.();
            break;
          case 'move':
          case 'shoot':
          case 'charge':
          case 'fight':
            this.beginActionTargeting(el.dataset.action as 'move' | 'shoot' | 'charge' | 'fight');
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
  }

  private emitMarkers(): void {
    // Transient wound token: the newest unseen dice resolution with wounds.
    let outcome: MarkerSnapshot['outcome'] = null;
    if (this.state) {
      for (let i = this.state.actionLog.length - 1; i >= this.lastSeenLogIndex; i--) {
        const entry = this.state.actionLog[i];
        if (entry.dice && entry.dice.outcome.wounds > 0) {
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

    const markers: MarkerSnapshot = {
      selectedUnitId: selectedId,
      targetUnitId: null,
      movementRangeUnitId: null,
      attackRange: null,
      movePath: null,
      outcome,
    };

    // If hovering an enemy unit, show the red target ring under that enemy.
    if (hoveredUnit && hoveredUnit.ownerId !== this.localPlayerId) {
      markers.targetUnitId = hoveredUnit.id;
    }

    // While confirming an attack/charge, keep the target marker on the chosen target.
    if (this.flow.mode === 'confirming') {
      const payload = this.flow.action.payload as { targetId?: string; path?: Vector3[] };
      if (payload.targetId) {
        markers.targetUnitId = payload.targetId;
      }
      if (this.flow.action.type === 'move-unit' && payload.path && payload.path.length >= 2) {
        markers.movePath = {
          from: payload.path[0],
          to: payload.path[payload.path.length - 1],
        };
      }
    }

    // While targeting an attack, show the red max-range circle around the active unit,
    // and highlight the hovered enemy (or nearest enemy in range if none hovered).
    if (this.flow.mode === 'targeting' && this.flow.action !== 'move' && this.state) {
      const active = this.activeUnit;
      if (active) {
        const maxRange = this.actionMaxRange(active, this.flow.action);
        if (maxRange > 0) {
          markers.attackRange = { unitId: active.id, range: maxRange };
        }
        if (!markers.targetUnitId) {
          const enemy = this.nearestEnemyInRange(active, this.flow.action);
          markers.targetUnitId = enemy?.id ?? null;
        }
      }
    }

    if (this.flow.mode === 'targeting' && this.flow.action === 'move') {
      markers.movementRangeUnitId = this.activeUnit?.id ?? null;
      if (this.activeUnit && this.movePreview) {
        markers.movePath = {
          from: { ...this.activeUnit.position },
          to: { ...this.movePreview },
        };
      }
    }
    if (this.activeUnit?.ownerId === this.localPlayerId) {
      markers.movementRangeUnitId = markers.movementRangeUnitId ?? this.activeUnit?.id ?? null;
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
      // Charge path ends at 1" engagement distance, so a target up to speed + 1" away is reachable.
      return unit.speed + 1;
    }
    return 1.5;
  }

  /** Nearest enemy the active unit could target (for the target marker). */
  private nearestEnemyInRange(unit: Unit, action: 'shoot' | 'charge' | 'fight'): Unit | null {
    if (!this.state) return null;
    const limit = this.actionMaxRange(unit, action);
    let best: Unit | null = null;
    let bestDistance = Infinity;
    for (const candidate of this.state.units) {
      if (candidate.ownerId === this.localPlayerId || candidate.isDestroyed) continue;
      const distance = Math.hypot(
        candidate.position.x - unit.position.x,
        candidate.position.z - unit.position.z
      );
      if (distance <= limit + 0.01 && distance < bestDistance) {
        best = candidate;
        bestDistance = distance;
      }
    }
    return best;
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
.sl-hud-round-progress { margin-left: auto; font-size: 12px; color: #90a4ae; }
.sl-hud-turn.mine { color: #69f0ae; font-weight: 600; }
.sl-hud-turn.theirs { color: #ff8a65; }
.sl-hud-panel { position: absolute; pointer-events: auto; background: rgba(10, 12, 16, 0.82);
  border: 1px solid #2a2f3a; border-radius: 8px; padding: 10px; min-width: 220px; }
.sl-hud-panel h3 { margin: 2px 0 8px; font-size: 12px; text-transform: uppercase;
  letter-spacing: 1px; color: #90caf9; }
.sl-hud-units { top: 60px; left: 12px; max-width: 290px; max-height: 75vh; overflow-y: auto; }
.sl-hud-side { top: 60px; right: 12px; width: 270px; max-height: 60vh; overflow-y: auto; }
.sl-hud-unit { padding: 6px 8px; margin-bottom: 4px; border-radius: 6px; background: #1a1f29;
  display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.sl-hud-unit.activatable { cursor: pointer; outline: 1px solid #69f0ae; }
.sl-hud-unit.activatable:hover { background: #213028; }
.sl-hud-unit.enemy { background: #241a1d; cursor: pointer; }
.sl-hud-unit.enemy:hover { background: #332024; }
.sl-hud-unit.active { outline: 2px solid #69f0ae; }
.sl-hud-unit.destroyed { opacity: 0.35; text-decoration: line-through; }
.sl-hud-unit-name { font-weight: 600; }
.sl-hud-unit-stats { font-size: 11px; color: #b0bec5; }
.sl-hud-unit-weapons { font-size: 10px; color: #90caf9; width: 100%; }
.sl-hud-unit-tags { font-size: 10px; color: #ff8a65; }
.sl-hud-bottom { position: absolute; bottom: 16px; left: 50%; transform: translateX(-50%);
  pointer-events: auto; display: flex; align-items: center; gap: 10px;
  background: rgba(10, 12, 16, 0.88); border: 1px solid #2a2f3a; border-radius: 10px;
  padding: 10px 16px; max-width: 85vw; }
.sl-hud-btn { pointer-events: auto; background: #263238; color: #eee; border: 1px solid #37474f;
  border-radius: 6px; padding: 6px 14px; cursor: pointer; font-size: 13px; }
.sl-hud-btn:hover:not([disabled]) { background: #37474f; }
.sl-hud-btn[disabled] { opacity: 0.4; cursor: default; }
.sl-hud-btn.primary { background: #2e7d32; border-color: #43a047; font-weight: 600; }
.sl-hud-btn.primary:hover { background: #43a047; }
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
.sl-hud-toast { position: absolute; bottom: 90px; left: 50%; transform: translateX(-50%);
  background: #263238; color: #ffd54f; border: 1px solid #4f5b62; border-radius: 8px;
  padding: 8px 16px; font-size: 13px; pointer-events: none; }
.sl-hud-gameover { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
  pointer-events: auto; background: rgba(10, 12, 16, 0.94); border: 2px solid #ffd54f;
  border-radius: 12px; padding: 24px 36px; text-align: center; box-shadow: 0 12px 32px rgba(0,0,0,0.6); }
.sl-hud-gameover h2 { margin: 0 0 8px; font-size: 28px; color: #ffd54f; }
.sl-hud-gameover p { margin: 0 0 18px; color: #b0bec5; }
`;
    document.head.appendChild(style);
  }
}
