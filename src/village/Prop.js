import { DEPTH } from './depth.js';

// Prop sizes (display width x height in game pixels)
export const PROP_DEFS = {
  prop_table_round:    { w: 72,  h: 56,  label: 'Table' },
  prop_portrait_framed:{ w: 40,  h: 48,  label: 'Portrait' },
  prop_trash_can:      { w: 32,  h: 44,  label: 'Trash Can' },
  prop_jukebox:        { w: 56,  h: 80,  label: 'Jukebox' },
  prop_coffee_cup:     { w: 28,  h: 24,  label: 'Coffee Cup' },
  prop_lamp_floor:     { w: 40,  h: 96,  label: 'Floor Lamp' },
  prop_plant_potted:   { w: 44,  h: 72,  label: 'Plant' },
  prop_chair_wooden:   { w: 40,  h: 56,  label: 'Chair' },
  prop_books_stack:    { w: 36,  h: 28,  label: 'Books' },
  prop_candle:         { w: 20,  h: 32,  label: 'Candle' },
  prop_bookshelf:      { w: 72,  h: 96,  label: 'Bookshelf' },
  prop_rug_rolled:     { w: 56,  h: 28,  label: 'Rug' },
};

export class Prop {
  constructor(scene, x, y, frameKey, options = {}) {
    const textureKey = options.textureKey || 'props';
    const def = PROP_DEFS[frameKey] || {};
    if (textureKey === 'props' && !def.w) {
      console.warn('[Prop] unknown key:', frameKey);
      return;
    }

    this.scene = scene;
    this.frameKey = frameKey;
    this.x = x;
    this.y = y;

    const angle = Number.isFinite(options.rotation) ? options.rotation : 0;
    const targetHeight = Number(options.targetHeight ?? options.displaySize?.h ?? def.h ?? 40);

    const useDirectTexture = textureKey !== 'props' || scene.textures.exists(frameKey);
    this.sprite = scene.add.image(
      x,
      y,
      useDirectTexture ? (textureKey === 'props' ? frameKey : textureKey) : 'props',
      useDirectTexture && textureKey === 'props' ? frameKey : undefined
    )
      .setOrigin(0.5, 1)
      .setAngle(angle)
      .setDepth(y);

    const naturalHeight = Number(this.sprite.texture?.frame?.height ?? this.sprite.height ?? 1);
    const scale = naturalHeight > 0 ? (targetHeight / naturalHeight) : 1;
    this.sprite.setScale(scale);
  }

  destroy() {
    this.sprite?.destroy();
  }
}
