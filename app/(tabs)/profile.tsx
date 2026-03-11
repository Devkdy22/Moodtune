// app/(tabs)/profile.tsx
// ─────────────────────────────────────────────────────────
//  프로필 / 설정 화면 (HTML Profile Panel 재현)
//  3탭: 내 정보 / 내 플리 / 설정
// ─────────────────────────────────────────────────────────
import { router } from "expo-router";
import React, { useState } from "react";
import {
  ScrollView,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { GlassButton } from "../../src/components/common/Button";
import GlassCard from "../../src/components/common/GlassCard";
import LogoIcon from "../../src/components/common/LogoIcon";
import ScreenBackground from "../../src/components/common/ScreenBackground";
import PlaylistCard from "../../src/components/music/PlaylistCard";
import { Colors } from "../../src/constants/colors";
import { FontSize } from "../../src/constants/layout";
import { MOCK_USER } from "../../src/constants/mockData";
import { useAppStore } from "../../src/store/useAppStore";

const PROFILE_TABS = ["내 정보", "내 플리", "설정"];

const STATS = [
  { label: "플레이리스트", value: MOCK_USER.stats.playlists },
  { label: "총 곡 수", value: MOCK_USER.stats.tracks },
  { label: "재생 시간", value: `${MOCK_USER.stats.hours}h` },
  { label: "즐겨찾기", value: MOCK_USER.stats.favorites },
];

const ACCOUNT_ROWS = [
  { icon: "✏️", label: "이름 변경", sub: MOCK_USER.name },
  { icon: "📧", label: "이메일", sub: MOCK_USER.email },
  { icon: "📅", label: "생년월일", sub: "1995년 3월 15일" },
  { icon: "🌏", label: "지역", sub: "대한민국" },
  { icon: "🔐", label: "비밀번호 변경", sub: "마지막 변경: 30일 전" },
];

const AI_ROWS = [
  { icon: "🎯", label: "AI 추천 정확도", sub: "현재: 높음" },
  { icon: "🎵", label: "선호 장르", sub: "Jazz, Lo-Fi, Indie" },
  { icon: "🚫", label: "제외 장르", sub: "없음" },
  { icon: "⏱", label: "기본 플레이리스트 길이", sub: "30~60분" },
];

const SETTING_ROWS = [
  { icon: "🔔", label: "알림", toggle: true },
  { icon: "🌙", label: "다크 모드", toggle: true },
  { icon: "📱", label: "데이터 절약", toggle: false },
  { icon: "📊", label: "사용 통계 공유", toggle: false },
];

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const playlists = useAppStore(s => s.playlists);
  const toggleLike = useAppStore(s => s.toggleLike);
  const logout = useAppStore(s => s.logout);
  const [activeTab, setActiveTab] = useState("내 정보");
  const [notif, setNotif] = useState(true);
  const [dark, setDark] = useState(true);
  const [dataSave, setData] = useState(false);
  const [analytics, setAna] = useState(false);

  const toggleMap: Record<string, [boolean, (v: boolean) => void]> = {
    알림: [notif, setNotif],
    "다크 모드": [dark, setDark],
    "데이터 절약": [dataSave, setData],
    "사용 통계 공유": [analytics, setAna],
  };

  return (
    <ScreenBackground>
      <StatusBar barStyle="light-content" />
      <View style={{ flex: 1 }}>
        {/* 헤더 */}
        <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
          {/* 아바타 */}
          <View style={styles.avatarSection}>
            <LogoIcon size={76} circular animated />
            <View>
              <Text style={styles.userName}>{MOCK_USER.name}</Text>
              <Text style={styles.userEmail}>{MOCK_USER.email}</Text>
              {/* Spotify 연결 상태 */}
              <View style={styles.spConnected}>
                <View style={styles.spDot} />
                <Text style={styles.spConnectedText}>Spotify 연결됨</Text>
              </View>
            </View>
          </View>

          {/* 통계 */}
          <GlassCard style={styles.statsGrid} padding={0}>
            {STATS.map((s, i) => (
              <View
                key={s.label}
                style={[
                  styles.statCell,
                  i < STATS.length - 1 && styles.statCellBorder,
                ]}
              >
                <Text style={styles.statValue}>{s.value}</Text>
                <Text style={styles.statLabel}>{s.label}</Text>
              </View>
            ))}
          </GlassCard>
        </View>

        {/* 탭 */}
        <View style={styles.tabRow}>
          {PROFILE_TABS.map(tab => (
            <TouchableOpacity
              key={tab}
              style={[styles.tabBtn, activeTab === tab && styles.tabBtnActive]}
              onPress={() => setActiveTab(tab)}
              activeOpacity={0.75}
            >
              <Text
                style={[
                  styles.tabText,
                  activeTab === tab && styles.tabTextActive,
                ]}
              >
                {tab}
              </Text>
              {activeTab === tab && <View style={styles.tabUnderline} />}
            </TouchableOpacity>
          ))}
        </View>

        {/* 탭 콘텐츠 */}
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[
            styles.tabContent,
            { paddingBottom: insets.bottom + 90 },
          ]}
          showsVerticalScrollIndicator={false}
        >
          {activeTab === "내 정보" && (
            <MyInfoTab accountRows={ACCOUNT_ROWS} aiRows={AI_ROWS} />
          )}
          {activeTab === "내 플리" && (
            <MyPlaylistsTab
              playlists={playlists}
              onPress={id => router.push(`/result/${id}`)}
              onLike={toggleLike}
            />
          )}
          {activeTab === "설정" && (
            <SettingsTab
              rows={SETTING_ROWS}
              toggleMap={toggleMap}
              onLogout={() => {
                logout();
                router.replace("/(auth)/login");
              }}
            />
          )}
        </ScrollView>
      </View>
    </ScreenBackground>
  );
}

// ── 내 정보 탭 ────────────────────────────────────────────
function MyInfoTab({ accountRows, aiRows }: any) {
  return (
    <View style={{ gap: 0 }}>
      <Text style={styles.sectionLabel}>계정 정보</Text>
      <GlassCard padding={0} style={{ overflow: "hidden", marginBottom: 24 }}>
        {accountRows.map((row: any, i: number) => (
          <TouchableOpacity
            key={row.label}
            style={[styles.infoRow, i > 0 && styles.infoRowBorder]}
            activeOpacity={0.75}
          >
            <Text style={styles.infoRowIcon}>{row.icon}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.infoRowLabel}>{row.label}</Text>
              <Text style={styles.infoRowSub}>{row.sub}</Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>
        ))}
      </GlassCard>

      <Text style={styles.sectionLabel}>AI 설정</Text>
      <GlassCard padding={0} style={{ overflow: "hidden" }}>
        {aiRows.map((row: any, i: number) => (
          <TouchableOpacity
            key={row.label}
            style={[styles.infoRow, i > 0 && styles.infoRowBorder]}
            activeOpacity={0.75}
          >
            <Text style={styles.infoRowIcon}>{row.icon}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.infoRowLabel}>{row.label}</Text>
              <Text style={styles.infoRowSub}>{row.sub}</Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>
        ))}
      </GlassCard>
    </View>
  );
}

// ── 내 플리 탭 ────────────────────────────────────────────
function MyPlaylistsTab({ playlists, onPress, onLike }: any) {
  return (
    <View>
      {playlists.length === 0 ? (
        <Text style={{ color: Colors.t3, textAlign: "center", marginTop: 40 }}>
          아직 플레이리스트가 없어요
        </Text>
      ) : (
        playlists.map((p: any) => (
          <PlaylistCard
            key={p.id}
            playlist={p}
            onPress={onPress}
            onLike={onLike}
          />
        ))
      )}
    </View>
  );
}

// ── 설정 탭 ──────────────────────────────────────────────
function SettingsTab({ rows, toggleMap, onLogout }: any) {
  return (
    <View style={{ gap: 0 }}>
      <Text style={styles.sectionLabel}>앱 설정</Text>
      <GlassCard padding={0} style={{ overflow: "hidden", marginBottom: 24 }}>
        {rows.map((row: any, i: number) => {
          const [value, setValue] = toggleMap[row.label] ?? [false, () => {}];
          return (
            <View
              key={row.label}
              style={[styles.infoRow, i > 0 && styles.infoRowBorder]}
            >
              <Text style={styles.infoRowIcon}>{row.icon}</Text>
              <Text style={[styles.infoRowLabel, { flex: 1 }]}>
                {row.label}
              </Text>
              <Switch
                value={value}
                onValueChange={setValue}
                trackColor={{
                  false: Colors.glassBd,
                  true: "rgba(61,220,132,0.5)",
                }}
                thumbColor={value ? Colors.green : Colors.t3}
                ios_backgroundColor={Colors.glassBd}
              />
            </View>
          );
        })}
      </GlassCard>

      <Text style={styles.sectionLabel}>계정</Text>
      <GlassCard padding={0} style={{ overflow: "hidden", marginBottom: 12 }}>
        <TouchableOpacity style={styles.infoRow}>
          <Text style={styles.infoRowIcon}>📤</Text>
          <Text style={[styles.infoRowLabel, { flex: 1 }]}>
            데이터 내보내기
          </Text>
          <Text style={styles.chevron}>›</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.infoRow, styles.infoRowBorder]}>
          <Text style={styles.infoRowIcon}>🗑</Text>
          <Text style={[styles.infoRowLabel, { flex: 1, color: Colors.error }]}>
            계정 삭제
          </Text>
          <Text style={styles.chevron}>›</Text>
        </TouchableOpacity>
      </GlassCard>

      <GlassButton
        label="로그아웃"
        onPress={onLogout}
        style={{ width: "100%", borderColor: Colors.error, marginTop: 8 }}
        textStyle={{ color: Colors.error }}
      />

      <Text style={styles.versionText}>MoodTune v1.0.0</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 24,
    paddingBottom: 16,
    gap: 16,
    flexShrink: 0,
  },
  avatarSection: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  userName: {
    fontSize: FontSize["4xl"],
    fontWeight: "800",
    color: Colors.t1,
    letterSpacing: -0.4,
  },
  userEmail: {
    fontSize: FontSize.base,
    color: Colors.t2,
    marginTop: 2,
  },
  spConnected: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: 6,
  },
  spDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: Colors.green,
  },
  spConnectedText: {
    fontSize: FontSize.sm,
    color: Colors.green,
    fontWeight: "600",
  },
  statsGrid: {
    flexDirection: "row",
    overflow: "hidden",
  },
  statCell: {
    flex: 1,
    paddingVertical: 14,
    alignItems: "center",
  },
  statCellBorder: {
    borderRightWidth: 1,
    borderRightColor: Colors.glassBd,
  },
  statValue: {
    fontSize: FontSize["3xl"],
    fontWeight: "800",
    color: Colors.t1,
    letterSpacing: -0.4,
  },
  statLabel: {
    fontSize: FontSize.xs,
    color: Colors.t3,
    marginTop: 3,
    textAlign: "center",
  },

  tabRow: {
    flexDirection: "row",
    paddingHorizontal: 24,
    borderBottomWidth: 1,
    borderBottomColor: Colors.glassBd,
    marginBottom: 20,
  },
  tabBtn: {
    paddingVertical: 10,
    paddingHorizontal: 4,
    marginRight: 24,
    position: "relative",
  },
  tabBtnActive: {},
  tabText: {
    fontSize: FontSize.md,
    color: Colors.t2,
    fontWeight: "500",
  },
  tabTextActive: {
    color: Colors.t1,
    fontWeight: "700",
  },
  tabUnderline: {
    position: "absolute",
    bottom: -1,
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: Colors.green,
    borderRadius: 1,
  },

  tabContent: {
    paddingHorizontal: 24,
  },
  sectionLabel: {
    fontSize: FontSize.sm,
    color: Colors.t3,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 10,
    marginTop: 4,
  },

  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  infoRowBorder: {
    borderTopWidth: 1,
    borderTopColor: Colors.glassBd,
  },
  infoRowIcon: {
    fontSize: 18,
    width: 28,
    textAlign: "center",
  },
  infoRowLabel: {
    fontSize: FontSize.md,
    fontWeight: "600",
    color: Colors.t1,
  },
  infoRowSub: {
    fontSize: FontSize.sm,
    color: Colors.t2,
    marginTop: 2,
  },
  chevron: {
    fontSize: 20,
    color: Colors.t3,
  },

  versionText: {
    fontSize: FontSize.sm,
    color: Colors.t3,
    textAlign: "center",
    marginTop: 24,
  },
});
