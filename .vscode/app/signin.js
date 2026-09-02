import { useState } from 'react';
import { View, TextInput, Button, Text } from 'react-native';
import { signIn } from '../lib/auth';
import { router } from 'expo-router';

export default function SignInScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');

  async function handleSignIn() {
    const { data, error } = await signIn(email, password);

    if (error) {
      setMessage(error.message);
    } else {
      router.push('/profile');
    }
  }

  return (
    <View style={{ padding: 20 }}>
      <TextInput placeholder="Email" value={email} onChangeText={setEmail} />
      <TextInput placeholder="Password" secureTextEntry value={password} onChangeText={setPassword} />
      <Button title="Sign In" onPress={handleSignIn} />
      <Button title="Go to Sign Up" onPress={() => router.push('/signup')} />
      {message && <Text>{message}</Text>}
    </View>
  );
}
