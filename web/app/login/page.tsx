import { signIn } from "../../auth";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ callbackUrl?: string; error?: string }> }) {
  const { callbackUrl = "/", error } = await searchParams;
  const safeCallback = callbackUrl.startsWith("/") && !callbackUrl.startsWith("//") ? callbackUrl : "/";
  return (
    <main style={{ maxWidth: 520, margin: "10vh auto", padding: 32 }}>
      <h1>Emerald Event Operations</h1>
      <p>Sign in with your organization&apos;s Microsoft Entra ID account.</p>
      {error ? <p role="alert">Sign-in failed or no Emerald application role is assigned.</p> : null}
      <form action={async () => {
        "use server";
        await signIn("microsoft-entra-id", { redirectTo: safeCallback });
      }}>
        <button type="submit">Sign in with Microsoft</button>
      </form>
    </main>
  );
}
