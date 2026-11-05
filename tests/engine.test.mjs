// 移植自上游 tests/EngineTests.cs / Ported from upstream tests/EngineTests.cs.
// Run: TZ=Asia/Shanghai node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import * as E from "../public/engine.js";

const D = (y, m, d, h = 0, mi = 0, s = 0) => new Date(y, m - 1, d, h, mi, s);
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.00001, `${msg}: ${a} != ${b}`);
const invalid = (s, msg) => assert.throws(() => E.validate(s), E.ValidationError, msg);
const base = (o = {}) => ({ ...E.defaults(), MonthlySalary: 21750, Basis: "fixed", LunchEnd: "13:00", ...o });

test("daily accrual, lunch and countdown", () => {
  const s = base();
  E.validate(s);
  near(E.calculate(D(2026, 11, 4, 8, 59, 59), s).today, 0, "Before shift earns zero");
  near(E.calculate(D(2026, 11, 4, 10), s).today, 125, "One hour at fixed daily pay");
  near(E.calculate(D(2026, 11, 4, 12, 59, 59), s).today, 375, "Lunch does not accrue");
  assert.equal(E.calculate(D(2026, 11, 4, 12, 30), s).statusKey, "status.break");
  near(E.calculate(D(2026, 11, 4, 18), s).today, 1000, "Full shift daily cap");
  near(E.calculate(D(2026, 11, 4, 23, 59, 59), s).today, 1000, "After shift no extra pay");
  near(E.calculate(D(2026, 11, 7, 11), s).today, 0, "Weekend zero");
  near(E.calculate(D(2026, 11, 4, 15), s).today, 625, "Time-derived recovery");
  assert.equal(E.calculate(D(2026, 11, 4, 9), s).countdown, 9 * 3600e3);
  assert.equal(E.calculate(D(2026, 11, 4, 18), s).countdown, 15 * 3600e3);
});

test("actual-days month, overrides and overnight shifts", () => {
  const month = base({ Basis: "actual" });
  near(E.calculate(D(2026, 11, 30, 23, 59, 59), month).month, 21750, "Actual days month reconciles salary");
  near(E.calculate(D(2026, 12, 1, 8), month).month, 0, "Month rollover clears total");
  Object.assign(month, { RestDates: "2026-11-04", WorkDates: "2026-11-07" });
  E.validate(month);
  assert.ok(!E.isWorkday(D(2026, 11, 4), month) && E.isWorkday(D(2026, 11, 7), month));
  near(E.calculate(D(2026, 11, 30, 23, 59, 59), month).month, 21750, "Overrides preserve reconciliation");
  invalid({ ...month, WorkDates: "2026-11-04" }, "Conflicting overrides rejected");

  const night = base({ Start: "22:00", End: "06:00", LunchStart: "02:00", LunchEnd: "03:00" });
  E.validate(night);
  const n = E.calculate(D(2026, 11, 7, 1), night);
  assert.equal(E.iso(n.workDate), "2026-11-06");
  near(n.today, (1000 * 3) / 7, "Overnight earnings");
  near(E.calculate(D(2026, 11, 7, 2, 30), night).today, (1000 * 4) / 7, "Overnight lunch excluded");
  assert.equal(E.calculate(D(2026, 11, 7, 6), night).today, 0);
  near(E.calculate(D(2026, 11, 4, 12, 30), base({ LunchEnabled: false })).today, (1000 * 3.5) / 9, "No-lunch schedule");
});

test("formatting and validation", () => {
  const s = base({ Decimals: 2 });
  assert.equal(E.format(1234.565, s), "¥1,234.57");
  assert.equal(E.format(999.9, { ...s, Decimals: 0 }), "¥1,000");
  assert.equal(E.format(1234.56789, { ...s, Decimals: 4, Grouping: false, Pattern: "{amount} 元" }), "1234.5679 元");
  assert.equal(E.format(10, { ...s, Decimals: 4, Grouping: false, Currency: "USD", Pattern: "{symbol}{amount} {code}" }), "$10.0000 USD");
  assert.equal(E.format(1234.5, { ...s, Currency: "HKD" }), "HK$1,234.50");
  assert.equal(E.format(1234.5, { ...s, Currency: "TWD", Pattern: "{symbol}{amount} {code}" }), "NT$1,234.50 TWD");
  assert.equal(E.format(1234.5, { ...s, Currency: "SGD" }), "S$1,234.50");
  assert.equal(E.format(1234.5, { ...s, Currency: "MYR" }), "RM1,234.50");
  invalid({ ...s, Pattern: "{amount}{amount}" }, "Duplicate amount token");
  invalid({ ...s, Pattern: "{unknown}{amount}" }, "Unknown token");
  invalid({ ...s, Decimals: 7 }, "Precision");
  invalid({ ...s, Start: "25:00" }, "Time");
  invalid({ ...s, LunchStart: "08:00" }, "Lunch outside shift");
  invalid({ ...s, LunchStart: "09:00", LunchEnd: "18:00" }, "Zero paid hours");
  invalid({ ...s, Weekdays: "" }, "Empty workweek");
  assert.equal(E.duration(90061e3), "25:01:01");
  assert.equal(E.duration(100), "00:00:01");
});

test("expenses come before goals without double counting", () => {
  const costs = base({ ExpensesEnabled: true, Expenses: [{ Name: "租金", Amount: 3000 }, { Name: "生活费", Amount: 2000 }], Goals: [{ Name: "旅行", Amount: 1000 }] });
  E.validate(costs);
  const c = E.expenseCoverage(3500, costs);
  near(c[0].remaining, 0, "Rent first"); near(c[1].covered, 500, "Remainder to second");
  assert.equal(c[1].remainingFraction, 0.75);
  near(E.goals(3500, costs)[0].allocated, 0, "Rewards wait");
  near(E.goals(3500, costs)[0].remainingToReach, 2500, "Estimate includes uncovered expenses");
  near(E.goals(5500, costs)[0].allocated, 500, "Only surplus reaches rewards");
  near(E.expenseCoverage(-1, costs).reduce((a, e) => a + e.covered, 0), 0, "No negative coverage");
  const off = { ...costs, ExpensesEnabled: false };
  assert.equal(E.expenseCoverage(3500, off).length, 0);
  near(E.goals(500, off)[0].allocated, 500, "Disabled expenses ignored");
  invalid({ ...costs, Expenses: [{ Name: "x", Amount: 0 }] }, "Zero expense");
});

test("pay cycles and confirmed opening income", () => {
  const cycle = { ...E.defaults(), SettlementDay: 15, MonthlySalary: 21750, LunchEnd: "13:00" };
  let p = E.payPeriod(D(2026, 11, 14), cycle);
  assert.deepEqual([E.iso(p.start), E.iso(p.end)], ["2026-10-15", "2026-11-15"]);
  p = E.payPeriod(D(2026, 11, 15), cycle);
  assert.deepEqual([E.iso(p.start), E.iso(p.end)], ["2026-11-15", "2026-12-15"]);
  near(E.calculate(D(2026, 11, 14, 23, 59, 59), cycle).month, 21750, "Noncalendar cycle reconciles");
  near(E.calculate(D(2026, 11, 15), cycle).month, 0, "Settlement resets");
  cycle.SettlementDay = 31;
  p = E.payPeriod(D(2026, 2, 28), cycle);
  assert.deepEqual([E.iso(p.start), E.iso(p.end)], ["2026-02-28", "2026-03-31"]);
  assert.equal(E.iso(E.payPeriod(D(2028, 2, 29), cycle).start), "2028-02-29");
  assert.equal(E.iso(E.payPeriod(D(2026, 1, 1), cycle).start), "2025-12-31");
  invalid({ ...cycle, SettlementDay: 0 }, "Day 0"); invalid({ ...cycle, SettlementDay: 32 }, "Day 32");

  const at = D(2026, 11, 4, 10);
  const anchored = base({ OpeningAt: at.toISOString(), OpeningIncome: 40 });
  E.validate(anchored);
  near(E.calculate(at, anchored).month, 40, "Confirmed income replaces estimate");
  near(E.calculate(D(2026, 11, 4, 11), anchored).month, 165, "Continues from confirmed amount");
  near(E.calculate(D(2026, 11, 5, 10), anchored).month, 1040, "Recovers elapsed income");
  anchored.OpeningIncome = 0;
  near(E.calculate(D(2026, 12, 1, 10), anchored).month, 125, "Opening expires next cycle");
  invalid({ ...anchored, OpeningIncome: -1 }, "Negative"); invalid({ ...anchored, OpeningAt: "broken" }, "Malformed");
  invalid({ ...anchored, OpeningAt: null }, "Unpaired");

  const nightCycle = { ...E.defaults(), SettlementDay: 15, Start: "22:00", End: "06:00", LunchEnabled: false, Basis: "fixed", MonthlySalary: 21750, Weekdays: "0,1,2,3,4,5,6" };
  near(E.calculate(D(2026, 11, 15, 1), nightCycle).month, 0, "Prior-cycle night shift does not leak");
  near(E.calculate(D(2026, 11, 15, 23), nightCycle).month, 125, "New-cycle night shift accrues");
});
