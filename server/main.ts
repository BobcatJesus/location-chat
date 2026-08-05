import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from './config';
import { VillageScene } from './scenes/VillageScene';

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'app',
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  backgroundColor: '#1b1b1f',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [VillageScene],
});