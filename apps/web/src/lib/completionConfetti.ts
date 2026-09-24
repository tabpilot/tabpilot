import confetti from 'canvas-confetti';

export function fireCompletionConfetti() {
  confetti({
    particleCount: 160,
    spread: 80,
    origin: { y: 0.7 },
    colors: ['#6366f1', '#8b5cf6', '#06b6d4', '#10b981', '#f59e0b'],
  });
}
