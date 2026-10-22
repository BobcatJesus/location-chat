import Phaser from 'phaser';

const PHOTO_BASE_SIZE = 32;
const PHOTO_BASE_RADIUS = PHOTO_BASE_SIZE / 2;
const BODY_TYPE_SCALE = {
  compact: 0.92,
  standard: 1,
  broad: 1.08,
};

function firstExistingTexture(scene, keys) {
  for (const key of keys) {
    if (scene.textures.exists(key)) return key;
  }
  return '__MISSING';
}

function inferSpriteScale(scene, textureKey, targetHeight) {
  try {
    const tex = scene.textures.get(textureKey);
    const src = tex?.getSourceImage?.();
    const h = Number(src?.height || 0);
    if (!h) return 0.17;
    return targetHeight / h;
  } catch {
    return 0.17;
  }
}

export default class SpriteAvatarBase extends Phaser.GameObjects.Container {
  constructor(scene, x, y, {
    name = '',
    isLocal = false,
    frameKeys,
    targetHeight = 52,
    shadowColor = 0x000000,
    bodyType = 'standard',
  } = {}) {
    super(scene, x, y);
    this.scene = scene;
    this.x = x;
    this.y = y;
    this._frameKeys = frameKeys;
    this._targetHeight = targetHeight;
    this._dir = 'front';
    this._moving = false;
    this._facingLeft = false;
    this._stepAccum = Math.random() * 120;
    // Drunkenness lives in the base class — like playDrink — so
    // every avatar model inherits it with zero per-model wiring.
    this._drunkLevel = 0;
    this._drunkClock = 0;
    this._drunkPhase = Math.random() * Math.PI * 2;
    this._hiccupIn = 3000 + Math.random() * 4000;
    this._stumbleIn = 3000 + Math.random() * 3000;
    this._stumblePulse = 0;
    this._stumbleX = 0;
    this._stars = null;
    this._stepFrame = 0;
    this._bodyScale = BODY_TYPE_SCALE[bodyType] || BODY_TYPE_SCALE.standard;

    this._shadow = scene.add.ellipse(0, 3, 34, 12, shadowColor, 0.22);
    this.add(this._shadow);

    const initialTexture = this._resolveTexture('front', 0);
    this._sprite = scene.add.image(0, 0, initialTexture).setOrigin(0.5, 1);
    this._baseScale = inferSpriteScale(scene, initialTexture, this._targetHeight) * this._bodyScale;
    this._sprite.setScale(this._baseScale);
    this.add(this._sprite);

    const labelText = (name || '').trim() || (isLocal ? 'YOU' : 'Traveler');
    this._label = scene.add.text(x, y - 38, labelText, {
      fontFamily: 'Courier New',
      fontSize: '10px',
      color: isLocal ? '#fef3c7' : '#fca5a5',
      backgroundColor: '#00000099',
      padding: { x: 3, y: 2 },
    }).setOrigin(0.5);

    this.setSize(44, 62);
    scene.add.existing(this);
  }

  _resolveTexture(direction, frameIdx) {
    const selected = this._frameKeys?.[direction]?.[frameIdx];
    const sameModelFallback = this._frameKeys?.front?.[0];
    const globalFallback = 'demon-front-step1';
    return firstExistingTexture(this.scene, [selected, sameModelFallback, globalFallback]);
  }

  _applyTexture(direction, frameIdx) {
    const key = this._resolveTexture(direction, frameIdx);
    this._sprite.setTexture(key);
    this._sprite.setScale(this._baseScale);
  }

  _getVisualScale() {
    return Math.max(1, Number(this.scaleX) || Number(this.scaleY) || 1);
  }

  _getLabelYOffset() {
    const scale = this._getVisualScale();
    return 42 + (scale - 1) * 28;
  }

  _getPhotoYOffset() {
    // Stack the photo clear ABOVE the name label (which sits above the head):
    // derive the offset from the label position + this photo's own radius,
    // so the disc can never sink onto the label or the avatar's head at
    // any zoom scale or photo size.
    const photoRadius = Math.max(PHOTO_BASE_RADIUS, Math.round(this._getPhotoSize() / 2));
    const labelHalfHeight = 10; // 10px font + padding, approx
    const ringMargin = 3;
    const gap = 5;
    return this._getLabelYOffset() + labelHalfHeight + ringMargin + gap + photoRadius;
  }

  _getPhotoSize() {
    const scale = this._getVisualScale();
    return Math.round(PHOTO_BASE_SIZE * Math.max(1.1, scale));
  }

  setScale(x, y = x) {
    super.setScale(x, y);
    this.syncLabel();
    return this;
  }

  setPosition(x, y) {
    this.x = x;
    this.y = y;
    super.setPosition(x, y);
    if (this._label) this.syncLabel();
  }

  setDepth(depth) {
    super.setDepth(depth);
    this._shadow.setDepth(Math.max(0, depth - 1000));
    this._sprite.setDepth(depth);
    this._label.setDepth(depth + 10);
    if (this._photoRing) this._photoRing.setDepth(depth + 10);
    if (this._photo) this._photo.setDepth(depth + 11);
  }

  setMovementState({ moving = false, direction = 'front', facingLeft = false } = {}) {
    this._moving = Boolean(moving);
    this._dir = direction || 'front';
    this._facingLeft = Boolean(facingLeft);
    this._sprite.setFlipX(this._dir === 'side' && this._facingLeft);
  }

  tick(delta = 16) {
    this._stepAccum += delta;
    if (this._moving && this._stepAccum >= 180) {
      this._stepAccum -= 180;
      this._stepFrame = 1 - this._stepFrame;
    }
    if (!this._moving) this._stepFrame = 0;

    const frame = this._moving ? this._stepFrame : 0;
    this._applyTexture(this._dir, frame);

    const bob = this._moving ? (this._stepFrame ? -1.1 : -0.3) : -0.2;
    this._sprite.y = bob;

    if (this._stars && (this._drunkLevel <= 0.66 || this._drinking)) for (const st of this._stars) st.setVisible(false);
    if (this._drunkLevel > 0.01 && !this._drinking) {
      // Staged performance — buzzed / tipsy / drunk must READ at a
      // glance, across the room: lean amplitude, stumble pulses,
      // a weaving walk, and floaters, all stepped up per stage.
      this._drunkClock += delta;
      const t = this._drunkClock / 1000;
      const lvl = this._drunkLevel;
      const stage = lvl > 0.66 ? 2 : lvl > 0.34 ? 1 : 0;
      const amp = [3.5, 8, 13][stage];
      const speed = [1.5, 1.8, 2.2][stage];
      this._stumbleIn -= delta;
      if (stage >= 1 && this._stumbleIn <= 0) {
        this._stumbleIn = stage === 2 ? 3500 + Math.random() * 3500 : 5000 + Math.random() * 4000;
        this._stumblePulse = (stage === 2 ? 10 : 6) * (Math.random() < 0.5 ? -1 : 1);
        if (this._moving) this._stumbleX = Math.sign(this._stumblePulse) * (stage === 2 ? 6 : 4);
      }
      this._stumblePulse *= Math.exp(-delta / 300);
      this._stumbleX *= Math.exp(-delta / 300);
      if (Math.abs(this._stumblePulse) < 0.05) this._stumblePulse = 0;
      const sway = Math.sin(t * speed + this._drunkPhase) * amp;
      const drift = Math.sin(t * 0.43 + this._drunkPhase * 2) * amp * 0.35;
      this._sprite.angle = sway + drift + this._stumblePulse;
      this._sprite.y += Math.sin(t * speed * 2 + this._drunkPhase) * (0.3 + lvl * 0.9);
      const weave = this._moving ? Math.sin(t * 2.1 + this._drunkPhase) * [0, 4, 7][stage] : 0;
      this._sprite.x = weave + this._stumbleX;
      if (this._moving && stage >= 1) this._sprite.angle += Math.sin(t * 2.1 + this._drunkPhase) * (stage === 2 ? 4 : 2);
      if (stage === 2) this._updateStars(t);
      else if (this._stars) for (const st of this._stars) st.setVisible(false);
      if (stage >= 1) {
        this._hiccupIn -= delta;
        if (this._hiccupIn <= 0) {
          this._hiccupIn = stage === 2 ? 3000 + Math.random() * 3000 : 4500 + Math.random() * 4500;
          this._spawnFloater(stage === 2 && Math.random() < 0.5 ? '💫' : '*hic*');
        }
      }
    } else if (!this._drinking && (this._sprite.angle !== 0 || this._sprite.x !== 0)) {
      this._sprite.angle = 0;
      this._sprite.x = 0;
      if (this._stars) for (const st of this._stars) st.setVisible(false);
    }
    this._shadow.scaleX = this._moving ? (this._stepFrame ? 0.96 : 1) : 1;
  }

  // Back-compat with older callers.
  setAnimationState({ moving = false, direction = 'front', sideFlip = 1, delta = 16 } = {}) {
    this.setMovementState({ moving, direction, facingLeft: sideFlip < 0 });
    this.tick(delta);
  }

  syncLabel() {
    if (!this._label) return;
    this._label.setPosition(this.x, this.y - this._getLabelYOffset());
    if (this._photo) {
      const photoY = this.y - this._getPhotoYOffset();
      const photoSize = this._getPhotoSize();
      const photoRadius = Math.max(PHOTO_BASE_RADIUS, Math.round(photoSize / 2));
      const ringRadius = photoRadius + 3;
      const ringDiameter = ringRadius * 2;
      this._photo.setPosition(this.x, photoY);
      const frame = this._photo.frame;
      const frameWidth = Number(
        frame?.cutWidth
        || frame?.width
        || frame?.realWidth
        || frame?.sourceSize?.w
        || frame?.sourceSize?.width
        || 0
      );
      const frameHeight = Number(
        frame?.cutHeight
        || frame?.height
        || frame?.realHeight
        || frame?.sourceSize?.h
        || frame?.sourceSize?.height
        || 0
      );
      const hasRenderableFrame = frameWidth > 0 && frameHeight > 0;
      if (!hasRenderableFrame) {
        // Texture frame can be momentarily unavailable while base64 upload finalizes.
        // Keep objects alive and hide them until the frame is renderable.
        this._photo.setVisible(false);
        if (this._photoRing) this._photoRing.setVisible(false);
        return;
      }
      this._photo.setVisible(true);
      this._photo.setDisplaySize(photoSize, photoSize);
      if (this._photoMask) this._photoMask.clear().fillCircle(this.x, photoY, photoRadius);
      if (this._photoRing) {
        this._photoRing.setVisible(true);
        this._photoRing.setPosition(this.x, photoY);
        if (typeof this._photoRing.setRadius === 'function') {
          this._photoRing.setRadius(ringRadius);
        } else {
          this._photoRing.setDisplaySize(ringDiameter, ringDiameter);
        }
      }
    }
  }

  attachPhoto(scene, photoDataUrl) {
    if (typeof photoDataUrl !== 'string' || !photoDataUrl.trim()) return;
    const texKey = `photo_${Math.random().toString(36).slice(2)}`;
    const tryCreatePhoto = (resolvedKey = texKey, attemptsLeft = 18) => {
      if (this._photo) return;
      if (scene.textures.exists(resolvedKey)) {
        createPhoto(resolvedKey);
        return;
      }
      if (attemptsLeft <= 0 || !scene.time?.delayedCall) return;
      scene.time.delayedCall(70, () => tryCreatePhoto(resolvedKey, attemptsLeft - 1));
    };
    const createPhoto = (resolvedKey = texKey) => {
      if (this._photo || !scene.textures.exists(resolvedKey)) return;
      const photoY = this.y - this._getPhotoYOffset();
      const photoSize = this._getPhotoSize();
      const photoRadius = Math.max(PHOTO_BASE_RADIUS, Math.round(photoSize / 2));
      const ringRadius = photoRadius + 3;
      this._photo = scene.add.image(this.x, photoY, resolvedKey).setDisplaySize(photoSize, photoSize).setOrigin(0.5);
      this._photoRing = scene.add.circle(this.x, photoY, ringRadius, 0x0f172a, 0.7)
        .setStrokeStyle(2, 0xf8fafc, 0.88);
      this._photoMask = scene.add.graphics().fillCircle(this.x, photoY, photoRadius);
      this._photoMask.setVisible(false);
      this._photo.setMask(this._photoMask.createGeometryMask());
      this._photoRing.setDepth((this.depth || 0) + 10);
      this._photo.setDepth((this.depth || 0) + 11);
      this._photoMask.setDepth((this.depth || 0) + 10);
      this.syncLabel();
    };

    const value = photoDataUrl.trim();
    const isDataImage = value.startsWith('data:image/');

    if (isDataImage) {
      try {
        scene.textures.addBase64(texKey, value);
      } catch {
        return;
      }

      tryCreatePhoto(texKey);
      return;
    }

    // Support persisted URL-based photos and preloaded texture keys.
    if (scene.textures.exists(value)) {
      createPhoto(value);
      return;
    }

    if (!scene.load) return;
    scene.load.image(texKey, value);
    if (scene.load.once) {
      scene.load.once(`filecomplete-image-${texKey}`, () => createPhoto(texKey));
      scene.load.once(Phaser.Loader.Events.LOAD_ERROR, () => {
        // Keep silent on image load failures; avatar still renders without photo.
      });
    }
    if (!scene.load.isLoading()) scene.load.start();
    tryCreatePhoto(texKey);
  }

  // Drunkenness, 0 (sober) to 1 (fully wobbly). The scene owns the
  // buzz math — drinks in, time out — the avatar owns the
  // performance: a lean from the feet, an occasional stumble, and
  // hiccups once it's a real buzz. No per-model setup: the sway
  // rotates the whole sprite around its foot pivot, so future
  // avatars are drunk-capable the moment they extend this class.
  setDrunkenness(level) {
    this._drunkLevel = Math.max(0, Math.min(1, Number(level) || 0));
    if (this._drunkLevel === 0 && !this._drinking && this._sprite) this._sprite.angle = 0;
  }

  // Full drunk: three gold stars circling the head — the universal
  // cartoon sign, readable from anywhere in the room.
  _updateStars(t) {
    if (!this._stars) {
      this._stars = [];
      for (let i = 0; i < 3; i++) {
        const st = this.scene.add.text(0, 0, '★', { fontSize: '11px', color: '#fbbf24' }).setOrigin(0.5);
        this.add(st);
        this._stars.push(st);
      }
    }
    const cy = -this._targetHeight - 5;
    this._stars.forEach((st, i) => {
      const a = t * 2.4 + (i * Math.PI * 2) / 3;
      st.setPosition(Math.cos(a) * 14, cy + Math.sin(a) * 5);
      st.setVisible(true);
    });
  }

  _spawnFloater(str) {
    const scene = this.scene;
    if (!scene?.add || !this._sprite?.active) return;
    const t = scene.add.text(this.x + (Math.random() * 16 - 8), this.y - this._getLabelYOffset() - 6, str, {
      fontSize: str === '💫' ? '12px' : '10px', color: '#fda4af', fontFamily: 'Courier New, monospace',
    }).setOrigin(0.5, 1).setDepth(this.depth + 12).setAlpha(0.95);
    scene.tweens.add({
      targets: t, y: t.y - 14, alpha: 0, duration: 950, ease: 'Sine.easeOut',
      onComplete: () => t.destroy(),
    });
  }

  // Bar treat: raise a mug to the face, tip back, take a few sips.
  // Purely cosmetic — the scene handles coins and broadcasting.
  playDrink() {
    if (this._drinking || !this.scene?.add || !this._sprite) return;
    this._drinking = true;
    const scene = this.scene;
    const sprite = this._sprite;

    // How much of the sprite frame the character art actually fills —
    // the mug has to meet the drawn face, not the frame's top edge.
    const FILL = { demon: 0.62, bunny: 0.72, turtle: 0.92, snake: 0.92, sheep: 0.92, wisp: 1.0, bat: 0.78, gator: 0.95, hoodie: 0.9, male: 0.9 };
    const key = String(this._frameKeys?.front?.[0] || '');
    const model = key.split('-')[0];
    const fill = FILL[model] ?? 0.85;
    const faceY = -Math.round(this._targetHeight * fill * 0.8);
    const handX = this._dir === 'side' ? (this._facingLeft ? -11 : 11) : 6;
    const handY = Math.round(faceY * 0.45);

    const mug = scene.add.text(handX, handY, '\u{1F37A}', { fontSize: '22px' })
      .setOrigin(0.5, 1)
      .setAlpha(0);
    this.add(mug);
    this._drinkMug = mug;

    const alive = () => this._drinking && mug.active && sprite.active;
    const steps = [
      { targets: mug, props: { alpha: 1 }, dur: 160 },                                        // mug appears in hand
      { targets: mug, props: { x: handX * 0.6, y: faceY }, dur: 340 },                        // raise to the face
      { targets: sprite, props: { angle: -7 }, dur: 300 },                                   // tip back
      { targets: mug, props: { y: faceY + 3 }, dur: 180, yoyo: true, repeat: 2 },             // sips
      { targets: sprite, props: { angle: 0 }, dur: 260 },                                     // straighten up
      { targets: mug, props: { x: handX, y: handY, alpha: 0 }, dur: 300 },                    // lower + fade
    ];
    const run = (i) => {
      if (!alive()) { this._endDrink(); return; }
      if (i >= steps.length) { this._endDrink(); return; }
      const st = steps[i];
      scene.tweens.add({
        targets: st.targets,
        ...st.props,
        duration: st.dur,
        yoyo: Boolean(st.yoyo),
        repeat: st.repeat || 0,
        ease: 'Sine.easeInOut',
        onComplete: () => run(i + 1),
      });
    };
    run(0);
  }

  // Water gets its OWN animation — not the beer toast with a
  // different label. A small clear glass (drawn, pale blue), a
  // shallow tip instead of the deep mug tip-back, quick gulps,
  // and droplet sparkles at the end: refreshment, not a toast.
  // Same contract as playDrink — cosmetic only, same cleanup.
  playWaterDrink() {
    if (this._drinking || !this.scene?.add || !this._sprite) return;
    this._drinking = true;
    const scene = this.scene;
    const sprite = this._sprite;

    const FILL = { demon: 0.62, bunny: 0.72, turtle: 0.92, snake: 0.92, sheep: 0.92, wisp: 1.0, bat: 0.78, gator: 0.95, hoodie: 0.9, male: 0.9 };
    const key = String(this._frameKeys?.front?.[0] || '');
    const model = key.split('-')[0];
    const fill = FILL[model] ?? 0.85;
    const faceY = -Math.round(this._targetHeight * fill * 0.8);
    const handX = this._dir === 'side' ? (this._facingLeft ? -11 : 11) : 6;
    const handY = Math.round(faceY * 0.45);

    // The glass: a little trapezoid tumbler, drawn around its
    // bottom-center so it tweens exactly like the mug does.
    const glass = scene.add.graphics();
    glass.fillStyle(0xdbeafe, 0.16);
    glass.fillPoints([{ x: -5.5, y: -13 }, { x: 5.5, y: -13 }, { x: 4, y: 0 }, { x: -4, y: 0 }], true);
    glass.fillStyle(0x38bdf8, 0.45);
    glass.fillPoints([{ x: -4.9, y: -8 }, { x: 4.9, y: -8 }, { x: 4, y: 0 }, { x: -4, y: 0 }], true);
    glass.lineStyle(1, 0xbae6fd, 0.95);
    glass.strokePoints([{ x: -5.5, y: -13 }, { x: 5.5, y: -13 }, { x: 4, y: 0 }, { x: -4, y: 0 }], true);
    glass.setPosition(handX, handY).setAlpha(0);
    this.add(glass);
    this._drinkMug = glass; // same cleanup slot as the mug

    const sparkle = () => {
      if (!sprite.active) return;
      [-11, 11].forEach((dx) => {
        const d = scene.add.text(this.x + dx, this.y - this._getLabelYOffset() - 2, '💧', {
          fontSize: '9px',
        }).setOrigin(0.5, 1).setDepth(this.depth + 12).setAlpha(0.9);
        scene.tweens.add({
          targets: d, y: d.y - 9, alpha: 0, duration: 650, ease: 'Sine.easeOut',
          onComplete: () => d.destroy(),
        });
      });
    };

    const alive = () => this._drinking && glass.active && sprite.active;
    const steps = [
      { targets: glass, props: { alpha: 1 }, dur: 140 },                                        // glass appears in hand
      { targets: glass, props: { x: handX * 0.6, y: faceY }, dur: 260 },                        // raise to the face
      { targets: sprite, props: { angle: -3 }, dur: 200 },                                      // shallow tip — water stays upright
      { targets: glass, props: { y: faceY + 2 }, dur: 110, yoyo: true, repeat: 3 },             // quick gulps
      { targets: sprite, props: { angle: 0 }, dur: 200 },                                       // straighten up
      { targets: glass, props: { x: handX, y: handY, alpha: 0 }, dur: 240, pre: sparkle },      // lower + fade, droplets
    ];
    const run = (i) => {
      if (!alive()) { this._endDrink(); return; }
      if (i >= steps.length) { this._endDrink(); return; }
      const st = steps[i];
      if (st.pre) st.pre();
      scene.tweens.add({
        targets: st.targets,
        ...st.props,
        duration: st.dur,
        yoyo: Boolean(st.yoyo),
        repeat: st.repeat || 0,
        ease: 'Sine.easeInOut',
        onComplete: () => run(i + 1),
      });
    };
    run(0);
  }

  _endDrink() {
    if (this._drinkMug) {
      try { this.scene?.tweens?.killTweensOf(this._drinkMug); } catch {}
      this._drinkMug.destroy();
      this._drinkMug = null;
    }
    if (this._sprite) {
      try { this.scene?.tweens?.killTweensOf(this._sprite); } catch {}
      if (this._sprite.active) this._sprite.angle = 0;
    }
    this._drinking = false;
  }

  destroy(fromScene) {
    this._endDrink();
    this._label?.destroy();
    this._photoRing?.destroy();
    this._photo?.destroy();
    this._photoMask?.destroy();
    super.destroy(fromScene);
  }
}
