import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UrlQueue } from './UrlQueue';

vi.mock('@/hooks/useJiraIssue', () => ({ useJiraIssue: () => ({ data: null, isLoading: false }) }));
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
