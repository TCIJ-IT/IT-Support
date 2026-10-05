# CTE IT Support V17 PWA

ارفع جميع الملفات الموجودة في هذا المجلد إلى جذر مستودع GitHub Pages نفسه.

الملفات الأساسية:
- index.html
- manifest.json
- sw.js
- icon-192.png
- icon-512.png
- icon-maskable-512.png
- unit-brand.jpg
- college-building.jpg

مهم:
استخدمنا روابط نسبية ./manifest.json و ./sw.js لأن الموقع منشور داخل مسار مشروع GitHub Pages،
وليس في جذر النطاق.

بعد الرفع:
1. افتح الموقع من HTTPS.
2. حدّث الصفحة مرة.
3. في Chrome/Edge على Android أو الكمبيوتر سيظهر زر «تثبيت التطبيق» عندما يصبح الموقع مؤهلاً.
4. فعّل الإشعارات من داخل النظام.

ملاحظة:
الإشعارات الفورية أثناء فتح الموقع/PWA تعمل عبر Firebase Realtime Database.
أما وصول Push والموقع مغلق بالكامل فيحتاج Firebase Cloud Messaging أو Web Push مع Backend/Cloud Function آمن.
