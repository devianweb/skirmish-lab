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
}

export interface GameHUDOptions {
  /** Player ID of the local player (host or guest perspective). */
  localPlayerId: string;
  controller: HUDController;
}

/** Marker state the renderer reflects (selection, target, range, outcome). */
export interface MarkerSnapshot {
  selectedUnitId: string | null;
  targetUnitId: string | null;
  movementRangeUnitId: string | null;
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
 * In-game HUD: round/turn header, unit list for the local player, action
 * selection with explicit confirmation, dice result display, and the action
 * log. Pure view layer over confirmed game state — it never mutates state
 * and only submits confirmed actions to the controller (host-authoritative).
 *
 * Interaction flow (alternating activations):
 *   your turn, no active unit → pick a unit (list or board) → confirm
 *   activation → action bar (move/shoot/charge/fight/hold/end) → pick a
 *   target or destination → confirm → the host applies it and the next
 *   state update re-renders everything.
 */
export class GameHUD {
  private container: HTMLElement;
  private localPlayerId: string;
  private controller: HUDController;
  private state: GameState | null = null;
  private flow: TargetingMode = { mode: 'idle' };
  /** Selected own unit (board click or list) pending activation. */
  private selectedUnitId: string | null = null;
  private markerHandlers: Array<(markers: MarkerSnapshot) => void> = [];
  /** Log index already reflected (used for transient wound tokens). */
  private lastSeenLogIndex = 0;
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
    this.state = state;
    if (this.flow.mode === 'waiting') {
      // Our action resolved into a new state — resume interacting.
      this.flow = { mode: 'idle' };
    }
    this.selectedUnitId = state.turnState.activeUnitId ?? null;
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

    if (this.flow.mode === 'idle' && target.kind === 'unit') {
      this.trySelectForActivation(target.unitId);
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
    if (this.flow.mode !== 'idle') return;
    const unit = this.state?.units.find((u) => u.id === unitId);
    if (!unit || unit.ownerId !== this.localPlayerId) return;
    if (!this.canActivateUnit(unit)) return;

    this.beginConfirmation(
      createAction(this.localPlayerId, 'activate-unit', {
        type: 'activate-unit',
        unitId,
      }),
      `Activate ${unit.name}`
    );
  }

  private tryActivateFromList(unitId: string): void {
    if (this.flow.mode !== 'idle') return;
    const unit = this.state?.units.find((u) => u.id === unitId);
    if (!unit || !this.canActivateUnit(unit)) return;

    this.beginConfirmation(
      createAction(this.localPlayerId, 'activate-unit', {
        type: 'activate-unit',
        unitId,
      }),
      `Activate ${unit.name}`
    );
  }

  private beginActionTargeting(action: 'move' | 'shoot' | 'charge' | 'fight'): void {
    if (this.flow.mode !== 'idle') return;
    const active = this.activeUnit;
    if (!active || active.ownerId !== this.localPlayerId) return;
    this.flow = { mode: 'targeting', action };
    this.render();
  }

  private prepareMove(destination: Vector3): void {
    const active = this.activeUnit;
    if (!active) return;

    const distance = Math.hypot(
      destination.x - active.position.x,
      destination.z - active.position.z
    );
    if (distance > active.remainingMovement + 0.01) {
      this.showToast(`Too far: ${distance.toFixed(1)}" of ${active.remainingMovement}" left`);
      return;
    }

    const path: Vector3[] = [
      { ...active.position },
      { x: destination.x, y: 0, z: destination.z },
    ];
    this.beginConfirmation(
      createAction(this.localPlayerId, 'move-unit', {
        type: 'move-unit',
        unitId: active.id,
        path,
        finalPosition: path[path.length - 1],
      }),
      `Move ${active.name} ${distance.toFixed(1)}" — ${active.remainingMovement - distance > 0.01 ? `${(active.remainingMovement - distance).toFixed(1)}" left` : 'all movement spent'}`
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
      this.beginConfirmation(
        createAction(this.localPlayerId, 'shoot', {
          type: 'shoot',
          attackerId: active.id,
          targetId: target.id,
          weaponId: weapon.id,
        }),
        `${active.name} fires ${weapon.name} at ${target.name} (${distance.toFixed(1)}")`
      );
      return;
    }

    if (this.flow.action === 'charge') {
      if (active.status.includes('engaged')) {
        this.showToast('Already engaged — fight instead');
        return;
      }
      if (distance > active.speed + 0.01) {
        this.showToast(`Too far to charge: ${distance.toFixed(1)}" vs speed ${active.speed}"`);
        return;
      }
      // End the charge at engagement distance of the target.
      const dx = active.position.x - target.position.x;
      const dz = active.position.z - target.position.z;
      const len = Math.hypot(dx, dz) || 1;
      const end = {
        x: target.position.x + (dx / len) * 1,
        y: 0,
        z: target.position.z + (dz / len) * 1,
      };
      const chargeDistance = Math.hypot(end.x - active.position.x, end.z - active.position.z);
      this.beginConfirmation(
        createAction(this.localPlayerId, 'charge', {
          type: 'charge',
          attackerId: active.id,
          targetId: target.id,
          path: [end],
        }),
        `${active.name} charges ${target.name} (${chargeDistance.toFixed(1)}")`
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
      this.beginConfirmation(
        createAction(this.localPlayerId, 'fight', {
          type: 'fight',
          attackerId: active.id,
          targetId: target.id,
          weaponId: weapon.id,
        }),
        `${active.name} strikes ${target.name} with ${weapon.name}`
      );
    }
  }

  private beginConfirmation(action: GameAction, summary: string): void {
    this.flow = { mode: 'confirming', action, summary };
    this.render();
  }

  private confirmPending(): void {
    if (this.flow.mode !== 'confirming') return;
    // Only confirmed actions ever leave the HUD — no optimistic dispatch.
    this.controller.submitAction(this.flow.action);
    this.flow = { mode: 'waiting' };
    this.render();
  }

  private cancel(): void {
    if (this.flow.mode === 'waiting') return; // already sent, nothing to cancel
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
      </div>`;

    const units = `
      <div class="sl-hud-panel sl-hud-units">
        <h3>${myName} — Fighters</h3>
        ${this.myUnits.map((unit) => this.renderUnitRow(unit)).join('')}
      </div>`;

    const right = `
      <div class="sl-hud-panel sl-hud-side">
        <h3>Dice</h3>
        ${this.renderDice()}
        <h3>Log</h3>
        <div class="sl-hud-log">${this.renderLog()}</div>
      </div>`;

    return `${header}${units}${right}${this.renderBottomBar()}${
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

      return `
        <div class="sl-hud-dice">
          <div class="sl-hud-dice-title">${attacker?.name ?? 'Attacker'} → ${
        target?.name ?? 'target'
      }</div>
          <div class="sl-hud-dice-row">
            ${toHit ? toHit.rolls.map((r) => `<span class="sl-die hit">${r}</span>`).join('') : ''}
            ${defense ? defense.rolls.map((r) => `<span class="sl-die def">${r}</span>`).join('') : ''}
          </div>
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
          ? 'Select a destination on the board'
          : `Select an enemy target (${this.flow.action})`;
      return `
        <div class="sl-hud-bottom">
          <span class="sl-hud-hint">${instruction}</span>
          <button class="sl-hud-btn" data-action="cancel">Cancel</button>
        </div>`;
    }

    if (this.myTurn && activeIsMine && active) {
      const engaged = active.status.includes('engaged');
      const canMove = !engaged && active.remainingMovement > 0.01;
      const canShoot = !engaged && active.weapons.some((w) => w.isEquipped && w.profile.type === 'ranged');
      const canCharge = !engaged;
      const canFight = engaged && active.weapons.some((w) => w.isEquipped && w.profile.type === 'melee');

      return `
        <div class="sl-hud-bottom sl-hud-actions">
          <span class="sl-hud-active-name">${active.name}</span>
          <button class="sl-hud-btn" data-action="move" ${canMove ? '' : 'disabled'}>Move</button>
          <button class="sl-hud-btn" data-action="shoot" ${canShoot ? '' : 'disabled'}>Shoot</button>
          <button class="sl-hud-btn" data-action="charge" ${canCharge ? '' : 'disabled'}>Charge</button>
          <button class="sl-hud-btn" data-action="fight" ${canFight ? '' : 'disabled'}>Fight</button>
          <button class="sl-hud-btn" data-action="hold">Hold</button>
          <button class="sl-hud-btn" data-action="end-activation">End Activation</button>
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
    // Unit list: click to (confirm) activation of an activatable unit.
    for (const row of Array.from(this.root.querySelectorAll('.sl-hud-unit.activatable'))) {
      row.addEventListener('click', () => {
        this.tryActivateFromList((row as HTMLElement).dataset.unitId!);
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

    const markers: MarkerSnapshot = {
      selectedUnitId: this.selectedUnitId,
      targetUnitId: null,
      movementRangeUnitId: null,
      outcome,
    };

    // While targeting an attack, mirror the prospective target under the cursor.
    if (this.flow.mode === 'targeting' && this.flow.action !== 'move' && this.state) {
      const active = this.activeUnit;
      const enemy = active
        ? this.nearestEnemyInRange(active, this.flow.action)
        : null;
      markers.targetUnitId = enemy?.id ?? null;
    }
    if (this.flow.mode === 'targeting' && this.flow.action === 'move') {
      markers.movementRangeUnitId = this.activeUnit?.id ?? null;
    }
    if (this.activeUnit?.ownerId === this.localPlayerId) {
      markers.movementRangeUnitId = markers.movementRangeUnitId ?? this.activeUnit?.id ?? null;
    }

    for (const handler of this.markerHandlers) {
      handler(markers);
    }
  }

  /** Nearest enemy the active unit could target (for the target marker). */
  private nearestEnemyInRange(unit: Unit, action: 'shoot' | 'charge' | 'fight'): Unit | null {
    if (!this.state) return null;
    let best: Unit | null = null;
    let bestDistance = Infinity;
    for (const candidate of this.state.units) {
      if (candidate.ownerId === this.localPlayerId || candidate.isDestroyed) continue;
      const distance = Math.hypot(
        candidate.position.x - unit.position.x,
        candidate.position.z - unit.position.z
      );
      const limit =
        action === 'shoot'
          ? Math.max(...unit.weapons.filter((w) => w.profile.type === 'ranged').map((w) => w.profile.range), 0)
          : action === 'charge'
          ? unit.speed
          : 1.5;
      if (distance <= limit && distance < bestDistance) {
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
.sl-hud-round { color: #ffd54f; }
.sl-hud-turn.mine { color: #69f0ae; font-weight: 600; }
.sl-hud-turn.theirs { color: #ff8a65; }
.sl-hud-panel { position: absolute; pointer-events: auto; background: rgba(10, 12, 16, 0.82);
  border: 1px solid #2a2f3a; border-radius: 8px; padding: 10px; min-width: 220px; }
.sl-hud-panel h3 { margin: 2px 0 8px; font-size: 12px; text-transform: uppercase;
  letter-spacing: 1px; color: #90caf9; }
.sl-hud-units { top: 60px; left: 12px; max-width: 280px; }
.sl-hud-side { top: 60px; right: 12px; width: 260px; max-height: 60vh; overflow-y: auto; }
.sl-hud-unit { padding: 6px 8px; margin-bottom: 4px; border-radius: 6px; background: #1a1f29;
  display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.sl-hud-unit.activatable { cursor: pointer; outline: 1px solid #69f0ae; }
.sl-hud-unit.activatable:hover { background: #213028; }
.sl-hud-unit.active { outline: 2px solid #69f0ae; }
.sl-hud-unit.destroyed { opacity: 0.35; text-decoration: line-through; }
.sl-hud-unit-name { font-weight: 600; }
.sl-hud-unit-stats { font-size: 11px; color: #b0bec5; }
.sl-hud-unit-tags { font-size: 10px; color: #ff8a65; }
.sl-hud-bottom { position: absolute; bottom: 16px; left: 50%; transform: translateX(-50%);
  pointer-events: auto; display: flex; align-items: center; gap: 10px;
  background: rgba(10, 12, 16, 0.88); border: 1px solid #2a2f3a; border-radius: 10px;
  padding: 10px 16px; max-width: 80vw; }
.sl-hud-btn { pointer-events: auto; background: #263238; color: #eee; border: 1px solid #37474f;
  border-radius: 6px; padding: 6px 14px; cursor: pointer; font-size: 13px; }
.sl-hud-btn:hover:not([disabled]) { background: #37474f; }
.sl-hud-btn[disabled] { opacity: 0.4; cursor: default; }
.sl-hud-btn.primary { background: #2e7d32; border-color: #43a047; font-weight: 600; }
.sl-hud-btn.primary:hover { background: #43a047; }
.sl-hud-hint { color: #b0bec5; }
.sl-hud-active-name { font-weight: 700; color: #69f0ae; margin-right: 8px; }
.sl-hud-confirm-summary { color: #fff; margin-right: 8px; }
.sl-hud-dice-title { font-size: 12px; color: #90caf9; margin-bottom: 4px; }
.sl-hud-dice-row { display: flex; gap: 4px; margin-bottom: 4px; }
.sl-die { display: inline-flex; align-items: center; justify-content: center; width: 24px;
  height: 24px; border-radius: 4px; background: #37474f; font-weight: 700; }
.sl-die.def { background: #4e342e; }
.sl-hud-dice-summary { font-size: 12px; color: #b0bec5; }
.sl-hud-dice-empty, .sl-hud-log-empty { color: #607d8b; font-size: 12px; }
.sl-hud-log-entry { font-size: 12px; color: #b0bec5; padding: 2px 0; }
.sl-hud-toast { position: absolute; bottom: 90px; left: 50%; transform: translateX(-50%);
  background: #5d1f1f; color: #ff8a65; border: 1px solid #a9402f; border-radius: 8px;
  padding: 8px 16px; font-size: 13px; }
`;
    document.head.appendChild(style);
  }
}
