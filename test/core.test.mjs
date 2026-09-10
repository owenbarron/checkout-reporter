import assert from "node:assert/strict";
import test from "node:test";
import Core from "../src/core.mjs";

const row = (id, time, user = "Taylor Example", location = "Campus Cafe", container = `Container ${id}`, containerType = "Cup") => ({
  id,
  assignedAt: time,
  assignedMs: new Date(time).getTime(),
  user,
  location,
  container,
  containerType,
});

test("normalizes the slim GraphQL row shape", () => {
  assert.deepEqual(Core.normalizeApiRow({
    assignment_id: 42,
    assigned_on: "2026-08-27T22:00:00.000Z",
    user: { full_name: "Taylor Example" },
    container: { unique_name: "Sample Container", type: { name: "Cup" }, corporateClient: { name: "Example University" } },
    from_location: { pretty_name: "Campus Cafe" },
  }), {
    id: "42",
    assignedAt: "2026-08-27T22:00:00.000Z",
    assignedMs: 1787868000000,
    user: "Taylor Example",
    location: "Campus Cafe",
    container: "Sample Container",
    containerType: "Cup",
    clientName: "Example University",
  });
});

test("deduplicates by stable assignment ID", () => {
  const records = [
    row("1", "2026-08-27T22:00:00Z"),
    row("1", "2026-08-27T22:00:00Z"),
    row("2", "2026-08-27T22:00:05Z"),
  ];
  assert.equal(Core.dedupeAssignments(records).length, 2);
});

test("groups only the same user and same location inside the configured window", () => {
  const records = [
    row("1", "2026-08-27T22:00:00Z"),
    row("2", "2026-08-27T22:00:12Z"),
    row("3", "2026-08-27T22:00:13Z", "Someone Else"),
    row("4", "2026-08-27T22:00:14Z", "Taylor Example", "Student Union"),
    row("5", "2026-08-27T22:00:44Z"),
  ];
  const tx = Core.groupTransactions(records, 30);
  assert.equal(tx.length, 4);
  assert.deepEqual(tx.find((item) => item.id === "tx-1").assignments, ["1", "2"]);
});

test("uses the supplied report time zone", () => {
  assert.deepEqual(Core.timestampParts("2026-08-28T01:30:00Z", "America/Phoenix"), {
    date: "2026-08-27",
    time: "18:30:00",
  });
});

test("compiles daily totals and protects CSV formulas", () => {
  const records = [
    row("1", "2026-08-27T22:00:00Z", "=NAME", "Campus Cafe"),
    row("2", "2026-08-27T22:00:10Z", "=NAME", "Campus Cafe"),
    row("3", "2026-08-27T22:01:00Z", "Other", "Campus Cafe"),
  ];
  const daily = Core.dailyByLocation(Core.groupTransactions(records, 30));
  assert.deepEqual(daily, [{
    date: "2026-08-27",
    location: "Campus Cafe",
    transactions: 2,
    containers: 3,
    containersPerTransaction: 1.5,
  }]);
  assert.match(Core.transactionsCsv(records, 30), /'=NAME/);
});

test("breaks daily totals out by independently selected dimensions", () => {
  const records = [
    row("1", "2026-08-27T22:00:00Z", "Taylor", "Campus Cafe", "Container 1", "Cup"),
    row("2", "2026-08-27T22:00:10Z", "Taylor", "Campus Cafe", "Container 2", "Bowl"),
    row("3", "2026-08-27T22:01:00Z", "Morgan", "Student Union", "Container 3", "Cup"),
  ];
  const transactions = Core.groupTransactions(records, 30);

  assert.deepEqual(Core.dailyBreakdown(transactions, { byLocation: false, byContainerType: false }), [{
    date: "2026-08-27",
    transactions: 2,
    containers: 3,
    containersPerTransaction: 1.5,
  }]);
  assert.deepEqual(Core.dailyBreakdown(transactions, { byLocation: false, byContainerType: true }), [
    { date: "2026-08-27", containerType: "Bowl", transactions: 1, containers: 1, containersPerTransaction: 1 },
    { date: "2026-08-27", containerType: "Cup", transactions: 2, containers: 2, containersPerTransaction: 1 },
  ]);
  assert.match(Core.dailyCsv(records, 30, { byLocation: true, byContainerType: true }), /Date,Location,Container Type,Transactions/);
  assert.match(Core.transactionsCsv(records, 30), /Container Names,Container Types,Assignment IDs/);
});
