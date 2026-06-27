import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { BottomNav, type MainTab } from "@/components/BottomNav";
import { toDateKey } from "@/lib/date";
import { AiScreen } from "@/screens/AiScreen";
import { CalendarScreen } from "@/screens/CalendarScreen";
import { ProfileScreen } from "@/screens/ProfileScreen";
import { TodayScreen } from "@/screens/TodayScreen";
import { colors } from "@/theme";

export function MainApp() {
  const today = toDateKey(new Date());
  const [activeTab, setActiveTab] = useState<MainTab>("today");
  const [selectedDate, setSelectedDate] = useState(today);

  function openDate(date: string) {
    setSelectedDate(date);
    setActiveTab("today");
  }

  return (
    <SafeAreaView edges={["top", "bottom"]} style={styles.safeArea}>
      <View style={styles.content}>
        {activeTab === "today" ? (
          <TodayScreen
            onOpenProfile={() => setActiveTab("profile")}
            onSelectDate={setSelectedDate}
            selectedDate={selectedDate}
            today={today}
          />
        ) : null}
        {activeTab === "calendar" ? (
          <CalendarScreen
            onOpenDate={openDate}
            onSelectDate={setSelectedDate}
            selectedDate={selectedDate}
            today={today}
          />
        ) : null}
        {activeTab === "ai" ? <AiScreen selectedDate={selectedDate} /> : null}
        {activeTab === "profile" ? <ProfileScreen /> : null}
      </View>
      <BottomNav activeTab={activeTab} onChange={setActiveTab} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: colors.surface,
    flex: 1,
  },
  content: {
    backgroundColor: colors.background,
    flex: 1,
  },
});
