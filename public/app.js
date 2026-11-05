// 网页版主界面，对应上游 MainController / Web home screen, mirroring upstream MainController.
import * as E from "./engine.js";

const STORE = "shechu.settings.v1";
const LANGS = { "zh-Hans": "简体中文", "zh-Hant": "繁體中文", en: "English", ja: "日本語", es: "Español", ko: "한국어" };
const WEEKDAYS = [["weekday.mon", 1], ["weekday.tue", 2], ["weekday.wed", 3], ["weekday.thu", 4], ["weekday.fri", 5], ["weekday.sat", 6], ["weekday.sun", 0]];
const DEMO_START = new Date(2026, 10, 4, 14, 32, 18);
const $ = (id) => document.getElementById(id);

// —— 文案 / Strings ——
let lang = "en";
function resolve(code) {
  code = (code || "").toLowerCase();
  if (code.startsWith("zh")) return /hant|tw|hk|mo/.test(code) ? "zh-Hant" : "zh-Hans";
  return ["ja", "es", "ko"].find((l) => code.startsWith(l)) || "en";
}
function t(key, ...args) {
  const s = I18N[lang][key] ?? I18N.en[key] ?? key;
  return s.replace(/\{(\d)(?::F(\d))?\}/g, (_, i, f) => (f != null ? Number(args[i]).toFixed(Number(f)) : String(args[i])));
}
function useLanguage(choice) {
  lang = choice && choice !== "auto" ? choice : resolve(navigator.language);
  document.documentElement.lang = lang;
  document.title = `${t("app.name")} · ${t("main.headline")}`;
  for (const el of document.querySelectorAll("[data-t]")) el.textContent = t(el.dataset.t);
  for (const el of document.querySelectorAll("[data-title]")) el.title = t(el.dataset.title);
  for (const select of [$("languageQuick"), $("fLanguage")]) {
    const value = select.value;
    select.replaceChildren(new Option(t("language.auto"), "auto"), ...Object.entries(LANGS).map(([v, n]) => new Option(n, v)));
    select.value = value || "auto";
  }
}

// —— 状态 / State ——
let settings, demo, privacy = false, mini = false, selectedGoal = -1, loadNotice = "";
const demoT0 = performance.now();
const now = () => (demo ? new Date(DEMO_START.getTime() + performance.now() - demoT0) : new Date());

function load() {
  let raw = null;
  try { raw = localStorage.getItem(STORE); } catch { /* 存储被禁用 / storage blocked */ }
  if (raw) {
    try {
      const s = { ...E.defaults(), ...JSON.parse(raw) };
      E.validate(s);
      useLanguage(s.Language);
      return s;
    } catch { loadNotice = "error.load"; }
  }
  useLanguage("auto");
  return E.defaults(t("goal.default"));
}

function persist(s) {
  try { localStorage.setItem(STORE, JSON.stringify(s)); return true; } catch { return false; }
}

function applyAppearance(s) {
  document.documentElement.dataset.theme = s.Theme;
  document.documentElement.dataset.font = s.Font;
  document.documentElement.style.setProperty("--speed", s.Speed + "ms");
  document.querySelector('meta[name="theme-color"]').content = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
}

// —— 翻页数字 / Flip digits ——
class Flip {
  constructor(row, host) { this.row = row; this.host = host; this.value = ""; this.signature = ""; this.tiles = []; }
  reset() { this.signature = ""; }
  set(value, s, animate) {
    const style = s.Animation + s.Font + s.Theme;
    if (style !== this.signature || value.length !== this.value.length) {
      this.row.replaceChildren(); this.tiles = [];
      for (const ch of value) {
        if (/\d/.test(ch)) { const tile = new Tile(ch, s.Animation); this.tiles.push(tile); this.row.append(tile.el); }
        else {
          const sym = document.createElement("span");
          sym.className = ch.trim() ? "sym" : "sym space"; sym.textContent = ch;
          this.tiles.push(sym); this.row.append(sym);
        }
      }
      this.signature = style; this.value = value; this.fit(); return;
    }
    [...value].forEach((ch, i) => (this.tiles[i] instanceof Tile ? this.tiles[i].set(ch, animate) : (this.tiles[i].textContent = ch)));
    this.value = value;
  }
  fit() {
    this.row.style.transform = "";
    const scale = Math.min(1, this.host.clientWidth / this.row.scrollWidth);
    this.row.style.transform = scale < 1 ? `scale(${scale})` : "";
  }
}

class Tile {
  constructor(ch, mode) { this.mode = mode; this.ch = ch; this.version = 0; this.el = document.createElement("div"); this.draw(ch); }
  static digit(ch, cls = "") { const b = document.createElement("b"); b.textContent = ch; if (cls) b.className = cls; return b; }
  static half(ch, cls) { const s = document.createElement("span"); s.className = cls; s.append(Tile.digit(ch)); return s; }
  draw(ch) {
    this.el.className = "tile" + (this.mode === "none" ? " plain" : this.mode === "slide" ? " slide" : "");
    if (this.mode === "flip") this.el.replaceChildren(Tile.half(ch, "half top"), Tile.half(ch, "half bottom"));
    else this.el.replaceChildren(Tile.digit(ch));
  }
  set(ch, animate) {
    if (ch === this.ch) return;
    const old = this.ch, token = ++this.version;
    this.ch = ch;
    if (!animate || this.mode === "none" || document.hidden) return this.draw(ch);
    const done = () => { if (token === this.version) this.draw(ch); };
    if (this.mode === "slide") {
      const incoming = Tile.digit(ch, "in");
      this.el.replaceChildren(Tile.digit(old, "out"), incoming);
      incoming.addEventListener("animationend", done, { once: true });
      return;
    }
    // 先翻旧上半页，再落下新下半页 / Fold the old upper flap, then unfold the new lower flap.
    const unfold = Tile.half(ch, "flap unfold");
    this.el.replaceChildren(Tile.half(ch, "half top"), Tile.half(old, "half bottom"), Tile.half(old, "flap fold"), unfold);
    unfold.addEventListener("animationend", done, { once: true });
  }
}

const flip = new Flip($("flipRow"), $("flipHost"));

// —— 主页刷新 / Home refresh ——
const text = (id, value) => { const el = $(id); if (el.textContent !== value) el.textContent = value; };
const dateLabel = (d) => `${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")} / ${d.toLocaleDateString(lang, { weekday: "short" })}`;
const periodLabel = (data) => t("income.period", E.iso(data.periodStart), E.iso(E.addDays(data.periodEnd, -1)));

function goalIndex(goals) {
  if (goals.length === 0) return 0;
  if (selectedGoal >= 0) return Math.min(selectedGoal, goals.length - 1);
  const next = goals.findIndex((g) => g.fraction < 1);
  return next < 0 ? goals.length - 1 : next;
}

function refresh(animate) {
  const s = settings, at = now(), data = E.calculate(at, s);
  flip.set(privacy ? "••••••" : E.format(data.today, s), s, animate);
  text("dateText", dateLabel(at));
  text("statusText", demo ? t("main.demoBadge") : data.statusKey === "status.break" ? t("web.breakResume", s.LunchEnd) : t(data.statusKey));
  text("subtitleText", loadNotice ? t(loadNotice) : t(s.Configured ? "main.subtitle" : "main.setupHint"));
  text("rateText", privacy ? t("main.hidden") : t("main.rate", E.symbol(s.Currency) + data.rate.toFixed(4)));
  text("countdownLabel", t(data.countdownKey));
  text("countdownText", E.duration(data.countdown));
  text("scheduleText", `${s.Start} — ${s.End}${s.LunchEnabled ? t("main.breakSuffix") : ""}`);
  text("hoursText", t("main.hours", data.worked / 3600, data.total / 3600));
  text("progressText", (data.progress * 100).toFixed(1) + "%");
  $("workProgress").style.width = data.progress * 100 + "%";
  text("hourlyText", privacy ? "••••" : E.money(data.hourly, s));
  text("monthText", privacy ? "••••" : E.money(data.month, s));
  $("monthText").title = periodLabel(data);

  const goals = E.goals(data.month, s), gi = goalIndex(goals), goal = goals[gi];
  text("goalHeadingText", goal ? t("goal.index", gi + 1, goals.length) : t("goal.heading"));
  text("goalNameText", goal ? goal.goal.Name : t("goal.emptyTitle"));
  text("goalAmountText", privacy ? "••••" : goal ? E.money(goal.goal.Amount, s) : "＋");
  text("goalPercentText", privacy || !goal ? "—" : Math.round(goal.fraction * 100) + "%");
  $("goalProgress").style.width = (privacy || !goal ? 0 : goal.fraction * 100) + "%";
  text("goalHintText", privacy ? t("goal.hidden") : !goal ? t("goal.emptyHint") :
    goal.fraction >= 1 ? t(gi === goals.length - 1 ? "goal.allDone" : "goal.done") : t("goal.remaining", goal.remainingToReach / data.hourly));
  $("prevGoal").disabled = $("nextGoal").disabled = goals.length < 2;
  text("footnoteText", s.Basis === "actual" ? t("main.actualFootnote", data.monthDays) : t("main.fixedFootnote"));

  $("expenseCard").hidden = !s.ExpensesEnabled;
  if (s.ExpensesEnabled) renderExpenses(data);

  text("demoButton", t(demo ? "main.demoActive" : "main.demo"));
  text("settingsButton", t(s.Configured ? "settings.open" : "main.firstUse"));
  $("privacyButton").classList.toggle("on", privacy);
  $("privacyButton").title = t(privacy ? "mode.privacyOffTip" : "mode.privacyOnTip");
  $("miniButton").classList.toggle("on", mini);
  $("miniButton").title = t(mini ? "mode.miniOffTip" : "mode.miniOnTip");
  $("demoButton").title = t("main.demoTip");
}

function renderExpenses(data) {
  const s = settings, rows = E.expenseCoverage(data.month, s), total = E.expenseTotal(s);
  const left = rows.reduce((a, r) => a + r.remaining, 0);
  text("expenseBadge", t(demo ? "main.demoBadge" : "expense.monthly"));
  $("expenseBadge").title = periodLabel(data);
  $("expenseTotalBar").style.width = (privacy || total === 0 ? 0 : (left / total) * 100) + "%";
  text("expenseSummary", privacy ? t("expense.hidden") : total === 0 ? t("expense.emptyTotal") : left === 0 ? t("expense.allCovered") : t("expense.summary", E.money(left, s), E.money(total, s)));
  const host = $("expenseRows");
  if (host.children.length !== rows.length) {
    host.replaceChildren(...rows.map(() => {
      const el = document.createElement("div");
      el.innerHTML = '<div class="row"><span class="name"></span><span class="red-text amount"></span></div><div class="progress red"><i></i></div><div class="tiny muted state"></div>';
      return el;
    }));
  }
  rows.forEach((r, i) => {
    const el = host.children[i];
    el.querySelector(".name").textContent = r.item.Name;
    el.querySelector(".amount").textContent = privacy ? "••••" : t("expense.remainingValue", E.money(r.remaining, s));
    el.querySelector("i").style.width = (privacy ? 0 : r.remainingFraction * 100) + "%";
    el.querySelector(".state").textContent = privacy ? t("expense.hidden") : r.remaining === 0 ? t("expense.completed") : t("expense.coveredValue", E.money(r.covered, s), E.money(r.item.Amount, s));
  });
}

function toggleMini() { mini = !mini; $("app").classList.toggle("mini", mini); flip.fit(); refresh(false); }
function togglePrivacy() { privacy = !privacy; flip.reset(); refresh(false); }

// —— 设置 / Settings ——
let draft, calMonth, calMode = "rest", adjustRequested = false;
const dialog = $("settingsDialog");

function fillSelect(id, values) { $(id).replaceChildren(...values.map(([v, label]) => new Option(label, v))); }

function openSettings(tab) {
  draft = structuredClone(settings);
  if (!draft.Expenses) draft.Expenses = [["expense.rent", 3000], ["expense.living", 2000], ["expense.essential", 1000]].map(([k, a]) => ({ Name: t(k), Amount: a }));
  adjustRequested = false; $("adjustHint").hidden = true; $("formError").textContent = "";
  fillSelect("fSettlement", Array.from({ length: 31 }, (_, i) => [i + 1, String(i + 1)]));
  $("fSalary").value = draft.MonthlySalary; $("fSettlement").value = E.cycleDay(draft); $("fBasis").value = draft.Basis;
  $("fStart").value = draft.Start; $("fEnd").value = draft.End;
  $("fLunch").checked = draft.LunchEnabled; $("fLunchStart").value = draft.LunchStart; $("fLunchEnd").value = draft.LunchEnd;
  const days = E.parseDays(draft);
  $("fWeekdays").replaceChildren(...WEEKDAYS.map(([key, n]) => {
    const label = document.createElement("label"), box = document.createElement("input");
    box.type = "checkbox"; box.value = n; box.checked = days.has(n);
    label.append(box, t(key)); return label;
  }));
  $("fExpenses").checked = draft.ExpensesEnabled;
  $("fLanguage").value = draft.Language || "auto"; $("fTheme").value = draft.Theme; $("fAnimation").value = draft.Animation;
  $("fSpeed").value = String(draft.Speed); $("fFont").value = draft.Font; $("fDecimals").value = String(draft.Decimals);
  $("fCurrency").value = draft.Currency; $("fGrouping").checked = draft.Grouping;
  const preset = [...$("fPattern").options].some((o) => o.value === draft.Pattern);
  $("fPattern").value = preset ? draft.Pattern : "custom"; $("fPatternText").value = draft.Pattern;
  calMonth = new Date(now().getFullYear(), now().getMonth(), 1);
  syncVisibility(); renderList("goal"); renderList("expense");
  showTab(tab || "salary");
  dialog.showModal();
}

function showTab(name) {
  for (const b of document.querySelectorAll("[data-tab]")) b.setAttribute("aria-selected", String(b.dataset.tab === name));
  for (const p of document.querySelectorAll("[data-pane]")) p.hidden = p.dataset.pane !== name;
  if (name === "calendar") { readSchedule(); renderCalendar(); }
}

function syncVisibility() {
  $("lunchFields").hidden = !$("fLunch").checked;
  $("expenseEditor").hidden = !$("fExpenses").checked;
  $("patternField").hidden = $("fPattern").value !== "custom";
}

// 把表单写入草稿；数字无效时抛出 / Copy form fields into the draft; throws on invalid numbers.
function readSchedule() {
  draft.Start = $("fStart").value; draft.End = $("fEnd").value;
  draft.LunchEnabled = $("fLunch").checked; draft.LunchStart = $("fLunchStart").value; draft.LunchEnd = $("fLunchEnd").value;
  draft.Weekdays = [...$("fWeekdays").querySelectorAll("input:checked")].map((b) => b.value).join(",");
}
function readForm() {
  readSchedule();
  const number = (v, key) => { const n = Number(v); if (v === "" || !isFinite(n)) throw new E.ValidationError(key); return n; };
  draft.MonthlySalary = number($("fSalary").value, "validation.salaryNumber");
  draft.SettlementDay = Number($("fSettlement").value); draft.Basis = $("fBasis").value;
  draft.ExpensesEnabled = $("fExpenses").checked;
  draft.Language = $("fLanguage").value; draft.Theme = $("fTheme").value; draft.Animation = $("fAnimation").value;
  draft.Speed = Number($("fSpeed").value); draft.Font = $("fFont").value; draft.Decimals = Number($("fDecimals").value);
  draft.Currency = $("fCurrency").value; draft.Grouping = $("fGrouping").checked;
  draft.Pattern = $("fPattern").value === "custom" ? $("fPatternText").value : $("fPattern").value;
  for (const kind of ["goal", "expense"]) {
    const items = kind === "goal" ? draft.Goals : draft.Expenses;
    $(kind + "List").querySelectorAll(".item").forEach((row, i) => {
      items[i].Name = row.querySelector(".name").value.trim();
      items[i].Amount = number(row.querySelector(".amount").value, `validation.${kind}Number`);
    });
  }
  return draft;
}

function renderList(kind) {
  const items = kind === "goal" ? draft.Goals : draft.Expenses, host = $(kind + "List");
  $(kind === "goal" ? "addGoal" : "addExpense").disabled = items.length >= 20;
  if (items.length === 0) {
    const empty = document.createElement("p"); empty.className = "empty"; empty.textContent = t(kind + ".emptyEditor");
    return host.replaceChildren(empty);
  }
  host.replaceChildren(...items.map((item, i) => {
    const row = document.createElement("div"); row.className = "item";
    row.innerHTML = '<input class="name" maxlength="28"><input class="amount" type="number" min="0" step="any" inputmode="decimal"><span class="ops"><button type="button" data-op="-1">↑</button><button type="button" data-op="1">↓</button><button type="button" data-op="x">×</button></span>';
    const [name, amount] = row.querySelectorAll("input");
    name.value = item.Name; name.setAttribute("aria-label", t(kind + ".name"));
    amount.value = item.Amount; amount.setAttribute("aria-label", t(kind + ".amount"));
    const [up, down, remove] = row.querySelectorAll("button");
    up.title = t(kind + ".moveUp"); down.title = t(kind + ".moveDown"); remove.title = t(kind + ".removeTip");
    up.disabled = i === 0; down.disabled = i === items.length - 1;
    name.oninput = () => (item.Name = name.value);
    amount.oninput = () => (item.Amount = amount.value === "" ? NaN : Number(amount.value));
    row.querySelector(".ops").onclick = (e) => {
      const op = e.target.dataset.op; if (!op) return;
      if (op === "x") items.splice(i, 1); else items.splice(i + Number(op), 0, items.splice(i, 1)[0]);
      renderList(kind);
    };
    return row;
  }));
}

function renderCalendar() {
  let rest, work;
  try { rest = E.parseDates(draft.RestDates); work = E.parseDates(draft.WorkDates); } catch { rest = new Set(); work = new Set(); }
  const weekly = (() => { try { return E.parseDays(draft); } catch { return new Set(); } })();
  $("calTitle").textContent = calMonth.toLocaleDateString(lang, { year: "numeric", month: "long" });
  for (const b of $("calModes").children) b.classList.toggle("on", b.dataset.mode === calMode);
  $("calHint").textContent = t(`calendar.${calMode}Hint`);
  $("calSummary").textContent = t("calendar.summary", rest.size, work.size);
  const head = WEEKDAYS.map(([key]) => { const d = document.createElement("div"); d.className = "dow"; d.textContent = t(key); return d; });
  const offset = (calMonth.getDay() + 6) % 7, first = E.addDays(calMonth, -offset), today = E.iso(new Date());
  const cells = Array.from({ length: 42 }, (_, i) => {
    const d = E.addDays(first, i), key = E.iso(d), b = document.createElement("button");
    const isRest = rest.has(key), isWork = work.has(key), scheduled = isWork || (!isRest && weekly.has(d.getDay()));
    b.type = "button"; b.dataset.date = key;
    b.className = [scheduled ? "work" : "off", isRest && "rest-x", isWork && "work-x", key === today && "today", d.getMonth() !== calMonth.getMonth() && "other"].filter(Boolean).join(" ");
    b.innerHTML = `<span>${d.getDate()}</span><small>${isRest ? t("calendar.restMark") : isWork ? t("calendar.workMark") : ""}</small>`;
    b.title = key + t(isRest ? "calendar.restSuffix" : isWork ? "calendar.workSuffix" : "calendar.normalSuffix");
    return b;
  });
  $("calGrid").replaceChildren(...head, ...cells);
}

// 单日互斥，再点一次恢复排班 / Overrides are exclusive; clicking the same mode again restores the schedule.
function clickDate(key) {
  const rest = E.parseDates(draft.RestDates), work = E.parseDates(draft.WorkDates);
  const selected = calMode === "rest" ? rest.has(key) : calMode === "work" && work.has(key);
  rest.delete(key); work.delete(key);
  if (!selected && calMode === "rest") rest.add(key);
  if (!selected && calMode === "work") work.add(key);
  draft.RestDates = [...rest].sort().join(","); draft.WorkDates = [...work].sort().join(",");
  renderCalendar();
}

function closeSettings() { dialog.close(); applyAppearance(settings); useLanguage(settings.Language); flip.reset(); refresh(false); }

function saveSettings() {
  $("formError").textContent = "";
  let candidate;
  try { candidate = { ...readForm(), Configured: true }; E.validate(candidate); }
  catch (e) { if (!(e instanceof E.ValidationError)) throw e; $("formError").textContent = t(e.message); return; }
  const needsConfirm = adjustRequested || !settings.Configured || E.cycleDay(settings) !== E.cycleDay(candidate) || (!settings.ExpensesEnabled && candidate.ExpensesEnabled);
  if (needsConfirm) return confirmIncome(candidate);
  commit(candidate);
}

function commit(candidate) {
  if (!persist(candidate)) { $("formError").textContent = t("error.save"); return; }
  settings = candidate; demo = false; loadNotice = ""; selectedGoal = -1;
  closeSettings();
}

// 确认前只操作副本；取消回到设置 / Work on a copy; cancelling returns to settings.
let incomeCandidate, incomeAt;
function confirmIncome(candidate) {
  incomeCandidate = candidate; incomeAt = new Date();
  const p = E.payPeriod(incomeAt, candidate), estimate = E.calculate(incomeAt, candidate).month;
  $("incomePeriod").textContent = t("income.period", E.iso(p.start), E.iso(E.addDays(p.end, -1)));
  $("incomeEstimate").textContent = t("income.estimate", E.money(estimate, candidate));
  $("incomeLabel").textContent = t("income.amount", candidate.Currency);
  $("incomeAmount").value = estimate.toFixed(2); $("incomeError").textContent = "";
  $("incomeDialog").showModal(); $("incomeAmount").select();
}

// —— 事件 / Events ——
function wire() {
  $("prevGoal").onclick = () => changeGoal(-1);
  $("nextGoal").onclick = () => changeGoal(1);
  $("privacyButton").onclick = togglePrivacy;
  $("miniButton").onclick = toggleMini;
  $("demoButton").onclick = () => { demo = !demo; flip.reset(); refresh(false); };
  $("settingsButton").onclick = () => openSettings();
  $("languageQuick").onchange = (e) => {
    settings.Language = e.target.value; useLanguage(settings.Language);
    // 未设置时示例目标跟随语言 / Unconfigured sample goal follows the language.
    if (settings.Configured) persist(settings); else settings.Goals = E.defaults(t("goal.default")).Goals;
    flip.reset(); refresh(false);
  };
  document.addEventListener("keydown", (e) => {
    if (dialog.open || $("incomeDialog").open || e.metaKey || e.ctrlKey || e.altKey || /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
    if (e.key === "m" || e.key === "M") toggleMini();
    else if (e.key === "p" || e.key === "P") togglePrivacy();
    else if (e.key === "Escape" && mini) toggleMini();
  });
  window.addEventListener("resize", () => flip.fit());
  document.addEventListener("visibilitychange", () => refresh(false));

  for (const b of document.querySelectorAll("[data-tab]")) b.onclick = () => showTab(b.dataset.tab);
  $("openCalendar").onclick = () => showTab("calendar");
  $("settingsForm").onchange = (e) => {
    syncVisibility();
    if (e.target.closest('[data-pane="appearance"]')) {
      try { readForm(); } catch { return; }
      applyAppearance(draft); useLanguage(draft.Language); flip.reset(); refresh(false);
    }
  };
  $("settingsForm").onsubmit = (e) => { e.preventDefault(); saveSettings(); };
  $("cancelSettings").onclick = closeSettings;
  dialog.addEventListener("cancel", (e) => { e.preventDefault(); closeSettings(); });
  $("addGoal").onclick = () => { draft.Goals.push({ Name: t("goal.new"), Amount: 1000 }); renderList("goal"); };
  $("addExpense").onclick = () => { draft.Expenses.push({ Name: t("expense.new"), Amount: 500 }); renderList("expense"); };
  $("adjustIncome").onclick = () => { adjustRequested = true; $("adjustHint").hidden = false; };
  $("calPrev").onclick = () => { calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1); renderCalendar(); };
  $("calNext").onclick = () => { calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1); renderCalendar(); };
  $("calToday").onclick = () => { calMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1); renderCalendar(); };
  $("calModes").onclick = (e) => { if (e.target.dataset.mode) { calMode = e.target.dataset.mode; renderCalendar(); } };
  $("calGrid").onclick = (e) => { const b = e.target.closest("button[data-date]"); if (b) clickDate(b.dataset.date); };

  $("incomeZero").onclick = () => ($("incomeAmount").value = "0.00");
  $("incomeCancel").onclick = () => $("incomeDialog").close();
  $("incomeForm").onsubmit = (e) => {
    e.preventDefault();
    const raw = $("incomeAmount").value.trim(), amount = Number(raw);
    if (raw === "" || !(amount >= 0) || amount > 100000000) { $("incomeError").textContent = t("validation.opening"); return; }
    $("incomeDialog").close();
    commit({ ...incomeCandidate, OpeningAt: incomeAt.toISOString(), OpeningIncome: Math.round(amount * 100) / 100 });
  };
}

function changeGoal(direction) {
  const goals = E.goals(E.calculate(now(), settings).month, settings);
  if (goals.length === 0) return;
  selectedGoal = (goalIndex(goals) + direction + goals.length) % goals.length;
  refresh(false);
}

settings = load();
demo = !settings.Configured;
$("languageQuick").value = settings.Language || "auto";
applyAppearance(settings);
wire();
refresh(false);
setInterval(() => refresh(true), 1000);
