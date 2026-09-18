import React from 'react';
import { DashboardProvider } from '@/components/DashboardProvider';
import { DashboardShell } from '@/components/DashboardShell';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <DashboardProvider>
      <DashboardShell>
        {children}
      </DashboardShell>
    </DashboardProvider>
  );
}
