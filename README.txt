Side Quest — Day/Night Phase 1 (outdoor venues only)
=====================================================
Files in this kit (extract over your clone root):
  src/village/DayNightMode.js   (NEW)
  src/village/VillageScene.js   (wiring: construct, update, destroy,
                                 get_time_phase emit, time_phase handler)
  server/socket.js              (canonical phase: get_time_phase ->
                                 time_phase, plus a per-minute broadcast)

What it does:
  Outdoor venues (Shepherd Park & friends) get a real-clock
  day/night cycle on America/Chicago time: dawn ramp 05:30-07:30,
  day, dusk ramp 17:30-19:30, night. The look is a deep-indigo
  grade over the world (capped at 0.36 so the room stays readable)
  with warm glow pools at the lampposts once it gets dark.
  Indoor venues (Asgard, Lola's, ...) are untouched by design.

Demo override (browser console, before entering a venue):
  window.__sqDayNight = 'night'   (also 'day' | 'dawn' | 'dusk')
  window.__sqDayNight = false     (disable)

LANDING CHECK (run BEFORE testing behavior):
  Select-String -Path src\village\VillageScene.js -Pattern "get_time_phase"
  Test-Path src\village\DayNightMode.js
  Both must show a match / True.

NOTE: the local dev server must be restarted to pick up the new
socket.js (client hot-reloads, server does not).
