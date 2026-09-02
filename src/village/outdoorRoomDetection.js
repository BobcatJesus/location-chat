export function normalizeOutdoorRoomText(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/[_\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isOutdoorLocation(roomId = '', roomName = '', amenityTag = '', shopTag = '') {
  const text = [roomId, roomName, amenityTag, shopTag]
    .map(normalizeOutdoorRoomText)
    .join(' ');
  const normalized = ` ${text} `;
  const outdoorKeywords = [
    'park', 'garden', 'forest', 'nature', 'trail', 'greenway', 'reserve',
    'meadow', 'grove', 'arboretum', 'botanical', 'playground', 'promenade',
    'greenspace', 'lawn',
  ];

  if (normalized.includes(' shepherd park ')) return true;
  if (normalized.includes(' green square ') || normalized.includes(' green space ') || normalized.includes(' lawn ')) return true;
  return outdoorKeywords.some((keyword) => normalized.includes(` ${keyword} `) || text.includes(keyword));
}
