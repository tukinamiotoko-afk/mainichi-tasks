import React, { useEffect } from 'react';
import { Platform } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SQLiteProvider } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import * as SplashScreen from 'expo-splash-screen';
import HomeScreen from './src/screens/HomeScreen';
import StatsScreen from './src/screens/StatsScreen';
import NotificationScreen from './src/screens/NotificationScreen';
import TimerScreen from './src/screens/TimerScreen';
import ScheduleScreen from './src/screens/ScheduleScreen';
import FlowScreen from './src/screens/FlowScreen';
import UpgradeScreen from './src/screens/UpgradeScreen';
import { migrateDb } from './src/db/database';
import { ThemeProvider } from './src/contexts/ThemeContext';
import { TimerProvider } from './src/contexts/TimerContext';
import { PurchasesProvider } from './src/contexts/PurchasesContext';
import { AdsProvider } from './src/contexts/AdsContext';

// Kept visible until HomeScreen finishes its first task load, so the app
// never shows a blank frame while waiting on the initial SQLite read.
SplashScreen.preventAutoHideAsync().catch(() => {});

// Show banners/sounds even when the app is in the foreground.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export type RootStackParamList = {
  Home: undefined;
  Stats: undefined;
  Notifications: undefined;
  Timer: undefined;
  Schedule: undefined;
  Flow: undefined;
  Upgrade: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

function AppNavigation() {
  return (
    <NavigationContainer>
      <StatusBar style="light" />
      <Stack.Navigator screenOptions={{ headerShown: false, animation: 'none' }}>
        <Stack.Screen name="Home" component={HomeScreen} />
        <Stack.Screen name="Stats" component={StatsScreen} />
        <Stack.Screen name="Notifications" component={NotificationScreen} />
        <Stack.Screen name="Timer" component={TimerScreen} />
        <Stack.Screen name="Schedule" component={ScheduleScreen} />
        <Stack.Screen name="Flow" component={FlowScreen} />
        <Stack.Screen name="Upgrade" component={UpgradeScreen} options={{ animation: 'slide_from_bottom' }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

export default function App() {
  useEffect(() => {
    if (Platform.OS === 'android') {
      Notifications.setNotificationChannelAsync('full', {
        name: '通常通知',
        importance: Notifications.AndroidImportance.HIGH,
        sound: 'default',
      });
      Notifications.setNotificationChannelAsync('silent', {
        name: 'サイレント通知',
        importance: Notifications.AndroidImportance.DEFAULT,
        sound: null,
      });
      Notifications.setNotificationCategoryAsync(
        'autoTimerActions',
        [
          {
            identifier: 'start-auto-timer',
            buttonTitle: '開始',
            options: { opensAppToForeground: true },
          },
        ]
      );
    }
  }, []);

  return (
    <SQLiteProvider databaseName="daily_tasks.db" onInit={migrateDb}>
      <ThemeProvider>
        <PurchasesProvider>
          <AdsProvider>
            <TimerProvider>
              <AppNavigation />
            </TimerProvider>
          </AdsProvider>
        </PurchasesProvider>
      </ThemeProvider>
    </SQLiteProvider>
  );
}
