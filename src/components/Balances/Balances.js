import React, { useCallback, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  Wallet, RefreshCw, Calculator, AlertTriangle,
  ChevronUp, ChevronDown, ChevronsUpDown,
} from 'lucide-react';
import { fantasyAPI } from '../../services/api';
import { useAuthStore } from '../../stores/authStore';
import { extractArray, readTeamMoney, formatCurrency } from '../../utils/helpers';
import LoadingState from '../Common/LoadingState';
import ErrorDisplay from '../Common/ErrorDisplay';
import EmptyState from '../Common/EmptyState';
import { computeBalances, buildManagersList, INITIAL_BUDGET } from './balanceUtils';

const MAX_PAGES = 150;
const PAGE_DELAY_MS = 250;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Un reintento por página ante un fallo transitorio (429/red) a mitad del walk.
const fetchActivityPage = async (leagueId, page) => {
  try {
    return extractArray(await fantasyAPI.getLeagueActivity(leagueId, page));
  } catch {
    await sleep(1000);
    return extractArray(await fantasyAPI.getLeagueActivity(leagueId, page));
  }
};

const walkAllActivity = async (leagueId, onProgress) => {
  const all = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    if (page > 0) await sleep(PAGE_DELAY_MS);
    const rows = await fetchActivityPage(leagueId, page);
    if (!rows.length) break;
    all.push(...rows);
    onProgress?.(all.length, page + 1);
  }
  return all;
};

const signedMoney = (n) => (n < 0 ? `-${formatCurrency(n)}` : formatCurrency(n));

const formatDate = (iso) => {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })
      .format(new Date(iso));
  } catch {
    return '—';
  }
};

const Balances = () => {
  const leagueId = useAuthStore((s) => s.leagueId);
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();

  const [runToken, setRunToken] = useState(0);
  const [progress, setProgress] = useState({ items: 0, pages: 0 });
  const [applyOffset, setApplyOffset] = useState(false);
  const [sortBy, setSortBy] = useState('balance');
  const [sortDir, setSortDir] = useState('desc');

  const onProgress = useCallback((items, pages) => setProgress({ items, pages }), []);

  const { data: ranking } = useQuery({
    queryKey: ['standings', leagueId],
    queryFn: () => fantasyAPI.getLeagueRanking(leagueId),
    enabled: !!leagueId,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });

  const managers = useMemo(() => buildManagersList(ranking), [ranking]);

  const myTeamId = useMemo(() => {
    const mine = managers.find(
      (m) => user?.userId && String(m.managerId) === String(user.userId)
    );
    return mine?.teamId || null;
  }, [managers, user?.userId]);

  // Saldo real de TU equipo (único que expone la API) para calibrar.
  const { data: myMoneyResp } = useQuery({
    queryKey: ['teamMoney', myTeamId],
    queryFn: () => fantasyAPI.getTeamMoney(myTeamId),
    enabled: !!myTeamId,
    staleTime: 2 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
  const myRealBalance = readTeamMoney(myMoneyResp);

  const { data: activity, isFetching, error } = useQuery({
    queryKey: ['leagueActivityFull', leagueId, runToken],
    queryFn: () => walkAllActivity(leagueId, onProgress),
    enabled: !!leagueId && runToken > 0,
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: false,
  });

  const result = useMemo(() => {
    if (!activity || managers.length === 0) return null;
    return computeBalances(activity, { initialBudget: INITIAL_BUDGET, managers });
  }, [activity, managers]);

  const myEstimated = useMemo(() => {
    if (!result || !user?.userId) return null;
    const row = result.rows.find((r) => String(r.managerId) === String(user.userId));
    return row ? row.balance : null;
  }, [result, user?.userId]);

  const offset =
    typeof myRealBalance === 'number' && typeof myEstimated === 'number'
      ? myRealBalance - myEstimated
      : null;

  const rows = useMemo(() => {
    if (!result) return [];
    const adj = applyOffset && offset ? offset : 0;
    const list = result.rows.map((r) => ({ ...r, shownBalance: r.balance + adj }));
    const dir = sortDir === 'asc' ? 1 : -1;
    return list.sort((a, b) => {
      switch (sortBy) {
        case 'manager':
          return a.managerName.toLowerCase().localeCompare(b.managerName.toLowerCase()) * dir;
        case 'income':
          return (a.income - b.income) * dir;
        case 'expense':
          return (a.expense - b.expense) * dir;
        case 'teamValue':
          return (a.teamValue - b.teamValue) * dir;
        case 'ops':
          return (a.ops - b.ops) * dir;
        default:
          return (a.shownBalance - b.shownBalance) * dir;
      }
    });
  }, [result, applyOffset, offset, sortBy, sortDir]);

  const toggleSort = (col) => {
    if (sortBy === col) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(col);
      setSortDir(col === 'manager' ? 'asc' : 'desc');
    }
  };

  const run = () => {
    setProgress({ items: 0, pages: 0 });
    setRunToken((t) => t + 1);
  };

  const SortHead = ({ col, children, align = 'left' }) => {
    const active = sortBy === col;
    const alignCls = align === 'right' ? 'text-right' : 'text-left';
    const justify = align === 'right' ? 'justify-end' : 'justify-start';
    return (
      <th
        className={`px-4 py-3 ${alignCls} text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer select-none hover:bg-gray-100 dark:hover:bg-gray-700`}
        onClick={() => toggleSort(col)}
      >
        <div className={`flex items-center gap-1.5 ${justify}`}>
          <span>{children}</span>
          {active
            ? (sortDir === 'asc' ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />)
            : <ChevronsUpDown className="w-3.5 h-3.5 opacity-40" />}
        </div>
      </th>
    );
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Wallet className="w-7 h-7 text-primary-500" aria-hidden="true" />
            Saldo estimado
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            Reconstruido desde la actividad de la liga · presupuesto inicial{' '}
            {formatCurrency(INITIAL_BUDGET)}
          </p>
        </div>
        {runToken > 0 && (
          <button
            type="button"
            onClick={run}
            disabled={isFetching || managers.length === 0}
            className="btn-primary flex items-center gap-2 disabled:opacity-60"
          >
            <RefreshCw className={`w-4 h-4 ${isFetching ? 'animate-spin' : ''}`} aria-hidden="true" />
            Recalcular
          </button>
        )}
      </div>

      {/* Estado inicial: nada calculado todavía */}
      {runToken === 0 && (
        <div className="card">
          <EmptyState
            icon={Wallet}
            title="Calcula el saldo de todos los participantes"
            description="La API de LaLiga solo da tu saldo real. El del resto se estima recorriendo toda la actividad de la temporada (compras, ventas, cláusulas, blindajes y premios de jornada) desde un presupuesto inicial de 100.000.000. Puede tardar unos segundos."
            action={
              <button
                type="button"
                onClick={run}
                disabled={managers.length === 0}
                className="btn-primary inline-flex items-center gap-2 disabled:opacity-60"
              >
                <Calculator className="w-4 h-4" aria-hidden="true" />
                Calcular saldos
              </button>
            }
          />
        </div>
      )}

      {/* Cargando el walk */}
      {runToken > 0 && isFetching && !result && (
        <div className="card">
          <LoadingState
            message={`Leyendo actividad… ${progress.items} movimientos (${progress.pages} páginas)`}
          />
        </div>
      )}

      {/* Error */}
      {runToken > 0 && error && !isFetching && (
        <ErrorDisplay error={error} title="Error al leer la actividad" onRetry={run} />
      )}

      {/* Resultado */}
      {result && (
        <>
          {/* Calibración contra tu saldo real */}
          <div className="card p-4">
            {offset !== null ? (
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
                  <span className="text-gray-600 dark:text-gray-300">
                    Tu saldo real:{' '}
                    <strong className="text-gray-900 dark:text-white">{signedMoney(myRealBalance)}</strong>
                  </span>
                  <span className="text-gray-600 dark:text-gray-300">
                    Estimado:{' '}
                    <strong className="text-gray-900 dark:text-white">{signedMoney(myEstimated)}</strong>
                  </span>
                  <span className={`font-medium ${offset === 0 ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400'}`}>
                    Desfase: {offset > 0 ? '+' : ''}{signedMoney(offset)}
                  </span>
                </div>
                <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={applyOffset}
                    onChange={(e) => setApplyOffset(e.target.checked)}
                    className="rounded border-gray-300 dark:border-gray-600"
                  />
                  Aplicar mi desfase a todos (asume el mismo error de estimación en cada manager)
                </label>
              </div>
            ) : (
              <p className="text-sm text-gray-500 dark:text-gray-400">
                No se pudo leer tu saldo real para calibrar la estimación.
              </p>
            )}
          </div>

          {/* Aviso de tipos desconocidos */}
          {result.unknownTypes.length > 0 && (
            <div className="card p-4 border-l-4 border-amber-400 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" aria-hidden="true" />
              <p className="text-sm text-gray-700 dark:text-gray-300">
                Se han ignorado movimientos con importe de tipo desconocido
                ({result.unknownTypes.join(', ')}): la estimación puede quedarse corta.
              </p>
            </div>
          )}

          {/* Tabla desktop */}
          <div className="card overflow-hidden hidden md:block">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 dark:bg-gray-800">
                  <tr>
                    <SortHead col="manager">Manager</SortHead>
                    <SortHead col="balance" align="right">Saldo estimado</SortHead>
                    <SortHead col="income" align="right">Ingresos</SortHead>
                    <SortHead col="expense" align="right">Gastos</SortHead>
                    <SortHead col="teamValue" align="right">Valor plantilla</SortHead>
                    <SortHead col="ops" align="right">Ops.</SortHead>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Última op.
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {rows.map((r) => {
                    const isUser = user?.userId && String(r.managerId) === String(user.userId);
                    return (
                      <tr
                        key={r.managerId}
                        onClick={() => r.teamId && navigate(`/teams/${r.teamId}/players`)}
                        className={`transition-colors cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50 ${
                          isUser ? 'bg-primary-50 dark:bg-primary-900/20' : ''
                        }`}
                      >
                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className="font-semibold text-gray-900 dark:text-white">
                            {r.managerName}
                            {isUser && (
                              <span className="ml-2 badge bg-primary-100 text-primary-800 dark:bg-primary-900/30 dark:text-primary-400">
                                Tú
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">{r.teamName}</div>
                        </td>
                        <td className={`px-4 py-3 whitespace-nowrap text-right font-bold ${
                          r.shownBalance < 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white'
                        }`}>
                          {signedMoney(r.shownBalance)}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-right text-sm text-green-600 dark:text-green-400">
                          {r.income ? `+${formatCurrency(r.income)}` : '—'}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-right text-sm text-red-600 dark:text-red-400">
                          {r.expense ? `-${formatCurrency(r.expense)}` : '—'}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-right text-sm text-gray-700 dark:text-gray-300">
                          {formatCurrency(r.teamValue)}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-right text-sm text-gray-500 dark:text-gray-400">
                          {r.ops}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-right text-xs text-gray-500 dark:text-gray-400">
                          {formatDate(r.lastAt)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Cards mobile */}
          <div className="md:hidden space-y-3">
            {rows.map((r) => {
              const isUser = user?.userId && String(r.managerId) === String(user.userId);
              return (
                <div
                  key={r.managerId}
                  onClick={() => r.teamId && navigate(`/teams/${r.teamId}/players`)}
                  className={`card p-4 cursor-pointer ${isUser ? 'ring-2 ring-primary-500 bg-primary-50 dark:bg-primary-900/20' : ''}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-bold text-gray-900 dark:text-white truncate">
                        {r.managerName}
                        {isUser && (
                          <span className="ml-2 badge bg-primary-500 text-white text-xs px-2 py-0.5">Tú</span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 truncate">{r.teamName}</div>
                    </div>
                    <div className={`text-lg font-black flex-shrink-0 ${
                      r.shownBalance < 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white'
                    }`}>
                      {signedMoney(r.shownBalance)}
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-gray-200 dark:border-gray-700 text-center">
                    <div>
                      <div className="text-[10px] uppercase text-gray-400 dark:text-gray-500">Ingresos</div>
                      <div className="text-xs font-bold text-green-600 dark:text-green-400">
                        {r.income ? `+${formatCurrency(r.income)}` : '—'}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase text-gray-400 dark:text-gray-500">Gastos</div>
                      <div className="text-xs font-bold text-red-600 dark:text-red-400">
                        {r.expense ? `-${formatCurrency(r.expense)}` : '—'}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase text-gray-400 dark:text-gray-500">Plantilla</div>
                      <div className="text-xs font-bold text-gray-700 dark:text-gray-300">
                        {formatCurrency(r.teamValue)}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <p className="text-xs text-gray-400 dark:text-gray-500">
            Estimación · {result.movementsUsed} movimientos usados · desde {formatDate(result.oldestAt)}.
            No incluye ajustes manuales del administrador ni movimientos que la API no publique en la actividad.
          </p>
        </>
      )}
    </div>
  );
};

export default Balances;
