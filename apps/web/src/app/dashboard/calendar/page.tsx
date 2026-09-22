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
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-600">
      {order.map((key) => (
        <li key={key} className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: STATUS_META[key].color }} />
          {STATUS_META[key].label}
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
        const params = new URLSearchParams({ userId, teamId, from: info.startStr, to: info.endStr });
        const res = await fetch(`http://localhost:3002/api/v1/posts?${params.toString()}`);
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
    [userId, teamId]
  );

  return (
    <div className="flex h-[calc(100vh-8rem)] min-h-150 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <StatusLegend />
        <div className="flex items-center gap-3 text-xs text-gray-500">
          {isLoading && <span>Loading…</span>}
          <span>Times shown in {timeZone}</span>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          Could not load posts: {error}
        </div>
      )}

      {notice && (
        <div
          role="status"
          className={`rounded-lg border px-3 py-2 text-sm ${
            notice.kind === 'warn' ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-indigo-200 bg-indigo-50 text-indigo-800'
          }`}
        >
          {notice.text}
        </div>
      )}

      <div className={`calendar-events-clickable min-h-0 flex-1 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm ${canCreate ? 'calendar-creatable' : ''}`}>
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
        <p className="text-center text-sm text-gray-400">No scheduled or published posts in this range.</p>
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
    return <div className="p-6 text-sm text-gray-500">Loading your calendar…</div>;
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
