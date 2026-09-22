"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import SupportCaseActions from "@/components/SupportCaseActions";
import type { SupportCase } from "@/lib/support";

type Notification = {
  support?: SupportCase | null;
  id: string;
  title: string;
  message: string;
  type: string | null;
  is_read: boolean;
  created_at: string;
};

export default function NotificationBell() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);

  const wrapperRef = useRef<HTMLDivElement>(null);

  async function loadNotifications() {
    try {
      setLoading(true);

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) return;

      const response = await fetch("/api/notifications", {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
        cache: "no-store",
      });

      const result = await response.json();

      if (!response.ok) {
        console.error("NOTIFICATION LOAD ERROR:", result.error);
        return;
      }

      setNotifications(result.notifications || []);
    } catch (error) {
      console.error("NOTIFICATION LOAD ERROR:", error);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadNotifications();
  }, []);

  useEffect(() => {
    function handleOutsideClick(event: MouseEvent) {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(event.target as Node)
      ) {
        setShow(false);
      }
    }

    document.addEventListener("mousedown", handleOutsideClick);

    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
    };
  }, []);

  const unreadCount = notifications.filter((item) => !item.is_read).length;

  async function markAsRead(notificationId: string) {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) return;

      const response = await fetch("/api/notifications/read", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          notificationId,
        }),
      });

      if (!response.ok) {
        const result = await response.json();
        console.error("MARK NOTIFICATION READ ERROR:", result.error);
        return;
      }

      setNotifications((current) =>
        current.map((item) =>
          item.id === notificationId ? { ...item, is_read: true } : item,
        ),
      );
    } catch (error) {
      console.error("MARK NOTIFICATION READ ERROR:", error);
    }
  }

  async function markAllAsRead() {
    if (unreadCount === 0) return;

    try {
      setMarkingAll(true);

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) return;

      const response = await fetch("/api/notifications/read", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          all: true,
        }),
      });

      if (!response.ok) {
        const result = await response.json();
        console.error("MARK ALL READ ERROR:", result.error);
        return;
      }

      setNotifications((current) =>
        current.map((item) => ({
          ...item,
          is_read: true,
        })),
      );
    } catch (error) {
      console.error("MARK ALL READ ERROR:", error);
    } finally {
      setMarkingAll(false);
    }
  }

  function formatDate(value: string) {
    try {
      return new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Dhaka",
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      }).format(new Date(value));
    } catch {
      return "";
    }
  }

  return (
    <div ref={wrapperRef} className="relative">
      {/* Bell */}

      <button
        type="button"
        onClick={() => {
          setShow((current) => !current);

          if (!show) {
            loadNotifications();
          }
        }}
        aria-label="Notifications"
        className="
          relative
          flex
          h-11
          w-11
          items-center
          justify-center
          rounded-xl
          border
          border-cyan-400/20
          bg-[#07182f]
          text-lg
          transition
          hover:border-cyan-400/40
        "
      >
        🔔
        {unreadCount > 0 && (
          <span
            className="
              absolute
              -right-1
              -top-1
              flex
              h-5
              min-w-5
              items-center
              justify-center
              rounded-full
              bg-red-500
              px-1
              text-[9px]
              font-black
              text-white
            "
          >
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown */}

      {show && (
        <div
          className="
            absolute
            -right-16
            sm:right-0
            top-[calc(100%+8px)]
            z-[100]
            w-[min(92vw,320px)]
            overflow-hidden
            rounded-2xl
            border
            border-cyan-400/20
            bg-[#081c36]
            shadow-2xl
          "
        >
          {/* Header */}

          <div
            className="
              flex
              items-center
              justify-between
              border-b
              border-cyan-400/10
              px-4
              py-3
            "
          >
            <div>
              <p className="text-sm font-black text-cyan-300">Notifications</p>

              <p className="mt-0.5 text-[10px] text-slate-500">
                {unreadCount > 0
                  ? `${unreadCount} unread notification${
                      unreadCount > 1 ? "s" : ""
                    }`
                  : "You're all caught up"}
              </p>
            </div>

            {unreadCount > 0 && (
              <button
                type="button"
                onClick={markAllAsRead}
                disabled={markingAll}
                className="
                  rounded-lg
                  border
                  border-cyan-400/20
                  px-2
                  py-1.5
                  text-[9px]
                  font-black
                  text-cyan-300
                  disabled:opacity-50
                "
              >
                {markingAll ? "..." : "Mark all read"}
              </button>
            )}
          </div>

          {/* List */}

          <div className="max-h-[360px] overflow-y-auto p-2">
            {loading ? (
              <div className="px-3 py-8 text-center text-xs text-slate-400">
                Loading notifications...
              </div>
            ) : notifications.length === 0 ? (
              <div className="px-3 py-8 text-center">
                <div className="text-2xl">🔔</div>

                <p className="mt-2 text-xs font-bold text-slate-300">
                  No notifications
                </p>

                <p className="mt-1 text-[10px] text-slate-500">
                  You are all caught up.
                </p>
              </div>
            ) : (
              notifications.slice(0, 10).map((item) => (
                <div
                  key={item.id}
                  className={`
                    mb-2
                    block
                    w-full
                    rounded-xl
                    border
                    p-3
                    text-left
                    transition
                    ${
                      item.is_read
                        ? "border-cyan-400/5 bg-[#07182f]"
                        : "border-cyan-400/15 bg-[#0b2545]"
                    }
                  `}
                >
                  <button type="button" onClick={() => markAsRead(item.id)} className="flex w-full items-start gap-2 text-left">
                    {!item.is_read && (
                      <span
                        className="
                          mt-1.5
                          h-2
                          w-2
                          shrink-0
                          rounded-full
                          bg-cyan-400
                        "
                      />
                    )}

                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-xs font-black leading-5 text-white">
                          {item.title}
                        </p>

                        {!item.is_read && (
                          <span className="shrink-0 text-[8px] font-black text-cyan-300">
                            NEW
                          </span>
                        )}
                      </div>

                      <p className="mt-1 text-[11px] leading-5 text-slate-300">
                        {item.message}
                      </p>

                      <p className="mt-2 text-[9px] text-slate-500">
                        {formatDate(item.created_at)}
                      </p>
                    </div>
                  </button>
                  <SupportCaseActions support={item.support} />
                </div>
              ))
            )}
          </div>

          {notifications.length > 0 && (
            <div className="border-t border-cyan-400/10 px-4 py-2 text-center">
              <p className="text-[9px] text-slate-500">
                Showing latest notifications
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
