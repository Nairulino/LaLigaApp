import useCountdown from './useCountdown';

/**
 * useClauseCountdown — cuenta atrás en vivo, a nivel de segundo, hasta que se
 * desbloquea la cláusula de rescisión de un jugador. Re-renderiza el
 * componente que lo usa cada segundo mientras está bloqueada; en cuanto llega
 * a cero devuelve isOpen=true (el consumidor activa el botón de clausular en
 * ese mismo render, sin esperar a un refresco externo).
 */
const useClauseCountdown = (clauseEndTime) => useCountdown(clauseEndTime);

export default useClauseCountdown;
