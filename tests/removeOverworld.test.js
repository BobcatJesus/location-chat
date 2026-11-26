// removeOverworld.test.js — Remove "overworld" v1 (`sq-remove-overworld-v1`).
// The main logged-in view's heading used to append " overworld" to every
// location ("Agora overworld", "Shepherd Park overworld"). The heading is
// built inline in app.jsx as a worldTitle const (a large React component —
// not instantiable under vitest), so this test pins that line textually:
// it must not contain "overworld" anywhere, and the no-room fallback must
// be "The Lost". A line with the suffix still in it renders the suffix on
// every location.
// Note: src/pages/SpatialChatRoom.jsx also had a static "The Lost
// Overworld" subtitle; the user asked for that one too, so its <h2> is
// now "The Lost" as well. (Nothing imports that page, so it is dead code
// on the live route, but the wording is gone everywhere now.) The
// "overworld-container" CSS class name is untouched — it is not displayed
// text, and renaming it would break its styling.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REMOVE_OVERWORLD_MARKER = 'sq-remove-overworld-v1';

// The worldTitle line in app.jsx.
function worldTitleLine() {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(
    join(here, '..', 'src', 'components', 'app.jsx'),
    'utf8',
  );
  const lines = src.split('\n');
  const hits = lines.filter((line) => line.includes('const worldTitle ='));
  expect(hits).toHaveLength(1);
  return hits[0];
}

describe('remove overworld v1', () => {
  it('builds the heading without the overworld suffix', () => {
    const line = worldTitleLine();
    expect(line.toLowerCase()).not.toContain('overworld');
  });

  it('shows just the room name when one is visible', () => {
    const line = worldTitleLine();
    expect(line).toContain('visibleRoomName ? visibleRoomName');
  });

  it('falls back to "The Lost" with no room', () => {
    const line = worldTitleLine();
    expect(line).toContain("'The Lost'");
  });

  it('carries the remove-overworld marker at the change', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(
      join(here, '..', 'src', 'components', 'app.jsx'),
      'utf8',
    );
    expect(src).toContain(REMOVE_OVERWORLD_MARKER);
  });

  it('drops "Overworld" from the old page subtitle too', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(
      join(here, '..', 'src', 'pages', 'SpatialChatRoom.jsx'),
      'utf8',
    );
    const lines = src.split('\n');
    const h2 = lines.filter((line) => line.includes('<h2>'));
    expect(h2).toHaveLength(1);
    expect(h2[0]).toContain('The Lost');
    expect(h2[0].toLowerCase()).not.toContain('overworld');
    expect(src).toContain(REMOVE_OVERWORLD_MARKER);
  });
});
