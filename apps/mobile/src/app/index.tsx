import { useEffect } from "react";
import { ActivityIndicator, Image, StyleSheet, Text, View } from "react-native";
import * as SplashScreen from "expo-splash-screen";

import { MainApp } from "@/MainApp";
import { useSession } from "@/session";
import { AuthScreen } from "@/screens/AuthScreen";
import { colors, spacing, typography } from "@/theme";

export default function IndexScreen() {
  const { status } = useSession();

  useEffect(() => {
    if (status !== "loading") {
      void SplashScreen.hideAsync();
    }
  }, [status]);

  if (status === "loading") {
    return (
      <View style={styles.loading}>
        <Image
          source={require("../../assets/images/app-icon.png")}
          style={styles.logo}
        />
        <Text style={styles.brand}>Daily Todo</Text>
        <ActivityIndicator color={colors.accent} style={styles.spinner} />
      </View>
    );
  }

  return status === "authenticated" ? <MainApp /> : <AuthScreen />;
}

const styles = StyleSheet.create({
  loading: {
    alignItems: "center",
    backgroundColor: colors.background,
    flex: 1,
    justifyContent: "center",
  },
  logo: {
    borderRadius: 20,
    height: 80,
    width: 80,
  },
  brand: {
    ...typography.section,
    color: colors.text,
    marginTop: spacing.md,
  },
  spinner: {
    marginTop: spacing.xl,
  },
});
