import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SQLiteProvider } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';
import HomeScreen from './src/screens/HomeScreen';
import StatsScreen from './src/screens/StatsScreen';
import NotificationScreen from './src/screens/NotificationScreen';
import TimerScreen from './src/screens/TimerScreen';
import ScheduleScreen from './src/screens/ScheduleScreen';
import FlowScreen from './src/screens/FlowScreen';
import { migrateDb } from './src/db/database';

export type RootStackParamList = {
  Home: undefined;
  Stats: undefined;
  Notifications: undefined;
  Timer: undefined;
  Schedule: undefined;
  Flow: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  return (
    <SQLiteProvider databaseName="daily_tasks.db" onInit={migrateDb}>
      <NavigationContainer>
        <StatusBar style="light" />
        <Stack.Navigator screenOptions={{ headerShown: false, animation: 'none' }}>
          <Stack.Screen name="Home" component={HomeScreen} />
          <Stack.Screen name="Stats" component={StatsScreen} />
          <Stack.Screen name="Notifications" component={NotificationScreen} />
          <Stack.Screen name="Timer" component={TimerScreen} />
          <Stack.Screen name="Schedule" component={ScheduleScreen} />
          <Stack.Screen name="Flow" component={FlowScreen} />
        </Stack.Navigator>
      </NavigationContainer>
    </SQLiteProvider>
  );
}
