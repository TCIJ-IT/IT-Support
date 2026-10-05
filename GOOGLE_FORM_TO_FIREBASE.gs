/**
 * Google Forms -> Firebase Realtime Database bridge
 * هذا هو الربط الذي يجعل رد Google Form يتحول إلى بلاغ داخل الموقع.
 *
 * الخطوات:
 * 1) افتح Google Form.
 * 2) من القائمة: Extensions > Apps Script.
 * 3) احذف الموجود والصق هذا الكود.
 * 4) Save.
 * 5) من Triggers أضف Trigger:
 *    function: onFormSubmit
 *    event source: From form
 *    event type: On form submit
 *
 * بعدها أي رد جديد يذهب إلى:
 * it_external_requests
 * ثم من الموقع اضغط "مزامنة الردود".
 */

const FIREBASE_URL = 'https://test-mode-c1433-default-rtdb.firebaseio.com/it_external_requests.json';

function pick_(namedValues, names, fallback) {
  for (const name of names) {
    if (namedValues[name] && namedValues[name][0]) return String(namedValues[name][0]).trim();
  }
  return fallback || '';
}

function allAnswers_(namedValues) {
  return Object.keys(namedValues).map(k => k + ': ' + (namedValues[k] || []).join(', ')).join('\n');
}

function onFormSubmit(e) {
  const nv = e.namedValues || {};

  const source = pick_(nv, [
    'اسم مقدم البلاغ','الاسم','اسم المهندس','اسم المستخدم','Name','Requester'
  ], 'استبيان خارجي');

  const contact = pick_(nv, [
    'وسيلة التواصل','رقم التواصل','البريد','الجوال','Contact','Email','Phone'
  ], '');

  const building = pick_(nv, [
    'اختيار مبنى','المبنى','مبنى','الموقع','اختر المبنى','Building','Location'
  ], '');

  const room = pick_(nv, [
    'رقم القاعة','القاعة','الغرفة','المعمل','المكتب','رقم المكتب','Room','Lab'
  ], '');

  const device = pick_(nv, [
    'جهاز المهندس','نوع الجهاز','الجهاز','الخدمة','Device','Service'
  ], 'أخرى');

  const problem = pick_(nv, [
    'اختيار المشكلة','وصف المشكلة','المشكلة','مشكلة','نموذج طلب صيانة','طلب صيانة',
    'Problem','Description','Issue'
  ], allAnswers_(nv));

  const priority = pick_(nv, [
    'الأهمية','الأولوية','Priority'
  ], 'متوسطة');

  const payload = {
    source,
    name: source,
    contact,
    building,
    room,
    location: building + (room ? ' - ' + room : ''),
    device,
    problem,
    description: problem,
    priority,
    date: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'),
    createdAt: new Date().toISOString(),
    submittedFrom: 'google_form',
    rawAnswers: nv
  };

  const res = UrlFetchApp.fetch(FIREBASE_URL, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  Logger.log(res.getResponseCode() + ' ' + res.getContentText());
}
