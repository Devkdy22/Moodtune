// app/index.tsx
// ─────────────────────────────────────────────────────────
//  App entry route → landing
// ─────────────────────────────────────────────────────────
import { Redirect } from "expo-router";
import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { useAppStore } from "../src/store/useAppStore";

export default function Index() {
  const isAuthenticated = useAppStore(s => s.isAuthenticated);
  const spotifyTokens = useAppStore(s => s.spotifyTokens);
  const spotifyUser = useAppStore(s => s.spotifyUser);
  const [hydrated, setHydrated] = useState(useAppStore.persist.hasHydrated());

  useEffect(() => {
    const unsub = useAppStore.persist.onFinishHydration(() => setHydrated(true));
    if (useAppStore.persist.hasHydrated()) setHydrated(true);
    return () => unsub();
  }, []);

  if (!hydrated) return <View style={{ flex: 1, backgroundColor: "#030e07" }} />;

  if (isAuthenticated && spotifyTokens?.accessToken) {
    if (spotifyUser?.id) return <Redirect href={"/(tabs)" as any} />;
    return <Redirect href={"/auth/spotify-linking?mode=bootstrap&next=/(tabs)" as any} />;
  }
  return <Redirect href={"/auth/login" as any} />;
}
