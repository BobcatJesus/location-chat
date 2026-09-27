const VENUE_EVENTS = [
  {
    id: 'library-study-night',
    roomIds: ['md-anderson-library'],
    title: 'Quiet Hours: Study Night',
    description: 'A quiet evening for focused study, thoughtful conversation, and book recommendations. Bring one thing you are working on and one question you want to untangle.',
    dayOfWeek: 4,
    startHour: 19,
    endHour: 21,
    activityLevel: 'busy',
    mood: 'focused',
  },
  {
    id: 'asgard-game-night',
    roomIds: ['asgard-games'],
    title: 'Game Night',
    description: 'Open tables, demos, and casual games for new and regular players.',
    dayOfWeek: 5,
    startHour: 18,
    endHour: 22,
    activityLevel: 'busy',
    mood: 'excited',
  },
  {
    id: 'park-sunset-walk',
    roomIds: ['hermann-park', 'park'],
    title: 'Sunset Walk',
    description: 'A relaxed group walk along the park paths before sunset.',
    dayOfWeek: 6,
    startHour: 18,
    endHour: 20,
    activityLevel: 'social',
    mood: 'relaxed',
  },
];

const customVenueEvents = [];

export function addVenueEvent(event) {
  const start = new Date(event?.startsAt);
  const end = new Date(event?.endsAt);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) return null;
  const normalized = {
    id: String(event?.id || `event-${Date.now()}`),
    roomIds: [String(event?.roomId || '')],
    title: String(event?.title || '').trim(),
    description: String(event?.description || '').trim(),
    startsAt: start.toISOString(),
    endsAt: end.toISOString(),
    activityLevel: String(event?.activityLevel || 'social'),
    mood: String(event?.mood || 'social'),
    creator: String(event?.creator || 'community'),
    custom: true,
  };
  if (!normalized.title || !normalized.description || normalized.endsAt <= normalized.startsAt) return null;
  customVenueEvents.push(normalized);
  return normalized;
}

function normalizeRoomId(value) {
  return String(value || '').toLowerCase().trim();
}

function getEventStart(date, event) {
  const start = new Date(date);
  const daysUntil = (event.dayOfWeek - start.getDay() + 7) % 7;
  start.setDate(start.getDate() + daysUntil);
  start.setHours(event.startHour, 0, 0, 0);
  return start;
}

export function getVenueEvents(roomId, date = new Date()) {
  const normalizedRoomId = normalizeRoomId(roomId);
  const now = date instanceof Date ? date : new Date(date);
  if (!normalizedRoomId || !Number.isFinite(now.getTime())) return [];

  const scheduledEvents = VENUE_EVENTS
    .filter((event) => event.roomIds.some((id) => normalizeRoomId(id) === normalizedRoomId))
    .map((event) => {
      const start = getEventStart(now, event);
      const end = new Date(start);
      end.setHours(event.endHour, 0, 0, 0);
      if (end <= now) {
        start.setDate(start.getDate() + 7);
        end.setDate(end.getDate() + 7);
      }
      const status = start <= now && now < end ? 'active' : 'upcoming';
      return { ...event, status, startsAt: start.toISOString(), endsAt: end.toISOString() };
    });

  const customEvents = customVenueEvents
    .filter((event) => event.roomIds.includes(normalizedRoomId))
    .filter((event) => new Date(event.endsAt) > now)
    .map((event) => ({ ...event, status: new Date(event.startsAt) <= now ? 'active' : 'upcoming' }));

  return [...scheduledEvents, ...customEvents]
    .sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
}

export function formatVenueEventsForPrompt(events = []) {
  if (!Array.isArray(events) || !events.length) {
    return 'There are no scheduled venue events to recommend right now.';
  }

  return events.slice(0, 3).map((event) => {
    const timing = event.status === 'active' ? 'happening now' : 'coming up soon';
    return `${event.title} (${timing}): ${event.description}`;
  }).join(' | ');
}
