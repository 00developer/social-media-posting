'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin, { type DateClickArg } from '@fullcalendar/interaction';
import type { EventClickArg, EventContentArg, EventInput, EventSourceFuncArg } from '@fullcalendar/core';
import { useDashboard } from '@/components/DashboardProvider';
import { CreatePostModal } from '@/components/post/CreatePostModal';
import { EditPostModal } from '@/components/post/EditPostModal';
import type { PostActionType } from '@/components/post/PostComposer';
import type { EditablePostRecord } from '@/lib/calendarEdit';
import { toEvent, type EventProps } from '@/lib/calendarEvent';
import { getPrefill } from '@/lib/calendarPrefill';
import { PLATFORM_SHORT_LABELS, STATUS_META, type CalendarStatusKey } from '@/lib/calendarStatus';
import { POST_SERVICE_URL } from '@/lib/apiUrls';
import { authHeader } from '@/lib/supabase';

function renderEventContent(arg: EventContentArg) {
  const { statusLabel, platforms } = arg.event.extendedProps as EventProps;

  return (
    <div
      className="flex w-full items-center gap-1 overflow-hidden px-1 text-[11px] leading-tight text-white"
      title={`${statusLabel}: ${arg.event.title}`}
    >
      {arg.timeText && <span className="shrink-0 font-semibold">{arg.timeText}</span>}
      <span className="flex shrink-0 gap-0.5">
        {platforms.map((p) => (
          <span key={p} className="rounded bg-white/25 px-1 font-bold">
            {PLATFORM_SHORT_LABELS[p] ?? p.slice(0, 2).toUpperCase()}
          </span>
        ))}
      </span>
      <span className="truncate">{arg.event.title}</span>
    </div>
  );
}

function StatusLegend() {
  const order: CalendarStatusKey[] = ['scheduled', 'processing', 'published', 'partial', 'failed'];
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-300 font-medium">
      {order.map((key) => (
        <li key={key} className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full ring-2 ring-slate-800 shadow-sm" style={{ backgroundColor: STATUS_META[key].color }} />
          <span>{STATUS_META[key].label}</span>
        </li>
      ))}
    </ul>
  );
}

// Keyed by team id in the page below, so switching team remounts this component:
// FullCalendar drops the old team's events and every piece of local state resets.
function TeamCalendar({ userId, teamId, canCreate, refreshTimeline }: { userId: string; teamId: string; canCreate: boolean; refreshTimeline: () => void }) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [eventCount, setEventCount] = useState(0);
  const [modal, setModal] = useState<{ initialScheduleAt: string } | null>(null);
  // The post whose details / edit modal is open. At most one of `modal` and `editing` is set.
  const [editing, setEditing] = useState<EditablePostRecord | null>(null);
  const [notice, setNotice] = useState<{ kind: 'warn' | 'info'; text: string } | null>(null);
  const calendarRef = useRef<FullCalendar>(null);
  const timeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(timer);
  }, [notice]);

  const handleDateClick = (info: DateClickArg) => {
    const prefill = getPrefill(info.date, info.allDay);
    if (!prefill.allowed) {
      setNotice({ kind: 'warn', text: "You can't schedule a post in the past. Pick today or a later date." });
      return;
    }
    setNotice(null);
    setEditing(null);
    setModal({ initialScheduleAt: prefill.value });
  };

  // Open the post behind an event. Works for every role: viewers get the read-only view (per-platform status),
  // and the modal itself decides whether the caption is editable.
  const handleEventClick = (info: EventClickArg) => {
    const { post } = info.event.extendedProps as EventProps;
    setNotice(null);
    setModal(null);
    setEditing(post);
  };

  const handleCloseModal = useCallback(() => setModal(null), []);
  const handleCloseEditor = useCallback(() => setEditing(null), []);

  const refetchEvents = useCallback(() => {
    calendarRef.current?.getApi().refetchEvents();
  }, []);

  const handleCreated = (actionType: PostActionType) => {
    if (actionType === 'draft') {
      setNotice({ kind: 'info', text: "Saved as a draft. Drafts have no date, so they don't appear on the calendar." });
    }
    // Refetch in every case: the post list changed, and "publish now" lands on today's cell.
    refetchEvents();
  };

  // Caption saved: the calendar event text and the Posts timeline both show it.
  const handleEdited = () => {
    refetchEvents();
    refreshTimeline();
  };

  const fetchEvents = useCallback(
    async (info: EventSourceFuncArg): Promise<EventInput[]> => {
      try {
        const params = new URLSearchParams({ teamId, from: info.startStr, to: info.endStr });
        const res = await fetch(`${POST_SERVICE_URL}/api/v1/posts?${params.toString()}`, { headers: await authHeader() });
        const body = await res.json();
        if (!res.ok || !body.success) {
          throw new Error(body.error || `Request failed (${res.status})`);
        }
        setError(null);
        return (body.data as EditablePostRecord[])
          .map(toEvent)
          .filter((event): event is EventInput => event !== null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not load posts');
        throw err;
      }
    },
    [teamId]
  );

  return (
    <div className="flex h-[calc(100dvh-8rem)] min-h-150 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-800 bg-[#0D131F] px-4 py-3">
        <StatusLegend />
        <div className="flex items-center gap-3 text-xs text-slate-400">
          {isLoading && <span className="inline-flex items-center gap-1.5 text-indigo-400 font-medium"><span className="h-1.5 w-1.5 rounded-full bg-indigo-400 animate-ping" />Loading…</span>}
          <span>Times shown in <strong className="text-slate-200">{timeZone}</strong></span>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-950/40 px-4 py-3 text-sm text-rose-300">
          Could not load posts: {error}
        </div>
      )}

      {notice && (
        <div
          role="status"
          className={`rounded-xl border px-4 py-3 text-sm ${
            notice.kind === 'warn' ? 'border-amber-500/30 bg-amber-950/40 text-amber-300' : 'border-indigo-500/30 bg-indigo-950/40 text-indigo-300'
          }`}
        >
          {notice.text}
        </div>
      )}

      <div className={`calendar-events-clickable min-h-0 flex-1 rounded-2xl border border-slate-800 bg-[#0D131F] p-2.5 sm:p-5 shadow-sm ${canCreate ? 'calendar-creatable' : ''}`}>
        <FullCalendar
          ref={calendarRef}
          plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
          initialView="dayGridMonth"
          headerToolbar={{
            left: 'prev,next today',
            center: 'title',
            right: 'dayGridMonth,timeGridWeek',
          }}
          timeZone="local"
          events={fetchEvents}
          eventContent={renderEventContent}
          eventDisplay="block"
          eventTimeFormat={{ hour: 'numeric', minute: '2-digit', meridiem: 'short' }}
          dayMaxEvents={3}
          fixedWeekCount={false}
          nowIndicator
          editable={false}
          selectable={false}
          dateClick={canCreate ? handleDateClick : undefined}
          eventClick={handleEventClick}
          eventInteractive
          loading={setIsLoading}
          eventsSet={(events) => setEventCount(events.length)}
          height="100%"
        />
      </div>

      {!isLoading && !error && eventCount === 0 && (
        <p className="text-center text-sm text-slate-500">No scheduled or published posts in this range.</p>
      )}

      {modal && (
        <CreatePostModal initialScheduleAt={modal.initialScheduleAt} onClose={handleCloseModal} onCreated={handleCreated} />
      )}

      {editing && (
        <EditPostModal
          post={editing}
          userId={userId}
          teamId={teamId}
          isViewer={!canCreate}
          onClose={handleCloseEditor}
          onSaved={handleEdited}
          onOutdated={refetchEvents}
          onRetried={handleEdited}
        />
      )}
    </div>
  );
}

export default function CalendarPage() {
  const { user, activeTeam, fetchTeamData } = useDashboard();

  if (!user || !activeTeam) {
    return <div className="p-6 text-sm text-slate-400">Loading your calendar…</div>;
  }

  return (
    <TeamCalendar
      key={activeTeam.id}
      userId={user.id}
      teamId={activeTeam.id}
      canCreate={activeTeam.role !== 'viewer'}
      refreshTimeline={fetchTeamData}
    />
  );
}
