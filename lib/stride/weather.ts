export interface WeatherReading {
  temperature: number;
  code: number;
  at: number;
  location: string;
  mode: 'gps' | 'ip';
}
export async function loadWeather(
  mode: 'gps' | 'ip',
  fetcher: typeof fetch = fetch,
  locate: () => Promise<{ latitude: number; longitude: number }> = () =>
    new Promise((resolve, reject) =>
      navigator.geolocation.getCurrentPosition(
        (position) => resolve(position.coords),
        reject,
        { timeout: 10000, maximumAge: 30 * 60000 },
      ),
    ),
): Promise<WeatherReading> {
  let latitude: number, longitude: number, location: string;
  if (mode === 'gps') {
    const coords = await locate();
    latitude = coords.latitude;
    longitude = coords.longitude;
    location = 'Your location';
  } else {
    const response = await fetcher('https://ipapi.co/json/', {
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error('Approximate location is unavailable.');
    const body = (await response.json()) as {
      latitude?: number;
      longitude?: number;
      city?: string;
      error?: boolean;
    };
    if (
      body.error ||
      !Number.isFinite(body.latitude) ||
      !Number.isFinite(body.longitude)
    )
      throw new Error('Approximate location is unavailable.');
    latitude = body.latitude!;
    longitude = body.longitude!;
    location = body.city || 'Approximate location';
  }
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    Math.abs(latitude) > 90 ||
    Math.abs(longitude) > 180
  )
    throw new Error('Invalid weather location.');
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', String(latitude));
  url.searchParams.set('longitude', String(longitude));
  url.searchParams.set('current', 'temperature_2m,weather_code');
  const response = await fetcher(url, { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error('Weather is unavailable.');
  const body = (await response.json()) as {
    current?: { temperature_2m?: number; weather_code?: number };
  };
  if (
    !Number.isFinite(body.current?.temperature_2m) ||
    !Number.isFinite(body.current?.weather_code)
  )
    throw new Error('Weather data is unavailable.');
  return {
    temperature: body.current!.temperature_2m!,
    code: body.current!.weather_code!,
    at: Date.now(),
    location,
    mode,
  };
}
