// 计算核心，逐行对应上游 Engine.cs / Calculation core, a line-by-line port of upstream Engine.cs.
// 时间一律按浏览器本地时区 / All times use the browser's local time zone.

export const CURRENCIES = ["CNY", "USD", "EUR", "JPY", "HKD", "TWD", "SGD", "MYR"];

export function defaults(goalName = "A weekend getaway") {
  return {
    MonthlySalary: 18000, Start: "09:00", End: "18:00", LunchStart: "12:00", LunchEnd: "13:30", LunchEnabled: true,
    Weekdays: "1,2,3,4,5", RestDates: "", WorkDates: "", Basis: "actual", Decimals: 3, Grouping: true,
    Currency: "CNY", Pattern: "{symbol}{amount}", Animation: "flip", Font: "DIN", Theme: "midnight", Speed: 420,
    Goals: [{ Name: goalName, Amount: 3000 }], Configured: false, Language: "auto",
    ExpensesEnabled: false, Expenses: null, SettlementDay: 1, OpeningAt: null, OpeningIncome: null,
  };
}

export const day = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
export const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const at = (d, minutes) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, minutes);

export class ValidationError extends Error {}
const fail = (key) => { throw new ValidationError(key); };

export function clock(value) {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value || "");
  if (!m) fail("validation.time");
  return Number(m[1]) * 60 + Number(m[2]);
}

export function parseDates(value) {
  const result = new Set();
  for (const token of (value || "").split(/[,，;\r\n ]+/).filter(Boolean)) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(token.trim());
    const d = m && new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (!d || iso(d) !== token.trim()) fail("validation.date");
    result.add(iso(d));
  }
  return result;
}

export function parseDays(s) {
  const result = new Set();
  for (const part of (s.Weekdays || "").split(",").filter(Boolean)) {
    const n = Number(part.trim());
    if (!Number.isInteger(n) || n < 0 || n > 6) fail("validation.day");
    result.add(n);
  }
  return result;
}

export const cycleDay = (s) => s.SettlementDay ?? 1;
export const goalItems = (s) => s.Goals || [];
export const expenseItems = (s) => s.Expenses || [];

export function validate(s) {
  const amountOk = (v) => typeof v === "number" && isFinite(v) && v > 0 && v <= 100000000;
  const cd = cycleDay(s);
  if (!Number.isInteger(cd) || cd < 1 || cd > 31) fail("validation.settlement");
  if ((s.OpeningIncome != null) !== !!s.OpeningAt ||
      (s.OpeningIncome != null && (!(s.OpeningIncome >= 0) || s.OpeningIncome > 100000000 || isNaN(Date.parse(s.OpeningAt)))))
    fail("validation.opening");
  if (!amountOk(s.MonthlySalary)) fail("validation.salary");
  if (clock(s.Start) === clock(s.End)) fail("validation.shift");
  if (s.LunchEnabled) {
    if (clock(s.LunchStart) === clock(s.LunchEnd)) fail("validation.breakEqual");
    const ref = new Date(2026, 0, 5), shift = rawShift(ref, s), l = lunch(ref, s);
    if (l.start < shift.start || l.end > shift.end || l.end - l.start >= shift.end - shift.start) fail("validation.breakBounds");
  }
  if (parseDays(s).size === 0) fail("validation.weekdays");
  const rest = parseDates(s.RestDates), work = parseDates(s.WorkDates);
  for (const d of rest) if (work.has(d)) fail("validation.dateConflict");
  if (s.Basis !== "actual" && s.Basis !== "fixed") fail("validation.basis");
  if (!Number.isInteger(s.Decimals) || s.Decimals < 0 || s.Decimals > 4) fail("validation.decimals");
  if (!CURRENCIES.includes(s.Currency)) fail("validation.currency");
  if (!["flip", "slide", "none"].includes(s.Animation)) fail("validation.animation");
  if (!["DIN", "Mono", "Classic"].includes(s.Font)) fail("validation.font");
  if (!["midnight", "forest", "paper"].includes(s.Theme)) fail("validation.theme");
  if (!(s.Speed >= 160 && s.Speed <= 700)) fail("validation.speed");
  if (goalItems(s).length > 20) fail("validation.goalCount");
  for (const g of goalItems(s)) {
    if (!g || !g.Name || !g.Name.trim() || g.Name.length > 28) fail("validation.goalName");
    if (!amountOk(g.Amount)) fail("validation.goalAmount");
  }
  if (expenseItems(s).length > 20) fail("validation.expenseCount");
  for (const e of expenseItems(s)) {
    if (!e || !e.Name || !e.Name.trim() || e.Name.length > 28) fail("validation.expenseName");
    if (!amountOk(e.Amount)) fail("validation.expenseAmount");
  }
  const p = s.Pattern || "";
  if (!p || p.length > 48 || !p.includes("{amount}") || p.split("{").length - 1 > 3) fail("validation.pattern");
  if (p.indexOf("{amount}") !== p.lastIndexOf("{amount}")) fail("validation.patternOnce");
  if (/[{}\r\n\t]/.test(p.replaceAll("{amount}", "").replaceAll("{symbol}", "").replaceAll("{code}", ""))) fail("validation.patternTokens");
}

// 同一份周期收入先覆盖必要开支，再进入奖励 / Cover expenses before rewards using each cycle's income once.
export const expenseTotal = (s) => (s.ExpensesEnabled ? expenseItems(s).reduce((a, e) => a + e.Amount, 0) : 0);
export const rewardIncome = (income, s) => Math.max(0, income - expenseTotal(s));

export function goals(income, s) {
  const cycleIncome = Math.max(0, income);
  income = rewardIncome(income, s);
  let before = 0;
  return goalItems(s).map((goal) => {
    const allocated = Math.max(0, Math.min(goal.Amount, income - before));
    before += goal.Amount;
    return { goal, allocated, fraction: allocated / goal.Amount, remainingToReach: Math.max(0, before + expenseTotal(s) - cycleIncome) };
  });
}

export function expenseCoverage(income, s) {
  if (!s.ExpensesEnabled) return [];
  let available = Math.max(0, income);
  return expenseItems(s).map((item) => {
    const covered = Math.min(available, item.Amount);
    available -= covered;
    const remaining = item.Amount - covered;
    return { item, covered, remaining, remainingFraction: remaining / item.Amount };
  });
}

export function isWorkday(date, s) {
  const key = iso(date);
  if (parseDates(s.WorkDates).has(key)) return true;
  if (parseDates(s.RestDates).has(key)) return false;
  return parseDays(s).has(date.getDay());
}

export function rawShift(date, s) {
  const start = at(date, clock(s.Start));
  let end = at(date, clock(s.End));
  if (end <= start) end = at(addDays(date, 1), clock(s.End));
  return { start, end };
}

export function lunch(date, s) {
  const shift = rawShift(date, s);
  let start = at(date, clock(s.LunchStart));
  if (start < shift.start) start = at(addDays(date, 1), clock(s.LunchStart));
  let end = at(day(start), clock(s.LunchEnd));
  if (end <= start) end = at(addDays(day(start), 1), clock(s.LunchEnd));
  return { start, end };
}

export function segments(date, s) {
  const shift = rawShift(date, s);
  if (!s.LunchEnabled) return [shift];
  const l = lunch(date, s);
  return [{ start: shift.start, end: l.start }, { start: l.end, end: shift.end }];
}

const seconds = (i) => (i.end - i.start) / 1000;
const elapsed = (now, segs) => segs.reduce((a, seg) => a + Math.max(0, (Math.min(now, seg.end) - seg.start) / 1000), 0);

const settlement = (year, month, d) => new Date(year, month, Math.min(d, new Date(year, month + 1, 0).getDate()));

export function payPeriod(date, s) {
  let y = date.getFullYear(), m = date.getMonth();
  if (day(date) < settlement(y, m, cycleDay(s))) m -= 1;
  return { start: settlement(y, m, cycleDay(s)), end: settlement(y, m + 1, cycleDay(s)) };
}

export function monthDays(date, s) {
  const p = payPeriod(date, s);
  let count = 0;
  for (let d = p.start; d < p.end; d = addDays(d, 1)) if (isWorkday(d, s)) count++;
  return count;
}

export const dayPay = (date, s) => s.MonthlySalary / (s.Basis === "fixed" ? 21.75 : Math.max(1, monthDays(date, s)));

// 夜班按开班日归属周期；重置发生在结算日零点 / Night shifts belong to their start date; cycles reset at midnight.
function periodIncome(now, s) {
  const p = payPeriod(now, s), daily = dayPay(now, s), today = day(now);
  let income = 0;
  for (let d = p.start; d <= today; d = addDays(d, 1)) {
    if (!isWorkday(d, s)) continue;
    const segs = segments(d, s);
    income += daily * (elapsed(now, segs) / segs.reduce((a, x) => a + seconds(x), 0));
  }
  return income;
}

export function calculate(now, s) {
  // 跨午夜班次归属开班日 / Overnight shifts belong to their starting date.
  let workDate = day(now);
  const yesterday = addDays(workDate, -1);
  if (isWorkday(yesterday, s) && now < rawShift(yesterday, s).end) workDate = yesterday;
  const segs = segments(workDate, s), shift = rawShift(workDate, s), workingDay = isWorkday(workDate, s);
  const total = segs.reduce((a, x) => a + seconds(x), 0);
  const worked = workingDay ? elapsed(now, segs) : 0;
  const daily = dayPay(workDate, s), rate = daily / total;
  const snap = { workDate, total, worked, progress: worked / total, daily, rate, hourly: rate * 3600, today: rate * worked };
  snap.statusKey = !workingDay ? "status.rest" : now < shift.start ? "status.before" : now >= shift.end ? "status.after" :
    segs.some((x) => now >= x.start && now < x.end) ? "status.earning" : "status.break";
  if (workingDay && now >= shift.start && now < shift.end) {
    snap.countdownKey = "main.countdownOff"; snap.countdown = shift.end - now;
  } else {
    snap.countdownKey = "main.countdownOn"; snap.countdown = 0;
    for (let i = 0, next = workDate; i < 370; i++, next = addDays(next, 1)) {
      const start = rawShift(next, s).start;
      if (start > now && isWorkday(next, s)) { snap.countdown = start - now; break; }
    }
  }
  const p = payPeriod(now, s);
  snap.periodStart = p.start; snap.periodEnd = p.end;
  snap.monthDays = monthDays(now, s);
  snap.month = periodIncome(now, s);
  const anchor = s.OpeningAt ? new Date(s.OpeningAt) : null;
  if (s.OpeningIncome != null && anchor && now >= anchor && anchor >= p.start && anchor < p.end)
    snap.month = s.OpeningIncome + Math.max(0, snap.month - periodIncome(anchor, s));
  return snap;
}

const SYMBOLS = { USD: "$", EUR: "€", HKD: "HK$", TWD: "NT$", SGD: "S$", MYR: "RM" };
export const symbol = (c) => SYMBOLS[c] ?? "¥";

function fixed(value, decimals, grouping) {
  // 远离零舍入，与 .NET MidpointRounding.AwayFromZero 一致 / Round half away from zero like .NET.
  const f = 10 ** decimals, rounded = Math.sign(value) * Math.round(Math.abs(value) * f + 1e-9) / f;
  return rounded.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping: grouping });
}

export const amount = (v, s) => fixed(v, s.Decimals, s.Grouping);
export const format = (v, s) => s.Pattern.replace("{amount}", amount(v, s)).replace("{symbol}", symbol(s.Currency)).replace("{code}", s.Currency);
export const money = (v, s) => symbol(s.Currency) + fixed(v, 2, true);

export function duration(ms) {
  const t = Math.ceil(Math.max(0, ms / 1000));
  const p = (n) => String(n).padStart(2, "0");
  return `${p(Math.floor(t / 3600))}:${p(Math.floor(t / 60) % 60)}:${p(t % 60)}`;
}
