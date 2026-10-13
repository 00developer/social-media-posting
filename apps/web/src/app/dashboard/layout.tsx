import React from 'react';
import { DashboardProvider } from '@/components/DashboardProvider';
import { DashboardShell } from '@/components/DashboardShell';
import { ToastProvider } from '@/components/ui/Toast';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <DashboardProvider>
      <ToastProvider>
        <DashboardShell>
          {children}
        </DashboardShell>
      </ToastProvider>
    </DashboardProvider>
  );
}
