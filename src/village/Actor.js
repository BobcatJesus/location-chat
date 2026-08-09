import Phaser from 'phaser';
import { DEPTH } from './depth.js';

const MAX_SHADOW_Z = 120;

export class Actor {
  constructor(cfg) {
    this.scene = cfg.scene;
    this.gx = cfg.gx;
    this.gy = cfg.gy;
    this.z = 0;
    this.footprintWidth = cfg.footprintWidth;
    this.footprintHeight = cfg.footprintHeight ?? cfg.footprintWidth * 0.5;
    this.solid = cfg.solid ?? false;

    if (cfg.shadowTexture) {
      this.shadow = cfg.scene.add.image(this.gx, this.gy, cfg.shadowTexture)
        .setDisplaySize(this.footprintWidth, this.footprintHeight);
    } else {
      this.shadow = cfg.scene.add.ellipse(this.gx, this.gy, this.footprintWidth, this.footprintHeight, 0x000000, 0.28);
    }
    this.shadow.setDepth(DEPTH.SHADOW);

    this.sprite = cfg.scene.add.image(this.gx, this.gy, cfg.texture, cfg.frame ?? null);
    this.sprite.setOrigin(0.5, 1);
    if (cfg.scale) this.sprite.setScale(cfg.scale);

    this.sync();
  }

  moveTo(gx, gy) { this.gx = gx; this.gy = gy; return this; }
  moveBy(dx, dy) { this.gx += dx; this.gy += dy; return this; }

  sync() {
    this.sprite.x = this.gx;
    this.sprite.y = this.gy - this.z;
    this.sprite.setDepth(DEPTH.ACTOR_MIN + Math.round(this.gy));
    const t = Phaser.Math.Clamp(this.z / MAX_SHADOW_Z, 0, 1);
    this.shadow.x = this.gx;
    this.shadow.y = this.gy;
    this.shadow.setScale(Phaser.Math.Linear(1, 0.55, t));
    this.shadow.setAlpha(Phaser.Math.Linear(0.28, 0.1, t));
  }

  destroy() {
    this.sprite.destroy();
    this.shadow.destroy();
  }
}
