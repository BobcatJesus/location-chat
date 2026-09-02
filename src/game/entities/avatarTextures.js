export const AVATAR_FRAME_KEYS = {
  og: {
    front: ['demon-front-step1', 'demon-front-step2'],
    back: ['demon-back-step1', 'demon-back-step2'],
    side: ['demon-side-step1', 'demon-side-step2'],
  },
  hoodie: {
    front: ['hoodie-front-step1', 'hoodie-front-step2'],
    back: ['hoodie-back-step1', 'hoodie-back-step2'],
    side: ['hoodie-side-step1', 'hoodie-side-step2'],
  },
  male: {
    front: ['male-front-step1', 'male-front-step2'],
    back: ['male-back-step1', 'male-back-step2'],
    side: ['male-side-step1', 'male-side-step2'],
  },
  bunny: {
    front: ['bunny-front-step1', 'bunny-front-step2'],
    back: ['bunny-back-step1', 'bunny-back-step2'],
    side: ['bunny-side-step1', 'bunny-side-step2'],
  },
  turtle: {
    front: ['turtle-front-step1', 'turtle-front-step2'],
    back: ['turtle-back-step1', 'turtle-back-step2'],
    side: ['turtle-side-step1', 'turtle-side-step2'],
  },
  snake: {
    front: ['snake-front-step1', 'snake-front-step2'],
    back: ['snake-back-step1', 'snake-back-step2'],
    side: ['snake-side-step1', 'snake-side-step2'],
  },
};

const AVATAR_FRAME_PATHS = {
  hoodie: {
    front: ['/avatars/hoodie/front-step1.png', '/avatars/hoodie/front-step2.png'],
    back: ['/avatars/hoodie/back-step1.png', '/avatars/hoodie/back-step2.png'],
    side: ['/avatars/hoodie/side-step1.png', '/avatars/hoodie/side-step2.png'],
  },
  male: {
    front: ['/avatars/male/front-step1.png', '/avatars/male/front-step2.png'],
    back: ['/avatars/male/back-step1.png', '/avatars/male/back-step2.png'],
    side: ['/avatars/male/side-step1.png', '/avatars/male/side-step2.png'],
  },
  bunny: {
    front: ['/avatars/bunny/front-step1.png', '/avatars/bunny/front-step2.png'],
    back: ['/avatars/bunny/back-step1.png', '/avatars/bunny/back-step2.png'],
    side: ['/avatars/bunny/side-step1.png', '/avatars/bunny/side-step2.png'],
  },
  turtle: {
    front: ['/avatars/turtle/front-step1.png', '/avatars/turtle/front-step2.png'],
    back: ['/avatars/turtle/back-step1.png', '/avatars/turtle/back-step2.png'],
    side: ['/avatars/turtle/side-step1.png', '/avatars/turtle/side-step2.png'],
  },
  snake: {
    front: ['/avatars/snake/front-step1.png', '/avatars/snake/front-step2.png'],
    back: ['/avatars/snake/back-step1.png', '/avatars/snake/back-step2.png'],
    side: ['/avatars/snake/side-step1.png', '/avatars/snake/side-step2.png'],
  },
};

export function preloadAvatarTextures(scene) {
  Object.entries(AVATAR_FRAME_PATHS).forEach(([model, dirs]) => {
    Object.entries(dirs).forEach(([dir, paths]) => {
      paths.forEach((path, i) => {
        const key = AVATAR_FRAME_KEYS[model][dir][i];
        if (!scene.textures.exists(key)) {
          scene.load.image(key, path);
        }
      });
    });
  });

  // Legacy fallback keys used if a target frame is missing.
  const legacyDirs = ['front', 'back', 'side'];
  legacyDirs.forEach((dir) => {
    [1, 2].forEach((step) => {
      const key = `demon-${dir}-step${step}`;
      if (!scene.textures.exists(key)) {
        scene.load.image(key, `/village-sprites/characters/demon-${dir}-step${step}.png`);
      }
    });
  });

}
