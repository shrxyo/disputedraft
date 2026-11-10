"use client";

import { useRouter } from "next/navigation";
import { AgGridReact } from "ag-grid-react";
import { AllCommunityModule, ModuleRegistry, themeQuartz } from "ag-grid-community";

ModuleRegistry.registerModules([AllCommunityModule]);

const STATUS_LABELS = {
  WAITING_FOR_SELLER_RESPONSE: "Needs your response",
  WAITING_FOR_BUYER_RESPONSE: "Waiting on buyer",
  UNDER_REVIEW: "Under review by PayPal",
  RESOLVED: "Resolved",
  OPEN: "Open",
  OTHER: "Other",
};

function daysLeft(iso) {
  return Math.ceil((new Date(iso) - Date.now()) / 86_400_000);
}

function DueCell({ value }) {
  if (!value) return "—";
  const days = daysLeft(value);
  const date = new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const color = days <= 3 ? "#b42318" : days <= 10 ? "#b54708" : "#344054";
  return (
    <span style={{ color, fontWeight: days <= 10 ? 600 : 400 }}>
      {date} ({days < 0 ? "overdue" : `${days}d left`})
    </span>
  );
}

function StageCell({ value }) {
  const chargeback = value === "CHARGEBACK";
  return (
    <span
      style={{
        padding: "2px 8px",
        borderRadius: 10,
        fontSize: 12,
        background: chargeback ? "#fee4e2" : "#eef4ff",
        color: chargeback ? "#b42318" : "#3538cd",
      }}
    >
      {chargeback ? "Chargeback" : value === "INQUIRY" ? "Inquiry" : value}
    </span>
  );
}

function StatusCell({ value, data }) {
  return (
    <>
      {STATUS_LABELS[value] ?? value}
      {data.submitted && <span style={{ marginLeft: 8, fontSize: 12, color: "#067647", fontWeight: 600 }}>✓ Submitted</span>}
    </>
  );
}

const columnDefs = [
  { field: "product", headerName: "Item", flex: 2, minWidth: 180 },
  { field: "reason", flex: 1.5, minWidth: 150 },
  {
    field: "amount",
    width: 110,
    valueFormatter: (p) => p.value.toLocaleString("en-US", { style: "currency", currency: p.data.currency }),
  },
  { field: "stage", width: 130, cellRenderer: StageCell },
  { field: "status", flex: 1.5, minWidth: 200, valueFormatter: (p) => STATUS_LABELS[p.value] ?? p.value, cellRenderer: StatusCell },
  { field: "dueDate", headerName: "Respond by", flex: 1.2, minWidth: 160, sort: "asc", cellRenderer: DueCell },
  { field: "id", headerName: "Dispute ID", flex: 1.3, minWidth: 170 },
];

export default function Inbox({ rows }) {
  const router = useRouter();
  return (
    <div style={{ height: 360 }}>
      <AgGridReact
        theme={themeQuartz}
        rowData={rows}
        columnDefs={columnDefs}
        defaultColDef={{ sortable: true, filter: true, resizable: true }}
        rowStyle={{ cursor: "pointer" }}
        onRowClicked={(e) => router.push(`/disputes/${e.data.id}`)}
      />
    </div>
  );
}
