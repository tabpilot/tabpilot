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
  readonly completed?: boolean;
  readonly disabled?: boolean;
  readonly className?: string;
}

export function NavigationControls({
  currentIndex,
  total,
  onPrevious,
  onNext,
  onSkip,
  onComplete,
  completed = false,
  disabled = false,
  className,
}: NavigationControlsProps) {
  const isFirst = currentIndex === 0;
  const isLast = currentIndex === total - 1;
  const progress = total > 0 ? ((currentIndex + 1) / total) * 100 : 0;

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

      {/* Progress bar */}
      <div className="flex items-center gap-3">
        <span className="text-xs text-zinc-500 font-medium w-12 flex-shrink-0">
          {currentIndex + 1} / {total}
        </span>
        <div className="flex-1 h-1.5 bg-zinc-200 dark:bg-zinc-800 rounded-full overflow-hidden">
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
          disabled={disabled || isFirst}
        >
          <ChevronLeft className="h-5 w-5" />
          Previous
        </Button>

        <div className="flex-shrink-0 text-center px-4">
          <div className="text-sm font-bold text-zinc-800 dark:text-zinc-200">
            Ticket {currentIndex + 1}
          </div>
          <div className="text-xs text-zinc-500">of {total}</div>
        </div>

        {(() => {
          if (!isLast) {
            return (
              <div className="flex-1 flex gap-2">
                <Button
                  variant="outline"
                  className={cn(
                    'flex-1 h-11 gap-1.5 border-zinc-300 dark:border-zinc-700',
                    'hover:border-amber-400 dark:hover:border-amber-500 hover:text-amber-600 dark:hover:text-amber-400',
                    'disabled:opacity-30',
                  )}
                  onClick={onSkip}
                  disabled={disabled}
                >
                  <ChevronsRight className="h-4 w-4" />
                  Skip
                </Button>
                <Button
                  variant="glow"
                  className={cn('flex-1 h-11 gap-2', 'disabled:opacity-30 disabled:shadow-none')}
                  onClick={onNext}
                  disabled={disabled}
                >
                  Next
                  <ChevronRight className="h-5 w-5" />
                </Button>
              </div>
            );
          }
          if (completed) {
            return (
              <div className="flex-1 h-11 flex items-center justify-center gap-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-sm font-semibold">
                <CheckCircle className="h-4 w-4" />
                Completed
              </div>
            );
          }
          return (
            <Button
              variant="glow"
              className="flex-1 h-11 gap-2 disabled:opacity-30 disabled:shadow-none"
              onClick={onComplete}
              disabled={disabled}
            >
              <CheckCircle className="h-5 w-5" />
              Complete
            </Button>
          );
        })()}
      </div>
    </div>
  );
}
