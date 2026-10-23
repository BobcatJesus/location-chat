// DayNightMode.js — day/night for OUTDOOR venues only (Thomas's scope
// call, 2026-10-22): parks, open-air places, anywhere with sky.
// Indoor-only venues are untouched by design — an enclosed room's
// lighting is its own mood already.
//
// The look is a filled-rectangle GRADE: a deep indigo layer over the
// world but under the UI. (Sprite tints do not visibly render in this
// Phaser build — the pumpkin saga's lesson — but shape fills do.)
// Warm glow pools appear at the lampposts the outdoor layouts already
// carry, ABOVE the grade, so lamps punch through the dark.
//
// The clock is America/Chicago. The server owns the canonical phase
// (get_time_phase -> time_phase, plus a per-minute broadcast, so a
// whole room agrees on the sky); this module lerps its darkness
// toward the server value, and computes the identical curve locally
// until the first server answer lands.
//
// Phases: dawn ramp 05:30-07:30, day, dusk ramp 17:30-19:30, night.
// Darkness caps at 0.36 so rooms stay readable. Night is mood, never
// a gate: nothing is locked behind real-world hours.
//
// Demo/testing override, mirroring HalloweenMode's __sqHalloween:
//   window.__sqDayNight = 'day' | 'dawn' | 'dusk' | 'night'  (force)
//   window.__sqDayNight = false                              (off)

import { DEPTH } from './depth.js';

export const NIGHT_DARKNESS = 0.36;

export function timePhaseFor(date = new Date()) {
  let mins = null;
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Chicago', hour12: false, hour: '2-digit', minute: '2-digit',
    }).formatToParts(date);
    const get = (t) => Number(parts.find((p) => p.type === t)?.value || 0);
    mins = (get('hour') % 24) * 60 + get('minute');
  } catch { /* fall through to local time */ }
  if (!Number.isFinite(mins)) mins = date.getHours() * 60 + date.getMinutes();
  if (mins < 330) return { phase: 'night', darkness: NIGHT_DARKNESS };
  if (mins < 450) return { phase: 'dawn', darkness: NIGHT_DARKNESS * (1 - (mins - 330) / 120) };
  if (mins < 1050) return { phase: 'day', darkness: 0 };
  if (mins < 1170) return { phase: 'dusk', darkness: NIGHT_DARKNESS * ((mins - 1050) / 120) };
  return { phase: 'night', darkness: NIGHT_DARKNESS };
}

function forcedPhase() {
  if (typeof window === 'undefined') return undefined;
  const v = window.__sqDayNight;
  if (v === false) return false;
  if (v === 'day') return { phase: 'day', darkness: 0 };
  if (v === 'night') return { phase: 'night', darkness: NIGHT_DARKNESS };
  if (v === 'dawn' || v === 'dusk') return { phase: v, darkness: NIGHT_DARKNESS / 2 };
  return undefined;
}

export class DayNightMode {
  constructor(scene) {
    this.scene = scene;
    this.active = false;
    this.grade = null;
    this.lampGlows = [];
    this.darkness = 0;
    this.targetDarkness = 0;
    this.phase = 'day';
  }

  start() {
    // Scope: outdoor venues (or venues with an outdoors) only.
    if (!this.scene.isOutdoorLocation) return;
    const forced = forcedPhase();
    if (forced === false) return;
    this.active = true;
    // Start from the local curve so the first frame is already right;
    // the server's answer (requested on join) simply confirms it.
    const initial = forced || timePhaseFor();
    this.phase = initial.phase;
    this.darkness = initial.darkness;
    this.targetDarkness = initial.darkness;
    this._buildGrade();
    this._buildLampGlows();
    this._apply();
  }

  _roomBounds() {
    try {
      const b = this.scene.roomLayout?.getBoundaryBounds?.();
      if (b && b.w > 80 && b.h > 80) return b;
    } catch {}
    const layout = this.scene.layout;
    return { x: 0, y: 0, w: layout?.width || 1600, h: layout?.height || 900 };
  }

  _buildGrade() {
    try {
      const b = this._roomBounds();
      const pad = 240;
      this.grade = this.scene.add.rectangle(
        b.x + b.w / 2, b.y + b.h / 2, b.w + pad * 2, b.h + pad * 2, 0x131c33, 1,
      );
      // Above the world and its overhead decor, below the UI layer.
      this.grade.setDepth(DEPTH.OVERHEAD + 400);
      this.grade.setAlpha(this.darkness);
    } catch {}
  }

  _ensureLampGlowTexture() {
    // Warm radial halo, drawn once — a bigger, softer cousin of the
    // pumpkin candle glow.
    try {
      if (this.scene.textures?.exists('sq-lamp-glow')) return true;
      const size = 192;
      const canvas = this.scene.textures.createCanvas('sq-lamp-glow', size, size);
      if (!canvas) return false;
      const ctx = canvas.getContext();
      const g = ctx.createRadialGradient(size / 2, size / 2, 4, size / 2, size / 2, size / 2);
      g.addColorStop(0, 'rgba(255,190,90,0.8)');
      g.addColorStop(0.35, 'rgba(255,150,50,0.32)');
      g.addColorStop(1, 'rgba(255,120,30,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, size, size);
      canvas.refresh();
      return true;
    } catch { return false; }
  }

  _buildLampGlows() {
    try {
      if (!this._ensureLampGlowTexture()) return;
      const zones = this.scene.layout?.floors?.[this.scene.currentFloor || 0]?.zones || [];
      for (const z of zones) {
        if (z.type !== 'lamppost') continue;
        const cx = z.x + (z.w || 30) / 2;
        const cy = z.y + 18; // the lamp head, not the post's base
        const glow = this.scene.add.image(cx, cy, 'sq-lamp-glow');
        glow.setDisplaySize(180, 180);
        glow.setBlendMode('ADD');
        // Just above the grade: lamps shine THROUGH the night.
        glow.setDepth(DEPTH.OVERHEAD + 401);
        glow.setAlpha(0);
        this.lampGlows.push(glow);
      }
    } catch {}
  }

  // Server's canonical phase (socket 'time_phase'). Ignored while a
  // demo override is forcing the sky.
  applyPhase(payload) {
    if (!this.active) return;
    if (forcedPhase()) return;
    const d = Number(payload?.darkness);
    if (!Number.isFinite(d)) return;
    this.phase = payload.phase || this.phase;
    this.targetDarkness = Math.max(0, Math.min(NIGHT_DARKNESS, d));
  }

  _apply() {
    try {
      if (this.grade) this.grade.setAlpha(this.darkness);
      const lampAlpha = (this.darkness / NIGHT_DARKNESS) * 0.75;
      for (const g of this.lampGlows) g.setAlpha(lampAlpha);
    } catch {}
  }

  update(delta) {
    if (!this.active) return;
    const forced = forcedPhase();
    if (forced) this.targetDarkness = forced.darkness;
    // Ease toward the target: a full day<->night swing takes ~5s of
    // visible change; the dawn/dusk ramps ride the server's per-minute
    // steps, smoothed out here.
    const step = (NIGHT_DARKNESS * (delta || 16)) / 5000;
    if (this.darkness < this.targetDarkness) {
      this.darkness = Math.min(this.targetDarkness, this.darkness + step);
    } else if (this.darkness > this.targetDarkness) {
      this.darkness = Math.max(this.targetDarkness, this.darkness - step);
    } else {
      return;
    }
    this._apply();
  }

  destroy() {
    this.active = false;
    try { this.grade?.destroy(); } catch {}
    this.grade = null;
    for (const g of this.lampGlows) { try { g.destroy(); } catch {} }
    this.lampGlows = [];
  }
}
