import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AuthenticatedDashboard>{children}</AuthenticatedDashboard>;
}

async function AuthenticatedDashboard({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login");
  }

  return <>{children}</>;
}
