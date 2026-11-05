import type { Metadata } from "next";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Sign in — WorkTrack" };

export default function LoginPage() {
  return (
    <main className="grid min-h-dvh place-items-center bg-[#F7F6FC] px-5 py-10">
      <LoginForm />
    </main>
  );
}
