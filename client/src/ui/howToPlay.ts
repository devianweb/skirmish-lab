/**
 * How to Play & Controls card content and modal renderer (14G).
 *
 * Single module of truth for controls, turn flow, the free rules link,
 * and the fan-project disclaimer, rendered in both the lobby and the in-game HUD.
 */

export const HOW_TO_PLAY_RULES_URL = 'https://onepagerules.com';

export const HOW_TO_PLAY_DISCLAIMER =
  'Unofficial fan project for One Page Rules games. Not affiliated with or endorsed by One Page Rules.';

export interface ControlItem {
  name: string;
  keysOrInput: string;
  description: string;
  sourceFile: string;
}

export const CAMERA_CONTROLS: ControlItem[] = [
  {
    name: 'Orbit / Rotate',
    keysOrInput: 'Left-click drag',
    description: 'Orbit camera around the battlefield centre',
    sourceFile: 'client/src/renderer/CameraController.ts',
  },
  {
    name: 'Pan',
    keysOrInput: 'Right-click drag',
    description: 'Pan camera across the board',
    sourceFile: 'client/src/renderer/CameraController.ts',
  },
  {
    name: 'Zoom',
    keysOrInput: 'Scroll wheel',
    description: 'Zoom in or out',
    sourceFile: 'client/src/renderer/CameraController.ts',
  },
];

export const GENERAL_CONTROLS: ControlItem[] = [
  {
    name: 'Select Unit',
    keysOrInput: 'Click unit',
    description: 'Select a friendly unit to view its card or activate it',
    sourceFile: 'client/src/ui/GameHUD.ts',
  },
  {
    name: 'Move / Place',
    keysOrInput: 'Click ground / terrain',
    description: 'Set movement destination or place a unit/model',
    sourceFile: 'client/src/ui/GameHUD.ts',
  },
  {
    name: 'Target Enemy',
    keysOrInput: 'Click enemy',
    description: 'Select an enemy target for shooting or melee charge',
    sourceFile: 'client/src/ui/GameHUD.ts',
  },
  {
    name: 'Confirm Action',
    keysOrInput: 'Confirm button',
    description: 'Commit staged movement, attacks, reactions, or deployment',
    sourceFile: 'client/src/ui/GameHUD.ts',
  },
  {
    name: 'Cancel Action',
    keysOrInput: 'Cancel button',
    description: 'Reset current action, targeting, or unconfirmed placement',
    sourceFile: 'client/src/ui/GameHUD.ts',
  },
  {
    name: 'Line-of-Sight & Terrain Debugger',
    keysOrInput: 'F9 (in game)',
    description: 'Toggle line-of-sight rays and terrain collision inspector',
    sourceFile: 'client/src/ui/GameHUD.ts',
  },
  {
    name: 'Developer Mode',
    keysOrInput: 'F9 (in lobby)',
    description: 'Toggle developer mode to unlock test armies and test maps',
    sourceFile: 'client/src/ui/Lobby.ts',
  },
];

export const MAP_BUILDER_CONTROLS: ControlItem[] = [
  {
    name: 'Rotate',
    keysOrInput: 'R',
    description: 'Rotate selected piece 90°',
    sourceFile: 'client/src/editor/MapEditor.ts',
  },
  {
    name: 'Raise Elevation',
    keysOrInput: 'E',
    description: 'Raise elevation (+0.5")',
    sourceFile: 'client/src/editor/MapEditor.ts',
  },
  {
    name: 'Lower Elevation',
    keysOrInput: 'Q',
    description: 'Lower elevation (-0.5")',
    sourceFile: 'client/src/editor/MapEditor.ts',
  },
  {
    name: 'Delete Piece',
    keysOrInput: 'Delete / Backspace',
    description: 'Delete selected piece',
    sourceFile: 'client/src/editor/MapEditor.ts',
  },
  {
    name: 'Duplicate Piece',
    keysOrInput: 'Ctrl+D / Cmd+D',
    description: 'Duplicate selected piece',
    sourceFile: 'client/src/editor/MapEditor.ts',
  },
  {
    name: 'Deselect / Cancel',
    keysOrInput: 'Esc',
    description: 'Deselect piece or cancel placement tool',
    sourceFile: 'client/src/editor/MapEditor.ts',
  },
];

export const ALL_CONTROLS: ControlItem[] = [
  ...CAMERA_CONTROLS,
  ...GENERAL_CONTROLS,
  ...MAP_BUILDER_CONTROLS,
];

export const HOW_TO_PLAY_TURN_FLOW: string[] = [
  'Players alternate activating one unit at a time.',
  'Pick a ready unit and choose an action: Hold, Advance, Rush, or Charge.',
  'Position your models on the battlefield or choose targets, then Confirm.',
  'The other player may get a reaction prompt (such as Auto or Confirm).',
  'The server rolls the dice authoritatively and the Dice panel shows them.',
  'Matches last 4 rounds; the player holding the most objectives wins.',
];

function renderControlRows(items: ControlItem[]): string {
  return items
    .map(
      (item) => `
        <div style="display: flex; justify-content: space-between; align-items: baseline; font-size: 12px; margin-bottom: 6px; gap: 8px;">
          <span style="color: #eee; flex: 1; min-width: 0;">
            <strong style="color: #ffd54f; font-family: monospace; background: #12161c; padding: 2px 6px; border-radius: 4px; border: 1px solid #37474f; font-size: 11px; white-space: nowrap;">${item.keysOrInput}</strong>
            <span style="margin-left: 6px; font-weight: 600;">${item.name}</span>
          </span>
          <span style="color: #b0bec5; font-size: 12px; text-align: right; flex-shrink: 0;">${item.description}</span>
        </div>`
    )
    .join('');
}

/**
 * Returns the HTML string for the How to play modal.
 * Styled matching the lobby card and HUD panels.
 */
export function renderHowToPlayModalHtml(): string {
  const turnFlowHtml = HOW_TO_PLAY_TURN_FLOW.map((line) => `<li style="margin-bottom: 4px;">${line}</li>`).join('');

  return `
    <div class="sl-how-to-play-overlay" data-action="how-to-play-backdrop" style="position: fixed; inset: 0; background: rgba(0, 0, 0, 0.75); display: flex; align-items: center; justify-content: center; z-index: 200; pointer-events: auto; padding: 20px; box-sizing: border-box;">
      <div class="sl-how-to-play-card" style="position: relative; max-width: 580px; width: 100%; max-height: 85vh; overflow-y: auto; background: rgba(18, 22, 28, 0.96); border: 1px solid #37474f; border-radius: 12px; padding: 24px; box-shadow: 0 16px 40px rgba(0, 0, 0, 0.7); box-sizing: border-box; font-family: system-ui, Arial, sans-serif; color: #eee; text-align: left;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; border-bottom: 1px solid #2a3442; padding-bottom: 12px;">
          <h2 style="margin: 0; font-size: 20px; color: #ffd54f; font-weight: 700; letter-spacing: 0.5px;">How to Play</h2>
          <button class="sl-hud-btn sl-how-to-play-close-btn" data-action="how-to-play-close" aria-label="Close" title="Close" style="background: transparent; border: none; color: #b0bec5; font-size: 22px; font-weight: 700; cursor: pointer; padding: 2px 6px; line-height: 1; border-radius: 4px;">✕</button>
        </div>

        <div style="margin-bottom: 20px;">
          <h3 style="margin: 0 0 10px; font-size: 13px; color: #90caf9; text-transform: uppercase; letter-spacing: 0.5px;">Turn Flow</h3>
          <ol class="sl-how-to-play-turn-flow" style="margin: 0; padding-left: 20px; font-size: 13px; line-height: 1.6; color: #cfd8dc;">
            ${turnFlowHtml}
          </ol>
        </div>

        <div style="margin-bottom: 20px;">
          <h3 style="margin: 0 0 10px; font-size: 13px; color: #90caf9; text-transform: uppercase; letter-spacing: 0.5px;">Controls</h3>
          
          <div style="margin-bottom: 12px; background: rgba(26, 31, 41, 0.7); padding: 12px 14px; border-radius: 8px; border: 1px solid #2a3442;">
            <div style="font-size: 12px; color: #ffd54f; font-weight: 700; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px;">Camera Controls</div>
            ${renderControlRows(CAMERA_CONTROLS)}
          </div>

          <div style="margin-bottom: 12px; background: rgba(26, 31, 41, 0.7); padding: 12px 14px; border-radius: 8px; border: 1px solid #2a3442;">
            <div style="font-size: 12px; color: #ffd54f; font-weight: 700; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px;">Battlefield & HUD</div>
            ${renderControlRows(GENERAL_CONTROLS)}
          </div>

          <div style="background: rgba(26, 31, 41, 0.7); padding: 12px 14px; border-radius: 8px; border: 1px solid #2a3442;">
            <div style="font-size: 12px; color: #ffd54f; font-weight: 700; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px;">Map Builder Keys</div>
            ${renderControlRows(MAP_BUILDER_CONTROLS)}
          </div>
        </div>

        <div style="border-top: 1px solid #2a3442; padding-top: 14px; font-size: 11px; line-height: 1.5; color: #78909c;">
          <div>${HOW_TO_PLAY_DISCLAIMER}</div>
          <div style="margin-top: 4px;">Full rules: <a href="${HOW_TO_PLAY_RULES_URL}" target="_blank" rel="noopener noreferrer" style="color: #90caf9;">onepagerules.com</a> (free)</div>
        </div>

        <div style="margin-top: 16px; display: flex; justify-content: flex-end;">
          <button class="sl-hud-btn sl-how-to-play-footer-close" data-action="how-to-play-close" style="padding: 8px 20px; font-size: 13px; font-weight: 600; background: #37474f; color: #eee; border: none; border-radius: 6px; cursor: pointer;">Close</button>
        </div>
      </div>
    </div>
  `;
}
