'use client';
import { normalizeRoute } from '@/lib/stride/routes';
import {
  flushAllNoteDrafts,
  hasUnsavedNoteDrafts,
} from '@/lib/stride/note-drafts';
import { stringValue } from '@/lib/stride/types';

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  Suspense,
  lazy,
} from 'react';
import {
  Zap,
  Search,
  Inbox,
  Sun,
  CalendarRange,
  CalendarDays,
  FileText,
  Flame,
  Timer,
  TrendingUp,
  Settings,
  Plus,
  Cloud,
  Menu,
  X,
  ChevronRight,
  Archive,
  Undo2,
  LayoutGrid,
  CheckCheck,
  GraduationCap,
  AlarmClock,
  Droplets,
  HeartPulse,
} from 'lucide-react';
import { StoreProvider, useStride } from '@/lib/stride/store';
import { type Entity, type Task, type Project } from '@/lib/stride/types';
import { Tasks, TaskEditor, ProjectEditor } from './features/tasks';
import { Calendar } from './features/views';
import { useMediaQuery } from '@/hooks/use-media-query';
import { WebMCP } from '@/lib/stride/webmcp';
import { TaskActionSurface } from './task-actions';
import { CoreItemActionSurface } from './core-item-actions';
import { Modal } from './primitives';
import { Loading } from './forms';
import { NetworkClock } from './network-clock';
import { AlarmOverlay } from './features/alarms';
import { CheckInReminder } from './features/wellness';
import { DayDashboard, PlannerSetup, WeeklyReview } from './features/dashboard';
import { UpdateProvider } from '@/lib/stride/updates';
const icons = {
  inbox: Inbox,
  today: Sun,
  'weekly-review': CalendarRange,
  upcoming: CalendarRange,
  tasks: CheckCheck,
  calendar: CalendarDays,
  notes: FileText,
  habits: Flame,
  focus: Timer,
  school: GraduationCap,
  alarms: AlarmClock,
  shower: Droplets,
  checkIns: HeartPulse,
  matrix: LayoutGrid,
  countdowns: CalendarRange,
  insights: TrendingUp,
  archive: Archive,
  settings: Settings,
};
const names: Record<string, string> = {
  inbox: 'Inbox',
  today: 'Today',
  'weekly-review': 'Weekly Review',
  upcoming: 'Upcoming',
  tasks: 'All tasks',
  calendar: 'Calendar',
  notes: 'Notes',
  habits: 'Habits',
  focus: 'Focus',
  school: 'School',
  alarms: 'Alarms',
  shower: 'Shower',
  checkIns: 'Check-ins',
  matrix: 'Eisenhower Matrix',
  countdowns: 'Countdowns',
  insights: 'Insights',
  archive: 'Completed tasks',
  settings: 'Settings',
};
const Notes = lazy(() => import('./features/notes'));
const SettingsPage = lazy(() => import('./features/settings'));
const School = lazy(() => import('./features/school'));
const Alarms = lazy(() =>
  import('./features/alarms').then((module) => ({ default: module.Alarms })),
);
const Shower = lazy(() =>
  import('./features/wellness').then((module) => ({ default: module.Shower })),
);
const CheckIns = lazy(() =>
  import('./features/wellness').then((module) => ({
    default: module.CheckIns,
  })),
);
const Habits = lazy(() =>
  import('./features/productivity').then((m) => ({ default: m.Habits })),
);
const Focus = lazy(() =>
  import('./features/productivity').then((m) => ({ default: m.Focus })),
);
const Matrix = lazy(() =>
  import('./features/productivity').then((m) => ({ default: m.Matrix })),
);
const Countdowns = lazy(() =>
  import('./features/productivity').then((m) => ({ default: m.Countdowns })),
);
const Insights = lazy(() =>
  import('./features/productivity').then((m) => ({ default: m.Insights })),
);
const enabled = [
  'inbox',
  'today',
  'weekly-review',
  'upcoming',
  'tasks',
  'calendar',
  'notes',
  'habits',
  'focus',
  'school',
  'alarms',
  'shower',
  'checkIns',
  'matrix',
  'countdowns',
  'insights',
  'archive',
];
let committedRoute: string | undefined;
let routeTransition = 0;
function hashRoute() {
  try {
    return normalizeRoute(
      decodeURIComponent(location.hash.slice(1)) || 'today',
    );
  } catch {
    return 'today';
  }
}
function readRoute() {
  return (committedRoute ??= hashRoute());
}
function subscribeRoute(callback: () => void) {
  const transition = () => {
    const next = hashRoute(),
      previous = readRoute(),
      run = ++routeTransition;
    if (next === previous) return;
    if (!hasUnsavedNoteDrafts()) {
      committedRoute = next;
      callback();
      return;
    }
    void flushAllNoteDrafts()
      .then(() => {
        if (run !== routeTransition) return;
        committedRoute = next;
        callback();
      })
      .catch((error) => {
        if (run === routeTransition)
          history.replaceState(null, '', `#${previous}`);
        window.dispatchEvent(
          new PromiseRejectionEvent('unhandledrejection', {
            promise: Promise.resolve(),
            reason: error,
          }),
        );
      });
  };
  window.addEventListener('hashchange', transition);
  return () => window.removeEventListener('hashchange', transition);
}
function Workspace() {
  const store = useStride();
  const route = useSyncExternalStore(subscribeRoute, readRoute, () => 'today');
  const [navOpen, setNavOpen] = useState(false);
  const compact = useMediaQuery('(max-width: 1023px)');
  const sidebarRef = useRef<HTMLElement>(null);
  const [search, setSearch] = useState<string | null>(null);
  const [enableShower, setEnableShower] = useState(false);
  const [enableCheckIns, setEnableCheckIns] = useState(false);
  const [searchResults, setSearchResults] = useState<Entity[]>([]);
  const [searchState, setSearchState] = useState<
    'idle' | 'searching' | 'done' | 'error'
  >('idle');
  const searchRun = useRef(0);
  const searchWorkspace = store.search;
  const openSearch = () => {
    searchRun.current++;
    setNavOpen(false);
    setSearchResults([]);
    setSearchState('searching');
    setSearch('');
  };
  const [taskEditor, setTaskEditor] = useState<Task | 'new' | null>(null);
  const [initial, setInitial] = useState<Record<string, unknown>>({});
  const [projectEditor, setProjectEditor] = useState<Project | 'new' | null>(
    null,
  );
  const navigate = (path: string) => {
    location.assign('#' + path);
    setNavOpen(false);
  };
  const add = (data: Record<string, unknown> = {}) => {
    setNavOpen(false);
    setInitial(data);
    setTaskEditor('new');
  };
  const routedTask = route.startsWith('task/')
    ? (store.entities.find(
        (e) => e.id === route.split('/')[1] && e.kind === 'task',
      ) as Task | undefined)
    : undefined;
  const routedProject = route.startsWith('project-settings/')
    ? (store.entities.find(
        (e) => e.id === route.split('/')[1] && e.kind === 'project',
      ) as Project | undefined)
    : undefined;
  const visibleTask =
    taskEditor || routedTask || (route === 'add' ? 'new' : null);
  const visibleProject = projectEditor || routedProject;
  const routeProject =
    route.startsWith('project/') || route.startsWith('project-settings/')
      ? route.split('/')[1] || ''
      : '';
  const projectionRoute =
    ['today', 'inbox', 'upcoming', 'tasks', 'archive'].includes(route) ||
    (!!routeProject && routeProject === store.startupProject);
  useEffect(() => {
    const run = ++searchRun.current;
    if (search === null) return;
    const timer = setTimeout(() => {
      setSearchState('searching');
      void searchWorkspace(search)
        .then((entities) => {
          if (searchRun.current !== run) return;
          setSearchResults(entities);
          setSearchState('done');
        })
        .catch(() => {
          if (searchRun.current === run) setSearchState('error');
        });
    }, 120);
    return () => clearTimeout(timer);
  }, [search, searchWorkspace]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        openSearch();
      }
      if (e.key === 'Escape') setNavOpen(false);
      if (
        e.key === 'q' &&
        !['INPUT', 'TEXTAREA', 'SELECT'].includes(
          (e.target as HTMLElement).tagName,
        ) &&
        !(e.target as HTMLElement).isContentEditable
      ) {
        e.preventDefault();
        add();
      }
    };
    const addTask = (event: Event) => add((event as CustomEvent).detail || {});
    window.addEventListener('stride-add-task', addTask);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('keydown', key);
      window.removeEventListener('stride-add-task', addTask);
    };
  }, []);
  useEffect(() => {
    if (!compact || !navOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const sidebar = sidebarRef.current;
    const focusable = () =>
      Array.from(
        sidebar?.querySelectorAll<HTMLElement>(
          'a[href],button:not([disabled]),input:not([disabled]),[tabindex="0"]',
        ) || [],
      ).filter((element) => element.getClientRects().length > 0);
    focusable()[0]?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const elements = focusable();
      const first = elements[0],
        last = elements.at(-1);
      if (
        event.shiftKey &&
        (document.activeElement === first ||
          !sidebar?.contains(document.activeElement))
      ) {
        event.preventDefault();
        last?.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last ||
          !sidebar?.contains(document.activeElement))
      ) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('keydown', handleKey);
      if (previous?.isConnected) previous.focus();
    };
  }, [compact, navOpen]);
  const navOrder = [
    ...store.settings.navOrder.filter((x) => enabled.includes(x)),
    ...enabled.filter((x) => !store.settings.navOrder.includes(x)),
  ].filter(
    (key) =>
      (key !== 'shower' || store.settings.showerEnabled) &&
      (key !== 'checkIns' || store.settings.checkInsEnabled),
  );
  const projects = store.entities.filter(
    (e) => e.kind === 'project',
  ) as Project[];
  const title =
    names[route] ||
    (route.startsWith('settings/') ? 'Settings' : '') ||
    stringValue(
      store.entities.find((e) => e.id === route.split('/')[1])?.data.title ||
        'Workspace',
    );
  const goResult = (e: Entity) => {
    setSearch(null);
    if (e.kind === 'task') {
      setTaskEditor(e as Task);
    } else if (e.kind === 'course' || e.kind === 'assignment') {
      navigate(`${e.kind}/${e.id}`);
    } else navigate(`${e.kind === 'folder' ? 'notes' : e.kind}/${e.id}`);
  };
  return (
    <div className="stride-shell">
      <a
        className="skip-link"
        href="#main-content"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById('main-content')?.focus();
        }}
      >
        Skip to content
      </a>
      {navOpen && (
        <button
          className="nav-overlay"
          aria-label="Close navigation"
          onClick={() => setNavOpen(false)}
        />
      )}
      <aside
        className={`stride-sidebar ${navOpen ? 'open' : ''}`}
        id="stride-main-navigation"
        ref={sidebarRef}
        inert={compact && !navOpen}
        aria-hidden={compact && !navOpen}
        aria-label="Main navigation"
      >
        {compact && (
          <button
            className="drawer-close icon-button"
            aria-label="Close navigation"
            onClick={() => setNavOpen(false)}
          >
            <X size={20} />
          </button>
        )}
        <a href="#today" className="brand" onClick={() => setNavOpen(false)}>
          <span className="brand-mark">
            <Zap fill="currentColor" size={21} />
          </span>
          stride<span className="brand-dot">.</span>
        </a>
        <button
          className="workspace-switch"
          onClick={() => navigate('settings')}
        >
          <span className="avatar">{(store.settings.name || 'Y')[0]}</span>
          <span>
            {store.settings.name || 'Your workspace'}
            <small>{store.account.user?.email || 'Personal space'}</small>
          </span>
        </button>
        <button
          className="search-button"
          onClick={() => {
            openSearch();
          }}
        >
          <Search size={17} />
          <span>Search anything</span>
          <kbd>⌘ K</kbd>
        </button>
        <div className="nav-scroll">
          <nav className="nav-group">
            {navOrder
              .filter((key) => !store.settings.hidden.includes(key))
              .map((key) => {
                const Icon = icons[key as keyof typeof icons];
                return (
                  <button
                    key={key}
                    className={`nav-item ${route === key ? 'active' : ''}`}
                    onClick={() => navigate(key)}
                  >
                    <Icon />
                    {names[key]}
                    {key === 'inbox' && (
                      <span>
                        {store.entities.filter(
                          (e) =>
                            e.kind === 'task' &&
                            e.data.project === 'inbox' &&
                            !e.data.completedAt,
                        ).length || ''}
                      </span>
                    )}
                  </button>
                );
              })}
          </nav>
          <div className="nav-label">
            PROJECTS
            <button
              className="icon-button"
              aria-label="New project"
              onClick={() => {
                setNavOpen(false);
                setProjectEditor('new');
              }}
            >
              <Plus size={16} />
            </button>
          </div>
          <nav className="nav-group">
            {projects.map((p) => (
              <CoreItemActionSurface
                key={p.id}
                entity={p}
                onOpen={() => navigate(`project/${p.id}`)}
              >
                {(menu) => (
                  <div className="sidebar-project-row">
                    <button
                      className={`nav-item ${route === `project/${p.id}` ? 'active' : ''}`}
                      key={p.id}
                      onClick={() => navigate(`project/${p.id}`)}
                    >
                      <i
                        className="project-dot"
                        style={{ background: p.data.color }}
                      />
                      {p.data.title}
                    </button>
                    {menu}
                  </div>
                )}
              </CoreItemActionSurface>
            ))}
            {projects.length === 0 && (
              <button
                className="nav-item muted"
                onClick={() => {
                  setNavOpen(false);
                  setProjectEditor('new');
                }}
              >
                <Plus />
                Create a project
              </button>
            )}
          </nav>
        </div>
        <footer>
          <div className="level-card">
            <Zap size={15} />
            <span>
              {store.entities.filter((e) => e.kind === 'completion').length *
                10}{' '}
              XP · a little progress, every day
            </span>
          </div>
          <button
            className={`nav-item ${route === 'settings' ? 'active' : ''}`}
            onClick={() => navigate('settings')}
          >
            <Settings />
            Settings
          </button>
          <button
            className="local-status"
            onClick={() => void store.sync()}
            title="Sync now"
          >
            <Cloud size={14} />
            {store.syncStatus}
          </button>
          {!!store.snapshot?.conflicts.length && (
            <button
              className="nav-item danger"
              onClick={() => navigate('settings')}
            >
              {store.snapshot.conflicts.length} edits need review
            </button>
          )}
        </footer>
      </aside>
      <main
        className="app-main"
        id="main-content"
        tabIndex={-1}
        inert={compact && navOpen}
      >
        <header className="topbar">
          <div className="topbar-breadcrumb">
            <button
              className="icon-button menu-toggle"
              onClick={() => setNavOpen(!navOpen)}
              aria-label="Open navigation"
              aria-expanded={navOpen}
              aria-controls="stride-main-navigation"
            >
              <Menu size={20} />
            </button>
            <span>Your workspace</span>
            <ChevronRight size={13} />
            <strong>{title}</strong>
          </div>
          <div className="topbar-actions">
            <NetworkClock
              mode={store.settings.clockTimezone}
              workspaceZone={store.settings.timezone}
            />
            {store.canUndo && (
              <button
                className="subtle-button topbar-undo"
                aria-label="Undo last change"
                onClick={() => void store.undo()}
              >
                <Undo2 size={16} />
                <span>Undo</span>
              </button>
            )}
            <button
              className="icon-button"
              aria-label="Search"
              onClick={() => {
                openSearch();
              }}
            >
              <Search size={18} />
            </button>
          </div>
        </header>
        <div
          className={`page-content ${route === 'notes' || route.startsWith('note/') || route.startsWith('notes/') ? 'notes-page-content' : ''}`}
          style={
            route.startsWith('project/')
              ? {
                  background:
                    projects.find((p) => p.id === route.split('/')[1])?.data
                      .background || undefined,
                }
              : undefined
          }
        >
          {!store.ready || (store.hydrating && !projectionRoute) ? (
            <Loading />
          ) : (
            <Suspense fallback={<Loading />}>
              {route === 'today' ? (
                <DayDashboard onEdit={setTaskEditor} onAdd={add} />
              ) : route === 'weekly-review' ? (
                <WeeklyReview onEdit={setTaskEditor} />
              ) : route === 'calendar' ? (
                <Calendar onEdit={setTaskEditor} onAdd={() => add()} />
              ) : route === 'settings' || route.startsWith('settings/') ? (
                <SettingsPage key={route} initialTab={route.split('/')[1]} />
              ) : route === 'notes' ||
                route.startsWith('note/') ||
                route.startsWith('notes/') ? (
                <Notes
                  key={route}
                  noteId={
                    route.startsWith('note/') ? route.split('/')[1] : undefined
                  }
                  folderId={
                    route.startsWith('notes/') ? route.split('/')[1] : undefined
                  }
                />
              ) : route === 'habits' || route.startsWith('habit/') ? (
                <Habits />
              ) : route === 'focus' ? (
                <Focus />
              ) : route === 'school' ||
                route.startsWith('course/') ||
                route.startsWith('assignment/') ? (
                <School key={route} targetId={route.split('/')[1]} />
              ) : route === 'alarms' ? (
                <Alarms />
              ) : route === 'shower' && store.settings.showerEnabled ? (
                <Shower />
              ) : route === 'checkIns' && store.settings.checkInsEnabled ? (
                <CheckIns />
              ) : route === 'matrix' ? (
                <Matrix onEdit={setTaskEditor} />
              ) : route === 'countdowns' ? (
                <Countdowns />
              ) : route === 'insights' ? (
                <Insights />
              ) : (
                <Tasks
                  key={route}
                  route={
                    route.startsWith('task/')
                      ? 'tasks'
                      : route.startsWith('project-settings/')
                        ? `project/${route.split('/')[1]}`
                        : route
                  }
                  onEdit={setTaskEditor}
                  onAdd={add}
                />
              )}
            </Suspense>
          )}
        </div>
        {store.ready && <PlannerSetup />}
        <nav className="bottom-nav" aria-label="Quick navigation">
          {[
            ['today', Sun],
            ['calendar', CalendarDays],
          ].map(([key, Icon]) => {
            const I = Icon as typeof Sun;
            return (
              <button
                className={route === key ? 'active' : ''}
                key={stringValue(key)}
                onClick={() => navigate(stringValue(key))}
              >
                <I />
                {names[stringValue(key)]}
              </button>
            );
          })}
          <button
            className="mobile-add"
            aria-label="Add task"
            onClick={() => add()}
          >
            <Plus />
          </button>
          <button
            onClick={() => {
              openSearch();
            }}
          >
            <Search />
            Search
          </button>
          <button onClick={() => setNavOpen(true)}>
            <Menu />
            More
          </button>
        </nav>
      </main>
      {visibleTask && (
        <TaskEditor
          key={visibleTask === 'new' ? 'new' : visibleTask.id}
          task={visibleTask === 'new' ? undefined : visibleTask}
          initial={initial}
          onClose={() => {
            setTaskEditor(null);
            if (route.startsWith('task/') || route === 'add') navigate('tasks');
          }}
        />
      )}
      {store.ready && !store.settings.optionalModulesOnboarded && (
        <Modal
          open
          title="Optional modules"
          onClose={() =>
            void store.setSettings({
              optionalModulesOnboarded: true,
              showerEnabled: enableShower,
              checkInsEnabled: enableCheckIns,
            })
          }
        >
          <p>
            Choose the optional daily tools you want to see. You can change
            either choice in Settings later.
          </p>
          <label>
            <input
              type="checkbox"
              checked={enableShower}
              onChange={(event) => setEnableShower(event.target.checked)}
            />{' '}
            Shower timer and tracking
          </label>
          <label>
            <input
              type="checkbox"
              checked={enableCheckIns}
              onChange={(event) => setEnableCheckIns(event.target.checked)}
            />{' '}
            Daily check-ins
          </label>
          <div className="form-actions">
            <button
              className="primary-button"
              onClick={() =>
                void store.setSettings({
                  optionalModulesOnboarded: true,
                  showerEnabled: enableShower,
                  checkInsEnabled: enableCheckIns,
                })
              }
            >
              Save choices
            </button>
          </div>
        </Modal>
      )}
      {visibleProject && (
        <ProjectEditor
          project={visibleProject === 'new' ? undefined : visibleProject}
          onClose={() => {
            setProjectEditor(null);
            if (route.startsWith('project-settings/'))
              navigate(`project/${route.split('/')[1]}`);
          }}
        />
      )}
      {search !== null && (
        <Modal
          open
          title="Search your workspace"
          onClose={() => setSearch(null)}
        >
          <input
            className="text-input"
            aria-label="Workspace search"
            placeholder="Tasks, notes, projects…"
            value={search}
            onChange={(e) => {
              searchRun.current++;
              setSearchResults([]);
              setSearchState('searching');
              setSearch(e.target.value);
            }}
          />
          <div className="search-results">
            {searchState === 'searching' && (
              <output className="hydration-notice">
                Searching this device…
              </output>
            )}
            {searchState === 'error' && (
              <p role="alert" className="form-error">
                Search is unavailable. Please retry.
              </p>
            )}
            {searchResults.map((entity) => {
              const row = (menu: React.ReactNode) => (
                <div className="core-item-row">
                  <button
                    className="search-result"
                    onClick={() => goResult(entity)}
                  >
                    <span>
                      {stringValue(
                        entity.data.title ||
                          entity.data.text ||
                          'Untitled note',
                      ).slice(0, 150)}
                    </span>
                    <small>{entity.kind}</small>
                  </button>
                  {menu}
                </div>
              );
              return entity.kind === 'task' ? (
                <TaskActionSurface
                  key={entity.id}
                  task={entity}
                  onEdit={() => goResult(entity)}
                >
                  {row}
                </TaskActionSurface>
              ) : (
                <CoreItemActionSurface
                  key={entity.id}
                  entity={entity}
                  onOpen={() => goResult(entity)}
                >
                  {row}
                </CoreItemActionSurface>
              );
            })}
            {searchResults.length === 0 && searchState === 'done' && (
              <p className="muted">No matching records.</p>
            )}
          </div>
          <p className="muted">
            Press Q anywhere to add a task. ⌘/Ctrl K opens search.
          </p>
        </Modal>
      )}
      <AlarmOverlay />
      <CheckInReminder />
      <datalist id="timezones" aria-label="Suggested timezones">
        {[
          'America/Toronto',
          'America/New_York',
          'America/Chicago',
          'America/Denver',
          'America/Los_Angeles',
          'Europe/London',
          'Europe/Paris',
          'Asia/Tokyo',
          'Asia/Seoul',
          'Asia/Kolkata',
          'Australia/Sydney',
          'UTC',
        ].map((z) => (
          <option key={z} value={z}>
            {z}
          </option>
        ))}
      </datalist>
    </div>
  );
}
export default function Stride() {
  return (
    <StoreProvider>
      <UpdateProvider>
        <WebMCP />
        <Workspace />
      </UpdateProvider>
    </StoreProvider>
  );
}
