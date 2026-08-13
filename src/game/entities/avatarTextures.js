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
  bunny: {
    front: ['bunny-front-step1', 'bunny-front-step2'],
    back: ['bunny-back-step1', 'bunny-back-step2'],
    side: ['bunny-side-step1', 'bunny-side-step2'],
  },
};

const AVATAR_FRAME_PATHS = {
  hoodie: {
    front: ['/avatars/hoodie/front-step1.png', '/avatars/hoodie/front-step2.png'],
    back: ['/avatars/hoodie/back-step1.png', '/avatars/hoodie/back-step2.png'],
    side: ['/avatars/hoodie/side-step1.png', '/avatars/hoodie/side-step2.png'],
  },
  bunny: {
    front: ['/avatars/bunny/front-step1.png', '/avatars/bunny/front-step2.png'],
    back: ['/avatars/bunny/back-step1.png', '/avatars/bunny/back-step2.png'],
    side: ['/avatars/bunny/side-step1.png', '/avatars/bunny/side-step2.png'],
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

  // Source sheets for exact male hoodie slices.
  if (!scene.textures.exists('hoodie-source-turnaround-step1')) {
    scene.load.image('hoodie-source-turnaround-step1', '/avatars/source/hoodie_turnaround_step1.png');
  }
  if (!scene.textures.exists('hoodie-source-walk-step2')) {
    scene.load.image('hoodie-source-walk-step2', '/avatars/source/hoodie_walk_step2.png');
  }
}
