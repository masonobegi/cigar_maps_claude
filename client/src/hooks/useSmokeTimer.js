import { useState, useEffect, useRef } from 'react';

export function useSmokeTimer() {
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0); // seconds
  const [label, setLabel] = useState('');
  const intervalRef = useRef(null);
  const startRef = useRef(null);

  useEffect(() => {
    if (running) {
      startRef.current = Date.now() - elapsed * 1000;
      intervalRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
      }, 1000);
    } else {
      clearInterval(intervalRef.current);
    }
    return () => clearInterval(intervalRef.current);
  }, [running]);

  function start(cigarLabel) {
    setLabel(cigarLabel || 'Smoke session');
    setElapsed(0);
    setRunning(true);
  }

  function stop() {
    setRunning(false);
    const mins = Math.round(elapsed / 60);
    return mins;
  }

  function reset() {
    setRunning(false);
    setElapsed(0);
    setLabel('');
  }

  function format(secs) {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  return { running, elapsed, label, formattedTime: format(elapsed), minutes: Math.round(elapsed / 60), start, stop, reset };
}
