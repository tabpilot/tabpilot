import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const mockUseCachedTicketScore = vi.fn();

vi.mock('@/hooks/useTicketScore', () => ({
  useCachedTicketScore: (...args: unknown[]) => mockUseCachedTicketScore(...args),
}));

import { TicketScoreBadge } from './TicketScoreBadge';

describe('TicketScoreBadge', () => {
  it('renders nothing when no cached score exists', () => {
    mockUseCachedTicketScore.mockReturnValue(undefined);
    const { container } = render(<TicketScoreBadge url="https://example.com" />);
    expect(container.firstChild).toBeNull();
  });

  it('displays the overall score when cached', () => {
    mockUseCachedTicketScore.mockReturnValue({ overall: 82, dimensions: {} });
    render(<TicketScoreBadge url="https://example.atlassian.net/browse/PROJ-1" />);
    expect(screen.getByText('82')).toBeTruthy();
  });

  it.each([
    { score: 75, expectedColor: 'emerald', label: '>= 70' },
    { score: 55, expectedColor: 'amber', label: '40–69' },
    { score: 25, expectedColor: 'red', label: '< 40' },
  ])(
    'applies $expectedColor color for scores $label (score=$score)',
    ({ score, expectedColor }) => {
      mockUseCachedTicketScore.mockReturnValue({ overall: score, dimensions: {} });
      render(<TicketScoreBadge url="https://example.atlassian.net/browse/PROJ-1" />);
      const badge = screen.getByText(String(score));
      expect(badge.className).toContain(expectedColor);
    },
  );
});
