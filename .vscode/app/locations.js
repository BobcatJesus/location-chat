import { useEffect, useState } from 'react';
import { View, Text, Button } from 'react-native';
import { getLocations } from '../lib/locations';
import { router } from 'expo-router';

export default function LocationsScreen() {
  const [locations, setLocations] = useState([]);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    const { data } = await getLocations();
    setLocations(data);
  }

  return (
    <View style={{ padding: 20 }}>
      {locations.map((loc) => (
        <View key={loc.id} style={{ marginBottom: 20 }}>
          <Text>{loc.name}</Text>
          <Text>{loc.description}</Text>
          <Button title="Enter Chat" onPress={() => router.push(`/chat?loc=${loc.id}`)} />
        </View>
      ))}
    </View>
  );
}
