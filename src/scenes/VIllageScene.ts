import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from '../config';
import { Actor, GROUND_DEPTH } from '../world/Actor';
import { World } from '../world/World';

    
const SPEED = 180;

export class VillageScene extends Phaser.Scene {
  private world!: World;
  private player!: Actor;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private keys!: Record<'W' | 'A' | 'S' | 'D', Phaser.Input.Keyboard.Key>;

  constructor() {
    super('VillageScene');
  }

  create(): void {
    console.log('CREATE START');

    this.world = new World();

    this.add
      .rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x8fbc78)
      .setOrigin(0, 0)
      .setDepth(GROUND_DEPTH);

    const props = [
      { x: 260, y: 220, w: 70,  h: 190, c: 0x6b4f3a }, // tree
      { x: 520, y: 300, w: 120, h: 150, c: 0xd98b6a }, // stall
      { x: 760, y: 200, w: 60,  h: 240, c: 0x6b4f3a }, // lamp post
      { x: 400, y: 440, w: 150, h: 90,  c: 0x9aa7b5 }, // fountain
    ];

    for (const p of props) {
      this.world.add(
        new Actor({
          scene: this,
          x: p.x,
          y: p.y,
          width: p.w,
          height: p.h,
          color: p.c,
          footprintWidth: p.w * 1.1,
        }),
      );
    }

   this.player = this.world.add(
      new Actor({
        scene: this,
        x: 160,                 // was GAME_WIDTH / 2
        y: GAME_HEIGHT - 60,    // was GAME_HEIGHT / 2
        width: 48,
        height: 96,
        color: 0xe8a33d,
        footprintWidth: 44,
      }),
    );


    this.cursors = this.input.keyboard!.createCursorKeys();
    this.keys = this.input.keyboard!.addKeys('W,A,S,D') as typeof this.keys;

    this.add
      .text(12, 12, 'Arrows / WASD to move', { fontSize: '14px', color: '#ffffff' })
      .setDepth(10000);

    this.world.sync();
    console.log('CREATE END');
  }

  update(_time: number, delta: number): void {
    const step = (SPEED * delta) / 1000;

    let dx = 0;
    let dy = 0;
    if (this.cursors.left.isDown  || this.keys.A.isDown) dx -= 1;
    if (this.cursors.right.isDown || this.keys.D.isDown) dx += 1;
    if (this.cursors.up.isDown    || this.keys.W.isDown) dy -= 1;
    if (this.cursors.down.isDown  || this.keys.S.isDown) dy += 1;

    if (dx !== 0 || dy !== 0) {
      const len = Math.hypot(dx, dy);
      this.player.setPosition(
        Phaser.Math.Clamp(this.player.x + (dx / len) * step, 20, GAME_WIDTH - 20),
        Phaser.Math.Clamp(this.player.y + (dy / len) * step, 60, GAME_HEIGHT - 10),
      );
    }

    this.world.sync();
  }
}