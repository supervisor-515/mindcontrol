/* 반증 장부 — 오프라인 + 휴대폰 알림용 서비스워커 */
"use strict";
const CACHE = "counter-ledger-v3";

/* 앱 셸: 상대 경로로 두어 GitHub Pages 하위 경로에서도 동작 */
const SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icon.svg",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-maskable-512.png",
  "./apple-touch-icon.png",
  "./favicon-32.png"
];

self.addEventListener("install", (ev) => {
  ev.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting())
      .catch(() => {})
  );
});

self.addEventListener("activate", (ev) => {
  ev.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (ev) => {
  const req = ev.request;
  if (req.method !== "GET") return;

  /* 페이지 이동: 네트워크 우선, 실패 시 캐시된 index.html */
  if (req.mode === "navigate") {
    ev.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put("./index.html", copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match("./index.html").then((r) => r || caches.match("./")))
    );
    return;
  }

  /* 그 외 자원(폰트·CSS·아이콘): 캐시 우선, 없으면 네트워크 후 캐시에 저장 */
  ev.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res && (res.status === 200 || res.type === "opaque")) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => cached);
    })
  );
});

/* ---------- 알림: 확인일이 된 실험을 휴대폰으로 ---------- */
function idbGet(k) {
  return new Promise((res) => {
    const r = indexedDB.open("counter-ledger", 1);
    r.onupgradeneeded = () => { try { r.result.createObjectStore("kv", { keyPath: "k" }); } catch (e) {} };
    r.onsuccess = () => {
      try {
        const tx = r.result.transaction("kv", "readonly");
        const g = tx.objectStore("kv").get(k);
        g.onsuccess = () => res(g.result ? g.result.v : null);
        g.onerror = () => res(null);
      } catch (e) { res(null); }
    };
    r.onerror = () => res(null);
  });
}
function idbPut(k, v) {
  return new Promise((res) => {
    const r = indexedDB.open("counter-ledger", 1);
    r.onupgradeneeded = () => { try { r.result.createObjectStore("kv", { keyPath: "k" }); } catch (e) {} };
    r.onsuccess = () => {
      try {
        const tx = r.result.transaction("kv", "readwrite");
        tx.objectStore("kv").put({ k, v });
        tx.oncomplete = () => res();
        tx.onerror = () => res();
      } catch (e) { res(); }
    };
    r.onerror = () => res();
  });
}
function todayLocal() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

async function checkReviews() {
  const schedule = (await idbGet("schedule")) || [];
  let notified = (await idbGet("notified")) || {};
  const today = todayLocal();

  /* 더 이상 일정에 없는 항목의 알림 기록은 정리 */
  const liveIds = new Set(schedule.map((e) => e.id));
  Object.keys(notified).forEach((key) => {
    if (!liveIds.has(key.split("|")[0])) delete notified[key];
  });

  const due = schedule.filter((e) => e.reviewDate && e.reviewDate <= today);
  const fresh = due.filter((e) => !notified[e.id + "|" + e.reviewDate]);

  if (fresh.length) {
    const n = due.length;
    const body = (fresh.length === 1 && n === 1)
      ? `"${fresh[0].choice || "예측"}" 의 결과를 장부에 적을 시간이다.`
      : `${n}건의 예측을 실제 결과와 대조할 시간이다.`;
    await self.registration.showNotification("반증 장부 — 확인할 때 됐다", {
      body,
      icon: "./icon-192.png",
      badge: "./favicon-32.png",
      tag: "cl-review",
      renotify: true,
      data: { url: "./" }
    });
    fresh.forEach((e) => { notified[e.id + "|" + e.reviewDate] = true; });
  }
  await idbPut("notified", notified);

  /* 앱 아이콘 배지도 갱신 (지원 시) */
  try {
    if (self.navigator && self.navigator.setAppBadge) {
      if (due.length > 0) self.navigator.setAppBadge(due.length);
      else if (self.navigator.clearAppBadge) self.navigator.clearAppBadge();
    }
  } catch (e) {}
}

self.addEventListener("periodicsync", (ev) => {
  if (ev.tag === "cl-review-check") ev.waitUntil(checkReviews());
});
self.addEventListener("sync", (ev) => {
  if (ev.tag === "cl-review-check") ev.waitUntil(checkReviews());
});
self.addEventListener("message", (ev) => {
  if (ev.data && ev.data.type === "check-reviews") ev.waitUntil(checkReviews());
});

self.addEventListener("notificationclick", (ev) => {
  ev.notification.close();
  ev.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of all) {
      if ("focus" in c) { try { await c.navigate("./"); } catch (e) {} return c.focus(); }
    }
    if (self.clients.openWindow) return self.clients.openWindow("./");
  })());
});
