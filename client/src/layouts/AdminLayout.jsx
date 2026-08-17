import React from "react";
import SidebarShell from "./SidebarShell";

const tabs = [
  { to: "/admin", label: "Tổng quan", end: true },
  { to: "/admin/users", label: "Người dùng" },
  { to: "/admin/incidents", label: "Quản lý sự cố" },
  { to: "/admin/refunds", label: "Quản lý hoàn tiền" },
  { to: "/admin/audit-logs", label: "Nhật ký" },
];

export default function AdminLayout() {
  return <SidebarShell tabs={tabs} />;
}
