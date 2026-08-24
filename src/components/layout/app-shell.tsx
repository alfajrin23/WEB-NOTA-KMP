"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FileText, History, LayoutDashboard, Moon, Plus, ReceiptText, Settings, Sun, TableProperties, Users } from "lucide-react";
import { useAppTheme } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const navigation = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/tambah-desa", label: "Tambah Wilayah", icon: Plus },
  { href: "/history", label: "History", icon: History },
  { href: "/nota-vendor", label: "Nota per Vendor", icon: ReceiptText },
  { href: "/master-template", label: "Template", icon: TableProperties },
  { href: "/vendors", label: "Vendor", icon: Users },
  { href: "/settings", label: "Pengaturan", icon: Settings },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { theme, setTheme } = useAppTheme();

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <aside className="no-print fixed inset-y-0 left-0 z-40 hidden w-72 border-r border-slate-200 bg-white/90 p-4 shadow-sm backdrop-blur xl:block dark:border-slate-800 dark:bg-slate-950/85">
        <Link href="/" className="mb-8 flex items-center gap-3 rounded-xl px-2 py-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-600 text-white shadow-sm shadow-blue-600/25">
            <FileText className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-bold text-slate-950 dark:text-slate-50">KDKMP</p>
            <p className="text-xs text-slate-500">Resume & Nota Generator</p>
          </div>
        </Link>

        <nav className="space-y-1">
          {navigation.map((item) => {
            const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-900",
                  active && "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-200",
                )}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>

      <div className="xl:pl-72">
        <header className="no-print sticky top-0 z-30 border-b border-slate-200 bg-white/80 px-4 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-950/80">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase text-blue-600">KDKMP Cianjur</p>
              <h1 className="text-lg font-bold tracking-normal">Generator Resume, Nota, dan Kwitansi</h1>
            </div>
            <Button variant="outline" size="icon" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} aria-label="Toggle dark mode">
              <Sun className="h-4 w-4 dark:hidden" />
              <Moon className="hidden h-4 w-4 dark:block" />
            </Button>
          </div>
        </header>

        <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
      </div>
    </div>
  );
}
