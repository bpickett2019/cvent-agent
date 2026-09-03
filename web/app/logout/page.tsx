import { signOut } from "../../auth";

export default function LogoutPage() {
  return (
    <main style={{ maxWidth: 520, margin: "10vh auto", padding: 32 }}>
      <h1>Sign out</h1>
      <form action={async () => {
        "use server";
        await signOut({ redirectTo: "/login" });
      }}>
        <button type="submit">Sign out</button>
      </form>
    </main>
  );
}
