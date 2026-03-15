import { Redirect } from "expo-router";
import React from "react";

/**
 * Handles transient OAuth callback paths such as:
 * /expo-auth-session/auth/spotify-login
 * and forwards immediately to the actual auth screen route.
 */
export default function ExpoAuthSessionCallbackScreen() {
  return <Redirect href="/auth/spotify-login" />;
}
