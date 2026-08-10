import Phaser from 'phaser';
import { colorHexToInt, skinToneToColor, skinToneToShade, hairHueToColor, accessoryHueToColor } from '../../utils/avatarColors';

// Kept for compatibility with previous avatar configuration calls.
export const SKINS = {
  blue:   { outfitHue: 210 },
  red:    { outfitHue: 350 },
  green:  { outfitHue: 135 },
  purple: { outfitHue: 275 },
  orange: { outfitHue: 24 },
  pink:   { outfitHue: 330 },
  teal:   { outfitHue: 178 },
  slate:  { outfitHue: 220 },
};

export const HAIR_STYLES = {
  messy: 'Messy Hair',
  combed: 'Combed Hair',
};

export const BODY_TYPES = {
  compact: { scale: 0.92 },
  standard: { scale: 1 },
  broad: { scale: 1.08 },
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function mixColorInt(a, b, t) {
  const k = clamp(t, 0, 1);
  const ar = (a >> 16) & 255;
  const ag = (a >> 8) & 255;
  const ab = a & 255;
  const br = (b >> 16) & 255;
  const bg = (b >> 8) & 255;
  const bb = b & 255;
  const rr = Math.round(ar + (br - ar) * k);
  const rg = Math.round(ag + (bg - ag) * k);
  const rb = Math.round(ab + (bb - ab) * k);
  return (rr << 16) | (rg << 8) | rb;
}

const mapLegacyHairStyle = (hairStyle) => {
  if (hairStyle === 'messy' || hairStyle === 'combed') return hairStyle;
  if (hairStyle === 'side' || hairStyle === 'mohawk') return 'messy';
  return 'combed';
};

export default class ModularAvatar extends Phaser.GameObjects.Container {
  constructor(
    scene,
    x,
    y,
    {
      skinId = 'blue',
      name = '',
      isLocal = false,
      hairStyle = 'combed',
      bodyType = 'standard',
      skinTone,
      hairHue,
      outfitHue,
      topStyle = 'hoodie',
      footwear = 'sneakers',
      glasses = false,
      hasScythe = false,
      // Legacy compatibility inputs
      pigment,
      scarfHue,
      eyeHue,
    } = {},
  ) {
    super(scene, x, y);

    const skin = SKINS[skinId] || SKINS.blue;
    const resolvedSkinTone = skinTone ?? pigment ?? 45;
    const resolvedHairHue = hairHue ?? eyeHue ?? 26;
    const resolvedOutfitHue = outfitHue ?? scarfHue ?? skin.outfitHue;
    mapLegacyHairStyle(hairStyle);

    const skinBase = colorHexToInt(skinToneToColor(resolvedSkinTone));
    const skinShade = colorHexToInt(skinToneToShade(resolvedSkinTone, -10));
    const outlineColor = colorHexToInt('#2f2733');
    const hoodieBase = colorHexToInt(accessoryHueToColor(resolvedOutfitHue, 10, 88));
    const hoodieShade = colorHexToInt(accessoryHueToColor(resolvedOutfitHue, 12, 75));
    const hoodieFold = colorHexToInt(accessoryHueToColor(resolvedOutfitHue, 16, 64));

    this._palette = {
      hoodie: hoodieBase,
      hoodieShade,
      hoodieFold,
      faceMask: 0x2b2430,
      faceMaskShade: 0x403540,
      skin: mixColorInt(skinBase, 0xfff1dd, 0.2),
      skinShade,
      eyeOuter: 0xfff2d8,
      eyeInner: mixColorInt(0xff7da2, colorHexToInt(hairHueToColor(resolvedHairHue)), 0.2),
      mouth: 0xd9847e,
      pants: 0x4a434c,
      pantsShade: 0x3f3941,
      shoe: footwear === 'heels' ? 0x26212b : 0x131216,
      shadow: 0xe9a89f,
      outline: outlineColor,
      spec: 0xffffff,
      string: 0x1f1a21,
      pocket: mixColorInt(hoodieBase, 0xffffff, 0.06),
    };

    const baseScale = (BODY_TYPES[bodyType] || BODY_TYPES.standard).scale;
    this._anim = {
      clock: Math.random() * Math.PI * 2,
      moving: false,
      direction: 'front',
      facingLeft: false,
      phase: Math.random() * 6.28,
    };

    this._rig = scene.add.container(0, 0);
    this.add(this._rig);

    const addEllipse = (x0, y0, w, h, fill, stroke = this._palette.outline, line = 2, alpha = 1) => {
      const shape = scene.add.ellipse(x0, y0, w, h, fill, alpha);
      if (line > 0) shape.setStrokeStyle(line, stroke, 0.95);
      this._rig.add(shape);
      return shape;
    };

    const addCircle = (x0, y0, r, fill, stroke = this._palette.outline, line = 2, alpha = 1) => {
      const shape = scene.add.circle(x0, y0, r, fill, alpha);
      if (line > 0) shape.setStrokeStyle(line, stroke, 0.95);
      this._rig.add(shape);
      return shape;
    };

    const addRect = (x0, y0, w, h, fill, stroke = this._palette.outline, line = 2, alpha = 1) => {
      const shape = scene.add.rectangle(x0, y0, w, h, fill, alpha);
      if (line > 0) shape.setStrokeStyle(line, stroke, 0.95);
      this._rig.add(shape);
      return shape;
    };

    this._shadow = scene.add.ellipse(0, 16.5 * baseScale, 28 * baseScale, 9.5 * baseScale, this._palette.shadow, 0.45);
    this._rig.add(this._shadow);

    // Legs and shoes
    this._legL = addEllipse(-4.8 * baseScale, 10.4 * baseScale, 9.5 * baseScale, 12.2 * baseScale, this._palette.pants, this._palette.pantsShade, 1.4);
    this._legR = addEllipse(4.8 * baseScale, 10.4 * baseScale, 9.5 * baseScale, 12.2 * baseScale, this._palette.pants, this._palette.pantsShade, 1.4);
    this._footL = addEllipse(-5.4 * baseScale, 15.1 * baseScale, 12.1 * baseScale, 8.6 * baseScale, this._palette.shoe, this._palette.shoe, 1);
    this._footR = addEllipse(5.4 * baseScale, 15.1 * baseScale, 12.1 * baseScale, 8.6 * baseScale, this._palette.shoe, this._palette.shoe, 1);
    this._legLBase = { x: this._legL.x, y: this._legL.y };
    this._legRBase = { x: this._legR.x, y: this._legR.y };
    this._footLBase = { x: this._footL.x, y: this._footL.y };
    this._footRBase = { x: this._footR.x, y: this._footR.y };

    // Hoodie body
    this._body = addEllipse(0, 2.2 * baseScale, 28 * baseScale, 26.6 * baseScale, this._palette.hoodie, this._palette.outline, 2);
    this._bodyBottom = addEllipse(0, 11.6 * baseScale, 25.8 * baseScale, 6.5 * baseScale, this._palette.hoodieShade, this._palette.outline, 1.2);
    this._pocket = addRect(0, 6.4 * baseScale, 14.3 * baseScale, 8.4 * baseScale, this._palette.pocket, this._palette.outline, 1.5, 0.92);
    this._pocketCutL = scene.add.arc(-1.4 * baseScale, 6.2 * baseScale, 5 * baseScale, 210, 340, false, this._palette.outline)
      .setStrokeStyle(1.2, this._palette.outline, 0.8);
    this._pocketCutR = scene.add.arc(1.4 * baseScale, 6.2 * baseScale, 5 * baseScale, 200, 330, true, this._palette.outline)
      .setStrokeStyle(1.2, this._palette.outline, 0.8);
    this._rig.add(this._pocketCutL);
    this._rig.add(this._pocketCutR);

    this._armL = addEllipse(-11.6 * baseScale, 2.8 * baseScale, 8.9 * baseScale, 14.6 * baseScale, this._palette.hoodieShade);
    this._armR = addEllipse(11.6 * baseScale, 2.8 * baseScale, 8.9 * baseScale, 14.6 * baseScale, this._palette.hoodieShade);
    this._handL = addCircle(-12.6 * baseScale, 8.4 * baseScale, 3.35 * baseScale, this._palette.skin, this._palette.outline, 1.2);
    this._handR = addCircle(12.6 * baseScale, 8.4 * baseScale, 3.35 * baseScale, this._palette.skin, this._palette.outline, 1.2);
    this._armLBase = { x: this._armL.x, y: this._armL.y, rot: 0 };
    this._armRBase = { x: this._armR.x, y: this._armR.y, rot: 0 };
    this._handLBase = { x: this._handL.x, y: this._handL.y };
    this._handRBase = { x: this._handR.x, y: this._handR.y };

    // Hood and face opening
    this._hoodShell = addEllipse(0, -12.4 * baseScale, 32.5 * baseScale, 30.6 * baseScale, this._palette.hoodie, this._palette.outline, 2.2);
    this._hoodInner = addEllipse(0, -11.1 * baseScale, 22.2 * baseScale, 18.8 * baseScale, this._palette.faceMask, this._palette.outline, 1.2);
    this._hoodInnerShade = addEllipse(0, -8.8 * baseScale, 21.1 * baseScale, 9.6 * baseScale, this._palette.faceMaskShade, this._palette.faceMaskShade, 0, 0.58);

    this._face = addEllipse(0, -7.1 * baseScale, 12.8 * baseScale, 8.2 * baseScale, this._palette.skin, this._palette.outline, 1.1);
    this._faceShade = addEllipse(0, -5.6 * baseScale, 12 * baseScale, 4.1 * baseScale, this._palette.skinShade, this._palette.skinShade, 0, 0.25);

    // Hoodie neck fold and strings
    this._neckFold = addEllipse(0, -0.6 * baseScale, 13.5 * baseScale, 5.2 * baseScale, this._palette.hoodieShade, this._palette.outline, 1.2, 0.82);
    this._stringL = addRect(-2.3 * baseScale, 0.3 * baseScale, 0.95 * baseScale, 6.8 * baseScale, this._palette.string, this._palette.string, 0, 0.95);
    this._stringR = addRect(2.3 * baseScale, 0.3 * baseScale, 0.95 * baseScale, 6.8 * baseScale, this._palette.string, this._palette.string, 0, 0.95);
    this._stringTipL = addCircle(-2.3 * baseScale, 3.7 * baseScale, 0.45 * baseScale, this._palette.string, this._palette.string, 0);
    this._stringTipR = addCircle(2.3 * baseScale, 3.7 * baseScale, 0.45 * baseScale, this._palette.string, this._palette.string, 0);

    // Front face
    this._eyeLOuter = addEllipse(-4.7 * baseScale, -9.3 * baseScale, 5.1 * baseScale, 7.1 * baseScale, this._palette.eyeOuter, this._palette.outline, 1.1);
    this._eyeROuter = addEllipse(4.7 * baseScale, -9.3 * baseScale, 5.1 * baseScale, 7.1 * baseScale, this._palette.eyeOuter, this._palette.outline, 1.1);
    this._eyeLInner = addEllipse(-4.7 * baseScale, -8.7 * baseScale, 3.1 * baseScale, 4.5 * baseScale, this._palette.eyeInner, this._palette.eyeInner, 0);
    this._eyeRInner = addEllipse(4.7 * baseScale, -8.7 * baseScale, 3.1 * baseScale, 4.5 * baseScale, this._palette.eyeInner, this._palette.eyeInner, 0);
    this._eyeSpecL = addCircle(-5.35 * baseScale, -11.0 * baseScale, 0.52 * baseScale, this._palette.spec, this._palette.spec, 0, 0.8);
    this._eyeSpecR = addCircle(4.05 * baseScale, -11.0 * baseScale, 0.52 * baseScale, this._palette.spec, this._palette.spec, 0, 0.8);
    this._nose = addCircle(0, -7.2 * baseScale, 0.5 * baseScale, this._palette.mouth, this._palette.mouth, 0, 0.52);
    this._smile = scene.add.arc(0, -6.4 * baseScale, 1.8 * baseScale, 20, 160, false, this._palette.mouth)
      .setStrokeStyle(1.3, this._palette.mouth, 0.9);
    this._rig.add(this._smile);

    // Side face
    this._sideFace = addEllipse(7.8 * baseScale, -7.5 * baseScale, 10.8 * baseScale, 9 * baseScale, this._palette.skin, this._palette.outline, 1.1);
    this._sideEyeOuter = addEllipse(8.2 * baseScale, -9.4 * baseScale, 4.5 * baseScale, 6.5 * baseScale, this._palette.eyeOuter, this._palette.outline, 1.1);
    this._sideEyeInner = addEllipse(8.3 * baseScale, -8.8 * baseScale, 2.7 * baseScale, 4 * baseScale, this._palette.eyeInner, this._palette.eyeInner, 0);
    this._sideSpec = addCircle(7.7 * baseScale, -11 * baseScale, 0.45 * baseScale, this._palette.spec, this._palette.spec, 0, 0.8);
    this._sideNose = addCircle(5.7 * baseScale, -7.7 * baseScale, 0.45 * baseScale, this._palette.mouth, this._palette.mouth, 0, 0.55);
    this._sideMouth = scene.add.arc(6.3 * baseScale, -7.0 * baseScale, 1.1 * baseScale, 75, 190, false, this._palette.mouth)
      .setStrokeStyle(1.2, this._palette.mouth, 0.85);
    this._rig.add(this._sideMouth);
    this._sideHood = addEllipse(2 * baseScale, -12.1 * baseScale, 23.8 * baseScale, 27.5 * baseScale, this._palette.hoodie, this._palette.outline, 2);
    this._sideHoodInset = addEllipse(5.2 * baseScale, -11.1 * baseScale, 14.5 * baseScale, 15.8 * baseScale, this._palette.faceMask, this._palette.outline, 1.2);
    this._sideBody = addEllipse(0, 2.3 * baseScale, 27 * baseScale, 25.5 * baseScale, this._palette.hoodie, this._palette.outline, 2);
    this._sideArm = addEllipse(11.4 * baseScale, 3.2 * baseScale, 8.2 * baseScale, 14.6 * baseScale, this._palette.hoodieShade, this._palette.outline, 1.4);
    this._sideHand = addCircle(12.2 * baseScale, 8.2 * baseScale, 3.2 * baseScale, this._palette.skin, this._palette.outline, 1.2);

    if (glasses) {
      this._glassL = addRect(-4.8 * baseScale, -9.5 * baseScale, 4.6 * baseScale, 3.3 * baseScale, 0x000000, 0x000000, 0, 0.1);
      this._glassR = addRect(4.8 * baseScale, -9.5 * baseScale, 4.6 * baseScale, 3.3 * baseScale, 0x000000, 0x000000, 0, 0.1);
      this._glassBridge = addRect(0, -9.5 * baseScale, 1.8 * baseScale, 0.9 * baseScale, 0x111111, 0x111111, 0, 0.7);
      this._sideGlass = addRect(8.1 * baseScale, -9.6 * baseScale, 3.8 * baseScale, 3 * baseScale, 0x000000, 0x000000, 0, 0.1);
    }

    if (hasScythe) {
      this._scytheShaft = addRect(14.5 * baseScale, -2 * baseScale, 2.1 * baseScale, 29 * baseScale, 0x6b7280, 0x475569, 1.2);
      this._scytheShaft.angle = 18;
      this._scytheBlade = scene.add.arc(19.3 * baseScale, -16.6 * baseScale, 8.2 * baseScale, 190, 15, false, 0xe2e8f0)
        .setStrokeStyle(2.5, 0xe2e8f0, 1);
      this._rig.add(this._scytheBlade);
    }

    this._frontParts = [
      this._hoodShell,
      this._hoodInner,
      this._hoodInnerShade,
      this._face,
      this._faceShade,
      this._eyeLOuter,
      this._eyeROuter,
      this._eyeLInner,
      this._eyeRInner,
      this._eyeSpecL,
      this._eyeSpecR,
      this._nose,
      this._smile,
      this._glassL,
      this._glassR,
      this._glassBridge,
    ].filter(Boolean);
    this._sideParts = [
      this._sideHood,
      this._sideHoodInset,
      this._sideFace,
      this._sideEyeOuter,
      this._sideEyeInner,
      this._sideSpec,
      this._sideNose,
      this._sideMouth,
      this._sideBody,
      this._sideArm,
      this._sideHand,
      this._sideGlass,
    ].filter(Boolean);

    this._backParts = [
      this._hoodShell,
      this._body,
      this._bodyBottom,
      this._neckFold,
      this._armL,
      this._armR,
      this._legL,
      this._legR,
      this._footL,
      this._footR,
      this._shadow,
    ].filter(Boolean);

    this.setSize(34, 50);
    this.setMovementState({ moving: false, direction: 'front', facingLeft: false });

    const labelText = (name || '').trim() || (isLocal ? 'YOU' : 'Traveler');
    this._label = scene.add.text(x, y - 32, labelText, {
      fontFamily: 'Courier New',
      fontSize: '10px',
      color: isLocal ? '#fef3c7' : '#fca5a5',
      backgroundColor: '#00000099',
      padding: { x: 3, y: 2 },
    }).setOrigin(0.5);

    scene.add.existing(this);
  }

  _applyFacing() {
    const side = this._anim.direction === 'side';
    const back = this._anim.direction === 'back';

    this._rig.setScale(side && this._anim.facingLeft ? -1 : 1, 1);

    this._frontParts.forEach((part) => {
      part.visible = !side && !back;
    });
    this._sideParts.forEach((part) => {
      part.visible = side;
    });

    if (back) {
      this._hoodShell.visible = true;
      this._hoodInner.visible = false;
      this._hoodInnerShade.visible = false;
      this._face.visible = false;
      this._faceShade.visible = false;
      this._eyeLOuter.visible = false;
      this._eyeROuter.visible = false;
      this._eyeLInner.visible = false;
      this._eyeRInner.visible = false;
      this._eyeSpecL.visible = false;
      this._eyeSpecR.visible = false;
      this._nose.visible = false;
      this._smile.visible = false;
      this._stringL.visible = false;
      this._stringR.visible = false;
      this._stringTipL.visible = false;
      this._stringTipR.visible = false;
      this._pocket.visible = false;
      this._pocketCutL.visible = false;
      this._pocketCutR.visible = false;
    } else {
      this._hoodInner.visible = !side;
      this._hoodInnerShade.visible = !side;
      this._face.visible = !side;
      this._faceShade.visible = !side;
      this._stringL.visible = !side;
      this._stringR.visible = !side;
      this._stringTipL.visible = !side;
      this._stringTipR.visible = !side;
      this._pocket.visible = !side;
      this._pocketCutL.visible = !side;
      this._pocketCutR.visible = !side;
    }

    // Side mode hides front-only body details while side body is shown.
    this._body.visible = !side;
    this._bodyBottom.visible = !side;
    this._armL.visible = !side;
    this._armR.visible = !side;
    this._handL.visible = !side;
    this._handR.visible = !side;
  }

  setMovementState({ moving = false, direction = 'front', facingLeft = false } = {}) {
    this._anim.moving = Boolean(moving);
    this._anim.direction = direction || 'front';
    this._anim.facingLeft = Boolean(facingLeft);
    this._applyFacing();
  }

  // Back-compat with older callers.
  setAnimationState({ moving = false, direction = 'front', sideFlip = 1, delta = 16 } = {}) {
    this.setMovementState({ moving, direction, facingLeft: sideFlip < 0 });
    this.tick(delta);
  }

  tick(delta = 16) {
    this._anim.clock += delta / 1000;

    const walkWave = Math.sin(this._anim.clock * 12 + this._anim.phase);
    const swayWave = Math.sin(this._anim.clock * 8 + this._anim.phase * 0.6);
    const idleWave = Math.sin(this._anim.clock * 2.2 + this._anim.phase);

    const moving = this._anim.moving;
    const lift = moving ? Math.abs(walkWave) * 1.7 : Math.abs(idleWave) * 0.45;
    const stepA = moving ? walkWave : idleWave * 0.2;
    const stepB = moving ? -walkWave : -idleWave * 0.2;

    this._rig.y = -lift;
    this._legL.y = this._legLBase.y + stepA * 0.8;
    this._legR.y = this._legRBase.y + stepB * 0.8;
    this._footL.y = this._footLBase.y + stepA * 1.8;
    this._footR.y = this._footRBase.y + stepB * 1.8;
    this._footL.x = this._footLBase.x + stepA * 1.4;
    this._footR.x = this._footRBase.x + stepB * 1.4;

    this._armL.y = this._armLBase.y + stepB * 0.8;
    this._armR.y = this._armRBase.y + stepA * 0.8;
    this._armL.rotation = this._armLBase.rot + stepB * 0.07;
    this._armR.rotation = this._armRBase.rot + stepA * 0.07;

    this._handL.y = this._handLBase.y + stepB * 1;
    this._handR.y = this._handRBase.y + stepA * 1;
    this._handL.x = this._handLBase.x + stepB * 0.5;
    this._handR.x = this._handRBase.x + stepA * 0.5;

    this._hoodShell.rotation = swayWave * 0.012;
    this._hoodInner.rotation = swayWave * 0.008;
    this._stringL.y = (0.3) + (moving ? Math.abs(stepB) * 0.65 : Math.abs(idleWave) * 0.35);
    this._stringR.y = (0.3) + (moving ? Math.abs(stepA) * 0.65 : Math.abs(idleWave) * 0.35);
    this._stringTipL.y = this._stringL.y + 3.4;
    this._stringTipR.y = this._stringR.y + 3.4;

    this._shadow.scaleX = moving ? 1 - Math.abs(stepA) * 0.06 : 1 - Math.abs(idleWave) * 0.03;
    this._shadow.scaleY = moving ? 1 - Math.abs(stepA) * 0.04 : 1 - Math.abs(idleWave) * 0.02;
  }

  // Call every frame or on move to keep label in sync
  syncLabel() {
    if (this._label) this._label.setPosition(this.x, this.y - 32);
    if (this._photo) {
      this._photo.setPosition(this.x, this.y - 50);
      if (this._photoMask) this._photoMask.clear().fillCircle(this.x, this.y - 50, 14);
    }
  }

  // Attach a base64 photo above the avatar
  attachPhoto(scene, photoDataUrl) {
    const texKey = `photo_${Math.random().toString(36).slice(2)}`;
    scene.textures.addBase64(texKey, photoDataUrl);
    scene.textures.once(`addtexture-${texKey}`, () => {
      this._photo = scene.add.image(this.x, this.y - 50, texKey).setDisplaySize(28, 28).setOrigin(0.5);
      this._photoMask = scene.add.graphics().fillCircle(this.x, this.y - 50, 14);
      this._photo.setMask(this._photoMask.createGeometryMask());
    });
  }

  destroy(fromScene) {
    this._label?.destroy();
    this._photo?.destroy();
    this._photoMask?.destroy();
    super.destroy(fromScene);
  }
}
