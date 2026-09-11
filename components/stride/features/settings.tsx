'use client';
import { stringValue } from '@/lib/stride/types';

import { useEffect, useState } from 'react';
import {
  Settings as SettingsIcon,
  Cloud,
  Download,
  Shield,
  Palette,
  Sparkles,
  Bell,
  Trash2,
  Watch,
  Copy,
  Link2,
} from 'lucide-react';
import { useStride } from '@/lib/stride/store';
import {
  transact,
  applyEdits,
  materialize,
  VERSION,
  listRecovery,
  restoreSnapshot,
} from '@/lib/stride/storage';
import {
  exportBackupArchive,
  stageBackup,
  stageBackupFile,
  restoreBackup,
  type StagedBackup,
  decodeBytes,
} from '@/lib/stride/backup';
import { downloadBlob } from '@/lib/stride/files';
import { Field, Select, ReorderButtons } from '../forms';
import { Modal } from '../primitives';
const navigation = [
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
const customColors = [
  ['workspaceBackground', 'Workspace background'],
  ['surfaceColor', 'Cards and editors'],
  ['textColor', 'Primary text'],
  ['mutedColor', 'Subtle surfaces'],
  ['mutedTextColor', 'Secondary text'],
  ['borderColor', 'Borders'],
  ['sidebarColor', 'Sidebar'],
  ['accentSurfaceColor', 'Selected items'],
] as const;
function contrastRatio(left: string, right: string) {
  const luminance = (hex: string) => {
    const channels = [1, 3, 5].map((offset) =>
      parseInt(hex.slice(offset, offset + 2), 16),
    );
    const linear = channels.map((channel) => {
      const value = channel / 255;
      return value <= 0.04045
        ? value / 12.92
        : ((value + 0.055) / 1.055) ** 2.4;
    });
    return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
  };
  const values = [luminance(left), luminance(right)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}
export default function Settings() {
  const store = useStride();
  const [tab, setTab] = useState('appearance');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [aiKey, setAIKey] = useState(() =>
    typeof window === 'undefined'
      ? ''
      : localStorage.getItem('stride-gemini-key') || '',
  );
  const [backupCode, setBackupCode] = useState('');
  const [restoreCode, setRestoreCode] = useState('');
  const [staged, setStaged] = useState<StagedBackup | null>(null);
  const [push, setPush] = useState<{
    configured: boolean;
    publicKey: string;
    signedIn: boolean;
  } | null>(null);
  const [permission, setPermission] = useState(() =>
    typeof Notification === 'undefined'
      ? 'unsupported'
      : Notification.permission,
  );
  const [storage, setStorage] = useState<{
    usage?: number;
    quota?: number;
    persistent: boolean;
  } | null>(null);
  const [trash, setTrash] = useState(false);
  const [recoveries, setRecoveries] = useState<
    Awaited<ReturnType<typeof listRecovery>>
  >([]);
  const [confirmedRestore, setConfirmedRestore] = useState(false);
  const [watchPairing, setWatchPairing] = useState<{
    code: string;
    expires: string;
  } | null>(null);
  const [watchLink, setWatchLink] = useState<{
    url: string;
    expires: string;
  } | null>(null);
  const [model, setModel] = useState(store.settings.model);
  const [name, setName] = useState(store.settings.name);
  const deleted = store.snapshot
    ? materialize(store.snapshot.fields, true).filter((e) => e.deleted)
    : [];
  const order = [
    ...store.settings.navOrder,
    ...navigation.filter((n) => !store.settings.navOrder.includes(n)),
  ];
  useEffect(() => {
    void fetch('/api/push')
      .then((r) => r.json())
      .then((v) => setPush(v as typeof push))
      .catch(() => {});
    void listRecovery(store.owner).then(setRecoveries);
    if (navigator.storage)
      void Promise.all([
        navigator.storage.estimate(),
        navigator.storage.persisted?.() || false,
      ]).then(([estimate, persistent]) =>
        setStorage({ ...estimate, persistent }),
      );
  }, [store.owner]);
  const action = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMessage('');
    try {
      await fn();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : stringValue(e));
    } finally {
      setBusy(false);
    }
  };
  const accountAction = async (actionName: string) =>
    action(async () => {
      let subscription: PushSubscription | null = null;
      let reminderRemovalWarning = false;
      if (actionName === 'logout') {
        const registration = await navigator.serviceWorker?.getRegistration();
        subscription =
          (await registration?.pushManager?.getSubscription()) || null;
        if (subscription) {
          const removal = await fetch('/api/push', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'remove',
              subscription: subscription.toJSON(),
            }),
          });
          reminderRemovalWarning = !removal.ok;
        }
      }
      const response = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: actionName, email, password }),
      });
      const data = (await response.json()) as {
        error?: string;
        verifyEmail?: boolean;
      };
      if (!response.ok) throw new Error(data.error || 'Account request failed');
      if (actionName === 'logout') await subscription?.unsubscribe();
      setPassword('');
      setMessage(
        actionName === 'logout' && reminderRemovalWarning
          ? 'Signed out and disabled this browser’s push endpoint. Server cleanup could not be confirmed and will be retried when that endpoint rejects delivery.'
          : data.verifyEmail
            ? 'Check your email to verify your account.'
            : actionName === 'recover'
              ? 'If that account exists, a recovery email has been sent.'
              : actionName === 'password'
                ? 'Password updated.'
                : 'Account updated.',
      );
      await store.refreshAccount();
    });
  const subscribe = async (test = false) =>
    action(async () => {
      if (!push?.configured)
        throw new Error('Background reminders need server configuration.');
      if (!store.account.user)
        throw new Error('Sign in before enabling background reminders.');
      if (
        !('Notification' in window) ||
        !('PushManager' in window) ||
        !('serviceWorker' in navigator)
      )
        throw new Error('Web Push is not available in this browser.');
      const allowed = await Notification.requestPermission();
      setPermission(allowed);
      if (allowed !== 'granted')
        throw new Error(
          'Notifications were not enabled. You can change this in browser settings.',
        );
      const registration = await navigator.serviceWorker.ready;
      const subscription =
        (await registration.pushManager.getSubscription()) ||
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: decodeBytes(push.publicKey),
        }));
      const r = await fetch('/api/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: test ? 'test' : 'subscribe',
          subscription: subscription.toJSON(),
        }),
      });
      const data = (await r.json()) as { error?: string };
      if (!r.ok) throw new Error(data.error);
      setMessage(
        test
          ? 'Test notification sent.'
          : 'This device is connected for background reminders.',
      );
      await store.sync();
    });
  const setting = (key: string, value: unknown) =>
    void store.setSettings({ [key]: value });
  const textContrast = contrastRatio(
    store.settings.workspaceBackground,
    store.settings.textColor,
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">MAKE STRIDE YOURS</div>
          <h1>Settings</h1>
        </div>
      </div>
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings categories">
          {[
            ['appearance', 'Appearance', Palette],
            ['navigation', 'Navigation', SettingsIcon],
            ['account', 'Account & sync', Cloud],
            ['notifications', 'Notifications', Bell],
            ['watch', 'Apple Watch', Watch],
            ['ai', 'Gemini input', Sparkles],
            ['backup', 'Backup & restore', Download],
            ['data', 'Storage & recovery', Shield],
          ].map(([id, label, Icon]) => {
            const I = Icon as typeof Cloud;
            return (
              <button
                className={`nav-item ${tab === id ? 'active' : ''}`}
                key={stringValue(id)}
                onClick={() => {
                  setTab(stringValue(id));
                  setMessage('');
                }}
              >
                <I size={17} />
                {stringValue(label)}
              </button>
            );
          })}
        </nav>
        <section className="settings-content">
          {tab === 'appearance' && (
            <>
              <h2>Appearance</h2>
              <div className="theme-presets">
                {[
                  ['Indigo', '#5268e8'],
                  ['Ocean', '#087a98'],
                  ['Forest', '#278363'],
                  ['Plum', '#8550b4'],
                  ['Graphite', '#526071'],
                ].map(([name, color]) => (
                  <button
                    key={name}
                    className="theme-preset"
                    style={{
                      borderColor:
                        store.settings.accent === color ? color : undefined,
                    }}
                    onClick={() => setting('accent', color)}
                  >
                    <span style={{ background: color }} />
                    {name}
                  </button>
                ))}
              </div>
              <div className="form-grid">
                <Field label="Color mode">
                  <Select
                    value={store.settings.theme}
                    onChange={(v) => setting('theme', v)}
                    options={['light', 'dark', 'system', 'custom']}
                  />
                </Field>
                <Field label="Custom accent">
                  <input
                    type="color"
                    value={store.settings.accent}
                    onChange={(e) => setting('accent', e.target.value)}
                  />
                </Field>
                <Field label="Density">
                  <Select
                    value={store.settings.density}
                    onChange={(v) => setting('density', v)}
                    options={['compact', 'comfortable', 'spacious']}
                  />
                </Field>
                <Field label="Typography">
                  <Select
                    value={store.settings.font}
                    onChange={(v) => setting('font', v)}
                    options={[
                      { value: 'sans', label: 'Modern sans' },
                      { value: 'serif', label: 'Editorial serif' },
                      { value: 'mono', label: 'Monospace' },
                    ]}
                  />
                </Field>
                <Field label="Display name">
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onBlur={() => setting('name', name)}
                  />
                </Field>
                <Field label="Workspace timezone">
                  <input
                    list="timezones"
                    value={store.settings.timezone}
                    placeholder="Example: America/Toronto"
                    onChange={(e) => setting('timezone', e.target.value)}
                  />
                </Field>
                <Field label="Daily task goal">
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={store.settings.dailyGoal}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (v >= 1 && v <= 100) setting('dailyGoal', v);
                    }}
                  />
                </Field>
              </div>
              {store.settings.theme === 'custom' && (
                <section
                  className="custom-theme"
                  aria-labelledby="palette-title"
                >
                  <h3 id="palette-title">Custom palette</h3>
                  <div className="form-grid">
                    {customColors.map(([key, label]) => (
                      <Field key={key} label={label}>
                        <input
                          type="color"
                          value={stringValue(store.settings[key])}
                          onChange={(event) => setting(key, event.target.value)}
                        />
                      </Field>
                    ))}
                  </div>
                  <output
                    className={`contrast-status ${textContrast < 4.5 ? 'low' : ''}`}
                    aria-live="polite"
                  >
                    Text contrast is {textContrast.toFixed(2)}:1.{' '}
                    {textContrast >= 4.5
                      ? 'This meets WCAG AA for normal text.'
                      : 'Choose text and background colors with at least 4.5:1 contrast.'}
                  </output>
                  <button
                    className="secondary-button"
                    onClick={() =>
                      void store.setSettings({
                        workspaceBackground: '#ffffff',
                        surfaceColor: '#ffffff',
                        textColor: '#282c3b',
                        mutedColor: '#f6f7fa',
                        mutedTextColor: '#737888',
                        borderColor: '#e9ebf0',
                        sidebarColor: '#f8f9fc',
                        accentSurfaceColor: '#edf0ff',
                      })
                    }
                  >
                    Reset custom palette
                  </button>
                </section>
              )}
              <label className="checkline">
                <input
                  type="checkbox"
                  checked={store.settings.motion}
                  onChange={(e) => setting('motion', e.target.checked)}
                />
                Enable lightweight animations
              </label>
              <p className="muted">
                Your device’s reduced-motion preference always takes precedence.
              </p>
              <label className="checkline">
                <input
                  type="checkbox"
                  checked={store.settings.rightPanel}
                  onChange={(e) => setting('rightPanel', e.target.checked)}
                />
                Show the Today panel on large screens
              </label>
              <p className="muted">
                Project backgrounds and page covers are set inside their own
                settings.
              </p>
            </>
          )}
          {tab === 'navigation' && (
            <>
              <h2>Navigation</h2>
              <p className="muted">
                Choose the features you want in your sidebar and arrange them
                around your workflow. Settings always stays accessible.
              </p>
              {order.map((key, i) => (
                <div className="nav-setting" key={key}>
                  <label className="checkline">
                    <input
                      type="checkbox"
                      checked={!store.settings.hidden.includes(key)}
                      onChange={(e) =>
                        setting(
                          'hidden',
                          e.target.checked
                            ? store.settings.hidden.filter((n) => n !== key)
                            : [...store.settings.hidden, key],
                        )
                      }
                    />
                    {key[0].toUpperCase() + key.slice(1)}
                  </label>
                  <ReorderButtons
                    up={
                      i
                        ? () => {
                            const next = [...order];
                            [next[i - 1], next[i]] = [next[i], next[i - 1]];
                            setting('navOrder', next);
                          }
                        : undefined
                    }
                    down={
                      i < order.length - 1
                        ? () => {
                            const next = [...order];
                            [next[i + 1], next[i]] = [next[i], next[i + 1]];
                            setting('navOrder', next);
                          }
                        : undefined
                    }
                  />
                </div>
              ))}
              <button
                className="secondary-button"
                onClick={() =>
                  void store.setSettings({ hidden: [], navOrder: [] })
                }
              >
                Reset navigation
              </button>
            </>
          )}
          {tab === 'account' && (
            <>
              <h2>Account & sync</h2>
              <div className="sync-status-card">
                <Cloud size={22} />
                <div>
                  <strong>{store.syncStatus}</strong>
                  <p className="muted">
                    {store.owner === 'guest'
                      ? 'Local-only workspace · cloud sync is not active'
                      : `${store.snapshot?.outbox.length || 0} pending changes · last sync ${
                          store.snapshot?.lastSync
                            ? new Date(
                                store.snapshot.lastSync,
                              ).toLocaleString()
                            : 'not yet'
                        }`}
                  </p>
                </div>
              </div>
              {!store.account.configured && (
                <div className="inset-panel">
                  <h3>Cloud accounts are not configured</h3>
                  <p className="muted">
                    This installation needs a Supabase project and production
                    email delivery. Until connected, your workspace stays on
                    this device. Export a backup before changing browsers or
                    clearing browser data.
                  </p>
                </div>
              )}
              {store.account.user ? (
                <>
                  <p>Signed in as {store.account.user.email}</p>
                  <div className="form-actions">
                    <button
                      className="secondary-button"
                      onClick={() => void store.sync()}
                    >
                      Sync now
                    </button>
                    <button
                      className="secondary-button"
                      onClick={() => void accountAction('logout')}
                      disabled={busy}
                    >
                      Sign out
                    </button>
                  </div>
                  <Field label="New password">
                    <input
                      autoComplete="new-password"
                      type="password"
                      minLength={8}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </Field>
                  <button
                    className="secondary-button"
                    disabled={busy || password.length < 8}
                    onClick={() => void accountAction('password')}
                  >
                    Update password
                  </button>
                </>
              ) : (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void accountAction('login');
                  }}
                >
                  <Field label="Email">
                    <input
                      required
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      disabled={!store.account.configured}
                    />
                  </Field>
                  <Field label="Password">
                    <input
                      required
                      type="password"
                      minLength={8}
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      disabled={!store.account.configured}
                    />
                  </Field>
                  <div className="form-actions">
                    {store.account.signupAllowed && (
                      <button
                        className="secondary-button"
                        type="button"
                        disabled={
                          !store.account.configured ||
                          busy ||
                          !email ||
                          password.length < 8
                        }
                        onClick={() => void accountAction('signup')}
                      >
                        Create owner account
                      </button>
                    )}
                    <button
                      className="primary-button"
                      disabled={!store.account.configured || busy}
                    >
                      Sign in
                    </button>
                  </div>
                  <button
                    className="subtle-button"
                    type="button"
                    disabled={!store.account.configured || busy || !email}
                    onClick={() => void accountAction('recover')}
                  >
                    Send password recovery email
                  </button>
                  {!store.account.signupAllowed && store.account.configured && (
                    <p className="muted">
                      This is a private workspace. Sign in with its configured
                      owner email.
                    </p>
                  )}
                </form>
              )}
              <p className="muted">
                Accounts have separate local workspaces. To transfer guest data,
                export it before signing in, then explicitly restore that backup
                in your account.
              </p>
              <p className="muted">
                A private preview may still require its hosting access login.
                Independent access is enabled at production release.
              </p>
            </>
          )}
          {tab === 'notifications' && (
            <>
              <h2>Notifications</h2>
              <p className="muted">
                iPhone and iPad need Stride added to the Home Screen before
                background notifications can be enabled. Delivery depends on the
                OS and a network connection.
              </p>
              <div className="capability-list">
                <p>
                  <strong>Browser permission:</strong> {permission}
                </p>
                <p>
                  <strong>Server reminders:</strong>{' '}
                  {push?.configured ? 'Configured' : 'Not configured'}
                </p>
                <p>
                  <strong>App installation:</strong>{' '}
                  {typeof window !== 'undefined' &&
                  matchMedia('(display-mode: standalone)').matches
                    ? 'Home Screen / standalone'
                    : 'Browser tab'}
                </p>
              </div>
              <div className="form-actions">
                <button
                  className="primary-button"
                  disabled={
                    busy ||
                    !push?.configured ||
                    !store.account.user ||
                    permission === 'unsupported'
                  }
                  onClick={() => void subscribe()}
                >
                  Enable on this device
                </button>
                <button
                  className="secondary-button"
                  disabled={
                    busy ||
                    !push?.configured ||
                    !store.account.user ||
                    permission !== 'granted'
                  }
                  onClick={() => void subscribe(true)}
                >
                  Send test notification
                </button>
                <button
                  className="secondary-button"
                  disabled={
                    busy ||
                    !push?.configured ||
                    !store.account.user ||
                    permission === 'unsupported'
                  }
                  onClick={() =>
                    void action(async () => {
                      const registration =
                        await navigator.serviceWorker?.getRegistration();
                      const subscription =
                        await registration?.pushManager?.getSubscription();
                      if (subscription) {
                        await fetch('/api/push', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            action: 'remove',
                            subscription: subscription.toJSON(),
                          }),
                        });
                        await subscription.unsubscribe();
                      }
                      setMessage(
                        'Background reminders disconnected on this device.',
                      );
                    })
                  }
                >
                  Disconnect device
                </button>
              </div>
              <div className="form-grid">
                <Field label="Quiet hours start">
                  <input
                    type="time"
                    value={store.settings.quietStart}
                    onChange={(e) => setting('quietStart', e.target.value)}
                  />
                </Field>
                <Field label="Quiet hours end">
                  <input
                    type="time"
                    value={store.settings.quietEnd}
                    onChange={(e) => setting('quietEnd', e.target.value)}
                  />
                </Field>
              </div>
              <p className="muted">
                Set matching start/end times to disable quiet hours. Configure
                task reminders in task details and habit reminders inside each
                habit. Repeated task reminders stop after 12 attempts or
                completion.
              </p>
              {!push?.configured && (
                <p className="muted">
                  Server setup requires VAPID credentials and the separately
                  hosted reminder scheduler. Local editing is fully available
                  without these services.
                </p>
              )}
            </>
          )}
          {tab === 'watch' && (
            <>
              <h2>Apple Watch & Watch Link</h2>
              <p className="muted">
                Watch Link is a small online view you can open from Mail or
                Messages on Apple Watch. It shows upcoming tasks, habits and
                focus controls. It is not an installed Watch app and does not
                save changes offline.
              </p>
              {!store.account.user && (
                <div className="inset-panel">
                  <h3>Sign in before pairing</h3>
                  <p className="muted">
                    A Watch Link connects to the currently signed-in workspace.
                    Local guest data never leaves this browser.
                  </p>
                </div>
              )}
              {watchLink && (
                <div className="watch-link-share">
                  <div>
                    <Link2 />
                    <div>
                      <strong>Your private Watch Link</strong>
                      <p className="muted">
                        Expires{' '}
                        {new Date(watchLink.expires).toLocaleDateString()}.
                        Anyone with this link can use the limited Watch
                        controls.
                      </p>
                    </div>
                  </div>
                  <input
                    aria-label="Private Watch Link"
                    readOnly
                    value={watchLink.url}
                    onFocus={(event) => event.currentTarget.select()}
                  />
                  <button
                    className="primary-button"
                    onClick={() =>
                      void action(async () => {
                        if (!navigator.clipboard)
                          throw new Error(
                            'Select the link above and copy it manually.',
                          );
                        await navigator.clipboard.writeText(watchLink.url);
                        setMessage(
                          'Watch Link copied. Send it only to yourself.',
                        );
                      })
                    }
                  >
                    <Copy /> Copy link
                  </button>
                </div>
              )}
              {watchPairing && (
                <output className="watch-pairing">
                  <span>NATIVE APP PAIRING CODE</span>
                  <strong>{watchPairing.code}</strong>
                  <p>
                    Enter this code in Stride on Apple Watch before{' '}
                    {new Date(watchPairing.expires).toLocaleTimeString([], {
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                    . It can be used once.
                  </p>
                </output>
              )}
              <div className="form-actions">
                <button
                  className="primary-button"
                  disabled={busy || !store.account.user}
                  onClick={() =>
                    void action(async () => {
                      const response = await fetch('/api/watch/pair', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ action: 'createLink' }),
                      });
                      const data = (await response.json()) as {
                        token?: string;
                        expires?: string;
                        error?: string;
                      };
                      if (!response.ok || !data.token || !data.expires)
                        throw new Error(
                          data.error || 'Watch Link is unavailable.',
                        );
                      setWatchLink({
                        url: `${location.origin}/watch#token=${encodeURIComponent(data.token)}`,
                        expires: data.expires,
                      });
                      setMessage(
                        'Watch Link ready. Copy it and send it only to yourself.',
                      );
                    })
                  }
                >
                  Create Watch Link
                </button>
                <button
                  className="secondary-button"
                  disabled={busy || !store.account.user}
                  onClick={() =>
                    void action(async () => {
                      const response = await fetch('/api/watch/pair', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ action: 'create' }),
                      });
                      const data = (await response.json()) as {
                        code?: string;
                        expires?: string;
                        error?: string;
                      };
                      if (!response.ok || !data.code || !data.expires)
                        throw new Error(
                          data.error || 'Pairing is unavailable.',
                        );
                      setWatchPairing({
                        code: data.code,
                        expires: data.expires,
                      });
                      setMessage('Pairing code ready for ten minutes.');
                    })
                  }
                >
                  Pair future native app
                </button>
                <button
                  className="secondary-button"
                  disabled={busy || !store.account.user}
                  onClick={() =>
                    void action(async () => {
                      const response = await fetch('/api/watch/pair', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ action: 'revoke' }),
                      });
                      const data = (await response.json()) as {
                        error?: string;
                      };
                      if (!response.ok)
                        throw new Error(
                          data.error || 'Could not disconnect watches.',
                        );
                      setWatchPairing(null);
                      setWatchLink(null);
                      setMessage(
                        'All Watch links and native apps were disconnected.',
                      );
                    })
                  }
                >
                  Revoke all Watch access
                </button>
              </div>
              <p className="muted">
                Watch links and native-app access expire after one year and can
                be revoked here at any time. Native pairing codes expire after
                ten minutes and can be used once. The Watch Link requires an
                internet connection and a production address reachable from the
                Watch.
              </p>
            </>
          )}
          {tab === 'ai' && (
            <>
              <h2>Gemini task input</h2>
              <p className="muted">
                Optional. Stride works without AI. Your key is stored only in
                this browser and is excluded from sync and backups.
              </p>
              <Field label="Your Gemini API key">
                <input
                  type="password"
                  autoComplete="off"
                  value={aiKey}
                  onChange={(e) => setAIKey(e.target.value)}
                  placeholder="Paste your own key"
                />
              </Field>
              <Field label="Model">
                <input
                  list="gemini-models"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="Gemini model ID"
                />
              </Field>
              <datalist id="gemini-models" aria-label="Suggested Gemini models">
                <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
                <option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
              </datalist>
              <p className="muted">
                Enter any generateContent model available to your key. Model
                availability and quotas come from Google.
              </p>
              <div className="form-actions">
                <button
                  className="secondary-button"
                  onClick={() => {
                    localStorage.removeItem('stride-gemini-key');
                    setAIKey('');
                    setMessage('Key removed from this browser.');
                  }}
                >
                  Remove key
                </button>
                <button
                  className="primary-button"
                  onClick={() =>
                    void action(async () => {
                      if (!/^[a-zA-Z0-9._-]{1,100}$/.test(model))
                        throw new Error('Enter a valid model ID');
                      if (aiKey)
                        localStorage.setItem('stride-gemini-key', aiKey);
                      else localStorage.removeItem('stride-gemini-key');
                      await store.setSettings({ model });
                      setMessage(
                        'AI settings saved. Use Parse with Gemini in the task editor.',
                      );
                    })
                  }
                >
                  Save AI settings
                </button>
              </div>
            </>
          )}
          {tab === 'backup' && (
            <>
              <h2>Backup & restore</h2>
              <p className="muted">
                Export your tasks, pages, databases, settings, history,
                templates and attachments. Restoring replaces this workspace and
                queues the restored records for sync. The .stride file keeps
                large attachments out of memory; compact codes are also offered
                when the workspace is small enough. Credentials and notification
                subscriptions are excluded.
              </p>
              <div className="form-actions">
                <button
                  className="primary-button"
                  disabled={busy}
                  onClick={() =>
                    void action(async () => {
                      const backup = await exportBackupArchive(store.owner);
                      setBackupCode(backup.code);
                      downloadBlob(
                        backup.blob,
                        `stride-backup-${new Date().toISOString().slice(0, 10)}.stride`,
                      );
                      setMessage(
                        backup.code
                          ? 'Complete Stride backup downloaded. Your compact export code is ready below.'
                          : 'Complete Stride backup downloaded. This workspace is too large for a safe in-memory export code.',
                      );
                    })
                  }
                >
                  <Download size={16} />
                  {busy ? 'Working…' : 'Create complete backup'}
                </button>
              </div>
              {backupCode && (
                <>
                  <Field label="Compact export code">
                    <textarea
                      className="export-code"
                      readOnly
                      value={backupCode}
                    />
                  </Field>
                  <div className="form-actions">
                    <button
                      className="secondary-button"
                      onClick={() =>
                        void action(async () => {
                          await navigator.clipboard.writeText(backupCode);
                          setMessage('Export code copied.');
                        })
                      }
                    >
                      Copy code
                    </button>
                    <button
                      className="secondary-button"
                      onClick={() =>
                        downloadBlob(
                          new Blob([backupCode], { type: 'text/plain' }),
                          'stride-backup.stride',
                        )
                      }
                    >
                      Download code
                    </button>
                  </div>
                  <p className="muted">
                    {Math.round(backupCode.length / 1024)} KB. Keep this code
                    private; it contains your workspace.
                  </p>
                </>
              )}
              <hr />
              <h3>Restore a backup</h3>
              <Field label="Paste a Stride export code or JSON">
                <textarea
                  value={restoreCode}
                  onChange={(e) => {
                    setRestoreCode(e.target.value);
                    setStaged(null);
                  }}
                />
              </Field>
              <Field label="Or choose a backup file">
                <input
                  type="file"
                  accept=".json,.stride,.txt"
                  onChange={(e) =>
                    void action(async () => {
                      const f = e.target.files?.[0];
                      if (!f) return;
                      setStaged(await stageBackupFile(f));
                      setConfirmedRestore(false);
                      setRestoreCode('');
                      setMessage(
                        'Backup validated. Review its contents before restoring.',
                      );
                    })
                  }
                />
              </Field>
              <button
                className="secondary-button"
                disabled={busy || !restoreCode.trim()}
                onClick={() =>
                  void action(async () => {
                    setStaged(await stageBackup(restoreCode));
                    setConfirmedRestore(false);
                    setMessage(
                      'Backup validated. Review its contents before restoring.',
                    );
                  })
                }
              >
                <Shield size={16} />
                Validate & preview
              </button>
              {staged && (
                <div className="inset-panel">
                  <h3>Ready to restore</h3>
                  <p>
                    {staged.records} records · {staged.files.length} attachments
                    · {(staged.bytes / 1000000).toFixed(1)} MB
                  </p>
                  <p className="muted">
                    Created {new Date(staged.backup.created).toLocaleString()}.
                    A recovery snapshot of your current workspace will be kept.
                  </p>
                  <label className="checkline">
                    <input
                      type="checkbox"
                      checked={confirmedRestore}
                      onChange={(e) => setConfirmedRestore(e.target.checked)}
                    />
                    Replace the current workspace with this backup
                  </label>
                  <button
                    className="primary-button"
                    disabled={busy || !confirmedRestore}
                    onClick={() =>
                      void action(async () => {
                        await restoreBackup(staged, store.owner);
                        await store.reload();
                        void store.sync();
                        setStaged(null);
                        setRestoreCode('');
                        setMessage('Workspace restored successfully.');
                      })
                    }
                  >
                    Restore workspace
                  </button>
                </div>
              )}
            </>
          )}
          {tab === 'data' && (
            <>
              <h2>Storage & recovery</h2>
              <p className="muted">
                Storage format {VERSION} · {store.entities.length} records ·{' '}
                {store.history.length} activity events
              </p>
              <p className="muted">
                {storage
                  ? `${((storage.usage || 0) / 1000000).toFixed(1)} MB used of ${((storage.quota || 0) / 1000000).toFixed(0)} MB available. ${storage.persistent ? 'Persistent storage granted.' : 'Storage persistence is managed by your browser.'}`
                  : 'Storage estimates are unavailable.'}
              </p>
              <button
                className="secondary-button"
                onClick={() =>
                  void action(async () => {
                    if (!navigator.storage?.persist)
                      throw new Error(
                        'Persistent storage requests are unsupported here.',
                      );
                    const persistent = await navigator.storage.persist();
                    setStorage({
                      ...(await navigator.storage.estimate()),
                      persistent,
                    });
                    setMessage(
                      persistent
                        ? 'Persistent storage granted.'
                        : 'The browser did not grant persistent storage. Sync and backups remain available.',
                    );
                  })
                }
              >
                Request persistent storage
              </button>
              <p className="muted">
                No web app can preserve unsynced data after you clear its
                browser storage. Keep cloud sync connected and save backups.
              </p>
              <div className="form-actions">
                <button
                  className="secondary-button"
                  onClick={() => setTrash(true)}
                >
                  <Trash2 size={16} />
                  Trash ({deleted.length})
                </button>
                <button
                  className="secondary-button"
                  onClick={() => void store.starter()}
                >
                  Add optional starter tasks
                </button>
              </div>
              <h3>Recovery snapshots</h3>
              {recoveries.length ? (
                recoveries.slice(0, 10).map((r) => (
                  <div className="activity-row" key={r.key}>
                    <span>
                      {r.key.includes('migration-')
                        ? 'Before storage migration'
                        : new Date(
                            Number(r.key.split(':')[1]),
                          ).toLocaleString()}
                    </span>
                    <button
                      className="secondary-button"
                      onClick={() =>
                        void action(async () => {
                          await restoreSnapshot(
                            r.snapshot,
                            r.files,
                            store.owner,
                          );
                          await store.reload();
                          setRecoveries(await listRecovery(store.owner));
                          setMessage(
                            'Recovery snapshot restored. The previous workspace was also preserved.',
                          );
                        })
                      }
                    >
                      Restore snapshot
                    </button>
                  </div>
                ))
              ) : (
                <p className="muted">
                  A recovery snapshot is created before every restore.
                </p>
              )}
              <h3>Conflicting edits</h3>
              {store.snapshot?.conflicts.length ? (
                store.snapshot.conflicts.map((c) => (
                  <div className="conflict-card" key={c.id}>
                    <h4>
                      {stringValue(
                        store.entities.find((e) => e.id === c.entity)?.data
                          .title || c.entity,
                      )}{' '}
                      · {c.key}
                    </h4>
                    {c.key === '_deleted' && (
                      <p>
                        An edit and a deletion happened on different devices.
                        The edited content is retained in Trash until you
                        choose.
                      </p>
                    )}
                    <div className="form-grid">
                      {[
                        ['local', c.local],
                        ['remote', c.remote],
                      ].map(([label, field]) => {
                        const f = field as typeof c.local;
                        return (
                          <div key={stringValue(label)}>
                            <strong>
                              {label === 'local'
                                ? 'This version'
                                : 'Other version'}
                            </strong>
                            <pre>
                              {c.key === '_deleted'
                                ? f.value === true
                                  ? 'Keep in Trash'
                                  : 'Restore item with its retained edits'
                                : JSON.stringify(f.value, null, 2)}
                            </pre>
                            <button
                              className="secondary-button"
                              onClick={() =>
                                void action(async () => {
                                  await transact((s) => {
                                    applyEdits(
                                      s,
                                      [
                                        {
                                          id: c.entity,
                                          kind: f.kind,
                                          data: { [c.key]: f.value },
                                        },
                                      ],
                                      'Resolved conflicting edit',
                                    );
                                    s.conflicts = s.conflicts.filter(
                                      (x) => x.id !== c.id,
                                    );
                                  }, store.owner);
                                  await store.reload();
                                  void store.sync();
                                })
                              }
                            >
                              Keep this version
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))
              ) : (
                <p className="muted">No conflicting edits need review.</p>
              )}
            </>
          )}
          {message && <output className="settings-message">{message}</output>}
        </section>
      </div>
      {trash && (
        <Modal title="Trash" open onClose={() => setTrash(false)}>
          {deleted.length ? (
            deleted.slice(0, 100).map((e) => (
              <div className="activity-row" key={e.id}>
                <span>
                  {stringValue(e.data.title || e.data.text || e.kind).slice(
                    0,
                    100,
                  )}
                </span>
                <button
                  className="secondary-button"
                  onClick={() =>
                    void store.edit(
                      [{ id: e.id, kind: e.kind, data: { _deleted: false } }],
                      'Restored from trash',
                    )
                  }
                >
                  Restore
                </button>
              </div>
            ))
          ) : (
            <p className="muted">Trash is empty.</p>
          )}
        </Modal>
      )}
    </>
  );
}
