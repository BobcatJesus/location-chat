import { useState, useEffect, useRef } from 'react';

const BACKEND_BASE_URL = import.meta.env.VITE_BACKEND_URL ||
  (import.meta.env.PROD ? 'https://location-chat-production.up.railway.app' : 'http://localhost:4000');

function resolveApiEndpoint(apiEndpoint) {
  if (!apiEndpoint) return `${BACKEND_BASE_URL}/api/geofence/check`;
  if (/^https?:\/\//i.test(apiEndpoint)) return apiEndpoint;
  if (!apiEndpoint.startsWith('/')) return `${BACKEND_BASE_URL}/${apiEndpoint}`;
  return `${BACKEND_BASE_URL}${apiEndpoint}`;
}

/**
 * Custom hook to track real-time user GPS location and automatically fetch
 * retro tilemap JSON whenever the user enters a verified venue polygon.
 * 
 * @param {string} apiEndpoint - Backend geofence verification endpoint
 * @param {boolean} enabled - Whether to actively watch and resolve geofence data
 * @returns {Object} { location, currentVenue, mapData, isInsideVenue, error, isLocating }
 */
export function useGeofencedMap(apiEndpoint = '/api/geofence/check', enabled = true) {
  const [location, setLocation] = useState(null);
  const [currentVenue, setCurrentVenue] = useState(null);
  const [mapData, setMapData] = useState(null);
  const [isInsideVenue, setIsInsideVenue] = useState(false);
  const [error, setError] = useState(null);
  const [isLocating, setIsLocating] = useState(true);

  // Tracks active venue ID to prevent redundant re-fetches during minor GPS drift
  const activeVenueIdRef = useRef(null);

  useEffect(() => {
    const resolvedEndpoint = resolveApiEndpoint(apiEndpoint);

    if (!enabled) {
      activeVenueIdRef.current = null;
      setLocation(null);
      setCurrentVenue(null);
      setMapData(null);
      setIsInsideVenue(false);
      setError(null);
      setIsLocating(false);
      return;
    }

    if (!('geolocation' in navigator)) {
      setError('Geolocation is not supported by your browser.');
      setIsLocating(false);
      return;
    }

    // High-accuracy configuration for spatial tracking
    const geoOptions = {
      enableHighAccuracy: true, // Forces phone GPS hardware vs IP lookup
      timeout: 10000,           // 10-second timeout per update
      maximumAge: 5000,         // Accept cached coordinates under 5s old
    };

    // Callback fired when phone provides updated GPS coordinates
    const handleSuccess = async (position) => {
      const { latitude, longitude, accuracy } = position.coords;
      setLocation({ latitude, longitude, accuracy });
      setIsLocating(false);

      try {
        // Ping backend geofence resolver endpoint
        const response = await fetch(resolvedEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ latitude, longitude }),
        });

        const raw = await response.text();
        let result = {};
        try {
          result = raw ? JSON.parse(raw) : {};
        } catch {
          throw new Error(`Invalid geofence response (${response.status})`);
        }

        if (!response.ok) {
          throw new Error(result?.error || `Geofence request failed (${response.status})`);
        }

        if (result.accessGranted && result.venue) {
          // Check if user entered a new venue or first-time load
          if (activeVenueIdRef.current !== result.venue.id) {
            activeVenueIdRef.current = result.venue.id;
            setCurrentVenue(result.venue);
            setMapData(result.venue.activeLayout);
            setIsInsideVenue(true);
            setError(null);
          }
        } else {
          // User is outside all registered venue polygons
          if (activeVenueIdRef.current !== null) {
            activeVenueIdRef.current = null;
            setCurrentVenue(null);
            setMapData(null);
            setIsInsideVenue(false);
          }
        }
      } catch (err) {
        console.error('Geofence API Error:', err);
        setError('Failed to verify GPS geofence with server.');
      }
    };

    const handleError = (err) => {
      setIsLocating(false);
      switch (err.code) {
        case err.PERMISSION_DENIED:
          setError('Location access denied. Please grant GPS permissions.');
          break;
        case err.POSITION_UNAVAILABLE:
          setError('Location information unavailable.');
          break;
        case err.TIMEOUT:
          setError('Location request timed out.');
          break;
        default:
          setError('An unknown location error occurred.');
      }
    };

    // Start watching physical GPS location continuously
    const watchId = navigator.geolocation.watchPosition(
      handleSuccess,
      handleError,
      geoOptions
    );

    // Clean up watcher when component unmounts
    return () => {
      navigator.geolocation.clearWatch(watchId);
    };
  }, [apiEndpoint, enabled]);

  return {
    location,        // Raw { latitude, longitude, accuracy }
    currentVenue,    // Active venue details
    mapData,         // 16-bit Tilemap & Furniture JSON payload
    isInsideVenue,   // Boolean flag for rendering space vs lock screen
    error,           // Location/API error string
    isLocating       // Initial loading state during GPS acquisition
  };
}
0       