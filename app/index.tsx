// app/index.tsx
// ─────────────────────────────────────────────────────────
//  App entry route → landing
// ─────────────────────────────────────────────────────────
import { Redirect } from "expo-router";

export default function Index() {
  return <Redirect href={"/auth/login" as any} />;
}
