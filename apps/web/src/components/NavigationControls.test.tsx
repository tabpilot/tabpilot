import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { NavigationControls } from './NavigationControls';

const baseProps = {
  currentIndex: 0,
  total: 3,
  onPrevious: vi.fn(),
  onNext: vi.fn(),
  onSkip: vi.fn(),
  onComplete: vi.fn(),
};

describe('NavigationControls', () => {
  it('shows Previous and Next buttons on a middle page', () => {
    render(<NavigationControls {...baseProps} currentIndex={1} />);
    expect(screen.getByRole('button', { name: /previous/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /next/i })).toBeInTheDocument();
  });

  it('disables Previous on the first item', () => {
    render(<NavigationControls {...baseProps} currentIndex={0} />);
    expect(screen.getByRole('button', { name: /previous/i })).toBeDisabled();
  });

  it('shows Complete button on the last item when not completed', () => {
    render(<NavigationControls {...baseProps} currentIndex={2} total={3} completed={false} />);
    expect(screen.getByRole('button', { name: /complete/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /next/i })).not.toBeInTheDocument();
  });

  it('shows Completed banner on the last item when completed', () => {
    render(<NavigationControls {...baseProps} currentIndex={2} total={3} completed={true} />);
    expect(screen.getByText('Completed')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /complete/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /next/i })).not.toBeInTheDocument();
  });

  it('calls onNext when Next is clicked', async () => {
    const onNext = vi.fn();
    render(<NavigationControls {...baseProps} currentIndex={0} onNext={onNext} />);
    await userEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('calls onComplete when Complete is clicked', async () => {
    const onComplete = vi.fn();
    render(
      <NavigationControls {...baseProps} currentIndex={2} total={3} onComplete={onComplete} />,
    );
    await userEvent.click(screen.getByRole('button', { name: /complete/i }));
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('uses the primary Next action at the end of a team queue within the full session', async () => {
    const onFinishQueue = vi.fn();
    render(
      <NavigationControls
        {...baseProps}
        currentIndex={1}
        total={5}
        showFinishQueue
        queuePosition={2}
        queueTotal={3}
        onFinishQueue={onFinishQueue}
        completeOnLast={false}
      />,
    );

    expect(screen.getByText('3 / 3')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /finish queue/i }));
    expect(onFinishQueue).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: /^next$/i })).not.toBeInTheDocument();
  });

  it('shows completed queue state after the queue cursor reaches its end', () => {
    render(
      <NavigationControls
        {...baseProps}
        currentIndex={2}
        showFinishQueue
        onFinishQueue={vi.fn()}
        queueCompleted
        queueName="Alpha"
        completeOnLast={false}
      />,
    );

    expect(screen.getByText('Alpha queue complete')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /queue complete/i })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /finish queue/i })).not.toBeInTheDocument();
  });

  it('disables buttons when disabled prop is true', () => {
    render(<NavigationControls {...baseProps} currentIndex={1} disabled={true} />);
    expect(screen.getByRole('button', { name: /previous/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled();
  });

  it('shows the completion banner when completed and on last page', () => {
    render(<NavigationControls {...baseProps} currentIndex={2} total={3} completed={true} />);
    expect(screen.getByText('All tickets groomed!')).toBeInTheDocument();
  });

  it('displays the correct progress fraction', () => {
    render(<NavigationControls {...baseProps} currentIndex={1} total={3} />);
    expect(screen.getByText('2 / 3')).toBeInTheDocument();
  });

  it('shows Skip button when not on the last item', () => {
    render(<NavigationControls {...baseProps} currentIndex={0} total={3} />);
    expect(screen.getByRole('button', { name: /skip/i })).toBeInTheDocument();
  });

  it('shows Skip button on the last item (allows marking single/last ticket as done)', () => {
    render(<NavigationControls {...baseProps} currentIndex={2} total={3} />);
    expect(screen.getByRole('button', { name: /skip/i })).toBeInTheDocument();
  });

  it('disables Skip button on the last item when already completed', () => {
    render(<NavigationControls {...baseProps} currentIndex={2} total={3} completed={true} />);
    expect(screen.getByRole('button', { name: /skip/i })).toBeDisabled();
  });

  it('calls onSkip when Skip is clicked', async () => {
    const onSkip = vi.fn();
    render(<NavigationControls {...baseProps} currentIndex={0} onSkip={onSkip} />);
    await userEvent.click(screen.getByRole('button', { name: /skip/i }));
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it('disables Skip button when disabled prop is true', () => {
    render(<NavigationControls {...baseProps} currentIndex={0} disabled={true} />);
    expect(screen.getByRole('button', { name: /skip/i })).toBeDisabled();
  });
});
