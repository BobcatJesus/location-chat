import { View, Text } from 'react-native';

console.log("INDEX LOADED");
console.log("ENV:", process.env.EXPO_PUBLIC_SUPABASE_URL);

export default function Index() {
  return (
    <View style={{ padding: 40 }}>
      <Text style={{ fontSize: 32 }}>SideQuest Bobcat</Text>
      <Text>Your app is finally loading the correct entry file.</Text>
    </View>
  );
}
