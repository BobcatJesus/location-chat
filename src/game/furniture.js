// Furniture item definitions — each has an id, label, draw function params
export const FURNITURE = [
  { type: 'table',    label: 'Table',       emoji: '🪑', w: 48, h: 32, color: 0x5c3300 },
  { type: 'chair',    label: 'Chair',       emoji: '💺', w: 20, h: 20, color: 0x3d2200 },
  { type: 'jukebox',  label: 'Jukebox',     emoji: '🎵', w: 24, h: 36, color: 0x220044 },
  { type: 'pinball',  label: 'Pinball',     emoji: '🎯', w: 28, h: 42, color: 0x002244 },
  { type: 'cashier',  label: 'Cashier',     emoji: '💰', w: 50, h: 20, color: 0x1a3300 },
  { type: 'art',      label: 'Art',         emoji: '🖼️', w: 32, h: 28, color: 0x2a1a00 },
  { type: 'rug',      label: 'Rug',         emoji: '🟫', w: 64, h: 48, color: 0x8B0000 },
  { type: 'neon',     label: 'Neon Sign',   emoji: '💡', w: 56, h: 22, color: 0xff00aa },
  { type: 'dj',       label: 'DJ Stage',    emoji: '🎧', w: 72, h: 40, color: 0x1a1a2e },
  { type: 'plant',    label: 'Plant',       emoji: '🌿', w: 20, h: 20, color: 0x1a4a00 },
  { type: 'sofa',     label: 'Sofa',        emoji: '🛋️', w: 56, h: 24, color: 0x4a2a00 },
  { type: 'bar',      label: 'Bar Counter', emoji: '🍺', w: 80, h: 20, color: 0x3d1a00 },
];

// Draw a piece of furniture in Phaser at (x, y)
export function drawFurniture(scene, item) {
  const def = FURNITURE.find(f => f.type === item.type) || FURNITURE[0];
  const { x, y } = item;
  const container = scene.add.container(x, y);

  switch (item.type) {
    case 'table':
      container.add(scene.add.rectangle(0, 0, def.w, def.h, 0x5c3300));
      container.add(scene.add.rectangle(0, 0, def.w - 4, def.h - 4, 0x8B6914).setAlpha(0.6));
      break;
    case 'chair':
      container.add(scene.add.rectangle(0, 0, def.w, def.h, 0x3d2200));
      container.add(scene.add.rectangle(0, -8, def.w, 6, 0x5c3300)); // back
      break;
    case 'jukebox':
      container.add(scene.add.rectangle(0, 0, def.w, def.h, 0x220044));
      container.add(scene.add.rectangle(0, -8, 18, 14, 0x000000)); // screen
      container.add(scene.add.circle(0, -8, 5, 0x00ffff).setAlpha(0.8));
      [0xff0000, 0x00ff00, 0x0000ff].forEach((c, i) =>
        container.add(scene.add.circle(-8 + i * 8, 8, 3, c).setAlpha(0.9))
      );
      break;
    case 'pinball':
      container.add(scene.add.rectangle(0, 0, def.w, def.h, 0x002244));
      container.add(scene.add.rectangle(0, -10, 22, 18, 0x000033)); // playfield
      container.add(scene.add.circle(0, -5, 4, 0xffff00).setAlpha(0.8)); // ball
      break;
    case 'cashier':
      container.add(scene.add.rectangle(0, 0, def.w, def.h, 0x1a3300));
      container.add(scene.add.rectangle(-14, -2, 20, 14, 0x000000)); // screen
      container.add(scene.add.rectangle(10, -2, 12, 10, 0x333300)); // register
      break;
    case 'art':
      container.add(scene.add.rectangle(0, 0, def.w, def.h, 0x8B6914)); // frame
      container.add(scene.add.rectangle(0, 0, def.w - 6, def.h - 6, 0x4a3000)); // canvas
      [0xff6600, 0x0066ff, 0x00aa44].forEach((c, i) =>
        container.add(scene.add.rectangle(-8 + i * 8, 0, 6, 14, c).setAlpha(0.8))
      );
      break;
    case 'rug':
      container.add(scene.add.ellipse(0, 0, def.w, def.h, 0x8B0000).setAlpha(0.8));
      container.add(scene.add.ellipse(0, 0, def.w - 12, def.h - 10, 0xcc2222).setAlpha(0.6));
      container.add(scene.add.ellipse(0, 0, def.w - 24, def.h - 20, 0xff4444).setAlpha(0.4));
      break;
    case 'neon':
      container.add(scene.add.rectangle(0, 0, def.w, def.h, 0x000000).setAlpha(0.6));
      container.add(scene.add.rectangle(0, 0, def.w - 4, def.h - 4, 0xff00aa).setAlpha(0.15));
      container.add(scene.add.text(0, 0, 'OPEN', { fontFamily: 'Courier New', fontSize: '10px', color: '#ff00aa' }).setOrigin(0.5).setAlpha(0.95));
      container.add(scene.add.rectangle(0, 0, def.w, def.h, 0xff00aa).setAlpha(0.06));
      break;
    case 'dj':
      container.add(scene.add.rectangle(0, 4, def.w, def.h, 0x1a1a2e)); // stage
      container.add(scene.add.rectangle(0, -8, 60, 20, 0x222244)); // deck
      container.add(scene.add.circle(-18, -8, 8, 0x333366)); // platter L
      container.add(scene.add.circle(18, -8, 8, 0x333366)); // platter R
      container.add(scene.add.rectangle(0, -8, 8, 16, 0x666688)); // mixer
      [0xff0000, 0x00ffff, 0xff00ff].forEach((c, i) =>
        container.add(scene.add.rectangle(-12 + i * 12, -22, 6, 4, c).setAlpha(0.9))
      );
      break;
    case 'plant':
      container.add(scene.add.rectangle(0, 6, 14, 12, 0x3d2200)); // pot
      container.add(scene.add.circle(0, -4, 10, 0x1a4a00));
      container.add(scene.add.circle(-4, -8, 7, 0x2d6e1a));
      container.add(scene.add.circle(4, -8, 7, 0x2d6e1a));
      break;
    case 'sofa':
      container.add(scene.add.rectangle(0, 0, def.w, def.h, 0x4a2a00));
      container.add(scene.add.rectangle(0, 4, def.w - 6, 12, 0x6b3d00)); // seat
      container.add(scene.add.rectangle(0, -8, def.w, 8, 0x5c3300)); // back
      container.add(scene.add.rectangle(-24, 0, 8, def.h, 0x5c3300)); // arm L
      container.add(scene.add.rectangle(24, 0, 8, def.h, 0x5c3300)); // arm R
      break;
    case 'bar':
      container.add(scene.add.rectangle(0, 0, def.w, def.h, 0x3d1a00));
      container.add(scene.add.rectangle(0, -2, def.w - 4, 8, 0x5c2800)); // top
      for (let i = -3; i <= 3; i++)
        container.add(scene.add.rectangle(i * 10, 4, 6, 8, 0x1a0a00)); // stools
      break;
    default:
      container.add(scene.add.rectangle(0, 0, 24, 24, def.color));
  }

  return container;
}
