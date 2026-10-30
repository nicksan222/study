import { useEffect, useState } from 'react';

/** Minute-granularity time for relative labels without reading the clock during render. */
export function useNowMinute(): number {
  const [now, setNow] = useState(() => Date.now() / 1000);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now() / 1000), 60_000);

    return () => clearInterval(timer);
  }, []);

  return now;
}
