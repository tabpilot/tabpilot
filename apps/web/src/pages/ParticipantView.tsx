import { WS_EVENTS } from '@tabpilot/shared';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle, ExternalLink, Users } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { useNavigate, useParams } from 'react-router-dom';
import { ParticipantAvatar } from '@/components/ParticipantAvatar';
import { ParticipantList } from '@/components/ParticipantList';
import { StatusBadge } from '@/components/StatusBadge';
import { TabSyncToggle } from '@/components/TabSyncToggle';
import { TicketScoreBreakdown } from '@/components/TicketScoreBreakdown';
import { UserAvatarMenu } from '@/components/UserAvatarMenu';
import { Button } from '@/components/ui/button';
import { useCurrentTitle } from '@/hooks/useCurrentTitle';
import { voteNotificationsEnabled } from '@/hooks/useJoinNotifications';
import { useSocket } from '@/hooks/useSocket';
import { useTabSync } from '@/hooks/useTabSync';
import { usePrefetchTicketScores } from '@/hooks/useTicketScore';
import { useTicketScoreStatus } from '@/hooks/useTicketScoreStatus';
import { fireCompletionConfetti } from '@/lib/completionConfetti';
import { getSocket } from '@/lib/socket';
import { cn, formatUrl, getFaviconUrl, safeUrl, truncateUrl } from '@/lib/utils';
import { useSessionStore } from '@/store/sessionStore';

const VOTING_VALUES = ['1', '2', '3', '5', '8', '13', '21', '?', '☕'];

function WaitingDots() {
  return (
    <span className="inline-flex gap-1">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="h-1.5 w-1.5 rounded-full bg-zinc-500"
          animate={{ opacity: [0.3, 1, 0.3], y: [0, -4, 0] }}
          transition={{
            duration: 1.2,
            repeat: Infinity,
            delay: i * 0.2,
            ease: 'easeInOut',
          }}
        />
      ))}
    </span>
  );
}

export function ParticipantView() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const [showParticipants, setShowParticipants] = useState(false);
  const [selectedVote, setSelectedVote] = useState<string | null>(null);
  const [groomingComplete, setGroomingComplete] = useState(false);
  const votedRef = useRef(false);

  const {
    session,
    participants,
    participantId,
    setParticipantId,
    loadParticipantId,
    setParticipantSecret,
    loadParticipantSecret,
    currentNavigateUrl,
    votedParticipantIds,
    revealedVotes,
  } = useSessionStore();

  const { navigateTo, isEnabled: tabSyncEnabled } = useTabSync();

  const checkedRef = useRef(false);

  // Load participant ID and secret from localStorage — ref guard prevents StrictMode double-toast
  useEffect(() => {
    if (!sessionId || checkedRef.current) return;
    checkedRef.current = true;

    const stored = loadParticipantId(sessionId);
    if (stored) {
      setParticipantId(stored);
      const storedSecret = loadParticipantSecret(sessionId);
      if (storedSecret) setParticipantSecret(storedSecret);
    } else {
      toast.error('Participant ID not found. Please join the session again.');
      navigate(`/join?code=`);
    }
  }, [
    sessionId,
    navigate,
    loadParticipantId,
    setParticipantId,
    loadParticipantSecret,
    setParticipantSecret,
  ]);

  // Navigate synced tab when URL changes
  const handleNavigate = useCallback(
    (url: string) => {
      if (tabSyncEnabled) {
        navigateTo(url);
      }
    },
    [tabSyncEnabled, navigateTo],
  );

  const handleGroomingComplete = useCallback(() => {
    setGroomingComplete(true);
    fireCompletionConfetti();
    toast.success('All tickets groomed!', { icon: '🎉', duration: 5000 });
  }, []);

  const handleTeamQueueCompleted = useCallback(({ queueName }: { queueName: string }) => {
    fireCompletionConfetti();
    toast.success(`${queueName} queue complete!`, { icon: '🎉', duration: 5000 });
  }, []);

  useSocket({
    sessionId,
    participantId,
    onNavigate: handleNavigate,
    onGroomingComplete: handleGroomingComplete,
    onTeamQueueCompleted: handleTeamQueueCompleted,
  });

  // Navigate to current URL on mount if session is active and sync enabled
  useEffect(() => {
    if (session?.state === 'active' && currentNavigateUrl && tabSyncEnabled) {
      navigateTo(currentNavigateUrl);
    }
  }, [session?.state, navigateTo, tabSyncEnabled, currentNavigateUrl]);

  const handleVote = (value: string) => {
    if (!sessionId || !participantId) return;
    setSelectedVote(value);
    votedRef.current = true;

    const socket = getSocket();
    socket.emit(WS_EVENTS.SUBMIT_VOTE, {
      sessionId,
      participantId,
      value,
    });
    if (voteNotificationsEnabled()) toast.success(`Vote submitted: ${value}`, { duration: 2000 });
  };

  // Update page title
  useEffect(() => {
    const prev = document.title;
    document.title = session ? `Tab Pilot — ${session.name}` : 'Tab Pilot';
    return () => {
      document.title = prev;
    };
  }, [session?.name, session]);

  // Reset vote when URL changes or host resets votes
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional trigger dependency
  useEffect(() => {
    setSelectedVote(null);
    votedRef.current = false;
  }, [currentNavigateUrl]);

  useEffect(() => {
    if (votedParticipantIds.length === 0 && !revealedVotes) {
      setSelectedVote(null);
      votedRef.current = false;
    }
  }, [votedParticipantIds, revealedVotes]);

  // Reset completion banner when a new URL is added (current index is no longer last)
  useEffect(() => {
    if (groomingComplete && session && session.currentIndex < session.urls.length - 1) {
      setGroomingComplete(false);
    }
  }, [groomingComplete, session]);

  const currentUrl = session?.urls[session.currentIndex];
  const onlineCount = participants.filter((p) => p.isOnline).length;

  const currentTitle = useCurrentTitle(currentUrl);
  const { data: scoreStatus } = useTicketScoreStatus();
  const scoringEnabled = scoreStatus?.configured ?? false;
  usePrefetchTicketScores(scoringEnabled ? (session?.urls ?? []) : []);

  if (!session) {
    return (
      <div className="h-screen flex items-center justify-center bg-white dark:bg-zinc-950">
        <div className="text-center space-y-3">
          <div className="w-10 h-10 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-zinc-400 text-sm">Connecting to session...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 overflow-hidden">
      {/* Top bar */}
      <header className="h-14 flex-shrink-0 flex items-center gap-3 px-4 border-b border-zinc-200 dark:border-zinc-800 bg-white/90 dark:bg-zinc-950/90 backdrop-blur-sm z-10">
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <a href="/" aria-label="Tab Pilot home">
            <img
              src="/logo.svg"
              alt="Tab Pilot logo"
              width={24}
              height={24}
              className="rounded-md flex-shrink-0"
            />
          </a>
          <h1 className="font-semibold text-zinc-800 dark:text-zinc-200 truncate text-sm">
            {session.name}
          </h1>
          <StatusBadge state={session.state} size="sm" />
          <span className="hidden sm:block text-xs text-zinc-400 truncate">
            hosted by{' '}
            <span className="text-zinc-600 dark:text-zinc-300 font-medium">{session.hostName}</span>
          </span>
        </div>

        {/* Participant count */}
        <button
          type="button"
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors text-sm"
          onClick={() => setShowParticipants(!showParticipants)}
        >
          <Users className="h-4 w-4 text-zinc-400" />
          <span className="text-zinc-700 dark:text-zinc-300 font-medium">{onlineCount}</span>
        </button>

        <UserAvatarMenu />
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Main content */}
        <main className="flex-1 overflow-y-auto scrollbar-thin">
          <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
            {/* Tab sync toggle — most prominent */}
            <TabSyncToggle />

            {/* Waiting state */}
            {session.state === 'waiting' && (
              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex flex-col items-center justify-center py-16 text-center"
              >
                <div className="w-20 h-20 rounded-full bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 flex items-center justify-center mb-6">
                  <div className="w-10 h-10 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                </div>
                <h2 className="text-xl font-semibold text-zinc-800 dark:text-zinc-200 mb-2">
                  Waiting for host to start
                </h2>
                <p className="text-zinc-500 text-sm flex items-center gap-2">
                  The session will begin shortly <WaitingDots />
                </p>

                <div className="mt-8 flex items-center gap-2 -space-x-2">
                  {participants.slice(0, 6).map((p) => (
                    <ParticipantAvatar key={p.id} participant={p} size="sm" showOnlineIndicator />
                  ))}
                  {participants.length > 6 && (
                    <div className="h-8 w-8 rounded-full bg-zinc-200 dark:bg-zinc-800 border-2 border-zinc-50 dark:border-zinc-900 flex items-center justify-center text-xs font-medium text-zinc-500 dark:text-zinc-400">
                      +{participants.length - 6}
                    </div>
                  )}
                </div>
                {participants.length > 0 && (
                  <p className="text-xs text-zinc-600 mt-3">
                    {onlineCount} participant{onlineCount === 1 ? '' : 's'} connected
                  </p>
                )}
              </motion.div>
            )}

            {/* Active state - current URL */}
            {session.state === 'active' && currentUrl && (
              <motion.div
                key={currentUrl}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
                className="space-y-4"
              >
                <div className="p-5 rounded-2xl bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
                  <p className="text-xs font-semibold text-indigo-400 uppercase tracking-wider mb-3">
                    Current ticket — {session.currentIndex + 1} / {session.urls.length}
                  </p>

                  <div className="flex items-center gap-3 mb-3">
                    <img
                      src={getFaviconUrl(currentUrl)}
                      alt=""
                      className="w-8 h-8 rounded-lg flex-shrink-0"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-zinc-900 dark:text-zinc-100">
                        {currentTitle}
                      </p>
                      <p className="text-xs text-zinc-500 truncate mt-0.5">
                        {truncateUrl(currentUrl, 60)}
                      </p>
                    </div>
                  </div>

                  {/* Progress bar */}
                  <div className="flex items-center gap-2 mb-3">
                    <div className="flex-1 h-1.5 bg-zinc-200 dark:bg-zinc-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-indigo-500 to-violet-500 rounded-full transition-all duration-700"
                        style={{
                          width: `${((session.currentIndex + 1) / session.urls.length) * 100}%`,
                        }}
                      />
                    </div>
                    <span className="text-xs text-zinc-500 flex-shrink-0">
                      {Math.round(((session.currentIndex + 1) / session.urls.length) * 100)}%
                    </span>
                  </div>

                  <a
                    href={safeUrl(currentUrl)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full"
                  >
                    <Button
                      variant="outline"
                      className="w-full border-zinc-300 dark:border-zinc-700 gap-2"
                    >
                      <ExternalLink className="h-4 w-4" />
                      Open in new tab
                    </Button>
                  </a>
                </div>

                {/* Tab sync status when navigating */}
                {tabSyncEnabled && currentUrl && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-green-500/10 border border-green-500/20 text-xs text-green-400"
                  >
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
                    </span>
                    Navigating to {formatUrl(currentUrl)} in synced tab
                  </motion.div>
                )}
              </motion.div>
            )}

            {/* Voting */}
            {session.state === 'active' && session.votingEnabled && (
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 flex items-center gap-2">
                  Story Points
                  {selectedVote && !revealedVotes && (
                    <span className="px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-400 text-xs border border-indigo-500/30">
                      You voted: {selectedVote}
                    </span>
                  )}
                  {!selectedVote &&
                    participantId &&
                    votedParticipantIds.includes(participantId) &&
                    !revealedVotes && (
                      <span className="px-2 py-0.5 rounded-full bg-zinc-700/60 text-zinc-400 text-xs border border-zinc-600/50">
                        Already voted
                      </span>
                    )}
                  {votedParticipantIds.length > 0 && !revealedVotes && (
                    <span className="text-xs text-zinc-500">
                      {votedParticipantIds.length} voted
                    </span>
                  )}
                </h3>

                {/* Revealed votes */}
                {revealedVotes ? (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="p-4 rounded-xl bg-indigo-500/5 border border-indigo-500/20 space-y-3"
                  >
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold text-indigo-400 uppercase tracking-wider">
                        Results
                      </p>
                      {(() => {
                        const nums = Object.values(revealedVotes)
                          .map(Number)
                          .filter((n) => !Number.isNaN(n));
                        const avg =
                          nums.length > 0
                            ? Math.round(nums.reduce((a, b) => a + b, 0) / nums.length)
                            : null;
                        return avg === null ? null : (
                          <span className="text-sm font-bold px-3 py-1 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                            avg {avg % 1 === 0 ? avg : avg.toFixed(1)}
                          </span>
                        );
                      })()}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(revealedVotes).map(([pid, val]) => {
                        const p = participants.find((x) => x.id === pid);
                        return (
                          <div
                            key={pid}
                            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-indigo-500/20 border border-indigo-500/30"
                          >
                            <span className="text-xs text-zinc-400">{p?.name || 'Unknown'}:</span>
                            <span className="text-xs font-bold text-indigo-300">{val}</span>
                          </div>
                        );
                      })}
                    </div>
                  </motion.div>
                ) : (
                  <div className="grid grid-cols-5 gap-2">
                    {VOTING_VALUES.map((val) => (
                      <button
                        key={val}
                        type="button"
                        onClick={() => handleVote(val)}
                        className={cn(
                          'h-12 rounded-xl font-bold text-base transition-all duration-150',
                          'border focus:outline-none focus:ring-2 focus:ring-indigo-500',
                          selectedVote === val
                            ? 'bg-indigo-500 border-indigo-400 text-white shadow-glow-indigo scale-105'
                            : 'bg-zinc-50 dark:bg-zinc-900 border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:border-indigo-500/50 hover:bg-zinc-100 dark:hover:bg-zinc-800',
                        )}
                      >
                        {val}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Ticket quality score */}
            {scoringEnabled && session.state === 'active' && currentUrl && (
              <TicketScoreBreakdown url={currentUrl} />
            )}

            {/* Grooming complete banner */}
            {groomingComplete && session.state === 'active' && (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-center gap-3 px-4 py-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30"
              >
                <CheckCircle className="h-5 w-5 text-emerald-400 flex-shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-emerald-400">All tickets groomed!</p>
                  <p className="text-xs text-zinc-500">The host has completed grooming.</p>
                </div>
              </motion.div>
            )}

            {/* Session ended */}
            {session.state === 'ended' && (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex flex-col items-center py-16 text-center"
              >
                <div className="w-16 h-16 rounded-full bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 flex items-center justify-center mb-4">
                  <span className="text-3xl">🏁</span>
                </div>
                <h2 className="text-xl font-semibold text-zinc-800 dark:text-zinc-200 mb-2">
                  Session ended
                </h2>
                <p className="text-zinc-500 text-sm mb-6">
                  The host has ended this grooming session.
                </p>
                <Button variant="glow" onClick={() => navigate('/')}>
                  Back to Home
                </Button>
              </motion.div>
            )}
          </div>
        </main>

        {/* Participants sidebar (collapsible) */}
        <AnimatePresence>
          {showParticipants && (
            <motion.aside
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 256, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.25 }}
              className="flex-shrink-0 border-l border-zinc-200 dark:border-zinc-800 overflow-hidden"
            >
              <ParticipantList
                participants={participants}
                session={session}
                className="h-full w-64"
              />
            </motion.aside>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
