export const FLOOR_W = 1600;
export const FLOOR_H = 900;

export const defaultLayout = {
  id: 'default',
  spawnF1: { x: 800, y: 450 },
  floors: [
    {
      carpet: 0x6aab45,
      wallColor: 0x2b2b33,
      zones: [
        { type: 'wall', x: 0, y: 0, w: FLOOR_W, h: FLOOR_H },
      ],
    },
  ],
};
