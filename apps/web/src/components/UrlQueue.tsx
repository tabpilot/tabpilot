import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core';
import {
  closestCenter,
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { motion } from 'framer-motion';
import {
  Check,
  ChevronsRight,
  ExternalLink,
  GripVertical,
  Loader2,
  Pencil,
  Send,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as Yup from 'yup';
import { TicketScoreBadge } from '@/components/TicketScoreBadge';
import { type QueueTicketTeam, useJiraIssue, useJiraIssueTeams } from '@/hooks/useJiraIssue';
import { useUrlTitle } from '@/hooks/useUrlTitle';
import { formatJiraTitle, isStoryPointConfigured, parseJiraUrl } from '@/lib/jira';
import { cn, formatUrl, getFaviconUrl, safeUrl, truncateUrl } from '@/lib/utils';

// ─── Story point validation ───────────────────────────────────────────────────

const storyPointSchema = Yup.number()
  .typeError('Must be a positive number')
  .positive('Must be a positive number')
  .required('Required');

function validateStoryPoint(value: string): string {
  try {
    storyPointSchema.validateSync(value === '' ? undefined : Number(value));
    return '';
  } catch (e) {
    return e instanceof Yup.ValidationError ? e.message : 'Invalid';
  }
}

// ─── Title enrichment ─────────────────────────────────────────────────────────

interface UrlTitleProps {
  readonly url: string;
  readonly isCurrent: boolean;
  readonly isPast: boolean;
  readonly scoringEnabled?: boolean;
  readonly isDragOverlay?: boolean;
}

function UrlTitle({ url, isCurrent, isPast, scoringEnabled, isDragOverlay }: UrlTitleProps) {
  // Disable fetching in the drag overlay — React Query returns cached data without a network call.
  const { data: jiraIssue, isLoading: jiraLoading } = useJiraIssue(url, isDragOverlay);
  const { data: pageTitle, isLoading: titleLoading } = useUrlTitle(url, isDragOverlay);

  const title = jiraIssue
    ? formatJiraTitle(jiraIssue)
    : (pageTitle ?? parseJiraUrl(url)?.key ?? formatUrl(url));
  // Only show spinner when we have no text at all to display yet.
  // During reorder/drag all titles are already cached, so this stays false.
  const isLoading = !title && (jiraLoading || titleLoading);

  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-1.5">
        {isLoading && <Loader2 className="h-3 w-3 animate-spin text-zinc-500 flex-shrink-0" />}
        <p
          className={cn(
            'min-w-0 text-xs font-semibold truncate',
            isCurrent && 'text-indigo-300',
            isPast && 'text-zinc-600 line-through',
            !isCurrent && !isPast && 'text-zinc-500 dark:text-zinc-400',
          )}
        >
          {title}
        </p>
        {jiraIssue?.team ? (
          <span
            className="max-w-[8rem] flex-shrink-0 truncate rounded-full border border-zinc-300/70 bg-zinc-200/80 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800"
            title={jiraIssue.team}
          >
            {jiraIssue.team}
          </span>
        ) : null}
        {scoringEnabled && <TicketScoreBadge url={url} />}
      </div>
      <p
        className={cn(
          'text-xs truncate mt-0.5',
          isCurrent && 'text-zinc-400',
          isPast && 'text-zinc-400 dark:text-zinc-700 line-through',
          !isCurrent && !isPast && 'text-zinc-500 dark:text-zinc-600',
        )}
      >
        {truncateUrl(url, 50)}
      </p>
    </div>
  );
}

// ─── Story point controls (host past-ticket view) ────────────────────────────

interface StoryPointControlsProps {
  readonly index: number;
  readonly savedVote?: string;
  readonly isJiraConfigured: boolean;
  readonly onSetVote?: (index: number, value: string) => void;
  readonly onResetVote?: (index: number) => void;
  readonly onCopyToJira?: (index: number) => void;
}

function StoryPointControls({
  index,
  savedVote,
  isJiraConfigured,
  onSetVote,
  onResetVote,
  onCopyToJira,
}: StoryPointControlsProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  function startEdit(e: React.MouseEvent) {
    e.stopPropagation();
    setEditValue(savedVote ?? '');
    setIsEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  }

  function confirm(e?: React.MouseEvent) {
    e?.stopPropagation();
    const trimmed = editValue.trim();
    if (trimmed && !validateStoryPoint(trimmed) && onSetVote) onSetVote(index, trimmed);
    setIsEditing(false);
  }

  function cancel(e?: React.MouseEvent) {
    e?.stopPropagation();
    setIsEditing(false);
  }

  if (isEditing) {
    return (
      <>
        <input
          ref={inputRef}
          type="number"
          min="0"
          step="any"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') confirm();
            if (e.key === 'Escape') cancel();
          }}
          className={cn(
            'w-14 h-6 px-1.5 rounded-md bg-zinc-800 text-zinc-100 text-xs font-bold border outline-none text-center',
            editValue.trim() && validateStoryPoint(editValue.trim())
              ? 'border-red-500/70'
              : 'border-indigo-500/60',
          )}
          aria-label="Edit story point"
          title={validateStoryPoint(editValue.trim()) || undefined}
        />
        <button
          type="button"
          onClick={confirm}
          disabled={!!validateStoryPoint(editValue.trim())}
          className="p-0.5 rounded text-green-400 hover:text-green-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          aria-label="Confirm story point"
        >
          <Check className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={cancel}
          className="p-0.5 rounded text-zinc-500 hover:text-zinc-300 transition-colors"
          aria-label="Cancel edit"
        >
          <X className="h-3 w-3" />
        </button>
      </>
    );
  }

  return (
    <>
      {savedVote !== undefined && savedVote !== 'skipped' && (
        <span
          className="min-w-[28px] h-6 px-1.5 flex items-center justify-center rounded-md bg-zinc-700/60 text-zinc-300 text-xs font-bold border border-zinc-600/50"
          title={`Story point: ${savedVote}`}
        >
          {savedVote}
        </span>
      )}
      <button
        type="button"
        onClick={startEdit}
        className="p-0.5 rounded text-zinc-500 dark:text-zinc-600 hover:text-zinc-300 opacity-0 group-hover:opacity-100 transition-all"
        aria-label="Edit story point"
        title="Set story point"
      >
        <Pencil className="h-3 w-3" />
      </button>
      {savedVote !== undefined && onResetVote && (
        <button
          type="button"
          onClick={() => onResetVote(index)}
          className="p-0.5 rounded text-zinc-500 dark:text-zinc-600 hover:text-red-400 hover:bg-red-400/10 opacity-0 group-hover:opacity-100 transition-all"
          aria-label="Reset story point"
          title="Reset story point"
        >
          <X className="h-3 w-3" />
        </button>
      )}
      {savedVote !== undefined && isJiraConfigured && onCopyToJira && (
        <button
          type="button"
          onClick={() => onCopyToJira(index)}
          className="p-0.5 rounded text-zinc-500 dark:text-zinc-600 hover:text-indigo-400 hover:bg-indigo-400/10 opacity-0 group-hover:opacity-100 transition-all"
          aria-label="Copy story point to Jira"
          title="Copy story point to Jira"
        >
          <Send className="h-3 w-3" />
        </button>
      )}
    </>
  );
}

// ─── Sortable row ─────────────────────────────────────────────────────────────

interface RowProps {
  readonly id: string;
  readonly url: string;
  readonly index: number;
  readonly currentIndex: number;
  readonly isHost: boolean;
  readonly isEditMode?: boolean;
  readonly onJumpTo?: (index: number) => void;
  readonly onDelete?: (index: number) => void;
  readonly isDragOverlay?: boolean;
  readonly savedVote?: string;
  readonly onSetVote?: (index: number, value: string) => void;
  readonly onResetVote?: (index: number) => void;
  readonly onCopyToJira?: (index: number) => void;
  /** Project keys that have story-points configured — used to gate the Jira send button */
  readonly storyPointProjects?: string[];
  readonly scoringEnabled?: boolean;
  /** Drag reorder. Off while a team filter is hiding part of the queue. */
  readonly canReorder?: boolean;
}

function buildRowClassName(
  isCurrent: boolean,
  isPast: boolean,
  isFuture: boolean,
  isPreDone: boolean,
  isEditMode: boolean,
  isDragging: boolean,
  isDragOverlay: boolean,
) {
  // In edit mode every row looks neutral — no current highlight, no past dimming.
  if (isEditMode) {
    return cn(
      'flex items-center gap-3 px-3 py-3 rounded-lg border transition-all duration-150 group relative overflow-hidden w-full text-left',
      'bg-transparent border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700',
      isDragging && 'opacity-40',
      isDragOverlay && 'shadow-xl opacity-100 cursor-grabbing',
    );
  }
  return cn(
    'flex items-center gap-3 px-3 py-3 rounded-lg border transition-all duration-150 group relative overflow-hidden w-full text-left',
    isCurrent && 'bg-indigo-500/10 border-indigo-500/50 border-l-2 border-l-indigo-500',
    isPast && 'bg-transparent border-zinc-200/50 dark:border-zinc-800/50 opacity-50',
    isFuture &&
      !isPreDone &&
      'bg-transparent border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 hover:bg-zinc-100/30 dark:hover:bg-zinc-800/30',
    isPreDone && 'bg-transparent border-zinc-200/50 dark:border-zinc-800/50 opacity-40',
    isDragging && 'opacity-40',
    isDragOverlay && 'shadow-xl opacity-100 cursor-grabbing',
  );
}

function UrlRow({
  id,
  url,
  index,
  currentIndex,
  isHost,
  isEditMode = false,
  onJumpTo,
  onDelete,
  isDragOverlay,
  savedVote,
  onSetVote,
  onResetVote,
  onCopyToJira,
  storyPointProjects,
  scoringEnabled,
  canReorder = true,
}: RowProps) {
  const isCurrent = index === currentIndex;
  const isPast = index < currentIndex;
  const isFuture = index > currentIndex;
  const isSkipped = isPast && savedVote === 'skipped';
  // Future ticket pre-marked as done via badge click (no navigation needed)
  const isPreDone = isFuture && savedVote === 'skipped';
  // Badge click is available on future tickets with no real vote (or already pre-marked)
  const canMarkDone =
    isHost && isFuture && !isCurrent && (savedVote === undefined || savedVote === 'skipped');

  const isJiraSpConfigured = isStoryPointConfigured(url, storyPointProjects ?? []);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled: !isHost || !isEditMode || !canReorder,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const isClickable = isHost && !!onJumpTo && !isCurrent;

  const rowClassName = buildRowClassName(
    isCurrent,
    isPast,
    isFuture,
    isPreDone,
    isEditMode,
    isDragging,
    isDragOverlay ?? false,
  );

  const dragHandle = isHost && isEditMode && canReorder && (
    <button
      type="button"
      className={cn(
        'flex-shrink-0 p-0.5 rounded text-zinc-500 dark:text-zinc-600 cursor-grab active:cursor-grabbing',
        'opacity-60 group-hover:opacity-100 transition-opacity',
        isDragOverlay && 'opacity-100',
      )}
      aria-label="Drag to reorder"
      onClick={(e) => e.stopPropagation()}
      {...attributes}
      {...listeners}
    >
      <GripVertical className="h-3.5 w-3.5" />
    </button>
  );

  const rowContent = (
    <>
      {isCurrent && !isEditMode && (
        <div className="absolute inset-0 bg-gradient-to-r from-indigo-500/5 to-transparent pointer-events-none" />
      )}

      {/* Drag handle — host only */}
      {dragHandle}

      {/* Index badge — clickable for mark-done on eligible future tickets */}
      {canMarkDone ? (
        <button
          type="button"
          className={cn(
            'relative z-10 flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-colors',
            isPreDone
              ? 'bg-amber-400/30 text-amber-500 hover:bg-red-400/20 hover:text-red-400'
              : 'bg-zinc-200 dark:bg-zinc-800 text-zinc-500 hover:bg-emerald-400/20 hover:text-emerald-500',
          )}
          aria-label={
            isPreDone ? `Unmark ticket ${index + 1} as done` : `Mark ticket ${index + 1} as done`
          }
          onClick={(e) => {
            e.stopPropagation();
            if (isPreDone) onResetVote?.(index);
            else onSetVote?.(index, 'skipped');
          }}
        >
          {isPreDone ? <ChevronsRight className="h-3 w-3" aria-label="Skipped" /> : index + 1}
        </button>
      ) : (
        <span
          className={cn(
            'flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold',
            isCurrent && !isEditMode && 'bg-indigo-500 text-white',
            (isCurrent && isEditMode) || isFuture
              ? 'bg-zinc-200 dark:bg-zinc-800 text-zinc-500'
              : undefined,
            isPast && !isEditMode && 'bg-zinc-300 dark:bg-zinc-700 text-zinc-500',
          )}
        >
          {isSkipped ? (
            <ChevronsRight className="h-3 w-3" aria-label="Skipped" />
          ) : isPast ? (
            <Check className="h-3 w-3" />
          ) : (
            index + 1
          )}
        </span>
      )}

      {/* Favicon + Title — clickable for navigation on non-current rows */}
      {isClickable ? (
        <button
          type="button"
          className="flex items-center gap-3 flex-1 min-w-0 text-left"
          onClick={() => onJumpTo?.(index)}
          aria-label={`Jump to ticket ${index + 1}`}
        >
          <img
            src={getFaviconUrl(url)}
            alt=""
            aria-hidden="true"
            className={cn('w-4 h-4 flex-shrink-0 rounded-sm', isPast && 'grayscale opacity-50')}
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
          <UrlTitle
            url={url}
            isCurrent={isCurrent}
            isPast={isPast}
            scoringEnabled={scoringEnabled}
            isDragOverlay={isDragOverlay}
          />
        </button>
      ) : (
        <>
          <img
            src={getFaviconUrl(url)}
            alt=""
            aria-hidden="true"
            className={cn('w-4 h-4 flex-shrink-0 rounded-sm', isPast && 'grayscale opacity-50')}
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
          <UrlTitle
            url={url}
            isCurrent={isCurrent}
            isPast={isPast}
            scoringEnabled={scoringEnabled}
            isDragOverlay={isDragOverlay}
          />
        </>
      )}

      {/* Current badge — hidden in edit mode */}
      {isCurrent && !isEditMode && (
        <span className="flex-shrink-0 text-xs font-semibold px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
          Current
        </span>
      )}

      {/* Saved story point badge for past tickets (host: editable + reset + copy-to-Jira) */}
      {isPast && isHost && (
        <div
          className="relative z-10 flex items-center gap-1 flex-shrink-0"
          onClick={(e) => e.stopPropagation()}
          aria-hidden="true"
        >
          <StoryPointControls
            index={index}
            savedVote={savedVote}
            isJiraConfigured={isJiraSpConfigured}
            onSetVote={onSetVote}
            onResetVote={onResetVote}
            onCopyToJira={onCopyToJira}
          />
        </div>
      )}

      {/* Saved average vote badge for past tickets (non-host view) */}
      {isPast && !isHost && savedVote !== undefined && savedVote !== 'skipped' && (
        <span
          className="flex-shrink-0 min-w-[28px] h-6 px-1.5 flex items-center justify-center rounded-md bg-zinc-700/60 text-zinc-300 text-xs font-bold border border-zinc-600/50"
          title={`Story point: ${savedVote}`}
        >
          {savedVote}
        </span>
      )}

      {/* Action buttons (host only) */}
      {isHost && (
        <div
          className="relative z-10 flex items-center gap-1 flex-shrink-0"
          onClick={(e) => e.stopPropagation()}
          aria-hidden="true"
        >
          {isFuture && (
            <a
              href={safeUrl(url)}
              target="_blank"
              rel="noopener noreferrer"
              className="p-1 rounded text-zinc-500 dark:text-zinc-600 hover:text-zinc-700 dark:hover:text-zinc-300 opacity-0 group-hover:opacity-100 transition-all"
              aria-label="Open URL"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
          {onDelete && (
            <button
              type="button"
              onClick={() => onDelete(index)}
              className="p-1 rounded text-zinc-500 dark:text-zinc-600 hover:text-red-400 hover:bg-red-400/10 opacity-0 group-hover:opacity-100 transition-all"
              aria-label="Remove URL"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}
    </>
  );

  return (
    <div ref={setNodeRef} style={style} className={rowClassName}>
      {rowContent}
    </div>
  );
}

const ALL_TEAMS = 'all';
const NO_TEAM = 'none';

interface TeamFilterOption {
  value: string;
  label: string;
}

function TeamFilterTabs({
  teams,
  hasUnassigned,
  value,
  onChange,
  shownCount,
}: {
  readonly teams: string[];
  readonly hasUnassigned: boolean;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly shownCount: number | null;
}) {
  const options: TeamFilterOption[] = [
    { value: ALL_TEAMS, label: 'All teams' },
    ...teams.map((team) => ({ value: `team:${team}`, label: team })),
    ...(hasUnassigned ? [{ value: NO_TEAM, label: 'No team' }] : []),
  ];

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const index = options.findIndex((option) => option.value === value);
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % options.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + options.length) % options.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = options.length - 1;
    else return;
    event.preventDefault();
    onChange(options[next].value);
    const tabs = event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    tabs[next]?.focus();
  }

  return (
    <div className="mb-1 flex flex-wrap items-center gap-1.5 px-1">
      <div
        role="tablist"
        aria-label="Filter tickets by team"
        onKeyDown={onKeyDown}
        className="flex flex-wrap items-center gap-1"
      >
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              role="tab"
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(option.value)}
              className={cn(
                'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500',
                selected
                  ? 'border-indigo-500/40 bg-indigo-500/15 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-300'
                  : 'border-zinc-200 text-zinc-500 hover:border-zinc-300 hover:bg-zinc-100 hover:text-zinc-700 dark:border-zinc-800 dark:hover:border-zinc-700 dark:hover:bg-zinc-800/60 dark:hover:text-zinc-200',
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      {shownCount !== null && <span className="text-xs text-zinc-500">{shownCount} shown</span>}
    </div>
  );
}

function matchesTeamFilter(ticket: QueueTicketTeam | undefined, filter: string): boolean {
  if (filter === ALL_TEAMS) return true;
  if (!ticket?.isJira || ticket.isLoading) return false;
  if (filter === NO_TEAM) return !ticket.team;
  const name = filter.startsWith('team:') ? filter.slice('team:'.length) : filter;
  return ticket.team === name;
}

// ─── UrlQueue ─────────────────────────────────────────────────────────────────

export interface UrlQueueProps {
  readonly urls: string[];
  readonly currentIndex: number;
  readonly isHost?: boolean;
  readonly isEditMode?: boolean;
  readonly onJumpTo?: (index: number) => void;
  readonly onDelete?: (index: number) => void;
  readonly onReorder?: (fromIndex: number, toIndex: number) => void;
  readonly className?: string;
  /** Average vote per URL index — shown as a badge on past tickets */
  readonly savedVotes?: Record<number, string>;
  /** Host: override saved story point for a URL index */
  readonly onSetVote?: (index: number, value: string) => void;
  /** Host: clear saved story point for a URL index */
  readonly onResetVote?: (index: number) => void;
  /** Host: push saved story point to Jira for a URL index */
  readonly onCopyToJira?: (index: number) => void;
  /** Project keys with story-points configured — gates the Jira send button per row */
  readonly storyPointProjects?: string[];
  readonly scoringEnabled?: boolean;
}

export function UrlQueue({
  urls,
  currentIndex,
  isHost = false,
  isEditMode = false,
  onJumpTo,
  onDelete,
  onReorder,
  className,
  savedVotes,
  onSetVote,
  onResetVote,
  onCopyToJira,
  storyPointProjects,
  scoringEnabled,
}: UrlQueueProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [teamFilter, setTeamFilter] = useState(ALL_TEAMS);
  // Optimistic local copies — updated immediately on drop so there's no
  // visual snap-back while we wait for the server round-trip.
  const [localUrls, setLocalUrls] = useState(urls);
  const [localCurrentIndex, setLocalCurrentIndex] = useState(currentIndex);
  const ticketTeams = useJiraIssueTeams(localUrls);

  // Keep in sync when the authoritative props change (server confirms reorder,
  // URL added/removed, navigation, etc.).
  useEffect(() => {
    setLocalUrls(urls);
  }, [urls]);
  useEffect(() => {
    setLocalCurrentIndex(currentIndex);
  }, [currentIndex]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
  );

  // Stable IDs for dnd-kit: use URL + index to handle duplicate URLs
  const items = localUrls.map((url, i) => `${i}:${url}`);

  const teams = useMemo(() => {
    const names = new Set<string>();
    for (const ticket of ticketTeams) {
      if (ticket.team) names.add(ticket.team);
    }
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [ticketTeams]);
  const hasUnassigned = ticketTeams.some(
    (ticket) => ticket.isJira && !ticket.isLoading && !ticket.team,
  );
  const filtering = teamFilter !== ALL_TEAMS;

  useEffect(() => {
    if (teamFilter === ALL_TEAMS) return;
    if (teamFilter === NO_TEAM) {
      if (!hasUnassigned) setTeamFilter(ALL_TEAMS);
      return;
    }
    const name = teamFilter.startsWith('team:') ? teamFilter.slice('team:'.length) : teamFilter;
    if (!teams.includes(name)) setTeamFilter(ALL_TEAMS);
  }, [teamFilter, teams, hasUnassigned]);

  const visibleEntries = localUrls
    .map((url, index) => ({ url, index, id: items[index] }))
    .filter((entry) => matchesTeamFilter(ticketTeams[entry.index], teamFilter));

  function handleDragStart(event: DragStartEvent) {
    setActiveId(event.active.id as string);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    if (!isEditMode || filtering) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const fromIndex = items.indexOf(active.id as string);
    const toIndex = items.indexOf(over.id as string);

    if (fromIndex === -1 || toIndex === -1) return;

    // Apply optimistically so the list settles immediately — no snap-back.
    const reordered = [...localUrls];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);
    setLocalUrls(reordered);
    onReorder?.(fromIndex, toIndex);
  }

  const activeUrl = activeId ? localUrls[items.indexOf(activeId)] : null;
  const activeIndex = activeId ? items.indexOf(activeId) : -1;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={visibleEntries.map((entry) => entry.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className={cn('flex flex-col gap-1', className)}>
          {teams.length > 0 && (
            <TeamFilterTabs
              teams={teams}
              hasUnassigned={hasUnassigned}
              value={teamFilter}
              onChange={setTeamFilter}
              shownCount={filtering ? visibleEntries.length : null}
            />
          )}
          {visibleEntries.map((entry) => (
            // Key by URL (not index-based id) so React reuses the DOM node
            // when items reorder, preventing the entry animation from replaying.
            <motion.div
              key={entry.url}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96 }}
              transition={{ duration: 0.18 }}
            >
              <UrlRow
                id={entry.id}
                url={entry.url}
                index={entry.index}
                currentIndex={localCurrentIndex}
                isHost={isHost}
                isEditMode={isEditMode}
                canReorder={!filtering}
                onJumpTo={onJumpTo}
                onDelete={onDelete}
                savedVote={savedVotes?.[entry.index]}
                onSetVote={onSetVote}
                onResetVote={onResetVote}
                onCopyToJira={onCopyToJira}
                storyPointProjects={storyPointProjects}
                scoringEnabled={scoringEnabled}
              />
            </motion.div>
          ))}
          {filtering && visibleEntries.length === 0 && (
            <p className="px-3 py-6 text-center text-xs text-zinc-500">No tickets for this team.</p>
          )}
        </div>
      </SortableContext>

      {/* Ghost row while dragging */}
      <DragOverlay dropAnimation={{ duration: 150, easing: 'ease' }}>
        {activeUrl !== null && activeIndex !== -1 ? (
          <UrlRow
            id={activeId as string}
            url={activeUrl}
            index={activeIndex}
            currentIndex={localCurrentIndex}
            isHost={isHost}
            isDragOverlay
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
