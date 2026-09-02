import { useEffect, useState } from 'react';
import { View, Text, TextInput, Button } from 'react-native';
import { getProfile, updateProfile } from '../lib/profile';
import { router } from 'expo-router';

export default function ProfileScreen() {
  const [profile, setProfile] = useState(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    loadProfile();
  }, []);

  async function loadProfile() {
    const { data, error } = await getProfile();
    if (error) setMessage(error.message);
    else setProfile(data);
  }

  async function saveProfile() {
    const { error } = await updateProfile(profile);
    if (error) setMessage(error.message);
    else setMessage('Saved!');
  }

  if (!profile) return <Text>Loading...</Text>;

  return (
    <View style={{ padding: 20 }}>
      <TextInput
        placeholder="Display Name"
        value={profile.display_name}
        onChangeText={(v) => setProfile({ ...profile, display_name: v })}
      />

      <TextInput
        placeholder="Major"
        value={profile.major}
        onChangeText={(v) => setProfile({ ...profile, major: v })}
      />

      <Button title="Save" onPress={saveProfile} />
      <Button title="Locations" onPress={() => router.push('/locations')} />
      {message && <Text>{message}</Text>}
    </View>
  );
}
