import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { motion } from '../../utils/motionShim';
import { useNavigate } from 'react-router-dom';
import { Trophy, Crown, ChevronUp, ChevronDown, ChevronsUpDown, RefreshCw } from 'lucide-react';
import { fantasyAPI } from '../../services/api';
import { useAuthStore } from '../../stores/authStore';
import { formatCurrency, formatNumber, extractArray } from '../../utils/helpers';
import LoadingSpinner from '../Common/LoadingSpinner';
import ErrorDisplay from '../Common/ErrorDisplay';
import useMarketTrends from '../../hooks/useMarketTrends';
import useTeamMarketIncreases from '../../hooks/useTeamMarketIncreases';
import { useCurrentWeek } from '../../hooks/useCurrentWeek';
import StandingsEvolution from './StandingsEvolution';

const Standings = () => {
  const leagueId = useAuthStore((state) => state.leagueId);
  const user = useAuthStore((state) => state.user);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [teamWeekPoints, setTeamWeekPoints] = useState(new Map());
  const [sortBy, setSortBy] = useState('position'); // position, manager, points, weekPoints, value, marketIncrease
  const [sortOrder, setSortOrder] = useState('asc'); // asc, desc
  // 'total' = clasificación acumulada (por defecto). Un número = ranking de esa
  // jornada concreta (puntos que hizo cada manager esa semana).
  const [selectedJornada, setSelectedJornada] = useState('total');
  const isTotal = selectedJornada === 'total';

  const { data: standings, isLoading, error, refetch } = useQuery({
    queryKey: ['standings', leagueId],
    queryFn: () => fantasyAPI.getLeagueRanking(leagueId),
    enabled: !!leagueId,
    retry: false,
    staleTime: 1 * 60 * 1000, // 1 minuto - clasificación puede cambiar con transacciones
    gcTime: 5 * 60 * 1000, // 5 minutos en memoria
  });

  // Get current week to fetch week points (shared hook, normalized number)
  const { weekNumber: currentWeekNumber } = useCurrentWeek();

  // Ranking de una jornada concreta. Comparte queryKey con StandingsEvolution y
  // con el efecto de "Pts Jornada" de más abajo, así que reutiliza caché.
  const {
    data: weeklyStandings,
    isLoading: weeklyLoading,
    error: weeklyError,
    refetch: refetchWeekly,
  } = useQuery({
    queryKey: ['weeklyRanking', leagueId, selectedJornada],
    queryFn: () => fantasyAPI.getLeagueRankingByWeek(leagueId, selectedJornada),
    enabled: !!leagueId && !isTotal,
    retry: false,
    staleTime: 2 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    placeholderData: keepPreviousData,
  });

  // Market trends via el hook compartido (una query key para toda la app)
  const { trendsReady: trendsInitialized } = useMarketTrends();

  // Team market value increases via the shared hook
  const teamMarketIncreases = useTeamMarketIncreases(standings, leagueId, trendsInitialized);

  // Fetch week points from weekly ranking
  useEffect(() => {
    const fetchTeamWeekPoints = async () => {
      if (!leagueId || !currentWeekNumber) return;
      if (!isTotal) return; // en modo jornada los puntos salen de weeklyStandings
      const currentWeek = currentWeekNumber;

      try {
        // Check if current week has started by fetching matches
        let weekToShow = currentWeek;
        try {
          const matchesResponse = await queryClient.fetchQuery({
            queryKey: ['matches', currentWeek],
            queryFn: () => fantasyAPI.getMatchday(currentWeek),
            staleTime: 2 * 60 * 1000,
            gcTime: 5 * 60 * 1000,
          });

          const matches = extractArray(matchesResponse);

          // Check if any match has started (matchState >= 2)
          const hasAnyMatchStarted = matches.some(match =>
            typeof match.matchState === 'number' && match.matchState >= 2
          );

          // If no matches have started, use previous week
          if (!hasAnyMatchStarted && currentWeek > 1) {
            weekToShow = currentWeek - 1;
          }
        } catch (matchError) {
          // If we can't fetch matches, just use current week
        }

        // Fetch weekly ranking which contains week points
        const weeklyRanking = await queryClient.fetchQuery({
          queryKey: ['weeklyRanking', leagueId, weekToShow],
          queryFn: () => fantasyAPI.getLeagueRankingByWeek(leagueId, weekToShow),
          staleTime: 2 * 60 * 1000, // 2 minutes - week points change frequently
          gcTime: 5 * 60 * 1000,
        });

        const weekPointsMap = new Map();

        // Extract weekly ranking data
        const weeklyData = extractArray(weeklyRanking);

        // Map week points by team ID
        weeklyData.forEach(item => {
          const teamId = item.team?.id;
          const weekPoints = item.points || 0; // "points" in weekly ranking is the week points
          if (teamId) {
            weekPointsMap.set(teamId, weekPoints);
          }
        });

        setTeamWeekPoints(weekPointsMap);

      } catch (error) {
        console.error('Error fetching team week points:', error);
      }
    };

    fetchTeamWeekPoints();
  }, [leagueId, currentWeekNumber, queryClient, isTotal]);

  // Handle different API response structures (memoized)
  const standingsData = useMemo(() => extractArray(standings), [standings]);

  // En modo jornada: normaliza el ranking semanal a la forma que usa la tabla y
  // asigna posición por puntos DE la jornada (desc).
  const jornadaData = useMemo(() => {
    if (isTotal) return [];
    const rows = extractArray(weeklyStandings).map((item) => {
      const team = item.team || {};
      return {
        id: item.id ?? team.id,
        name: item.name ?? team.name,
        manager: typeof item.manager === 'string' ? item.manager : team.manager?.managerName,
        team,
        userId: item.userId ?? team.manager?.id,
        jornadaPoints: Number(item.points) || 0,
      };
    });
    rows.sort((a, b) => b.jornadaPoints - a.jornadaPoints);
    rows.forEach((row, i) => { row.position = i + 1; });
    return rows;
  }, [isTotal, weeklyStandings]);

  const activeData = isTotal ? standingsData : jornadaData;

  // Helper functions defined before useMemo
  const getTeamName = (item) => {
    return item.name || item.team?.name || 'Equipo';
  };

  const getManagerName = (item) => {
    return item.manager || item.team?.manager?.managerName || 'Manager';
  };

  const getTeamPoints = (item) => {
    return item.points || item.team?.points || 0;
  };

  const getTeamValue = (item) => {
    return item.teamValue || item.team?.teamValue || 0;
  };

  const getTeamId = (item) => {
    return item.id || item.team?.id;
  };

  const getTeamMarketIncrease = useCallback((item) => {
    const teamId = getTeamId(item);
    return teamMarketIncreases.get(teamId) || 0;
  }, [teamMarketIncreases]);

  const getWeekPoints = useCallback((item) => {
    if (!isTotal) return item.jornadaPoints || 0;
    const teamId = getTeamId(item);
    const weekPointsFromMap = teamWeekPoints.get(teamId);
    if (weekPointsFromMap !== undefined) {
      return weekPointsFromMap;
    }
    return item.weekPoints || item.team?.weekPoints || 0;
  }, [teamWeekPoints, isTotal]);

  // Handle column header click for sorting
  const handleSort = (column) => {
    if (sortBy === column) {
      // Toggle sort order if clicking the same column
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      // Set new column and default order
      setSortBy(column);
      setSortOrder(column === 'position' ? 'asc' : 'desc');
    }
  };

  // Sort standings based on selected column and order
  const sortedStandings = useMemo(() => {
    const data = Array.isArray(activeData) ? [...activeData] : [];

    return data.sort((a, b) => {
      let valueA, valueB;

      switch (sortBy) {
        case 'position':
          valueA = a.position || 999;
          valueB = b.position || 999;
          break;
        case 'manager':
          valueA = getManagerName(a).toLowerCase();
          valueB = getManagerName(b).toLowerCase();
          break;
        case 'points':
          valueA = getTeamPoints(a);
          valueB = getTeamPoints(b);
          break;
        case 'weekPoints':
          valueA = getWeekPoints(a);
          valueB = getWeekPoints(b);
          break;
        case 'value':
          valueA = getTeamValue(a);
          valueB = getTeamValue(b);
          break;
        case 'marketIncrease':
          valueA = getTeamMarketIncrease(a);
          valueB = getTeamMarketIncrease(b);
          break;
        default:
          valueA = a.position || 999;
          valueB = b.position || 999;
      }

      // Handle string vs number comparison
      if (typeof valueA === 'string' && typeof valueB === 'string') {
        return sortOrder === 'asc'
          ? valueA.localeCompare(valueB)
          : valueB.localeCompare(valueA);
      }

      return sortOrder === 'asc' ? valueA - valueB : valueB - valueA;
    });
  }, [activeData, sortBy, sortOrder, getTeamMarketIncrease, getWeekPoints]);

  // Guarded UI returns after hooks
  if (isLoading) return <LoadingSpinner fullScreen={true} />;

  if (error) {
    return <ErrorDisplay
      error={error}
      title="Error al cargar la clasificación"
      onRetry={refetch}
      fullScreen={true}
    />;
  }

  const getPositionBadge = (position) => {
    if (position === 1) {
      return <Crown className="w-5 h-5 text-yellow-500" />;
    } else if (position <= 3) {
      return <Trophy className="w-5 h-5 text-orange-500" />;
    }
    return null;
  };

  const getUserId = (item) => {
    return item.userId || item.team?.userId || item.team?.manager?.id;
  };

  const isCurrentUser = (item) => {
    const itemUserId = getUserId(item);
    return itemUserId && user?.userId && itemUserId.toString() === user.userId.toString();
  };

  const formatMarketChange = (change) => {
    if (!change || change === 0) return '0€';
    const formattedValue = Math.abs(change).toLocaleString('es-ES');
    return change > 0 ? `+${formattedValue}€` : `-${formattedValue}€`;
  };

  const handleRowClick = (item) => {
    const teamId = getTeamId(item);
    if (teamId) {
      navigate(`/teams/${teamId}/players`);
    }
  };

  // Helper component for sortable column headers
  const SortableHeader = ({ column, children, align = 'left' }) => {
    const isActive = sortBy === column;
    const alignClass = align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left';

    return (
      <th
        className={`px-6 py-4 ${alignClass} text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors select-none`}
        onClick={() => handleSort(column)}
      >
        <div className={`flex items-center gap-2 ${align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : 'justify-start'}`}>
          <span>{children}</span>
          {isActive ? (
            sortOrder === 'asc' ? (
              <ChevronUp className="w-4 h-4" />
            ) : (
              <ChevronDown className="w-4 h-4" />
            )
          ) : (
            <ChevronsUpDown className="w-4 h-4 opacity-40" />
          )}
        </div>
      </th>
    );
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
            Clasificación
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            {sortedStandings.length} equipos en la liga
            {!isTotal && ` · puntos de la jornada ${selectedJornada}`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label htmlFor="standings-jornada" className="sr-only">Filtrar por jornada</label>
          <select
            id="standings-jornada"
            value={selectedJornada}
            onChange={(e) => {
              const raw = e.target.value;
              setSelectedJornada(raw === 'total' ? 'total' : Number(raw));
              setSortBy('position');
              setSortOrder('asc');
            }}
            className="input-field"
          >
            <option value="total">Total (acumulado)</option>
            {Array.from({ length: currentWeekNumber || 0 }, (_, i) => i + 1)
              .reverse()
              .map((j) => (
                <option key={j} value={j}>Jornada {j}</option>
              ))}
          </select>
          <button
            onClick={async () => {
              if (isTotal) {
                await queryClient.invalidateQueries({ queryKey: ['standings', leagueId] });
                await queryClient.invalidateQueries({ queryKey: ['teamData'] });
                refetch();
              } else {
                await queryClient.invalidateQueries({ queryKey: ['weeklyRanking', leagueId, selectedJornada] });
                refetchWeekly();
              }
            }}
            className="btn-primary flex items-center gap-2"
          >
            <RefreshCw className="w-4 h-4" aria-hidden="true" />
            Actualizar
          </button>
        </div>
      </div>

      {/* Evolución de posiciones por jornada (colapsable) */}
      {isTotal && (
        <StandingsEvolution
          leagueId={leagueId}
          currentWeekNumber={currentWeekNumber}
          userTeamId={getTeamId(standingsData.find(isCurrentUser) || {})}
        />
      )}

      {!isTotal && weeklyLoading && (
        <div className="py-12">
          <LoadingSpinner label={`Cargando jornada ${selectedJornada}…`} />
        </div>
      )}

      {!isTotal && weeklyError && !weeklyLoading && (
        <ErrorDisplay
          error={weeklyError}
          title={`Error al cargar la jornada ${selectedJornada}`}
          onRetry={refetchWeekly}
        />
      )}

      {(isTotal || (!weeklyLoading && !weeklyError)) && (
      <>
      {/* Standings Table - Desktop */}
      <div className="card overflow-hidden hidden md:block">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 dark:bg-gray-800">
              <tr>
                <SortableHeader column="position">Posición</SortableHeader>
                <SortableHeader column="manager">Manager</SortableHeader>
                <SortableHeader column="weekPoints" align="right">
                  {isTotal ? 'Pts Jornada' : `Pts J${selectedJornada}`}
                </SortableHeader>
                {isTotal && <SortableHeader column="points" align="right">Puntos</SortableHeader>}
                {isTotal && <SortableHeader column="marketIncrease" align="right">Subida Valor</SortableHeader>}
                {isTotal && <SortableHeader column="value" align="right">Valor</SortableHeader>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {sortedStandings.map((item, index) => {
                const position = item.position || index + 1;
                const isUser = isCurrentUser(item);

                return (
                  <motion.tr
                    key={item.id || item.team?.id || index}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.05 }}
                    onClick={() => handleRowClick(item)}
                    className={`hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors cursor-pointer ${
                      isUser ? 'bg-primary-50 dark:bg-primary-900/20' : ''
                    }`}
                  >
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        {getPositionBadge(position)}
                        <span className={`text-lg font-bold ${
                          position <= 3 
                            ? 'text-yellow-600 dark:text-yellow-400' 
                            : 'text-gray-900 dark:text-white'
                        }`}>
                          {position}
                        </span>
                        {isUser && (
                          <span className="badge bg-primary-100 text-primary-800 dark:bg-primary-900/30 dark:text-primary-400">
                            Tú
                          </span>
                        )}
                      </div>
                    </td>

                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-gradient-to-br from-primary-400 to-primary-500 rounded-full flex items-center justify-center">
                          <span className="text-white text-sm font-bold">
                            {getManagerName(item).charAt(0)}
                          </span>
                        </div>
                        <div>
                          <div className="font-semibold text-gray-900 dark:text-white">
                            {getManagerName(item)}
                          </div>
                          <div className="text-sm text-gray-500 dark:text-gray-400">
                            {getTeamName(item)}
                          </div>
                        </div>
                      </div>
                    </td>

                    <td className="px-6 py-4 whitespace-nowrap text-right">
                      <div className="text-lg font-bold text-primary-600 dark:text-primary-400">
                        {formatNumber(getWeekPoints(item))}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        {isTotal ? 'jornada actual' : `jornada ${selectedJornada}`}
                      </div>
                    </td>

                    {isTotal && (
                    <td className="px-6 py-4 whitespace-nowrap text-right">
                      <div className="text-lg font-bold text-gray-900 dark:text-white">
                        {formatNumber(getTeamPoints(item))}
                      </div>
                      <div className="text-sm text-gray-500 dark:text-gray-400">
                        total
                      </div>
                    </td>
                    )}

                    {isTotal && (
                    <td className="px-6 py-4 whitespace-nowrap text-right">
                      <div className={`text-sm font-medium ${
                        getTeamMarketIncrease(item) > 0
                          ? 'text-green-600 dark:text-green-400'
                          : getTeamMarketIncrease(item) < 0
                          ? 'text-red-600 dark:text-red-400'
                          : 'text-gray-600 dark:text-gray-400'
                      }`}>
                        {formatMarketChange(getTeamMarketIncrease(item))}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        {trendsInitialized ? 'últimas 24h' : 'cargando...'}
                      </div>
                    </td>
                    )}

                    {isTotal && (
                    <td className="px-6 py-4 whitespace-nowrap text-right">
                      <div className="text-sm font-medium text-gray-900 dark:text-white">
                        {formatCurrency(getTeamValue(item))}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        valor
                      </div>
                    </td>
                    )}
                  </motion.tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Standings Cards - Mobile */}
      <div className="md:hidden space-y-3">
        {sortedStandings.map((item, index) => {
          const position = item.position || index + 1;
          const isUser = isCurrentUser(item);

          return (
            <motion.div
              key={item.id || item.team?.id || index}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.02 }}
              onClick={() => handleRowClick(item)}
              className={`card p-5 cursor-pointer transition-all hover:shadow-lg ${
                isUser ? 'ring-2 ring-primary-500 bg-primary-50 dark:bg-primary-900/20' : ''
              }`}
            >
              <div className="flex flex-col gap-4">
                {/* Header: Position + Manager Info */}
                <div className="flex items-start gap-4">
                  {/* Position Badge - Larger */}
                  <div className="flex flex-col items-center justify-center min-w-[60px] pt-1">
                    {getPositionBadge(position)}
                    <div className={`text-3xl font-black ${
                      position <= 3
                        ? 'text-yellow-600 dark:text-yellow-400'
                        : 'text-gray-900 dark:text-white'
                    }`}>
                      {position}
                    </div>
                    <div className="text-[10px] text-gray-500 dark:text-gray-400 uppercase mt-0.5">
                      Pos
                    </div>
                  </div>

                  {/* Manager Info - Better spacing */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-12 h-12 bg-gradient-to-br from-primary-400 to-primary-500 rounded-full flex items-center justify-center flex-shrink-0 shadow-md">
                        <span className="text-white text-lg font-bold">
                          {getManagerName(item).charAt(0)}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <div className="font-bold text-base text-gray-900 dark:text-white truncate">
                            {getManagerName(item)}
                          </div>
                          {isUser && (
                            <span className="badge bg-primary-500 text-white text-xs px-2 py-0.5">
                              Tú
                            </span>
                          )}
                        </div>
                        <div className="text-sm text-gray-600 dark:text-gray-400 truncate mt-0.5">
                          {getTeamName(item)}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Stats - Improved spacing and size */}
                {isTotal ? (
                <div className="grid pt-3 border-t border-gray-200 dark:border-gray-700" style={{gridTemplateColumns: '1fr 1fr 1.5fr 1.5fr', gap: '0.25rem'}}>
                  <div className="text-center">
                    <div className="text-[9px] font-medium text-gray-500 dark:text-gray-400 uppercase mb-1">
                      Jor
                    </div>
                    <div className="text-xs font-black text-primary-600 dark:text-primary-400 leading-tight">
                      {formatNumber(getWeekPoints(item))}
                    </div>
                  </div>
                  <div className="text-center">
                    <div className="text-[9px] font-medium text-gray-500 dark:text-gray-400 uppercase mb-1">
                      Pts
                    </div>
                    <div className="text-xs font-black text-gray-900 dark:text-white leading-tight">
                      {formatNumber(getTeamPoints(item))}
                    </div>
                  </div>
                  <div className="text-center">
                    <div className="text-[9px] font-medium text-gray-500 dark:text-gray-400 uppercase mb-1">
                      Valor
                    </div>
                    <div className="text-xs font-black text-gray-900 dark:text-white leading-tight">
                      {formatCurrency(getTeamValue(item))}
                    </div>
                  </div>
                  <div className="text-center">
                    <div className="text-[9px] font-medium text-gray-500 dark:text-gray-400 uppercase mb-1">
                      24h
                    </div>
                    <div className={`text-xs font-black leading-tight ${
                      getTeamMarketIncrease(item) > 0
                        ? 'text-green-600 dark:text-green-400'
                        : getTeamMarketIncrease(item) < 0
                        ? 'text-red-600 dark:text-red-400'
                        : 'text-gray-600 dark:text-gray-400'
                    }`}>
                      {formatMarketChange(getTeamMarketIncrease(item))}
                    </div>
                  </div>
                </div>
                ) : (
                <div className="flex items-center justify-between pt-3 border-t border-gray-200 dark:border-gray-700">
                  <span className="text-[10px] font-medium text-gray-500 dark:text-gray-400 uppercase">
                    Puntos jornada {selectedJornada}
                  </span>
                  <span className="text-lg font-black text-primary-600 dark:text-primary-400 leading-tight">
                    {formatNumber(getWeekPoints(item))}
                  </span>
                </div>
                )}
              </div>
            </motion.div>
          );
        })}
      </div>

      {sortedStandings.length === 0 && (
        <div className="card p-12 text-center">
          <Trophy className="w-16 h-16 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
            No hay datos de clasificación
          </h3>
          <p className="text-gray-500 dark:text-gray-400">
            {isTotal
              ? 'Los datos de clasificación se cargarán cuando estén disponibles'
              : `Aún no hay puntuaciones para la jornada ${selectedJornada}`}
          </p>
        </div>
      )}
      </>
      )}
    </div>
  );
};

export default Standings;


