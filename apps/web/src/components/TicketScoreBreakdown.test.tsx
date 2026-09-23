import type { TicketScore } from '@tabpilot/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockUseTicketScore = vi.fn();

vi.mock('@/hooks/useTicketScore', () => ({
  useTicketScore: (...args: unknown[]) => mockUseTicketScore(...args),
}));

vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: {
    div: ({
      children,
      className,
    }: React.HTMLAttributes<HTMLDivElement> & {
      initial?: unknown;
      animate?: unknown;
      exit?: unknown;
      transition?: unknown;
    }) => <div className={className}>{children}</div>,
  },
}));

import { TicketScoreBreakdown } from './TicketScoreBreakdown';

const MOCK_SCORE: TicketScore = {
  overall: 72,
  dimensions: {
    clarity: { score: 80, feedback: 'Clear requirements.' },
    completeness: { score: 65, feedback: 'Missing edge cases.' },
    actionability: { score: 75, feedback: 'Mostly actionable.' },
    testability: { score: 60, feedback: 'No acceptance criteria.' },
    formatting: { score: 85, feedback: 'Well structured.' },
    context: { score: 67, feedback: 'Needs more background.' },
  },
};

describe('TicketScoreBreakdown', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('renders nothing when score is not available', () => {
    mockUseTicketScore.mockReturnValue({ data: null, isLoading: false, error: null });
    const { container } = render(<TicketScoreBreakdown url="https://example.com" />);
    expect(container.firstChild).toBeNull();
  });

  it('shows loading state while fetching', () => {
    mockUseTicketScore.mockReturnValue({ data: null, isLoading: true, error: null });
    render(<TicketScoreBreakdown url="https://example.com" />);
    expect(screen.getByText('Generating AI review…')).toBeTruthy();
  });

  it('renders nothing on error', () => {
    mockUseTicketScore.mockReturnValue({
      data: null,
      isLoading: false,
      error: new Error('fail'),
    });
    const { container } = render(<TicketScoreBreakdown url="https://example.com" />);
    expect(container.firstChild).toBeNull();
  });

  it('displays the overall score', () => {
    mockUseTicketScore.mockReturnValue({
      data: MOCK_SCORE,
      isLoading: false,
      error: null,
    });
    render(<TicketScoreBreakdown url="https://example.atlassian.net/browse/PROJ-1" />);
    expect(screen.getByText('72')).toBeTruthy();
    expect(screen.getByText('Ticket Quality')).toBeTruthy();
  });

  it('shows all six dimension labels in the strip', () => {
    mockUseTicketScore.mockReturnValue({
      data: MOCK_SCORE,
      isLoading: false,
      error: null,
    });
    render(<TicketScoreBreakdown url="https://example.atlassian.net/browse/PROJ-1" />);
    for (const label of ['CLR', 'CMP', 'ACT', 'TST', 'FMT', 'CTX']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it('shows dimension details when expanded (default)', () => {
    mockUseTicketScore.mockReturnValue({
      data: MOCK_SCORE,
      isLoading: false,
      error: null,
    });
    render(<TicketScoreBreakdown url="https://example.atlassian.net/browse/PROJ-1" />);
    expect(screen.getByText('Clarity')).toBeTruthy();
    expect(screen.getByText('Clear requirements.')).toBeTruthy();
    expect(screen.getByText('Completeness')).toBeTruthy();
  });

  it('collapses and expands when collapsible (canRegenerate)', async () => {
    mockUseTicketScore.mockReturnValue({
      data: MOCK_SCORE,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
      isFetching: false,
    });
    render(
      <TicketScoreBreakdown url="https://example.atlassian.net/browse/PROJ-1" canRegenerate />,
    );

    expect(screen.getByText('Clarity')).toBeTruthy();

    await userEvent.click(screen.getByText('Ticket Quality'));
    expect(screen.queryByText('Clarity')).toBeNull();

    await userEvent.click(screen.getByText('Ticket Quality'));
    expect(screen.getByText('Clarity')).toBeTruthy();
  });

  it('persists collapsed state to localStorage', async () => {
    mockUseTicketScore.mockReturnValue({
      data: MOCK_SCORE,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
      isFetching: false,
    });
    render(
      <TicketScoreBreakdown url="https://example.atlassian.net/browse/PROJ-1" canRegenerate />,
    );

    await userEvent.click(screen.getByText('Ticket Quality'));
    expect(localStorage.getItem('tabpilot_score_collapsed')).toBe('1');

    await userEvent.click(screen.getByText('Ticket Quality'));
    expect(localStorage.getItem('tabpilot_score_collapsed')).toBeNull();
  });

  it('shows regenerate button when canRegenerate is true', () => {
    mockUseTicketScore.mockReturnValue({
      data: MOCK_SCORE,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
      isFetching: false,
    });
    render(
      <TicketScoreBreakdown url="https://example.atlassian.net/browse/PROJ-1" canRegenerate />,
    );
    expect(screen.getByLabelText('Regenerate score')).toBeTruthy();
  });

  it('does not show regenerate button when canRegenerate is false', () => {
    mockUseTicketScore.mockReturnValue({
      data: MOCK_SCORE,
      isLoading: false,
      error: null,
    });
    render(<TicketScoreBreakdown url="https://example.atlassian.net/browse/PROJ-1" />);
    expect(screen.queryByLabelText('Regenerate score')).toBeNull();
  });
});
