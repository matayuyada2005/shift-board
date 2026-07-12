import { initializeApp } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  addDoc,
  setDoc,
  deleteDoc,
  onSnapshot,
  enableIndexedDbPersistence,
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

import { firebaseConfig } from "./firebase-config.js";
import { buildICS, downloadICS } from "./ics.js";

/* ============================================================
   Firebase 初期化
   ============================================================ */
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

enableIndexedDbPersistence(db).catch(() => {
  // 複数タブを開いている場合などは失敗することがあるが、致命的ではないので無視する
});

/* ============================================================
   状態管理
   ============================================================ */
const state = {
  uid: null,
  workplaces: [], // {id, name, hourlyWage, color}
  shifts: [], // {id, workplaceId, date, startTime, endTime, breakMinutes, memo}
  activeTab: "calendar",
  calYear: null,
  calMonth: null, // 0-11
  salaryYear: null,
  salaryMonth: null,
  editingShiftDate: null,
  unsubWorkplaces: null,
  unsubShifts: null,
};

const today = new Date();
state.calYear = today.getFullYear();
state.calMonth = today.getMonth();
state.salaryYear = today.getFullYear();
state.salaryMonth = today.getMonth();

const WORKPLACE_COLORS = [
  "#B02A22",
  "#A5750E",
  "#3B6E4F",
  "#2B5876",
  "#7B4B94",
  "#C4622D",
  "#4C6444",
  "#8A3B5D",
];

/* ============================================================
   小さなユーティリティ
   ============================================================ */
function $(sel) {
  return document.querySelector(sel);
}
function $all(sel) {
  return Array.from(document.querySelectorAll(sel));
}
function pad(n) {
  return String(n).padStart(2, "0");
}
function dateKey(y, m, d) {
  return `${y}-${pad(m + 1)}-${pad(d)}`;
}
function showToast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => t.classList.remove("show"), 2200);
}

// "HH:MM" と休憩(分)から実働時間(時間単位)を計算。日をまたぐ場合にも対応。
function calcWorkedHours(startTime, endTime, breakMinutes) {
  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em] = endTime.split(":").map(Number);
  let startMin = sh * 60 + sm;
  let endMin = eh * 60 + em;
  if (endMin <= startMin) endMin += 24 * 60; // 日またぎシフト
  const worked = endMin - startMin - Number(breakMinutes || 0);
  return Math.max(0, worked) / 60;
}

function calcShiftPay(shift, workplace) {
  if (!workplace) return 0;
  const hours = calcWorkedHours(shift.startTime, shift.endTime, shift.breakMinutes);
  return Math.round(hours * workplace.hourlyWage);
}

function workplaceById(id) {
  return state.workplaces.find((w) => w.id === id);
}

/* ============================================================
   認証まわり
   ============================================================ */
let authMode = "login"; // or "signup"

$("#auth-toggle-mode").addEventListener("click", () => {
  authMode = authMode === "login" ? "signup" : "login";
  $("#auth-submit").textContent = authMode === "login" ? "ログイン" : "新規登録する";
  $("#auth-toggle-mode").textContent =
    authMode === "login" ? "初めての方はこちら(新規登録)" : "すでにアカウントをお持ちの方はこちら";
  $("#auth-error").textContent = "";
});

$("#auth-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("#auth-email").value.trim();
  const password = $("#auth-password").value;
  $("#auth-error").textContent = "";
  $("#auth-submit").disabled = true;
  try {
    if (authMode === "login") {
      await signInWithEmailAndPassword(auth, email, password);
    } else {
      await createUserWithEmailAndPassword(auth, email, password);
    }
  } catch (err) {
    $("#auth-error").textContent = translateAuthError(err);
  } finally {
    $("#auth-submit").disabled = false;
  }
});

function translateAuthError(err) {
  const code = err && err.code;
  const map = {
    "auth/invalid-email": "メールアドレスの形式が正しくありません",
    "auth/user-not-found": "このメールアドレスのアカウントが見つかりません",
    "auth/wrong-password": "パスワードが違います",
    "auth/invalid-credential": "メールアドレスまたはパスワードが違います",
    "auth/email-already-in-use": "このメールアドレスは既に登録されています",
    "auth/weak-password": "パスワードは6文字以上にしてください",
    "auth/network-request-failed": "通信エラーが発生しました。接続を確認してください",
  };
  return map[code] || "エラーが発生しました。もう一度お試しください";
}

$("#logout-btn").addEventListener("click", async () => {
  if (confirm("ログアウトしますか?")) {
    await signOut(auth);
  }
});

onAuthStateChanged(auth, (user) => {
  if (state.unsubWorkplaces) state.unsubWorkplaces();
  if (state.unsubShifts) state.unsubShifts();

  if (user) {
    state.uid = user.uid;
    $("#auth-view").classList.add("hidden");
    $("#app").classList.remove("hidden");
    $("#fab-add-shift").classList.remove("hidden");
    $("#user-chip").textContent = user.email;
    $("#settings-email").textContent = user.email;
    subscribeData(user.uid);
  } else {
    state.uid = null;
    state.workplaces = [];
    state.shifts = [];
    $("#app").classList.add("hidden");
    $("#fab-add-shift").classList.add("hidden");
    $("#auth-view").classList.remove("hidden");
  }
});

/* ============================================================
   Firestore 同期
   ============================================================ */
function subscribeData(uid) {
  const workplacesCol = collection(db, "users", uid, "workplaces");
  state.unsubWorkplaces = onSnapshot(workplacesCol, (snap) => {
    state.workplaces = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderWorkplaceList();
    renderShiftWorkplaceOptions();
    renderCalendar();
    renderSalary();
  });

  const shiftsCol = collection(db, "users", uid, "shifts");
  state.unsubShifts = onSnapshot(shiftsCol, (snap) => {
    state.shifts = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderCalendar();
    renderSalary();
  });
}

async function saveWorkplace(data, id) {
  const col = collection(db, "users", state.uid, "workplaces");
  if (id) {
    await setDoc(doc(col, id), data, { merge: true });
  } else {
    await addDoc(col, data);
  }
}

async function deleteWorkplace(id) {
  await deleteDoc(doc(db, "users", state.uid, "workplaces", id));
}

async function saveShift(data, id) {
  const col = collection(db, "users", state.uid, "shifts");
  if (id) {
    await setDoc(doc(col, id), data, { merge: true });
  } else {
    await addDoc(col, data);
  }
}

async function deleteShift(id) {
  await deleteDoc(doc(db, "users", state.uid, "shifts", id));
}

/* ============================================================
   タブ切り替え
   ============================================================ */
$all(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    state.activeTab = btn.dataset.tab;
    $all(".tab-btn").forEach((b) => b.classList.toggle("active", b === btn));
    $all(".view").forEach((v) => v.classList.add("hidden"));
    $(`#view-${state.activeTab}`).classList.remove("hidden");
    $("#fab-add-shift").classList.toggle("hidden", state.activeTab !== "calendar");
  });
});

/* ============================================================
   カレンダー描画
   ============================================================ */
const MONTH_LABEL = (y, m) => `${y}年${m + 1}月`;
const DOW = ["日", "月", "火", "水", "木", "金", "土"];

$("#cal-prev").addEventListener("click", () => {
  state.calMonth -= 1;
  if (state.calMonth < 0) {
    state.calMonth = 11;
    state.calYear -= 1;
  }
  renderCalendar();
});
$("#cal-next").addEventListener("click", () => {
  state.calMonth += 1;
  if (state.calMonth > 11) {
    state.calMonth = 0;
    state.calYear += 1;
  }
  renderCalendar();
});

function renderCalendar() {
  $("#cal-title").textContent = MONTH_LABEL(state.calYear, state.calMonth);
  const grid = $("#cal-grid");
  grid.innerHTML = "";

  DOW.forEach((label, i) => {
    const el = document.createElement("div");
    el.className = "cal-dow" + (i === 0 ? " sun" : "");
    el.textContent = label;
    grid.appendChild(el);
  });

  const firstDay = new Date(state.calYear, state.calMonth, 1).getDay();
  const daysInMonth = new Date(state.calYear, state.calMonth + 1, 0).getDate();
  const todayKey = dateKey(today.getFullYear(), today.getMonth(), today.getDate());

  for (let i = 0; i < firstDay; i++) {
    const el = document.createElement("div");
    el.className = "cal-cell empty";
    grid.appendChild(el);
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const key = dateKey(state.calYear, state.calMonth, d);
    const cell = document.createElement("div");
    cell.className = "cal-cell" + (key === todayKey ? " is-today" : "");

    const num = document.createElement("div");
    num.className = "day-num";
    num.textContent = d;
    cell.appendChild(num);

    const dayShifts = state.shifts
      .filter((s) => s.date === key)
      .sort((a, b) => a.startTime.localeCompare(b.startTime));

    dayShifts.slice(0, 2).forEach((s) => {
      const wp = workplaceById(s.workplaceId);
      const chip = document.createElement("div");
      chip.className = "shift-chip";
      chip.style.background = wp ? wp.color : "#888";
      chip.textContent = `${wp ? wp.name : "?"} ${s.startTime}`;
      cell.appendChild(chip);
    });
    if (dayShifts.length > 2) {
      const more = document.createElement("div");
      more.className = "cal-more";
      more.textContent = `+${dayShifts.length - 2}`;
      cell.appendChild(more);
    }

    cell.addEventListener("click", () => openShiftModal(key));
    grid.appendChild(cell);
  }
}

$("#fab-add-shift").addEventListener("click", () => {
  const key = dateKey(today.getFullYear(), today.getMonth(), today.getDate());
  openShiftModal(key);
});

/* ============================================================
   シフト追加/編集モーダル
   ============================================================ */
function renderShiftWorkplaceOptions() {
  const sel = $("#shift-workplace");
  sel.innerHTML = "";
  if (state.workplaces.length === 0) {
    sel.innerHTML = '<option value="">先にバイト先を登録してください</option>';
    return;
  }
  state.workplaces.forEach((w) => {
    const opt = document.createElement("option");
    opt.value = w.id;
    opt.textContent = `${w.name}(時給${w.hourlyWage}円)`;
    sel.appendChild(opt);
  });
}

function openShiftModal(dateStr) {
  if (state.workplaces.length === 0) {
    showToast("先に「バイト先」タブから勤務先を登録してください");
    return;
  }
  state.editingShiftDate = dateStr;
  $("#shift-modal-title").textContent = `${dateStr} のシフト`;
  $("#shift-id").value = "";
  $("#shift-date").value = dateStr;
  $("#shift-start").value = "09:00";
  $("#shift-end").value = "17:00";
  $("#shift-break").value = "0";
  $("#shift-memo").value = "";
  renderShiftWorkplaceOptions();
  updatePayPreview();
  renderExistingShiftsForDay(dateStr);
  $("#shift-modal-backdrop").classList.remove("hidden");
}

function renderExistingShiftsForDay(dateStr) {
  const wrap = $("#day-existing-shifts");
  const dayShifts = state.shifts
    .filter((s) => s.date === dateStr)
    .sort((a, b) => a.startTime.localeCompare(b.startTime));

  if (dayShifts.length === 0) {
    wrap.innerHTML = "";
    return;
  }

  wrap.innerHTML = `<div class="section-title" style="font-size:13px;"><span class="eyebrow">この日の登録済み</span></div>`;
  dayShifts.forEach((s) => {
    const wp = workplaceById(s.workplaceId);
    const row = document.createElement("div");
    row.className = "day-shift-item";
    row.innerHTML = `
      <div class="shift-color-bar" style="background:${wp ? wp.color : "#888"}"></div>
      <div class="shift-info">
        <div class="shift-workplace">${wp ? wp.name : "(削除済み)"}</div>
        <div class="shift-time">${s.startTime} - ${s.endTime}${s.memo ? " ・ " + s.memo : ""}</div>
      </div>
      <div class="shift-pay">¥${calcShiftPay(s, wp).toLocaleString()}</div>
      <button type="button" class="icon-btn edit-shift" data-id="${s.id}">✎</button>
      <button type="button" class="icon-btn delete-shift" data-id="${s.id}">🗑</button>
    `;
    wrap.appendChild(row);
  });

  wrap.querySelectorAll(".edit-shift").forEach((btn) => {
    btn.addEventListener("click", () => {
      const s = state.shifts.find((x) => x.id === btn.dataset.id);
      if (!s) return;
      $("#shift-id").value = s.id;
      $("#shift-date").value = s.date;
      $("#shift-workplace").value = s.workplaceId;
      $("#shift-start").value = s.startTime;
      $("#shift-end").value = s.endTime;
      $("#shift-break").value = s.breakMinutes;
      $("#shift-memo").value = s.memo || "";
      $("#shift-modal-title").textContent = "シフトを編集";
      updatePayPreview();
    });
  });
  wrap.querySelectorAll(".delete-shift").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (confirm("このシフトを削除しますか?")) {
        await deleteShift(btn.dataset.id);
        renderExistingShiftsForDay(dateStr);
      }
    });
  });
}

function updatePayPreview() {
  const wpId = $("#shift-workplace").value;
  const wp = workplaceById(wpId);
  const start = $("#shift-start").value;
  const end = $("#shift-end").value;
  const brk = $("#shift-break").value;
  const preview = $("#shift-pay-preview");
  if (!wp || !start || !end) {
    preview.textContent = "";
    return;
  }
  const hours = calcWorkedHours(start, end, brk);
  const pay = Math.round(hours * wp.hourlyWage);
  preview.textContent = `実働 ${hours.toFixed(2)} 時間 ・ 見込み給与 ¥${pay.toLocaleString()}`;
}

["shift-workplace", "shift-start", "shift-end", "shift-break"].forEach((id) => {
  $(`#${id}`).addEventListener("input", updatePayPreview);
});

$("#shift-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = $("#shift-id").value || null;
  const data = {
    date: $("#shift-date").value,
    workplaceId: $("#shift-workplace").value,
    startTime: $("#shift-start").value,
    endTime: $("#shift-end").value,
    breakMinutes: Number($("#shift-break").value || 0),
    memo: $("#shift-memo").value.trim(),
  };
  await saveShift(data, id);
  showToast("シフトを保存しました");
  closeModals();
});

/* ============================================================
   バイト先管理
   ============================================================ */
function renderWorkplaceList() {
  const wrap = $("#workplace-list");
  wrap.innerHTML = "";

  if (state.workplaces.length === 0) {
    wrap.innerHTML = `
      <div class="empty-state">
        <div class="empty-seal">🖋️</div>
        まだバイト先が登録されていません<br/>下のボタンから追加しましょう
      </div>`;
    return;
  }

  state.workplaces.forEach((w) => {
    const card = document.createElement("div");
    card.className = "workplace-card";
    card.innerHTML = `
      <div class="workplace-dot" style="background:${w.color}"></div>
      <div style="flex:1;">
        <div class="workplace-name">${w.name}</div>
        <div class="workplace-wage">時給 ¥${Number(w.hourlyWage).toLocaleString()}</div>
      </div>
      <button class="icon-btn edit-wp" data-id="${w.id}">✎</button>
      <button class="icon-btn delete-wp" data-id="${w.id}">🗑</button>
    `;
    wrap.appendChild(card);
  });

  wrap.querySelectorAll(".edit-wp").forEach((btn) => {
    btn.addEventListener("click", () => openWorkplaceModal(btn.dataset.id));
  });
  wrap.querySelectorAll(".delete-wp").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (confirm("このバイト先を削除しますか?(登録済みシフトは残ります)")) {
        await deleteWorkplace(btn.dataset.id);
        showToast("バイト先を削除しました");
      }
    });
  });
}

$("#add-workplace-btn").addEventListener("click", () => openWorkplaceModal(null));

function buildColorSwatches(selected) {
  const wrap = $("#workplace-color-swatches");
  wrap.innerHTML = "";
  WORKPLACE_COLORS.forEach((c) => {
    const sw = document.createElement("div");
    sw.className = "swatch" + (c === selected ? " selected" : "");
    sw.style.background = c;
    sw.addEventListener("click", () => {
      $("#workplace-color").value = c;
      wrap.querySelectorAll(".swatch").forEach((s) => s.classList.remove("selected"));
      sw.classList.add("selected");
    });
    wrap.appendChild(sw);
  });
}

function openWorkplaceModal(id) {
  const w = id ? workplaceById(id) : null;
  $("#workplace-modal-title").textContent = w ? "バイト先を編集" : "バイト先を追加";
  $("#workplace-id").value = id || "";
  $("#workplace-name").value = w ? w.name : "";
  $("#workplace-wage").value = w ? w.hourlyWage : "";
  const color = w ? w.color : WORKPLACE_COLORS[state.workplaces.length % WORKPLACE_COLORS.length];
  $("#workplace-color").value = color;
  buildColorSwatches(color);
  $("#workplace-modal-backdrop").classList.remove("hidden");
}

$("#workplace-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = $("#workplace-id").value || null;
  const data = {
    name: $("#workplace-name").value.trim(),
    hourlyWage: Number($("#workplace-wage").value || 0),
    color: $("#workplace-color").value || WORKPLACE_COLORS[0],
  };
  await saveWorkplace(data, id);
  showToast("バイト先を保存しました");
  closeModals();
});

/* ============================================================
   給与集計
   ============================================================ */
$("#salary-prev").addEventListener("click", () => {
  state.salaryMonth -= 1;
  if (state.salaryMonth < 0) {
    state.salaryMonth = 11;
    state.salaryYear -= 1;
  }
  renderSalary();
});
$("#salary-next").addEventListener("click", () => {
  state.salaryMonth += 1;
  if (state.salaryMonth > 11) {
    state.salaryMonth = 0;
    state.salaryYear += 1;
  }
  renderSalary();
});

function renderSalary() {
  $("#salary-month-label").textContent = MONTH_LABEL(state.salaryYear, state.salaryMonth);
  const prefix = `${state.salaryYear}-${pad(state.salaryMonth + 1)}`;
  const monthShifts = state.shifts.filter((s) => s.date.startsWith(prefix));

  const byWorkplace = {};
  let total = 0;
  monthShifts.forEach((s) => {
    const wp = workplaceById(s.workplaceId);
    const pay = calcShiftPay(s, wp);
    const hours = calcWorkedHours(s.startTime, s.endTime, s.breakMinutes);
    total += pay;
    const key = s.workplaceId;
    if (!byWorkplace[key]) byWorkplace[key] = { hours: 0, pay: 0, workplace: wp };
    byWorkplace[key].hours += hours;
    byWorkplace[key].pay += pay;
  });

  $("#salary-total").textContent = total.toLocaleString();

  const breakdown = $("#salary-breakdown");
  const rows = Object.values(byWorkplace).sort((a, b) => b.pay - a.pay);

  if (rows.length === 0) {
    breakdown.innerHTML = `<div class="empty-state" style="padding:20px 10px;">この月のシフトはまだありません</div>`;
    return;
  }

  const maxPay = Math.max(...rows.map((r) => r.pay), 1);
  breakdown.innerHTML = "";
  rows.forEach((r) => {
    const name = r.workplace ? r.workplace.name : "(削除済みのバイト先)";
    const color = r.workplace ? r.workplace.color : "#888";
    const row = document.createElement("div");
    row.className = "summary-row";
    row.style.display = "block";
    row.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <div class="summary-left">
          <div class="workplace-dot" style="background:${color}"></div>
          <div>
            <div style="font-weight:700;">${name}</div>
            <div style="font-size:11px;color:var(--ink-soft);">${r.hours.toFixed(1)} 時間</div>
          </div>
        </div>
        <div class="workplace-wage">¥${r.pay.toLocaleString()}</div>
      </div>
      <div class="bar-track"><div class="bar-fill" style="width:${(r.pay / maxPay) * 100}%;background:${color};"></div></div>
    `;
    breakdown.appendChild(row);
  });
}

/* ============================================================
   ICS書き出し(iPhoneカレンダー連携)
   ============================================================ */
$("#export-month-ics").addEventListener("click", () => {
  const prefix = `${state.calYear}-${pad(state.calMonth + 1)}`;
  const shifts = state.shifts.filter((s) => s.date.startsWith(prefix));
  if (shifts.length === 0) {
    showToast("この月にはシフトがありません");
    return;
  }
  const map = Object.fromEntries(state.workplaces.map((w) => [w.id, w]));
  const ics = buildICS(shifts, map);
  downloadICS(`shift-${prefix}.ics`, ics);
  showToast(".icsファイルをダウンロードしました");
});

$("#export-all-ics").addEventListener("click", () => {
  const todayStr = dateKey(today.getFullYear(), today.getMonth(), today.getDate());
  const shifts = state.shifts.filter((s) => s.date >= todayStr);
  if (shifts.length === 0) {
    showToast("今後のシフトがありません");
    return;
  }
  const map = Object.fromEntries(state.workplaces.map((w) => [w.id, w]));
  const ics = buildICS(shifts, map);
  downloadICS("shift-upcoming.ics", ics);
  showToast(".icsファイルをダウンロードしました");
});

/* ============================================================
   モーダル共通処理
   ============================================================ */
function closeModals() {
  $all(".modal-backdrop").forEach((m) => m.classList.add("hidden"));
}
$all("[data-close-modal]").forEach((btn) => {
  btn.addEventListener("click", closeModals);
});
$all(".modal-backdrop").forEach((backdrop) => {
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) closeModals();
  });
});

/* ============================================================
   Service Worker登録(PWA化・オフライン対応)
   ============================================================ */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {
      // file:// で開いた場合など、SW登録に失敗しても致命的ではない
    });
  });
}
