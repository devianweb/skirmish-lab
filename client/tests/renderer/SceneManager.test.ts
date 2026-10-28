// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';

// SceneManager needs a WebGL context jsdom can't provide, so only the
// WebGLRenderer is faked — scene, camera, and lights run real Three.js.
vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  class FakeWebGLRenderer {
    domElement: HTMLCanvasElement;
    setSize = vi.fn();
    setPixelRatio = vi.fn();
    render = vi.fn();
    constructor() {
      this.domElement = document.createElement('canvas');
    }
  }
  return { ...actual, WebGLRenderer: FakeWebGLRenderer };
});

import { SceneManager } from '../../src/renderer/SceneManager';

describe('SceneManager', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.innerWidth = 1024;
    window.innerHeight = 768;
  });

  function makeSceneManager(): SceneManager {
    const container = document.createElement('div');
    document.body.appendChild(container);
    return new SceneManager(container);
  }

  it('mounts its canvas into the container', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    new SceneManager(container);
    expect(container.querySelector('canvas')).not.toBeNull();
  });

  it('sets initial camera aspect from the window size', () => {
    const manager = makeSceneManager();
    expect(manager.getCamera().aspect).toBeCloseTo(1024 / 768);
  });

  it('updates camera aspect and renderer size on window resize', () => {
    const manager = makeSceneManager();

    window.innerWidth = 800;
    window.innerHeight = 600;
    window.dispatchEvent(new Event('resize'));

    expect(manager.getCamera().aspect).toBeCloseTo(800 / 600);
    expect(manager.getRenderer().setSize).toHaveBeenCalledWith(800, 600);
  });

  it('runs the frame callback and a render on every animation frame', () => {
    let nextFrame: (() => void) | null = null;
    vi.stubGlobal(
      'requestAnimationFrame',
      (cb: () => void) => {
        nextFrame = cb;
        return 1;
      }
    );

    const manager = makeSceneManager();
    const frameCallback = vi.fn();

    manager.startAnimationLoop(frameCallback);

    // First frame runs synchronously when the loop starts.
    expect(frameCallback).toHaveBeenCalledTimes(1);
    expect(manager.getRenderer().render).toHaveBeenCalledTimes(1);

    nextFrame!();
    expect(frameCallback).toHaveBeenCalledTimes(2);
    expect(manager.getRenderer().render).toHaveBeenCalledTimes(2);
    expect(manager.getRenderer().render).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'Scene' }),
      expect.objectContaining({ isPerspectiveCamera: true })
    );
  });
});
