
console.log("ENV:", process.env.EXPO_PUBLIC_SUPABASE_URL);


import { Stack } from 'expo-router';

export default function Layout() {
  return (
    <Stack>
      <Stack.Screen name="signin" options={{ title: "Sign In" }} />
      <Stack.Screen name="signup" options={{ title: "Sign Up" }} />
      <Stack.Screen name="profile" options={{ title: "Profile" }} />
      <Stack.Screen name="locations" options={{ title: "Locations" }} />
      <Stack.Screen name="chat" options={{ title: "Chat" }} />
    </Stack>
  );
}
console.log("ENV:", process.env.EXPO_PUBLIC_SUPABASE_URL);

console.log("ENV:", process.env.EXPO_PUBLIC_SUPABASE_URL);


// app/_layout.tsx
import { Stack } from "expo-router";

export default function Layout() {
  return <Stack />;
}
