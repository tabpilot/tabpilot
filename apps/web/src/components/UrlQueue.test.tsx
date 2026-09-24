import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UrlQueue } from './UrlQueue';

const jiraTeams = vi.hoisted(() => ({
  byUrl: new Map<string, { team: string | null; isJira: boolean; isLoading: boolean }>(),
  issue: null as {
    key: string;
    summary: string;
    status: string;
    issueType: string;
    team?: string | null;
  } | null,
}));

vi.mock('@/hooks/useJiraIssue', () => ({
  useJiraIssue: (url: string) => ({
    data: url.includes('atlassian') ? jiraTeams.issue : null,
    isLoading: false,
  }),
  useJiraIssueTeams: (urls: string[]) =>
    urls.map((url) => jiraTeams.byUrl.get(url) ?? { team: null, isJira: false, isLoading: false }),
}));
vi.mock('@/hooks/useUrlTitle', () => ({ useUrlTitle: () => ({ data: null, isLoading: false }) }));
vi.mock('framer-motion', () => ({
  motion: { div: ({ children }: React.HTMLAttributes<HTMLDivElement>) => <div>{children}</div> },
  DragOverlay: ({ children }: React.HTMLAttributes<HTMLDivElement>) => <div>{children}</div>,
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@dnd-kit/core', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@dnd-kit/core')>();
  return { ...mod, DragOverlay: ({ children }: { children: React.ReactNode }) => <>{children}</> };
});

const URLS = [
  'https://example.atlassian.net/browse/PROJ-1',
  'https://example.atlassian.net/browse/PROJ-2',
  'https://example.com/current',
];

beforeEach(() => {
  jiraTeams.byUrl = new Map();
  jiraTeams.issue = null;
});

describe('UrlQueue — story point controls (host view)', () => {
  const onSetVote = vi.fn();
  const onResetVote = vi.fn();
  const onCopyToJira = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function renderQueue(overrides: Partial<React.ComponentProps<typeof UrlQueue>> = {}) {
    return render(
      <UrlQueue
        urls={URLS}
        currentIndex={2}
        isHost
        savedVotes={{ 0: '5', 1: '8' }}
        onSetVote={onSetVote}
        onResetVote={onResetVote}
        onCopyToJira={onCopyToJira}
        storyPointProjects={['PROJ']}
        {...overrides}
      />,
    );
  }

  it('shows saved vote badges for past tickets', () => {
    renderQueue();
    expect(screen.getByTitle('Story point: 5')).toBeInTheDocument();
    expect(screen.getByTitle('Story point: 8')).toBeInTheDocument();
  });

  it('shows pencil edit buttons for past tickets (host)', async () => {
    renderQueue();
    const editBtns = screen.getAllByTitle('Set story point');
    expect(editBtns.length).toBeGreaterThanOrEqual(2);
  });

  it('shows reset buttons only when a saved vote exists', () => {
    renderQueue();
    const resetBtns = screen.getAllByTitle('Reset story point');
    expect(resetBtns).toHaveLength(2);
  });

  it('clicking reset calls onResetVote with the correct index', async () => {
    renderQueue();
    const [firstReset] = screen.getAllByTitle('Reset story point');
    await userEvent.click(firstReset);
    expect(onResetVote).toHaveBeenCalledWith(0);
  });

  it('clicking pencil opens inline edit input', async () => {
    renderQueue();
    const [firstEdit] = screen.getAllByTitle('Set story point');
    await userEvent.click(firstEdit);
    const inputs = screen.getAllByLabelText('Edit story point');
    expect(inputs.length).toBeGreaterThanOrEqual(1);
  });

  it('entering a value and pressing Enter calls onSetVote', async () => {
    renderQueue();
    const [firstEdit] = screen.getAllByTitle('Set story point');
    await userEvent.click(firstEdit);
    const [input] = screen.getAllByLabelText('Edit story point');
    await userEvent.clear(input);
    await userEvent.type(input, '13');
    await userEvent.keyboard('{Enter}');
    expect(onSetVote).toHaveBeenCalledWith(0, '13');
  });

  it('clicking the cancel button closes the edit without calling onSetVote', async () => {
    renderQueue();
    const [firstEdit] = screen.getAllByTitle('Set story point');
    await userEvent.click(firstEdit);
    const cancelBtn = screen.getAllByLabelText('Cancel edit')[0];
    await userEvent.click(cancelBtn);
    expect(onSetVote).not.toHaveBeenCalled();
  });

  it('shows Jira send button for configured projects with a saved vote', async () => {
    renderQueue();
    await waitFor(() => {
      const jiraBtns = screen.getAllByTitle('Copy story point to Jira');
      expect(jiraBtns.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('does not show Jira send button when project is not in storyPointProjects', () => {
    renderQueue({ storyPointProjects: [] });
    expect(screen.queryByTitle('Copy story point to Jira')).not.toBeInTheDocument();
  });

  it('clicking the Jira send button calls onCopyToJira with the correct index', async () => {
    renderQueue();
    const [firstJira] = screen.getAllByTitle('Copy story point to Jira');
    await userEvent.click(firstJira);
    expect(onCopyToJira).toHaveBeenCalledWith(0);
  });

  it('does not show story point controls for non-host view', () => {
    renderQueue({ isHost: false });
    expect(screen.queryByTitle('Set story point')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Reset story point')).not.toBeInTheDocument();
  });

  it('shows skip icon instead of checkmark for skipped tickets', () => {
    renderQueue({ savedVotes: { 0: 'skipped', 1: '8' } });
    expect(screen.getByLabelText('Skipped')).toBeInTheDocument();
  });

  it('does not show story point badge for skipped tickets', () => {
    renderQueue({ savedVotes: { 0: 'skipped' } });
    expect(screen.queryByTitle('Story point: skipped')).not.toBeInTheDocument();
  });
});

describe('UrlQueue — team filter', () => {
  const urls = [
    'https://example.atlassian.net/browse/PROJ-1',
    'https://example.atlassian.net/browse/PROJ-2',
    'https://example.atlassian.net/browse/PROJ-3',
    'https://example.com/notes',
  ];

  beforeEach(() => {
    jiraTeams.byUrl = new Map([
      [urls[0], { team: 'Platform', isJira: true, isLoading: false }],
      [urls[1], { team: 'Platform', isJira: true, isLoading: false }],
      [urls[2], { team: null, isJira: true, isLoading: false }],
      [urls[3], { team: null, isJira: false, isLoading: false }],
    ]);
    jiraTeams.issue = null;
  });

  function renderFiltered(overrides: Partial<React.ComponentProps<typeof UrlQueue>> = {}) {
    return render(
      <UrlQueue urls={urls} currentIndex={0} isHost onJumpTo={vi.fn()} {...overrides} />,
    );
  }

  it('lists teams and shows the team name on Jira rows', () => {
    renderFiltered();
    expect(screen.getByRole('tablist', { name: 'Filter tickets by team' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Platform' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'No team' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'All teams' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('PROJ-3')).toBeInTheDocument();
    expect(screen.getByText('example.com')).toBeInTheDocument();
  });

  it('shows only tickets for the selected team', async () => {
    renderFiltered();
    await userEvent.click(screen.getByRole('tab', { name: 'Platform' }));
    expect(screen.getByText('PROJ-1')).toBeInTheDocument();
    expect(screen.getByText('PROJ-2')).toBeInTheDocument();
    expect(screen.queryByText('PROJ-3')).not.toBeInTheDocument();
    expect(screen.queryByText('example.com')).not.toBeInTheDocument();
    expect(screen.getByText('2 shown')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Platform' })).toHaveAttribute('aria-selected', 'true');
  });

  it('shows Jira tickets that have no team', async () => {
    renderFiltered();
    await userEvent.click(screen.getByRole('tab', { name: 'No team' }));
    expect(screen.queryByText('PROJ-1')).not.toBeInTheDocument();
    expect(screen.getByText('PROJ-3')).toBeInTheDocument();
    expect(screen.queryByText('example.com')).not.toBeInTheDocument();
    expect(screen.getByText('1 shown')).toBeInTheDocument();
  });

  it('hides the No team tab when every Jira has a team', () => {
    jiraTeams.byUrl = new Map([
      [urls[0], { team: 'Platform', isJira: true, isLoading: false }],
      [urls[1], { team: 'Mobile', isJira: true, isLoading: false }],
      [urls[2], { team: 'Platform', isJira: true, isLoading: false }],
      [urls[3], { team: null, isJira: false, isLoading: false }],
    ]);
    renderFiltered();
    expect(screen.getByRole('tab', { name: 'Platform' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Mobile' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'No team' })).not.toBeInTheDocument();
  });

  it('does not treat a loading Jira as having no team', () => {
    jiraTeams.byUrl = new Map([
      [urls[0], { team: 'Platform', isJira: true, isLoading: false }],
      [urls[1], { team: null, isJira: true, isLoading: true }],
      [urls[2], { team: 'Platform', isJira: true, isLoading: false }],
      [urls[3], { team: null, isJira: false, isLoading: false }],
    ]);
    renderFiltered();
    expect(screen.queryByRole('tab', { name: 'No team' })).not.toBeInTheDocument();
  });

  it('moves between team tabs with the arrow keys', async () => {
    renderFiltered();
    const allTeams = screen.getByRole('tab', { name: 'All teams' });
    allTeams.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Platform' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('2 shown')).toBeInTheDocument();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'No team' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('PROJ-3')).toBeInTheDocument();
    expect(screen.queryByText('PROJ-1')).not.toBeInTheDocument();
  });

  it('hides drag handles while a team filter is active', async () => {
    renderFiltered({ isEditMode: true });
    expect(screen.getAllByLabelText('Drag to reorder').length).toBe(urls.length);
    await userEvent.click(screen.getByRole('tab', { name: 'Platform' }));
    expect(screen.queryAllByLabelText('Drag to reorder')).toHaveLength(0);
  });

  it('shows the team name on a Jira row', () => {
    jiraTeams.issue = {
      key: 'PROJ-1',
      summary: 'Fix bug',
      status: 'Open',
      issueType: 'Bug',
      team: 'Platform',
    };
    renderFiltered();
    expect(screen.getAllByTitle('Platform').length).toBeGreaterThan(0);
  });

  it('does not offer a team filter when no ticket has a team', () => {
    jiraTeams.byUrl = new Map();
    jiraTeams.issue = null;
    renderFiltered();
    expect(
      screen.queryByRole('tablist', { name: 'Filter tickets by team' }),
    ).not.toBeInTheDocument();
  });
});

describe('UrlQueue — mark-done badge click (host view)', () => {
  const onSetVote = vi.fn();
  const onResetVote = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // 3 URLs, currentIndex=1 → index 0 is past, index 2 is future
  function renderMarkDone(overrides: Partial<React.ComponentProps<typeof UrlQueue>> = {}) {
    return render(
      <UrlQueue
        urls={['https://a.com', 'https://b.com', 'https://c.com']}
        currentIndex={1}
        isHost
        onSetVote={onSetVote}
        onResetVote={onResetVote}
        {...overrides}
      />,
    );
  }

  it('hides drag handles when not in edit mode (default)', () => {
    renderMarkDone();
    expect(screen.queryAllByLabelText('Drag to reorder')).toHaveLength(0);
  });

  it('shows drag handles for all rows when isEditMode is true', () => {
    renderMarkDone({ isEditMode: true });
    const handles = screen.getAllByLabelText('Drag to reorder');
    expect(handles.length).toBe(3);
  });

  it('clicking the index badge on a future ticket calls onSetVote with "skipped"', async () => {
    renderMarkDone();
    // Future ticket is index 2 (3rd badge button)
    const badges = screen.getAllByRole('button', { name: /mark ticket \d+ as done/i });
    // badge for the future ticket
    await userEvent.click(badges[badges.length - 1]);
    expect(onSetVote).toHaveBeenCalledWith(2, 'skipped');
  });

  it('clicking the badge on a future ticket already marked skipped calls onResetVote', async () => {
    renderMarkDone({ savedVotes: { 2: 'skipped' } });
    const badges = screen.getAllByRole('button', { name: /unmark ticket \d+ as done/i });
    await userEvent.click(badges[0]);
    expect(onResetVote).toHaveBeenCalledWith(2);
  });

  it('does not render a clickable badge on the current ticket', () => {
    renderMarkDone();
    // Only future (and past with no vote) should have clickable badges
    // current (index 1) should NOT have a mark-done button
    const markDoneBtns = screen.queryAllByRole('button', { name: /mark ticket 2 as done/i });
    expect(markDoneBtns).toHaveLength(0);
  });

  it('does not render a clickable badge on a future ticket that already has a real vote', () => {
    renderMarkDone({ savedVotes: { 2: '5' } });
    const markDoneBtns = screen.queryAllByRole('button', { name: /mark ticket 3 as done/i });
    expect(markDoneBtns).toHaveLength(0);
  });

  it('shows pre-done styling on a future ticket marked as skipped', () => {
    renderMarkDone({ savedVotes: { 2: 'skipped' } });
    expect(screen.getAllByLabelText('Skipped').length).toBeGreaterThan(0);
  });
});
