// シフトをiPhone(Apple)カレンダー等に取り込むための .ics ファイル生成モジュール
// 生成した .ics はファイルとしてダウンロードし、iPhone側で「開く」→カレンダーに追加、の流れで使います。

function pad(n) {
  return String(n).padStart(2, "0");
}

// date: "YYYY-MM-DD", time: "HH:MM" → ローカル時刻のフローティングフォーマット (YYYYMMDDTHHMMSS)
function toICSDateTime(dateStr, timeStr) {
  const [y, m, d] = dateStr.split("-");
  const [hh, mm] = timeStr.split(":");
  return `${y}${m}${d}T${hh}${mm}00`;
}

function escapeText(str) {
  return String(str)
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

function nowStamp() {
  const d = new Date();
  return (
    d.getUTCFullYear() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    "T" +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    "Z"
  );
}

// 1件のシフトからVEVENTブロックを作る
function buildEvent(shift, workplace) {
  const summary = escapeText(`${workplace ? workplace.name : "バイト"}のシフト`);
  const wage = workplace ? workplace.hourlyWage : null;
  const descParts = [];
  if (wage) descParts.push(`時給${wage}円`);
  if (shift.memo) descParts.push(shift.memo);
  const description = escapeText(descParts.join(" / "));

  const dtStart = toICSDateTime(shift.date, shift.startTime);
  const dtEnd = toICSDateTime(shift.date, shift.endTime);
  const uid = `${shift.id || Math.random().toString(36).slice(2)}@shift-board`;

  return [
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${nowStamp()}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${summary}`,
    description ? `DESCRIPTION:${description}` : null,
    "BEGIN:VALARM",
    "TRIGGER:-PT60M",
    "ACTION:DISPLAY",
    "DESCRIPTION:シフトのリマインダー",
    "END:VALARM",
    "END:VEVENT",
  ]
    .filter(Boolean)
    .join("\r\n");
}

// 複数シフトから1つの.icsファイル文字列を作る
export function buildICS(shifts, workplaceMap) {
  const events = shifts
    .map((s) => buildEvent(s, workplaceMap[s.workplaceId]))
    .join("\r\n");

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//shift-board//JP",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    events,
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}

// .icsファイルをダウンロードさせる
export function downloadICS(filename, icsString) {
  const blob = new Blob([icsString], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
