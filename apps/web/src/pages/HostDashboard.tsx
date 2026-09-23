import { AnimatePresence, motion } from 'framer-motion';
import {
  ClipboardCopy,
  Copy,
  ExternalLink,
  Eye,
  Link2,
  Play,
  Plus,
  Power,
  RefreshCw,
  Send,
  Settings,
  ToggleLeft,
  ToggleRight,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { useNavigate, useParams } from 'react-router-dom';
import * as Yup from 'yup';
import { JoinCodeDisplay } from '@/components/JoinCodeDisplay';
import { NavigationControls } from '@/components/NavigationControls';
import { ParticipantList } from '@/components/ParticipantList';
import { StatusBadge } from '@/components/StatusBadge';
import { TicketScoreBreakdown } from '@/components/TicketScoreBreakdown';
import { UrlQueue } from '@/components/UrlQueue';
import { UserAvatarMenu } from '@/components/UserAvatarMenu';
import { Button } from '@/components/ui/button';
import { useCurrentTitle } from '@/hooks/useCurrentTitle';
import { useHostActions } from '@/hooks/useHostActions';
import { useJiraStatus } from '@/hooks/useJiraStatus';
import { useNotificationPrefs } from '@/hooks/useJoinNotifications';
import { useSocket } from '@/hooks/useSocket';
import { useStoryPointOverride } from '@/hooks/useStoryPointOverride';
import { usePrefetchTicketScores } from '@/hooks/useTicketScore';
import { useTicketScoreStatus } from '@/hooks/useTicketScoreStatus';
import { isStoryPointConfigured, parseJiraUrl, updateJiraStoryPoints } from '@/lib/jira';
import { cn, getFaviconUrl, safeUrl, truncateUrl } from '@/lib/utils';
import { useSessionStore } from '@/store/sessionStore';

function computeVoteAverage(votes: Record<string, string>): number | null {
  const nums = Object.values(votes)
    .map(Number)
    .filter((n) => !Number.isNaN(n));
  return nums.length > 0 ? Math.round(nums.reduce((a, b) => a + b, 0) / nums.length) : null;
}

interface RevealedVotesPanelProps {
  readonly revealedVotes: Record<string, string>;
  readonly participants: Array<{ id: string; name: string }>;
  readonly currentUrl: string | undefined;
  readonly storyPointProjects: string[];
  readonly storyPointOverride: string;
  readonly onStoryPointChange: (value: string) => void;
  readonly onSaveVote: (val: string) => void;
  readonly hasExtraFields: boolean;
  readonly sendExtraFields: boolean;
  readonly onSendExtraFieldsChange: (v: boolean) => void;
  readonly hostKey: string | null;
  readonly sessionId: string | undefined;
}

function RevealedVotesPanel({
  revealedVotes,
  participants,
  currentUrl,
  storyPointProjects,
  storyPointOverride,
  onStoryPointChange,
  onSaveVote,
  hasExtraFields,
  sendExtraFields,
  onSendExtraFieldsChange,
  hostKey,
  sessionId,
}: RevealedVotesPanelProps) {
  const avg = Object.keys(revealedVotes).length > 0 ? computeVoteAverage(revealedVotes) : null;
  const spError = validateStoryPoint(storyPointOverride.trim());
  const spDirty = storyPointOverride.trim().length > 0;
  const spValid = spDirty && !spError;
  const jiraInfo =
    currentUrl && isStoryPointConfigured(currentUrl, storyPointProjects)
      ? parseJiraUrl(currentUrl)
      : null;

  async function saveToJira(val: string) {
    if (!jiraInfo) return;
    if (!hostKey || !sessionId) {
      toast.error('No host credentials available.');
      return;
    }
    onSaveVote(val);
    try {
      await updateJiraStoryPoints(
        jiraInfo.key,
        Number(val),
        hostKey,
        sessionId,
        jiraInfo.baseUrl,
        !sendExtraFields,
      );
      toast.success(`Story point ${val} saved to ${jiraInfo.key}`);
    } catch {
      toast.error('Failed to update Jira story point. Check Jira integration settings.');
    }
  }

  async function handleKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter' || !spValid) return;
    const val = storyPointOverride.trim();
    if (jiraInfo) {
      await saveToJira(val);
    } else {
      onSaveVote(val);
      toast.success('Story point saved.');
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      className="mt-3 p-3 rounded-lg bg-indigo-500/5 border border-indigo-500/20"
    >
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-indigo-400 uppercase tracking-wider">
          Votes Revealed
        </p>
        {avg !== null && (
          <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
            avg {avg % 1 === 0 ? avg : avg.toFixed(1)}
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {Object.entries(revealedVotes).map(([pid, val]) => {
          const participant = participants.find((p) => p.id === pid);
          return (
            <div
              key={pid}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-indigo-500/20 border border-indigo-500/30"
            >
              <span className="text-xs text-zinc-400">{participant?.name ?? 'Unknown'}:</span>
              <span className="text-xs font-bold text-indigo-300">{val}</span>
            </div>
          );
        })}
      </div>

      {/* Story point override + save + copy-to-Jira */}
      <div className="flex items-start gap-2 mt-3 pt-3 border-t border-indigo-500/20">
        <span className="text-xs text-zinc-400 flex-shrink-0 mt-1.5">Story Point:</span>
        <div className="flex flex-col gap-0.5">
          <input
            type="number"
            min="0"
            step="any"
            value={storyPointOverride}
            onChange={(e) => onStoryPointChange(e.target.value)}
            onKeyDown={handleKeyDown}
            className={cn(
              'w-16 h-7 px-2 rounded-md bg-zinc-800 text-zinc-100 text-xs font-bold border outline-none text-center',
              spDirty && spError
                ? 'border-red-500/70 focus:border-red-500'
                : 'border-indigo-500/40 focus:border-indigo-500',
            )}
            aria-label="Story point override"
            aria-invalid={spDirty && !!spError}
            aria-describedby={spDirty && spError ? 'sp-error' : undefined}
            placeholder="—"
          />
          {spDirty && spError && (
            <span id="sp-error" className="text-[10px] text-red-400 leading-none">
              {spError}
            </span>
          )}
        </div>
        {jiraInfo ? (
          <div className="flex flex-col gap-1.5">
            <button
              type="button"
              disabled={!spValid}
              onClick={() => saveToJira(storyPointOverride.trim())}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-indigo-500/20 text-indigo-300 text-xs font-semibold border border-indigo-500/30 hover:bg-indigo-500/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Send className="h-3 w-3" />
              Save to Jira
            </button>
            {hasExtraFields && (
              <label className="flex items-center gap-1.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={sendExtraFields}
                  onChange={(e) => onSendExtraFieldsChange(e.target.checked)}
                  className="h-3 w-3 rounded accent-indigo-500"
                  aria-label="Send extra Jira fields"
                />
                <span className="text-[10px] text-zinc-500">Include extra fields</span>
              </label>
            )}
          </div>
        ) : (
          <button
            type="button"
            disabled={!spValid}
            onClick={() => {
              onSaveVote(storyPointOverride.trim());
              toast.success('Story point saved.');
            }}
            className="px-2.5 py-1 rounded-md bg-indigo-500/20 text-indigo-300 text-xs font-semibold border border-indigo-500/30 hover:bg-indigo-500/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Save
          </button>
        )}
      </div>
    </motion.div>
  );
}

const storyPointSchema = Yup.number()
  .typeError('Must be a positive number')
  .positive('Must be a positive number')
  .required('Required');

function validateStoryPoint(value: string): string {
  try {
    storyPointSchema.validateSync(value === '' ? undefined : Number(value));
    return '';
  } catch (e) {
    return e instanceof Yup.ValidationError ? e.message : 'Invalid';
  }
}

export function HostDashboard() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const [showShareModal, setShowShareModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showEndConfirm, setShowEndConfirm] = useState(false);
  const [newUrl, setNewUrl] = useState('');
  const [showMobileParticipants, setShowMobileParticipants] = useState(false);
  const [isGroomingComplete, setIsGroomingComplete] = useState(false);
  const [sendExtraFields, setSendExtraFields] = useState(false);

  const {
    session,
    participants,
    hostKey,
    setIsHost,
    setHostKey,
    loadHostKey,
    loadHostInviteKey,
    reset,
    votedParticipantIds,
    revealedVotes,
    savedVotesMap,
  } = useSessionStore();

  const { storyPointOverride, setStoryPointOverride } = useStoryPointOverride(revealedVotes);

  // Ref guard: React StrictMode double-invokes effects in dev, which would
  // show the "Host key not found" toast twice before navigation completes.
  // The ref persists across StrictMode's intermediate unmount, so this runs once.
  const checkedRef = useRef(false);

  useEffect(() => {
    if (!sessionId || checkedRef.current) return;
    checkedRef.current = true;

    const storedHostKey = loadHostKey(sessionId);
    if (storedHostKey) {
      setHostKey(storedHostKey);
      setIsHost(true);
    } else {
      toast.error('Host key not found. Did you create this session?');
      navigate('/');
    }
  }, [sessionId, setIsHost, setHostKey, navigate, loadHostKey]);

  const { isConnected } = useSocket({
    sessionId,
    hostKey: hostKey || undefined,
  });

  const { joinEnabled, toggleJoin, voteEnabled, toggleVote } = useNotificationPrefs();

  const { data: jiraStatus } = useJiraStatus();
  const storyPointProjects = jiraStatus?.storyPointProjects ?? [];
  const hasExtraFields = jiraStatus?.hasExtraFields ?? false;
  const { data: scoreStatus } = useTicketScoreStatus();
  const scoringEnabled = scoreStatus?.configured ?? false;
  usePrefetchTicketScores(scoringEnabled ? (session?.urls ?? []) : []);

  // Update page title
  useEffect(() => {
    const prev = document.title;
    document.title = session ? `Tab Pilot — ${session.name}` : 'Tab Pilot';
    return () => {
      document.title = prev;
    };
  }, [session?.name, session]);

  const {
    handleRevealVotes,
    handleStartSession,
    handleNavigate,
    handleSkip,
    handleComplete,
    handleJumpTo,
    handleToggleLock,
    handleToggleVoting,
    handleKickParticipant,
    handleDeleteUrl,
    handleReorderUrls,
    handleResetVotes,
    handleSetSavedVote,
    handleResetSavedVote,
    handleAddUrl,
    handleEndSession,
    handleCopyCoHostInviteLink,
    handleCopyToJira,
  } = useHostActions({
    sessionId,
    hostKey,
    session,
    setIsGroomingComplete,
    newUrl,
    setNewUrl,
    navigate,
    reset,
    loadHostInviteKey,
    savedVotesMap,
    storyPointProjects,
    sendExtraFields,
  });

  // Reset completion banner when a new URL is added (current index is no longer last)
  useEffect(() => {
    if (isGroomingComplete && session && session.currentIndex < session.urls.length - 1) {
      setIsGroomingComplete(false);
    }
  }, [isGroomingComplete, session]);

  const currentUrl = session?.urls[session.currentIndex];
  const onlineCount = participants.filter((p) => p.isOnline).length;
  const canReveal = !!session?.votingEnabled && votedParticipantIds.length > 0 && !revealedVotes;
  const canResetVotes =
    !!session?.votingEnabled && (votedParticipantIds.length > 0 || !!revealedVotes);

  // Enrich current URL — Jira first, then generic page title, then domain
  const currentTitle = useCurrentTitle(currentUrl);

  if (!session) {
    return (
      <div className="h-screen flex items-center justify-center bg-white dark:bg-zinc-950">
        <div className="text-center space-y-3">
          <div className="w-10 h-10 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-zinc-400 text-sm">Loading session...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 overflow-hidden">
      {/* Top bar */}
      <header className="flex-shrink-0 border-b border-zinc-200 dark:border-zinc-800 bg-white/90 dark:bg-zinc-950/90 backdrop-blur-sm z-10">
        {/* Row 1: logo + session name + status + avatar */}
        <div className="flex items-center gap-2.5 px-4 h-14 sm:h-16">
          <a href="/" aria-label="Tab Pilot home">
            <img
              src="/logo.svg"
              alt="Tab Pilot logo"
              width={28}
              height={28}
              className="rounded-md flex-shrink-0"
            />
          </a>
          <h1 className="font-semibold text-zinc-900 dark:text-zinc-100 truncate text-sm flex-1 min-w-0">
            {session.name}
          </h1>
          <StatusBadge state={session.state} size="sm" />

          {/* Desktop-only controls (inline with title row) */}
          <div className="hidden sm:flex items-center gap-1.5 flex-shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowShareModal(true)}
              title="Share session"
              className="gap-2 font-mono border-zinc-300 dark:border-zinc-700"
            >
              <span className="text-zinc-500">Code:</span>
              <span className="font-bold tracking-widest">{session.joinCode}</span>
              <Copy className="h-3.5 w-3.5 text-zinc-500" />
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowMobileParticipants(true)}
              className="gap-1.5 border-zinc-300 dark:border-zinc-700"
            >
              <Users className="h-3.5 w-3.5 text-zinc-400" />
              <span className="font-medium">{onlineCount}</span>
              <span className="text-zinc-500">/{participants.length}</span>
            </Button>

            {canReveal && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleRevealVotes}
                className="gap-1.5 border-indigo-500/50 text-indigo-400 hover:bg-indigo-500/10"
              >
                <Eye className="h-3.5 w-3.5" />
                Reveal ({votedParticipantIds.length})
              </Button>
            )}

            {canResetVotes && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleResetVotes}
                className="gap-1.5 border-zinc-300 dark:border-zinc-700 text-zinc-400 hover:text-red-400 hover:border-red-400/50"
                title="Reset votes — clear all votes and start a new round"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Reset
              </Button>
            )}

            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowSettingsModal(true)}
              className="gap-1.5 border-zinc-300 dark:border-zinc-700"
              title="Session settings"
            >
              <Settings className="h-3.5 w-3.5" />
              Settings
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowEndConfirm(true)}
              className="gap-1.5 border-zinc-300 dark:border-zinc-700"
            >
              <Power className="h-3.5 w-3.5 text-red-400" />
              End
            </Button>
          </div>

          <UserAvatarMenu />
        </div>

        {/* Row 2: mobile-only action bar */}
        <div className="sm:hidden flex items-center gap-2 px-4 pb-3">
          <button
            type="button"
            onClick={() => setShowMobileParticipants(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-sm hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors"
          >
            <Users className="h-4 w-4 text-zinc-400" />
            <span className="text-zinc-700 dark:text-zinc-300 font-medium">{onlineCount}</span>
            <span className="text-zinc-500">/{participants.length}</span>
          </button>

          {canReveal && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleRevealVotes}
              className="gap-1.5 border-indigo-500/50 text-indigo-400 hover:bg-indigo-500/10"
            >
              <Eye className="h-4 w-4" />
              Reveal ({votedParticipantIds.length})
            </Button>
          )}

          {canResetVotes && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleResetVotes}
              className="gap-1.5 border-zinc-300 dark:border-zinc-700 text-zinc-400 hover:text-red-400 hover:border-red-400/50"
              title="Reset votes"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          )}

          <div className="flex-1" />

          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowSettingsModal(true)}
            className="border-zinc-300 dark:border-zinc-700"
            title="Session settings"
          >
            <Settings className="h-4 w-4" />
          </Button>

          <Button variant="destructive" size="sm" onClick={() => setShowEndConfirm(true)}>
            <Power className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar — hidden on mobile, always visible on desktop */}
        <aside className="hidden md:flex w-64 xl:w-72 flex-shrink-0 border-r border-zinc-200 dark:border-zinc-800 overflow-hidden flex-col bg-white dark:bg-zinc-950">
          <ParticipantList
            participants={participants}
            onKick={handleKickParticipant}
            className="flex-1"
            session={session}
            votedParticipantIds={session.votingEnabled ? votedParticipantIds : undefined}
            revealedVotes={session.votingEnabled ? revealedVotes : undefined}
          />
        </aside>

        {/* Center content — full width on mobile */}
        <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {/* Current URL display */}
          {currentUrl && session.state === 'active' && (
            <div className="flex-shrink-0 px-6 pt-5 pb-4 border-b border-zinc-200 dark:border-zinc-800">
              <div className="flex items-center gap-4 p-4 rounded-xl bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
                <img
                  src={getFaviconUrl(currentUrl)}
                  alt=""
                  className="w-8 h-8 rounded-lg flex-shrink-0"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none';
                  }}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-indigo-400 mb-0.5">
                    Current ticket — {session.currentIndex + 1} of {session.urls.length}
                  </p>
                  <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                    {currentTitle}
                  </p>
                  <p className="text-xs text-zinc-500 truncate mt-0.5">
                    {truncateUrl(currentUrl, 70)}
                  </p>
                </div>
                <a
                  href={safeUrl(currentUrl)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-shrink-0"
                >
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 border-zinc-300 dark:border-zinc-700"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Open
                  </Button>
                </a>
              </div>

              {/* Revealed votes panel */}
              {session.votingEnabled && revealedVotes && (
                <RevealedVotesPanel
                  revealedVotes={revealedVotes}
                  participants={participants}
                  currentUrl={currentUrl}
                  storyPointProjects={storyPointProjects}
                  storyPointOverride={storyPointOverride}
                  onStoryPointChange={setStoryPointOverride}
                  onSaveVote={(val) => handleSetSavedVote(session.currentIndex, val)}
                  hasExtraFields={hasExtraFields}
                  sendExtraFields={sendExtraFields}
                  onSendExtraFieldsChange={setSendExtraFields}
                  hostKey={hostKey}
                  sessionId={sessionId}
                />
              )}

              {scoringEnabled && <TicketScoreBreakdown url={currentUrl} canRegenerate />}
            </div>
          )}

          {/* URL Queue */}
          <div className="flex-1 overflow-y-auto scrollbar-thin px-6 py-4">
            <div className="flex items-center gap-2 mb-3">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                Ticket Queue
              </h2>
              <span className="text-xs px-1.5 py-0.5 rounded-full bg-zinc-200 dark:bg-zinc-800 text-zinc-500">
                {session.urls.length}
              </span>
            </div>
            <UrlQueue
              urls={session.urls}
              currentIndex={session.currentIndex}
              isHost={true}
              onJumpTo={handleJumpTo}
              onDelete={handleDeleteUrl}
              onReorder={handleReorderUrls}
              savedVotes={session.votingEnabled ? savedVotesMap : undefined}
              onSetVote={session.votingEnabled ? handleSetSavedVote : undefined}
              onResetVote={session.votingEnabled ? handleResetSavedVote : undefined}
              onCopyToJira={session.votingEnabled ? handleCopyToJira : undefined}
              storyPointProjects={storyPointProjects}
              scoringEnabled={scoringEnabled}
            />

            {/* Add URL input */}
            <div className="flex items-center gap-2 mt-3 px-1">
              <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 focus-within:border-indigo-500 transition-colors">
                <Link2 className="h-3.5 w-3.5 text-zinc-400 flex-shrink-0" />
                <input
                  type="url"
                  value={newUrl}
                  onChange={(e) => setNewUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddUrl();
                    }
                  }}
                  placeholder="Paste a URL and press Enter to add…"
                  className="flex-1 bg-transparent text-xs text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 outline-none min-w-0"
                />
                {newUrl.trim() && (
                  <button
                    type="button"
                    onClick={handleAddUrl}
                    className="flex-shrink-0 p-0.5 rounded text-indigo-400 hover:text-indigo-300 transition-colors"
                    aria-label="Add URL"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Navigation controls */}
          {session.state === 'active' && (
            <NavigationControls
              currentIndex={session.currentIndex}
              total={session.urls.length}
              onPrevious={() => handleNavigate('prev')}
              onNext={() => handleNavigate('next')}
              onSkip={handleSkip}
              onComplete={handleComplete}
              completed={isGroomingComplete}
              disabled={!isConnected}
            />
          )}
        </main>
      </div>

      {/* "Start Session" overlay when waiting */}
      <AnimatePresence>
        {session.state === 'waiting' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 flex items-center justify-center bg-white/80 dark:bg-zinc-950/80 backdrop-blur-sm z-20"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 25 }}
              className="glass-card rounded-3xl p-10 max-w-sm w-full mx-4 text-center"
            >
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center mx-auto mb-6 shadow-glow-indigo">
                <Play className="h-8 w-8 text-white ml-0.5" />
              </div>
              <h2 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100 mb-2">
                Ready to start?
              </h2>
              <p className="text-zinc-400 text-sm mb-3 leading-relaxed">
                {(() => {
                  const plural = onlineCount === 1 ? '' : 's';
                  return participants.length > 0
                    ? `${onlineCount} participant${plural} online and waiting.`
                    : 'Waiting for participants to join...';
                })()}
              </p>

              <div className="flex justify-center mb-6">
                <JoinCodeDisplay joinCode={session.joinCode} codeOnly />
              </div>

              <Button
                variant="glow"
                size="lg"
                className="w-full h-12 text-base"
                onClick={handleStartSession}
                disabled={!isConnected}
              >
                <Play className="h-5 w-5 mr-2" />
                Start Session
              </Button>
              {!isConnected && (
                <p className="text-xs text-red-400 mt-2">Not connected — check your connection</p>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Session ended overlay */}
      <AnimatePresence>
        {session.state === 'ended' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 flex items-center justify-center bg-white/90 dark:bg-zinc-950/90 backdrop-blur-sm z-20"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="glass-card rounded-3xl p-10 max-w-sm w-full mx-4 text-center"
            >
              <h2 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100 mb-2">
                Session ended
              </h2>
              <p className="text-zinc-400 text-sm mb-6">
                Great work! Your team groomed {session.urls.length} ticket
                {session.urls.length === 1 ? '' : 's'}.
              </p>
              <Button variant="glow" size="lg" className="w-full" onClick={() => navigate('/')}>
                Back to Home
              </Button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Mobile participants overlay */}
      <AnimatePresence>
        {showMobileParticipants && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="md:hidden fixed inset-0 z-40 bg-zinc-950/60 backdrop-blur-sm"
            onClick={() => setShowMobileParticipants(false)}
          >
            <motion.div
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              className="absolute inset-y-0 left-0 w-4/5 max-w-xs bg-white dark:bg-zinc-950 border-r border-zinc-200 dark:border-zinc-800 flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-4 h-14 border-b border-zinc-200 dark:border-zinc-800 flex-shrink-0">
                <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  Participants
                </span>
                <button
                  type="button"
                  onClick={() => setShowMobileParticipants(false)}
                  className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                  aria-label="Close participants"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <ParticipantList
                participants={participants}
                onKick={handleKickParticipant}
                className="flex-1"
                session={session}
                votedParticipantIds={session.votingEnabled ? votedParticipantIds : undefined}
                revealedVotes={session.votingEnabled ? revealedVotes : undefined}
              />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* End session confirm modal */}
      <AnimatePresence>
        {showEndConfirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-white/80 dark:bg-zinc-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setShowEndConfirm(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 w-full max-w-sm"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">End session?</h3>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Close"
                  onClick={() => setShowEndConfirm(false)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-sm text-zinc-500 mb-6">
                This will disconnect all participants and close the session. This cannot be undone.
              </p>
              <div className="flex gap-3">
                <Button
                  variant="outline"
                  className="flex-1 border-zinc-300 dark:border-zinc-700"
                  onClick={() => setShowEndConfirm(false)}
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  className="flex-1"
                  onClick={() => {
                    setShowEndConfirm(false);
                    handleEndSession();
                  }}
                >
                  <Power className="h-4 w-4 mr-1.5" />
                  End Session
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Settings modal */}
      <AnimatePresence>
        {showSettingsModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-white/80 dark:bg-zinc-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setShowSettingsModal(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 w-full max-w-sm"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-5">
                <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">Session Settings</h3>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Close"
                  onClick={() => setShowSettingsModal(false)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                      Story point voting
                    </p>
                    <p className="text-xs text-zinc-500">
                      Participants can vote on story points during grooming
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleToggleVoting}
                    className="flex-shrink-0"
                    aria-label="Toggle voting"
                  >
                    {session.votingEnabled ? (
                      <ToggleRight className="h-8 w-8 text-indigo-400" />
                    ) : (
                      <ToggleLeft className="h-8 w-8 text-zinc-600" />
                    )}
                  </button>
                </div>

                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                      Lock session
                    </p>
                    <p className="text-xs text-zinc-500">Prevent new participants from joining</p>
                  </div>
                  <button
                    type="button"
                    onClick={handleToggleLock}
                    className="flex-shrink-0"
                    aria-label="Toggle lock"
                  >
                    {session.isLocked ? (
                      <ToggleRight className="h-8 w-8 text-amber-400" />
                    ) : (
                      <ToggleLeft className="h-8 w-8 text-zinc-600" />
                    )}
                  </button>
                </div>

                <div className="border-t border-zinc-100 dark:border-zinc-800 pt-3 mt-1">
                  <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-3">
                    Notifications
                  </p>

                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                        Join notifications
                      </p>
                      <p className="text-xs text-zinc-500">Show toast when a participant joins</p>
                    </div>
                    <button
                      type="button"
                      onClick={toggleJoin}
                      className="flex-shrink-0"
                      aria-label="Toggle join notifications"
                    >
                      {joinEnabled ? (
                        <ToggleRight className="h-8 w-8 text-indigo-400" />
                      ) : (
                        <ToggleLeft className="h-8 w-8 text-zinc-600" />
                      )}
                    </button>
                  </div>

                  <div className="flex items-center justify-between gap-4 mt-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                        Vote notifications
                      </p>
                      <p className="text-xs text-zinc-500">Show toast when a vote is submitted</p>
                    </div>
                    <button
                      type="button"
                      onClick={toggleVote}
                      className="flex-shrink-0"
                      aria-label="Toggle vote notifications"
                    >
                      {voteEnabled ? (
                        <ToggleRight className="h-8 w-8 text-indigo-400" />
                      ) : (
                        <ToggleLeft className="h-8 w-8 text-zinc-600" />
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Share modal */}
      <AnimatePresence>
        {showShareModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-white/80 dark:bg-zinc-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setShowShareModal(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 w-full max-w-sm"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-5">
                <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">Share Session</h3>
                <Button variant="ghost" size="icon" onClick={() => setShowShareModal(false)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <JoinCodeDisplay joinCode={session.joinCode} />

              <div className="mt-5 pt-5 border-t border-zinc-200 dark:border-zinc-700">
                <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-1.5 flex items-center gap-1.5">
                  <UserPlus className="h-3.5 w-3.5" />
                  Invite Co-Hosts
                </p>
                <p className="text-xs text-zinc-500 mb-3">
                  Share the secret invite link with other facilitators.
                </p>
                <button
                  type="button"
                  onClick={handleCopyCoHostInviteLink}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-indigo-500/10 border border-indigo-500/30 text-indigo-400 hover:bg-indigo-500/20 hover:border-indigo-500/50 transition-colors text-sm font-medium"
                >
                  <ClipboardCopy className="h-4 w-4" />
                  Copy Co-Host Invite Link
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
