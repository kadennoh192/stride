'use client';
import { useEffect, useState } from 'react';
import { useStride } from '@/lib/stride/store';
import { loadWeather, type WeatherReading } from '@/lib/stride/weather';

const cacheKey = 'stride-weather-cache';
const labels: Record<number, string> = {
  0: 'Clear',
  1: 'Mostly clear',
  2: 'Partly cloudy',
  3: 'Cloudy',
  45: 'Fog',
  48: 'Fog',
  51: 'Drizzle',
  61: 'Rain',
  63: 'Rain',
  65: 'Heavy rain',
  71: 'Snow',
  80: 'Rain showers',
  95: 'Thunderstorm',
};

export function WeatherCard() {
  const { settings } = useStride();
  const [weather, setWeather] = useState<WeatherReading | null>(() => {
    if (typeof localStorage === 'undefined') return null;
    try {
      return JSON.parse(
        localStorage.getItem(cacheKey) || 'null',
      ) as WeatherReading | null;
    } catch {
      return null;
    }
  });
  const [error, setError] = useState('');
  useEffect(() => {
    if (!settings.weatherEnabled) return;
    if (
      weather &&
      weather.mode === settings.weatherLocation &&
      Date.now() - weather.at < 30 * 60000
    )
      return;
    let cancelled = false;
    const run = async () => {
      try {
        const next = await loadWeather(settings.weatherLocation);
        if (!cancelled) {
          setWeather(next);
          localStorage.setItem(cacheKey, JSON.stringify(next));
          setError('');
        }
      } catch (reason) {
        if (!cancelled)
          setError(
            typeof reason === 'object' &&
              reason !== null &&
              'code' in reason &&
              reason.code === 1
              ? 'Location permission denied. Choose IP location in Settings or hide weather.'
              : String(reason),
          );
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [settings.weatherEnabled, settings.weatherLocation, weather]);
  if (!settings.weatherEnabled) return null;
  const displayed = weather?.mode === settings.weatherLocation ? weather : null;
  return (
    <section className="dashboard-card">
      <h2>Weather</h2>
      {displayed ? (
        <p>
          {Math.round(displayed.temperature)}°C ·{' '}
          {labels[displayed.code] || 'Current conditions'} ·{' '}
          {displayed.location}
        </p>
      ) : (
        <p>Loading conditions…</p>
      )}
      {error && (
        <p className="muted">
          {displayed ? 'Stale conditions (offline or update failed). ' : ''}
          {error}
        </p>
      )}
    </section>
  );
}
