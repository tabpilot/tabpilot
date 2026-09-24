import { CheckCircle, ChevronLeft, ChevronRight, ChevronsRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface NavigationControlsProps {
  readonly currentIndex: number;
  readonly total: number;
  readonly onPrevious: () => void;
  readonly onNext: () => void;
  readonly onSkip: () => void;
  readonly onComplete: () => void;
  readonly onFinishQueue?: () => void;
  readonly showFinishQueue?: boolean;
  readonly queueCompleted?: boolean;
  readonly queueName?: string;
  readonly queuePosition?: number;
  readonly queueTotal?: number;
  readonly completed?: boolean;
  readonly disabled?: boolean;
  /** When false, the last ticket keeps a disabled Next button instead of Complete. */
  readonly completeOnLast?: boolean;
  readonly className?: string;
}

export function NavigationControls({
  currentIndex,
  total,
  onPrevious,
  onNext,
  onSkip,
  onComplete,
  onFinishQueue,
  showFinishQueue = false,
  queueCompleted = false,
  queueName = 'Team',
  queuePosition,
  queueTotal,
  completed = false,
  disabled = false,
  completeOnLast = true,
  className,
}: NavigationControlsProps) {
  const isFirst = currentIndex === 0;
  const isLast = currentIndex === total - 1;
  const queueMode = showFinishQueue && queuePosition !== undefined && queueTotal !== undefined;
  const position = queueMode ? queuePosition : currentIndex;
  const itemCount = queueMode ? queueTotal : total;
  const isQueueFirst = queueMode ? queuePosition === 0 : isFirst;
  const isQueueLast = queueMode ? queuePosition === queueTotal - 1 : isLast;
  const progress = itemCount > 0 ? ((position + 1) / itemCount) * 100 : 0;

  return (
    <div
      className={cn(
        'flex flex-col gap-3 px-4 py-4',
        'border-t border-zinc-200 dark:border-zinc-800',
        'bg-white/80 dark:bg-zinc-950/80 backdrop-blur-sm',
        className,
      )}
    >
      {/* Completion banner */}
      {completed && (
        <div className="flex items-center justify-center gap-2 py-2 px-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-sm font-medium">
          <CheckCircle className="h-4 w-4 flex-shrink-0" />
          All tickets groomed!
        </div>
      )}
      {showFinishQueue && queueCompleted && (
        <div
          className="flex items-center justify-center gap-2 py-2 px-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-sm font-medium"
          role="status"
        >
          <CheckCircle className="h-4 w-4 flex-shrink-0" />
          {queueName} queue complete
        </div>
      )}
      {showFinishQueue && isQueueLast && !queueCompleted && (
        <p className="text-center text-xs text-zinc-500" aria-live="polite">
          Last ticket in {queueName}. Finish the queue when you’re ready to move on.
        </p>
      )}

      {/* Progress bar */}
      <div className="flex items-center gap-3">
        <span className="text-xs text-zinc-500 font-medium w-12 flex-shrink-0">
          {position + 1} / {itemCount}
        </span>
        <div
          className="flex-1 h-1.5 bg-zinc-200 dark:bg-zinc-800 rounded-full overflow-hidden"
          role="progressbar"
          aria-label={`${queueName} queue progress`}
          aria-valuemin={0}
          aria-valuemax={itemCount}
          aria-valuenow={position + 1}
        >
          <div
            className={cn(
              'h-full rounded-full transition-all duration-500 ease-out',
              completed
                ? 'bg-gradient-to-r from-emerald-500 to-teal-500'
                : 'bg-gradient-to-r from-indigo-500 to-violet-500',
            )}
            style={{ width: `${progress}%` }}
          />
        </div>
        <span className="text-xs text-zinc-500 font-medium w-12 text-right flex-shrink-0">
          {Math.round(progress)}%
        </span>
      </div>
      {/* Navigation buttons */}
      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          className={cn(
            'flex-1 h-11 gap-2 border-zinc-300 dark:border-zinc-700',
            'hover:border-zinc-400 dark:hover:border-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-800',
            'disabled:opacity-30',
          )}
          onClick={onPrevious}
          disabled={disabled || isQueueFirst}
        >
          <ChevronLeft className="h-5 w-5" />
          Previous
        </Button>

        <div className="flex-shrink-0 text-center px-4">
          <div className="text-sm font-bold text-zinc-800 dark:text-zinc-200">
            Ticket {position + 1}
          </div>
          <div className="text-xs text-zinc-500">of {itemCount}</div>
        </div>

        {(() => {
          const skipBtn = (
            <Button
              variant="outline"
              className={cn(
                'flex-1 h-11 gap-1.5 border-zinc-300 dark:border-zinc-700',
                'hover:border-amber-400 dark:hover:border-amber-500 hover:text-amber-600 dark:hover:text-amber-400',
                'disabled:opacity-30',
              )}
              onClick={onSkip}
              disabled={disabled || completed || (showFinishQueue && queueCompleted)}
            >
              <ChevronsRight className="h-4 w-4" />
              Skip
            </Button>
          );

          if (showFinishQueue && isQueueLast && onFinishQueue) {
            return (
              <div className="flex-1 flex gap-2">
                {skipBtn}
                {queueCompleted ? (
                  <Button variant="outline" className="flex-1 h-11 gap-2" disabled>
                    Queue complete
                    <CheckCircle className="h-5 w-5" />
                  </Button>
                ) : (
                  <Button
                    variant="glow"
                    className="flex-1 h-11 gap-2 disabled:opacity-30 disabled:shadow-none"
                    onClick={onFinishQueue}
                    disabled={disabled}
                  >
                    Finish queue
                    <CheckCircle className="h-5 w-5" />
                  </Button>
                )}
              </div>
            );
          }

          if (!isQueueLast || !completeOnLast) {
            return (
              <div className="flex-1 flex gap-2">
                {skipBtn}
                <Button
                  variant="glow"
                  className={cn('flex-1 h-11 gap-2', 'disabled:opacity-30 disabled:shadow-none')}
                  onClick={onNext}
                  disabled={disabled || (isQueueLast && !completeOnLast)}
                >
                  Next
                  <ChevronRight className="h-5 w-5" />
                </Button>
              </div>
            );
          }

          return (
            <div className="flex-1 flex gap-2">
              {skipBtn}
              {completed ? (
                <div className="flex-1 h-11 flex items-center justify-center gap-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-sm font-semibold">
                  <CheckCircle className="h-4 w-4" />
                  Completed
                </div>
              ) : (
                <Button
                  variant="glow"
                  className="flex-1 h-11 gap-2 disabled:opacity-30 disabled:shadow-none"
                  onClick={onComplete}
                  disabled={disabled}
                >
                  <CheckCircle className="h-5 w-5" />
                  Complete
                </Button>
              )}
            </div>
          );
        })()}
      </div>
    </div>
  );
}
