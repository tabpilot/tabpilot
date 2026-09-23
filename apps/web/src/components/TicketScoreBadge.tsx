import { useCachedTicketScore } from '@/hooks/useTicketScore';
import { cn } from '@/lib/utils';

function scoreColor(score: number): string {
  if (score >= 70) return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
  if (score >= 40) return 'bg-amber-500/20 text-amber-400 border-amber-500/30';
  return 'bg-red-500/20 text-red-400 border-red-500/30';
}

interface TicketScoreBadgeProps {
  readonly url: string;
}

export function TicketScoreBadge({ url }: TicketScoreBadgeProps) {
  const score = useCachedTicketScore(url);

  if (!score) return null;

  return (
    <span
      className={cn(
        'flex-shrink-0 min-w-[28px] h-5 px-1.5 flex items-center justify-center rounded-md text-xs font-bold border',
        scoreColor(score.overall),
      )}
      title={`Ticket quality: ${score.overall}/100`}
    >
      {score.overall}
    </span>
  );
}
