import { AppSidebar } from "@/components/ui/app-sidebar";
import { BfcacheGuard } from "@/components/ui/BfcacheGuard";
import { Toaster } from 'react-hot-toast';

/** Layout das telas com menu lateral. */
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="pa-app">
      <BfcacheGuard />
      <Toaster
        toastOptions={{
          style: {
            background: '#0a1410',
            color: '#e9f0eb',
            borderRadius: '999px',
            padding: '10px 18px',
            fontSize: '14px',
          },
          success: { iconTheme: { primary: '#bfe3d0', secondary: '#0a1410' } },
          error: { iconTheme: { primary: '#e0917a', secondary: '#0a1410' } },
        }}
      />
      <AppSidebar />
      <main className="pa-shell">
        {children}
      </main>
    </div>
  );
}
