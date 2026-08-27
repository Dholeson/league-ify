import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import type { NotificationItem } from "../../shared/types.ts";
import { api } from "../api.ts";

// The topbar bell: stacks unread accomplishments (achievement tier-ups, level
// ups, goal completions) and pops a transient toast when new ones read in. The
// server generates them by diffing career state on each fetch; this component
// polls on mount, on a `notif:refresh` window event (fired after a sync), and
// on a gentle interval, then dedupes toasts client-side so each fires once.

const TOASTED_KEY = "toastedNotifs";
const loadToasted = (): Set<string> => {
  try { return new Set(JSON.parse(localStorage.getItem(TOASTED_KEY) || "[]")); } catch { return new Set(); }
};
const saveToasted = (s: Set<string>) => {
  try { localStorage.setItem(TOASTED_KEY, JSON.stringify([...s].slice(-120))); } catch { /* ignore */ }
};

function relTime(iso: string): string {
  const secs = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 45) return "just now";
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.round(secs / 3600)}h ago`;
  return `${Math.round(secs / 86400)}d ago`;
}

const routeFor = (n: NotificationItem) => n.link ?? (n.type === "goal" ? "/seasons" : "/achievements");

export default function NotificationBell() {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [toasts, setToasts] = useState<NotificationItem[]>([]);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const load = async (allowToast: boolean) => {
    try {
      const r = await api.notifications();
      setItems(r.items);
      setUnread(r.unread);
      if (!allowToast) return;
      const toasted = loadToasted();
      // Only toast genuinely fresh, un-toasted, unread wins — never a backlog.
      const fresh = r.items.filter(
        (n) => !n.read && !toasted.has(n.id) && Date.now() - new Date(n.createdAt).getTime() < 5 * 60 * 1000
      );
      if (fresh.length) {
        const show = fresh.slice(0, 3);
        setToasts((t) => [...show, ...t].slice(0, 3));
        r.items.forEach((n) => toasted.add(n.id)); // mark all seen so nothing re-toasts later
        saveToasted(toasted);
        show.forEach((n) => setTimeout(() => setToasts((t) => t.filter((x) => x.id !== n.id)), 7000));
      } else {
        r.items.forEach((n) => toasted.add(n.id));
        saveToasted(toasted);
      }
    } catch { /* offline / not configured — bell just stays quiet */ }
  };

  useEffect(() => {
    load(true);
    const onRefresh = () => load(true);
    window.addEventListener("notif:refresh", onRefresh);
    const iv = window.setInterval(() => load(true), 90000);
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => {
      window.removeEventListener("notif:refresh", onRefresh);
      window.clearInterval(iv);
      document.removeEventListener("mousedown", onDoc);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && unread > 0) {
      setUnread(0);
      setItems((xs) => xs.map((n) => ({ ...n, read: true })));
      try { await api.markNotificationsRead(); } catch { /* ignore */ }
    }
  };

  const go = (n: NotificationItem) => { setOpen(false); navigate(routeFor(n)); };

  const clearAll = async () => {
    setItems([]); setUnread(0);
    try { await api.clearNotifications(); } catch { /* ignore */ }
  };

  return (
    <>
      <div className="notif-bell" ref={ref}>
        <button className={`nb-btn ${open ? "on" : ""}`} onClick={toggle} title="Notifications" aria-label="Notifications">
          <i className="ti ti-bell" aria-hidden="true" />
          {unread > 0 && <span className="nb-badge">{unread > 9 ? "9+" : unread}</span>}
        </button>
        {open && (
          <div className="notif-menu">
            <div className="nm-head">
              <span>Notifications</span>
              {items.length > 0 && <button className="nm-clear" onClick={clearAll}>Clear all</button>}
            </div>
            {items.length === 0 ? (
              <div className="nm-empty">
                <i className="ti ti-bell-z" aria-hidden="true" />
                <span>No notifications yet. Play a game — wins land here.</span>
              </div>
            ) : (
              <div className="nm-list">
                {items.map((n) => (
                  <button key={n.id} className={`nm-item ${n.read ? "" : "unread"}`} onClick={() => go(n)}>
                    <span className="nm-ic" style={{ color: n.accent ?? "var(--gold)" }}><i className={`ti ${n.icon}`} aria-hidden="true" /></span>
                    <span className="nm-body">
                      <span className="nm-title">{n.title}</span>
                      <span className="nm-sub">{n.body}</span>
                    </span>
                    <span className="nm-time faint">{relTime(n.createdAt)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {toasts.length > 0 && createPortal(
        <div className="notif-toast-host">
          {toasts.map((n) => (
            <div className="notif-toast" key={n.id} onClick={() => setToasts((t) => t.filter((x) => x.id !== n.id))}>
              <span className="nt-ic" style={{ color: n.accent ?? "var(--gold)" }}><i className={`ti ${n.icon}`} aria-hidden="true" /></span>
              <span className="nt-body">
                <span className="nt-title">{n.title}</span>
                <span className="nt-sub">{n.body}</span>
              </span>
            </div>
          ))}
        </div>,
        document.body
      )}
    </>
  );
}
