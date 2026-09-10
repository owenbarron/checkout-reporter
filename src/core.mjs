const REPORT_TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

function text(value) {
  return String(value ?? "").trim();
}

function first(row, paths) {
  for (const path of paths) {
    const value = path.split(".").reduce((node, key) => node?.[key], row);
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return "";
}

function timestampParts(value, timeZone = REPORT_TIME_ZONE) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = {};
  for (const part of formatter.formatToParts(date)) parts[part.type] = part.value;
  const hour = parts.hour === "24" ? "00" : parts.hour;
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${hour}:${parts.minute}:${parts.second}`,
  };
}

function normalizeApiRow(row) {
  const assignedRaw = first(row, ["assigned_on", "assignedOn", "assigned_at", "created_at"]);
  const assignedMs = new Date(assignedRaw).getTime();
  const user = text(first(row, ["user.full_name", "user.fullName", "user.name", "user_name"]));
  const location = text(first(row, [
    "from_location.pretty_name",
    "from_location.prettyName",
    "fromLocation.pretty_name",
    "fromLocation.prettyName",
    "from_location.name",
    "from_location_name",
  ])) || "Location not set";
  const container = text(first(row, [
    "container.unique_name",
    "container.uniqueName",
    "container.name",
    "container_name",
  ])) || "Container not named";
  const containerType = text(first(row, [
    "container.type.name",
    "container.containerType.name",
    "container.container_type.name",
    "container_type.name",
    "container_type_name",
  ])) || "Container type not set";
  const sourceId = text(first(row, ["assignment_id", "assignmentId", "id", "_id"]));
  const clientName = text(first(row, [
    "container.corporateClient.name",
    "container.corporate_client.name",
    "corporateClient.name",
    "corporate_client.name",
  ]));
  const id = sourceId || [container, user, location, assignedRaw].join("|");
  if (!id || !user || !Number.isFinite(assignedMs)) return null;
  return {
    id,
    assignedAt: new Date(assignedMs).toISOString(),
    assignedMs,
    user,
    location,
    container,
    containerType,
    clientName,
  };
}

function dedupeAssignments(records) {
  const byId = new Map();
  for (const record of records) {
    if (!record?.id) continue;
    const prior = byId.get(record.id);
    if (!prior || Number(record.assignedMs) > Number(prior.assignedMs)) byId.set(record.id, record);
  }
  return [...byId.values()].sort((a, b) => a.assignedMs - b.assignedMs);
}

function groupTransactions(records, gapSeconds = 30) {
  const gapMs = Math.max(0, Number(gapSeconds) || 0) * 1000;
  const streams = new Map();
  for (const record of dedupeAssignments(records)) {
    const key = `${record.user.toLocaleLowerCase()}\u0000${record.location.toLocaleLowerCase()}`;
    if (!streams.has(key)) streams.set(key, []);
    streams.get(key).push(record);
  }

  const transactions = [];
  for (const stream of streams.values()) {
    let current = null;
    for (const record of stream) {
      if (!current || record.assignedMs - current.lastMs > gapMs) {
        current = {
          id: `tx-${record.id}`,
          assignedMs: record.assignedMs,
          lastMs: record.assignedMs,
          user: record.user,
          location: record.location,
          assignments: [],
          containers: [],
          containerTypes: [],
        };
        transactions.push(current);
      }
      current.lastMs = Math.max(current.lastMs, record.assignedMs);
      current.assignments.push(record.id);
      current.containers.push(record.container);
      current.containerTypes.push(record.containerType || "Container type not set");
    }
  }

  return transactions.sort((a, b) => a.assignedMs - b.assignedMs);
}

function dailyBreakdown(transactions, options = {}) {
  const byLocation = options.byLocation !== false;
  const byContainerType = options.byContainerType === true;
  const groups = new Map();
  for (const transaction of transactions) {
    const stamp = timestampParts(transaction.assignedMs);
    if (!stamp) continue;
    const typeCounts = new Map();
    if (byContainerType) {
      transaction.assignments.forEach((_, index) => {
        const type = transaction.containerTypes?.[index] || "Container type not set";
        typeCounts.set(type, (typeCounts.get(type) || 0) + 1);
      });
    } else {
      typeCounts.set("", transaction.assignments.length);
    }
    for (const [containerType, containerCount] of typeCounts) {
      const location = byLocation ? transaction.location : "";
      const key = [stamp.date, location, containerType].join("\u0000");
      const current = groups.get(key) || {
        date: stamp.date,
        ...(byLocation ? { location } : {}),
        ...(byContainerType ? { containerType } : {}),
        transactions: 0,
        containers: 0,
      };
      current.transactions += 1;
      current.containers += containerCount;
      groups.set(key, current);
    }
  }
  return [...groups.values()]
    .map((row) => ({
      ...row,
      containersPerTransaction: row.transactions ? row.containers / row.transactions : 0,
    }))
    .sort((a, b) => b.date.localeCompare(a.date)
      || String(a.location || "").localeCompare(String(b.location || ""))
      || String(a.containerType || "").localeCompare(String(b.containerType || "")));
}

function dailyByLocation(transactions) {
  return dailyBreakdown(transactions, { byLocation: true, byContainerType: false });
}

function csvCell(value) {
  let result = String(value ?? "");
  if (/^[=+\-@]/.test(result)) result = "'" + result;
  return /[",\r\n]/.test(result) ? `"${result.replaceAll('"', '""')}"` : result;
}

function toCsv(headers, rows) {
  return "\uFEFF" + [
    headers.map(csvCell).join(","),
    ...rows.map((row) => row.map(csvCell).join(",")),
  ].join("\r\n");
}

function dailyCsv(records, gapSeconds = 30, options = {}) {
  const byLocation = options.byLocation !== false;
  const byContainerType = options.byContainerType === true;
  const daily = dailyBreakdown(groupTransactions(records, gapSeconds), { byLocation, byContainerType });
  const headers = [
    "Date",
    ...(byLocation ? ["Location"] : []),
    ...(byContainerType ? ["Container Type"] : []),
    "Transactions",
    "Containers Checked Out",
    "Containers / Transaction",
  ];
  return toCsv(
    headers,
    daily.map((row) => [
      row.date,
      ...(byLocation ? [row.location] : []),
      ...(byContainerType ? [row.containerType] : []),
      row.transactions,
      row.containers,
      row.containersPerTransaction.toFixed(2),
    ]),
  );
}

function transactionsCsv(records, gapSeconds = 30) {
  const transactions = groupTransactions(records, gapSeconds).sort((a, b) => b.assignedMs - a.assignedMs);
  return toCsv(
    ["Date", "Time", "Location", "User", "Transaction ID", "Containers", "Container Names", "Container Types", "Assignment IDs"],
    transactions.map((transaction) => {
      const stamp = timestampParts(transaction.assignedMs);
      return [
        stamp?.date || "",
        stamp?.time || "",
        transaction.location,
        transaction.user,
        transaction.id,
        transaction.assignments.length,
        transaction.containers.join(" | "),
        transaction.containerTypes.join(" | "),
        transaction.assignments.join(" | "),
      ];
    }),
  );
}

export default {
  REPORT_TIME_ZONE,
  timestampParts,
  normalizeApiRow,
  dedupeAssignments,
  groupTransactions,
  dailyBreakdown,
  dailyByLocation,
  dailyCsv,
  transactionsCsv,
};
