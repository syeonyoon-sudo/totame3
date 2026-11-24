// 또타미 서비스 워커 — 시스템 알림 표시용 (오프라인 캐시는 사용하지 않음)
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))
self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) if ('focus' in c) return c.focus()
      return self.clients.openWindow('/move')
    }),
  )
})
