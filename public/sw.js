// Push-only service worker - deliberately has no "fetch" listener, so it
// never caches anything and adds no offline behavior. Only handles incoming
// push events and notification taps.

self.addEventListener("push", function (event) {
  let data = { title: "עדכון חדש ב־Double K Top", body: "" };
  if (event.data) {
    try {
      data = event.data.json();
    } catch {
      data.body = event.data.text();
    }
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/icon-192.png",
    })
  );
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const clientsList = await clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of clientsList) {
        if ("focus" in client) {
          await client.focus();
          if ("navigate" in client) await client.navigate("/student");
          return;
        }
      }
      await clients.openWindow("/student");
    })()
  );
});
