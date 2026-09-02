import { useState } from 'react';
import { View, TextInput, Button, Text } from 'react-native';
import { signUp } from '../lib/auth';
import { router } from 'expo-router';

export default function SignUpScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');

  async function handleSignUp() {
    const { data, error } = await signUp(email, password);

    if (error) {
      setMessage(error.message);
    } else {
      router.push('/signin');
    }
  }

  return (
    <View style={{ padding: 20 }}>
      <TextInput placeholder="Email" value={email} onChangeText={setEmail} />
      <TextInput placeholder="Password" secureTextEntry value={password} onChangeText={setPassword} />
      <Button title="Create Account" onPress={handleSignUp} />
      <Button title="Go to Sign In" onPress={() => router.push('/signin')} />
      {message && <Text>{message}</Text>}
    </View>
  );
}
