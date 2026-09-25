import type { Session, TeamQueueProgressUpdate } from '@tabpilot/shared';
import { WS_EVENTS } from '@tabpilot/shared';
import { useCallback } from 'react';
import toast from 'react-hot-toast';
import { fireCompletionConfetti } from '@/lib/completionConfetti';
import { isStoryPointConfigured, parseJiraUrl, updateJiraStoryPoints } from '@/lib/jira';
import { getSocket } from '@/lib/socket';

function isValidHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}

interface UseHostActionsOptions {
  sessionId: string | undefined;
  hostKey: string | null;
  session: Session | null;
  setIsGroomingComplete: (v: boolean) => void;
  newUrl: string;
  setNewUrl: (v: string) => void;
  navigate: (path: string) => void;
  reset: () => void;
  loadHostInviteKey: (sessionId: string) => string | null;
  savedVotesMap: Record<number, string>;
  storyPointProjects: string[];
  sendExtraFields: boolean;
}

/**
 * Extracts all socket-emitting host action callbacks from HostDashboard to keep
 * the component's cognitive complexity within acceptable bounds.
 */
export function useHostActions({
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
}: UseHostActionsOptions) {
  const handleRevealVotes = useCallback(() => {
    if (!sessionId || !hostKey) return;
    getSocket().emit(WS_EVENTS.HOST_REVEAL_VOTES, { sessionId, hostKey });
  }, [sessionId, hostKey]);

  const handleStartSession = useCallback(() => {
    if (!sessionId || !hostKey) return;
    getSocket().emit(WS_EVENTS.HOST_START_SESSION, { sessionId, hostKey });
  }, [sessionId, hostKey]);

  const handleNavigate = useCallback(
    (direction: 'next' | 'prev') => {
      if (!sessionId || !hostKey) return;
      if (direction === 'prev') setIsGroomingComplete(false);
      getSocket().emit(WS_EVENTS.HOST_NAVIGATE, { sessionId, hostKey, direction });
    },
    [sessionId, hostKey, setIsGroomingComplete],
  );

  const handleSkip = useCallback(() => {
    if (!sessionId || !hostKey) return;
    getSocket().emit(WS_EVENTS.HOST_NAVIGATE, {
      sessionId,
      hostKey,
      direction: 'next',
      skip: true,
    });
  }, [sessionId, hostKey]);

  const handleComplete = useCallback(() => {
    setIsGroomingComplete(true);
    fireCompletionConfetti();
    if (sessionId && hostKey) {
      getSocket().emit(WS_EVENTS.GROOMING_COMPLETE, { sessionId, hostKey });
    }
  }, [sessionId, hostKey, setIsGroomingComplete]);

  const handleTeamQueueComplete = useCallback(
    (queueName: string) => {
      fireCompletionConfetti();
      if (sessionId && hostKey) {
        getSocket().emit(WS_EVENTS.TEAM_QUEUE_COMPLETED, { sessionId, hostKey, queueName });
      }
    },
    [sessionId, hostKey],
  );

  const handleJumpTo = useCallback(
    (index: number) => {
      if (!sessionId || !hostKey) return;
      if (session && index < session.currentIndex) setIsGroomingComplete(false);
      getSocket().emit(WS_EVENTS.HOST_NAVIGATE, { sessionId, hostKey, index });
    },
    [sessionId, hostKey, session, setIsGroomingComplete],
  );

  const handleNavigateToIndex = useCallback(
    (index: number, skip = false, teamQueueProgress?: TeamQueueProgressUpdate) => {
      if (!sessionId || !hostKey) return;
      if (session && index < session.currentIndex) setIsGroomingComplete(false);
      getSocket().emit(WS_EVENTS.HOST_NAVIGATE, {
        sessionId,
        hostKey,
        index,
        ...(skip ? { skip: true } : {}),
        ...(teamQueueProgress ? { teamQueueProgress } : {}),
      });
    },
    [sessionId, hostKey, session, setIsGroomingComplete],
  );

  const handleToggleLock = useCallback(() => {
    if (!sessionId || !hostKey || !session) return;
    const locked = !session.isLocked;
    getSocket().emit(WS_EVENTS.HOST_TOGGLE_LOCK, { sessionId, hostKey, locked });
    toast(locked ? 'Session locked — no new participants can join.' : 'Session unlocked.', {
      icon: locked ? '🔒' : '🔓',
      duration: 3000,
    });
  }, [sessionId, hostKey, session]);

  const handleToggleVoting = useCallback(() => {
    if (!sessionId || !hostKey || !session) return;
    const votingEnabled = !session.votingEnabled;
    getSocket().emit(WS_EVENTS.HOST_TOGGLE_VOTING, { sessionId, hostKey, votingEnabled });
    toast(votingEnabled ? 'Voting enabled.' : 'Voting disabled.', {
      icon: votingEnabled ? '✅' : '🚫',
      duration: 3000,
    });
  }, [sessionId, hostKey, session]);

  const handleToggleTeamQueues = useCallback(() => {
    if (!sessionId || !hostKey || !session) return;
    const teamQueuesEnabled = !session.teamQueuesEnabled;
    getSocket().emit(WS_EVENTS.HOST_TOGGLE_TEAM_QUEUES, { sessionId, hostKey, teamQueuesEnabled });
    toast(teamQueuesEnabled ? 'Team queues enabled.' : 'Team queues disabled.', {
      icon: teamQueuesEnabled ? '👥' : '🚫',
      duration: 3000,
    });
  }, [sessionId, hostKey, session]);

  const handleKickParticipant = useCallback(
    (participantId: string) => {
      if (!sessionId || !hostKey) return;
      getSocket().emit(WS_EVENTS.HOST_KICK_PARTICIPANT, { sessionId, hostKey, participantId });
      toast('Participant removed.', { icon: '🚫', duration: 3000 });
    },
    [sessionId, hostKey],
  );

  const handleDeleteUrl = useCallback(
    (index: number) => {
      if (!sessionId || !hostKey) return;
      getSocket().emit(WS_EVENTS.HOST_REMOVE_URL, { sessionId, hostKey, index });
    },
    [sessionId, hostKey],
  );

  const handleReorderUrls = useCallback(
    (fromIndex: number, toIndex: number) => {
      if (!sessionId || !hostKey) return;
      getSocket().emit(WS_EVENTS.HOST_REORDER_URLS, { sessionId, hostKey, fromIndex, toIndex });
    },
    [sessionId, hostKey],
  );

  const handleResetVotes = useCallback(() => {
    if (!sessionId || !hostKey) return;
    getSocket().emit(WS_EVENTS.HOST_RESET_VOTES, { sessionId, hostKey });
  }, [sessionId, hostKey]);

  const handleSetSavedVote = useCallback(
    (urlIndex: number, value: string) => {
      if (!sessionId || !hostKey) return;
      getSocket().emit(WS_EVENTS.HOST_SET_SAVED_VOTE, { sessionId, hostKey, urlIndex, value });
    },
    [sessionId, hostKey],
  );

  const handleResetSavedVote = useCallback(
    (urlIndex: number) => {
      if (!sessionId || !hostKey) return;
      getSocket().emit(WS_EVENTS.HOST_RESET_SAVED_VOTE, { sessionId, hostKey, urlIndex });
    },
    [sessionId, hostKey],
  );

  const handleAddUrl = useCallback(() => {
    const trimmed = newUrl.trim();
    if (!trimmed || !sessionId || !hostKey) return;
    if (!isValidHttpUrl(trimmed)) {
      toast.error('Please enter a valid http/https URL');
      return;
    }
    const jiraIssue = parseJiraUrl(trimmed);
    if (
      jiraIssue &&
      session?.urls.some((url) => parseJiraUrl(url)?.key === jiraIssue.key)
    ) {
      toast.error(`Jira issue ${jiraIssue.key} is already in the queue`);
      return;
    }
    getSocket().emit(WS_EVENTS.HOST_ADD_URL, { sessionId, hostKey, url: trimmed });
    setNewUrl('');
  }, [newUrl, sessionId, hostKey, session?.urls, setNewUrl]);

  const handleEndSession = useCallback(() => {
    if (!sessionId || !hostKey) return;
    getSocket().emit(WS_EVENTS.HOST_END_SESSION, { sessionId, hostKey });
    reset();
    navigate('/');
  }, [sessionId, hostKey, navigate, reset]);

  const handleCopyCoHostInviteLink = useCallback(async () => {
    if (!sessionId) return;
    const inviteKey = loadHostInviteKey(sessionId);
    if (!inviteKey) {
      toast.error('Host invite key not found.');
      return;
    }
    const link = `${globalThis.location.origin}/host/join/${sessionId}?key=${inviteKey}`;
    try {
      await navigator.clipboard.writeText(link);
      toast.success('Co-host invite link copied to clipboard.', { icon: '🔗' });
    } catch {
      toast.error('Failed to copy link.');
    }
  }, [sessionId, loadHostInviteKey]);

  const handleCopyToJira = useCallback(
    async (urlIndex: number) => {
      const url = session?.urls[urlIndex];
      const jiraInfo =
        url && isStoryPointConfigured(url, storyPointProjects) ? parseJiraUrl(url) : null;
      const points = savedVotesMap[urlIndex];
      if (!jiraInfo || points === undefined || Number.isNaN(Number(points))) {
        toast.error('No numeric story point to copy, or not a Jira URL.');
        return;
      }
      if (!hostKey || !sessionId) {
        toast.error('No host credentials available.');
        return;
      }
      try {
        await updateJiraStoryPoints(
          jiraInfo.key,
          Number(points),
          hostKey,
          sessionId,
          jiraInfo.baseUrl,
          !sendExtraFields,
        );
        toast.success(`Story point ${points} saved to ${jiraInfo.key}`);
      } catch {
        toast.error('Failed to update Jira story point. Check Jira integration settings.');
      }
    },
    [session, savedVotesMap, storyPointProjects, sendExtraFields, hostKey, sessionId],
  );

  return {
    handleRevealVotes,
    handleStartSession,
    handleNavigate,
    handleSkip,
    handleComplete,
    handleTeamQueueComplete,
    handleJumpTo,
    handleNavigateToIndex,
    handleToggleLock,
    handleToggleVoting,
    handleToggleTeamQueues,
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
  };
}
