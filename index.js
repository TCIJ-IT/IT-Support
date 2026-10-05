const { onValueCreated } = require("firebase-functions/v2/database");
const admin = require("firebase-admin");

admin.initializeApp();

exports.pushNewNotification = onValueCreated(
  "/it_notifications/{notificationId}",
  async (event) => {
    const n = event.data.val() || {};
    const snap = await admin.database().ref("it_push_devices").once("value");
    const devices = snap.val() || {};

    const selected = Object.entries(devices).filter(([key, d]) => {
      if (!d || !d.enabled || !d.token) return false;
      if (n.user) return d.user === n.user;
      if (Array.isArray(n.roles)) return n.roles.includes(d.role);
      return true;
    });

    if (!selected.length) return null;

    const tokens = selected.map(([,d]) => d.token);
    const message = {
      tokens,
      notification: {
        title: n.title || "وحدة تقنية المعلومات",
        body: n.message || "يوجد تحديث جديد في نظام الدعم الفني."
      },
      data: {
        ticketNo: String(n.ticketNo || ""),
        url: "./index.html"
      },
      webpush: {
        fcmOptions: { link: "./index.html" },
        notification: {
          icon: "./icon-192.png",
          badge: "./icon-192.png",
          tag: String(n.ticketNo || event.params.notificationId)
        }
      }
    };

    const result = await admin.messaging().sendEachForMulticast(message);

    const removals = {};
    result.responses.forEach((r, i) => {
      if (r.success) return;
      const code = r.error?.code || "";
      if (
        code.includes("registration-token-not-registered") ||
        code.includes("invalid-registration-token")
      ) {
        removals[selected[i][0]] = null;
      }
    });
    if (Object.keys(removals).length) {
      await admin.database().ref("it_push_devices").update(removals);
    }
    return null;
  }
);


/* V36 note:
   Frontend now tries POST /send-now with {ticketNo}.
   If you want immediate push from Cloudflare Worker, add a route in your deployed worker that:
   1) validates request origin if needed,
   2) reads the ticket from Firebase by ticketNo,
   3) sends FCM/Web Push to registered devices.
   This bundled example is intentionally not auto-modified with secrets.
*/
