import type { TicketScore, TicketScoreDimension } from '@tabpilot/shared';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, ChevronUp, Loader2, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { useTicketScore } from '@/hooks/useTicketScore';
import apiClient from '@/lib/api';
import { parseJiraUrl } from '@/lib/jira';
import { cn } from '@/lib/utils';

const DIMENSIONS = [
  'clarity',
  'completeness',
  'actionability',
  'testability',
  'formatting',
  'context',
] as const;

const DIMENSION_LABELS: Record<string, string> = {
  clarity: 'Clarity',
  completeness: 'Completeness',
  actionability: 'Actionability',
  testability: 'Testability',
  formatting: 'Formatting',
  context: 'Context',
};

const DIMENSION_SHORT: Record<string, string> = {
  clarity: 'CLR',
  completeness: 'CMP',
  actionability: 'ACT',
  testability: 'TST',
  formatting: 'FMT',
  context: 'CTX',
};

function segmentColor(score: number): string {
  if (score >= 70) return 'bg-emerald-500';
  if (score >= 40) return 'bg-amber-500';
  return 'bg-red-500';
}

function segmentColorMuted(score: number): string {
  if (score >= 70) return 'bg-emerald-500/30';
  if (score >= 40) return 'bg-amber-500/30';
  return 'bg-red-500/30';
}

function overallColor(score: number): string {
  if (score >= 70) return 'text-emerald-400';
  if (score >= 40) return 'text-amber-400';
  return 'text-red-400';
}

function overallBg(score: number): string {
  if (score >= 70) return 'bg-emerald-500/15 border-emerald-500/30';
  if (score >= 40) return 'bg-amber-500/15 border-amber-500/30';
  return 'bg-red-500/15 border-red-500/30';
}

function ComparisonStrip({ dims }: { readonly dims: TicketScore['dimensions'] }) {
  return (
    <div className="space-y-1">
      <div className="flex gap-0.5 h-2 rounded-full overflow-hidden">
        {DIMENSIONS.map((key) => {
          const dim = dims[key];
          return (
            <div
              key={key}
              className={cn('flex-1 relative group', segmentColorMuted(dim.score))}
              title={`${DIMENSION_LABELS[key]}: ${dim.score}`}
            >
              <div
                className={cn(
                  'absolute inset-y-0 left-0 transition-all duration-700',
                  segmentColor(dim.score),
                )}
                style={{ width: `${dim.score}%` }}
              />
            </div>
          );
        })}
      </div>
      <div className="flex gap-0.5">
        {DIMENSIONS.map((key) => {
          const dim = dims[key];
          return (
            <div key={key} className="flex-1 flex items-center justify-center">
              <span className={cn('text-[10px] font-bold', overallColor(dim.score))}>
                {DIMENSION_SHORT[key]}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DimensionDetail({
  name,
  dim,
}: {
  readonly name: string;
  readonly dim: TicketScoreDimension;
}) {
  return (
    <div className="flex gap-2 items-start">
      <span
        className={cn(
          'flex-shrink-0 w-8 h-5 flex items-center justify-center rounded text-xs font-bold border',
          dim.score >= 70 && 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400',
          dim.score >= 40 && dim.score < 70 && 'bg-amber-500/15 border-amber-500/30 text-amber-400',
          dim.score < 40 && 'bg-red-500/15 border-red-500/30 text-red-400',
        )}
      >
        {dim.score}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-zinc-300">{DIMENSION_LABELS[name] ?? name}</p>
        <p className="text-xs text-zinc-400 leading-normal">{dim.feedback}</p>
      </div>
    </div>
  );
}

const COLLAPSED_KEY = 'tabpilot_score_collapsed';

function loadCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

function saveCollapsed(collapsed: boolean) {
  try {
    if (collapsed) localStorage.setItem(COLLAPSED_KEY, '1');
    else localStorage.removeItem(COLLAPSED_KEY);
  } catch {}
}

interface BreakdownContentProps {
  readonly score: TicketScore;
  readonly onRegenerate?: () => void;
  readonly isRegenerating?: boolean;
  readonly collapsible?: boolean;
}

function BreakdownContent({
  score,
  onRegenerate,
  isRegenerating,
  collapsible,
}: BreakdownContentProps) {
  const [collapsed, setCollapsed] = useState(collapsible ? loadCollapsed() : false);
  const expanded = !collapsed;

  function toggle() {
    if (!collapsible) return;
    const next = !collapsed;
    setCollapsed(next);
    saveCollapsed(next);
  }

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 overflow-hidden">
      {/* Header */}
      <button
        type="button"
        onClick={toggle}
        className={cn(
          'w-full flex items-center justify-between px-3 py-2',
          collapsible ? 'cursor-pointer' : 'cursor-default',
        )}
      >
        <div className="flex items-center gap-3">
          <span className="text-xs font-medium text-zinc-400">Ticket Quality</span>
          <span
            className={cn(
              'px-2 py-0.5 rounded-full text-xs font-bold border',
              overallBg(score.overall),
              overallColor(score.overall),
            )}
          >
            {score.overall}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {onRegenerate && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRegenerate();
              }}
              disabled={isRegenerating}
              className="p-1 rounded text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 disabled:opacity-40 transition-colors"
              aria-label="Regenerate score"
              title="Regenerate score"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', isRegenerating && 'animate-spin')} />
            </button>
          )}
          {collapsible &&
            (expanded ? (
              <ChevronUp className="h-4 w-4 text-zinc-500" />
            ) : (
              <ChevronDown className="h-4 w-4 text-zinc-500" />
            ))}
        </div>
      </button>

      {/* Comparison strip — always visible */}
      <div className="px-3 pb-2">
        <ComparisonStrip dims={score.dimensions} />
      </div>

      {/* Expanded dimension details */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="details"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 space-y-2 border-t border-zinc-800">
              <div className="pt-2 space-y-2">
                {DIMENSIONS.map((key) => (
                  <DimensionDetail key={key} name={key} dim={score.dimensions[key]} />
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

interface TicketScoreBreakdownProps {
  readonly url: string;
  readonly canRegenerate?: boolean;
}

export function TicketScoreBreakdown({ url, canRegenerate }: TicketScoreBreakdownProps) {
  const { data: score, isLoading, error, refetch, isFetching } = useTicketScore(url);
  const [regenerating, setRegenerating] = useState(false);

  async function handleRegenerate() {
    const info = parseJiraUrl(url);

    setRegenerating(true);
    try {
      if (info) {
        await apiClient.delete(`/ticket-score/${info.key}`);
      } else {
        await apiClient.delete('/ticket-score/url', { params: { url } });
      }
      await refetch();
    } finally {
      setRegenerating(false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-indigo-500/20 bg-indigo-500/5">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-400 flex-shrink-0" />
        <span className="text-xs font-medium text-indigo-300">Generating AI review…</span>
      </div>
    );
  }

  if (error || !score) return null;

  return (
    <BreakdownContent
      score={score}
      onRegenerate={canRegenerate ? handleRegenerate : undefined}
      isRegenerating={regenerating || isFetching}
      collapsible
    />
  );
}
