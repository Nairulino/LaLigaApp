import { useEffect, useState } from 'react';
import { getClauseCountdown } from '../utils/clauseUtils';

/**
 * useClauseCountdown — cuenta atrás en vivo, a nivel de segundo, hasta que se
 * desbloquea la cláusula de rescisión de un jugador. Re-renderiza el
 * componente que lo usa cada segundo mientras está bloqueada; en cuanto llega
 * a cero deja de ticar y devuelve isOpen=true (el consumidor activa el botón
 * de clausular en ese mismo render, sin esperar a un refresco externo).
 */
const useClauseCountdown = (clauseEndTime) => {
  const [countdown, setCountdown] = useState(() => getClauseCountdown(clauseEndTime));

  useEffect(() => {
    setCountdown(getClauseCountdown(clauseEndTime));
    if (!clauseEndTime) return undefined;

    const id = setInterval(() => {
      const next = getClauseCountdown(clauseEndTime);
      setCountdown(next);
      if (!next) clearInterval(id);
    }, 1000);

    return () => clearInterval(id);
  }, [clauseEndTime]);

  if (!countdown) return { isOpen: true, days: 0, hours: 0, minutes: 0, seconds: 0, totalSeconds: 0 };
  return { isOpen: false, ...countdown };
};

export default useClauseCountdown;
