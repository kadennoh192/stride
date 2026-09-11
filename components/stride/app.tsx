'use client';
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
  ListFilter,
  FileText,
  Grid2X2,
  Flame,
  Timer,
  TrendingUp,
  Sparkles,
  Settings,
  Plus,
  Cloud,
  Menu,
  X,
  ChevronRight,
  Archive,
  Undo2,
  LayoutGrid,
  History,
  CheckCheck,
} from 'lucide-react';
import { StoreProvider, useStride } from '@/lib/stride/store';
import { type Task, type Project } from '@/lib/stride/types';
import { Tasks, TaskEditor, ProjectEditor } from './features/tasks';
import { Calendar } from './features/views';
import { useMediaQuery } from '@/hooks/use-media-query';
import { WebMCP } from '@/lib/stride/webmcp';
import { Modal } from './primitives';
import { Loading } from './forms';
const icons = {
  inbox: Inbox,
  today: Sun,
  upcoming: CalendarRange,
  tasks: CheckCheck,
  calendar: CalendarDays,
  filters: ListFilter,
  pages: FileText,
  databases: Grid2X2,
  habits: Flame,
  focus: Timer,
  matrix: LayoutGrid,
  countdowns: CalendarRange,
  insights: TrendingUp,
  explore: Sparkles,
  archive: Archive,
  history: History,
  settings: Settings,
};
const names: Record<string, string> = {
  inbox: 'Inbox',
  today: 'Today',
  upcoming: 'Upcoming',
  tasks: 'All tasks',
  calendar: 'Calendar',
  filters: 'Filters & labels',
  pages: 'Pages',
  databases: 'Databases',
  habits: 'Habits',
  focus: 'Focus',
  matrix: 'Eisenhower Matrix',
  countdowns: 'Countdowns',
  insights: 'Insights',
  explore: 'Explore',
  archive: 'Completed tasks',
  history: 'Activity',
  settings: 'Settings',
};
const Pages = lazy(() => import('./features/pages'));
const Databases = lazy(() => import('./features/databases'));
const SettingsPage = lazy(() => import('./features/settings'));
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
const Explore = lazy(() =>
  import('./features/productivity').then((m) => ({ default: m.Explore })),
);
const Activity = lazy(() =>
  import('./features/productivity').then((m) => ({ default: m.Activity })),
);
const enabled = [
  'inbox',
  'today',
  'upcoming',
  'tasks',
  'calendar',
  'filters',
  'pages',
  'databases',
  'habits',
  'focus',
  'matrix',
  'countdowns',
  'insights',
  'explore',
  'archive',
  'history',
];
function readRoute() {
  try {
    return decodeURIComponent(location.hash.slice(1)) || 'today';
  } catch {
    return 'today';
  }
}
function subscribeRoute(callback: () => void) {
  window.addEventListener('hashchange', callback);
  return () => window.removeEventListener('hashchange', callback);
}
function Workspace() {
  const store = useStride();
  const route = useSyncExternalStore(subscribeRoute, readRoute, () => 'today');
  const [navOpen, setNavOpen] = useState(false);
  const compact = useMediaQuery('(max-width: 1023px)');
  const sidebarRef = useRef<HTMLElement>(null);
  const [search, setSearch] = useState<string | null>(null);
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
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setNavOpen(false);
        setSearch('');
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
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
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
  ];
  const projects = store.entities.filter(
    (e) => e.kind === 'project',
  ) as Project[];
  const filters = store.entities.filter(
    (e) => e.kind === 'view' && e.data.filter,
  );
  const results =
    search !== null
      ? store.entities
          .filter(
            (e) =>
              [
                'task',
                'page',
                'project',
                'database',
                'habit',
                'block',
              ].includes(e.kind) &&
              `${e.data.title || ''} ${e.data.text || ''} ${e.data.description || ''}`
                .toLowerCase()
                .includes(search.toLowerCase()),
          )
          .slice(0, 50)
      : [];
  const title =
    names[route] ||
    stringValue(
      store.entities.find((e) => e.id === route.split('/')[1])?.data.title ||
        'Workspace',
    );
  const goResult = (e: (typeof store.entities)[number]) => {
    setSearch(null);
    if (e.kind === 'task') {
      setTaskEditor(e as Task);
    } else
      navigate(
        `${e.kind === 'block' ? 'page' : e.kind}/${e.kind === 'block' ? e.data.page : e.id}`,
      );
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
            setNavOpen(false);
            setSearch('');
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
          {filters.length > 0 && (
            <>
              <div className="nav-label">SAVED FILTERS</div>
              <nav className="nav-group">
                {filters.map((f) => (
                  <button
                    className="nav-item"
                    key={f.id}
                    onClick={() => navigate(`filter/${f.id}`)}
                  >
                    <ListFilter />
                    {stringValue(f.data.title)}
                  </button>
                ))}
              </nav>
            </>
          )}
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
          <div>
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
          <div>
            {store.canUndo && (
              <button
                className="subtle-button"
                onClick={() => void store.undo()}
              >
                <Undo2 size={16} />
                Undo
              </button>
            )}
            <button
              className="icon-button"
              aria-label="Search"
              onClick={() => {
                setNavOpen(false);
                setSearch('');
              }}
            >
              <Search size={18} />
            </button>
          </div>
        </header>
        <div
          className="page-content"
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
          {!store.ready ? (
            <Loading />
          ) : (
            <Suspense fallback={<Loading />}>
              {route === 'calendar' ? (
                <Calendar onEdit={setTaskEditor} onAdd={() => add()} />
              ) : route === 'settings' ? (
                <SettingsPage />
              ) : route === 'pages' || route.startsWith('page/') ? (
                <Pages pageId={route.split('/')[1]} />
              ) : route === 'databases' || route.startsWith('database/') ? (
                <Databases databaseId={route.split('/')[1]} />
              ) : route === 'habits' || route.startsWith('habit/') ? (
                <Habits />
              ) : route === 'focus' ? (
                <Focus />
              ) : route === 'matrix' ? (
                <Matrix onEdit={setTaskEditor} />
              ) : route === 'countdowns' ? (
                <Countdowns />
              ) : route === 'insights' ? (
                <Insights />
              ) : route === 'explore' ? (
                <Explore />
              ) : route === 'history' ? (
                <Activity />
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
              setNavOpen(false);
              setSearch('');
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
            placeholder="Tasks, pages, projects, blocks…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="search-results">
            {results.map((e) => (
              <button
                key={e.id}
                className="search-result"
                onClick={() => goResult(e)}
              >
                <span>
                  {stringValue(e.data.title || e.data.text || 'Untitled').slice(
                    0,
                    150,
                  )}
                </span>
                <small>{e.kind}</small>
              </button>
            ))}
            {results.length === 0 && (
              <p className="muted">No matching records.</p>
            )}
          </div>
          <p className="muted">
            Press Q anywhere to add a task. ⌘/Ctrl K opens search.
          </p>
        </Modal>
      )}
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
      <WebMCP />
      <Workspace />
    </StoreProvider>
  );
}
