import Phaser from 'phaser';
import { VillageScene } from './scenes/VillageScene';

import { GAME_WIDTH, GAME_HEIGHT } from './config';

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'app',
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  backgroundColor: '#8fbc78',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [VillageScene],
});
