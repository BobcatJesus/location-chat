import Phaser from 'phaser';

/** All shadows live on one layer beneath every actor and prop. */
export const SHADOW_DEPTH = -500;
/** Ground/floor draws beneath the shadows. */
export const GROUND_DEPTH = -1000;

export interface ActorConfig {
  scene: Phaser.Scene;
  x: number;
  y: number;
  /** placeholder body size — becomes the generated sprite's frame size */
  width: number;
  height: number;
  color: number;
  /** ground shadow width; defaults to body width */
  footprintWidth?: number;
}

export class Actor {
  readonly scene: Phaser.Scene;
  readonly body: Phaser.GameObjects.Rectangle;
  readonly shadow: Phaser.GameObjects.Ellipse;

  constructor(cfg: ActorConfig) {
    this.scene = cfg.scene;
    const footprint = cfg.footprintWidth ?? cfg.width;

    // Shadow first, on its own layer, sized to the footprint (2:1 ellipse).
    this.shadow = cfg.scene.add.ellipse(
      cfg.x, cfg.y,
      footprint, footprint * 0.5,
      0x000000, 0.28,
    );
    this.shadow.setDepth(SHADOW_DEPTH);

    // Body: feet-origin pivot is the whole trick — y is where the feet are.
    this.body = cfg.scene.add.rectangle(cfg.x, cfg.y, cfg.width, cfg.height, cfg.color);
    this.body.setOrigin(0.5, 1);
    this.body.setStrokeStyle(3, 0x2b2b33);
  }

  get x(): number { return this.body.x; }
  get y(): number { return this.body.y; }

  setPosition(x: number, y: number): this {
    this.body.setPosition(x, y);
    return this;
  }

  /** Run once per frame after movement: shadow follows feet, depth follows y. */
  sync(): void {
    this.shadow.setPosition(this.body.x, this.body.y);
    this.body.setDepth(this.body.y);
  }

  destroy(): void {
    this.body.destroy();
    this.shadow.destroy();
  }
}