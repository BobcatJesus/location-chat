import { useEffect, useState } from 'react';
import { View, Text, TextInput, Button } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { sendMessage, listenToMessages } from '../lib/chat';

export default function ChatScreen() {
  const { loc } = useLocalSearchParams();
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');

  useEffect(() => {
    const channel = listenToMessages((payload) => {
      setMessages((prev) => [...prev, payload.new]);
    });

    return () => {
      channel.unsubscribe();
    };
  }, []);

  async function handleSend() {
    await sendMessage(loc, text);
    setText('');
  }

  return (
    <View style={{ padding: 20 }}>
      {messages.map((m) => (
        <Text key={m.id}>{m.content}</Text>
      ))}

      <TextInput placeholder="Message" value={text} onChangeText={setText} />
      <Button title="Send" onPress={handleSend} />
    </View>
  );
}
