import React, { useEffect, useMemo, useState } from 'react';
import {
  ActionSheetIOS,
  Alert,
  Image,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { launchCamera, launchImageLibrary } from 'react-native-image-picker';
import { useTheme } from '../context/ThemeContext';
import { ProfileService } from '../services/ProfileService';
import { PermissionManager } from '../utils/permissions';
import { useTranslation } from 'react-i18next';
import { ThemeTokens } from '../constants/ThemeTokens';

const FONT_FAMILY =
  Platform.OS === 'ios'
    ? ThemeTokens.typography.families.ios
    : ThemeTokens.typography.families.android;

const ProfileScreen = ({ navigation }: any) => {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [name, setName] = useState('');
  const [avatarUri, setAvatarUri] = useState<string | undefined>(undefined);
  const initials = useMemo(() => {
    const parts = name
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2);
    if (parts.length === 0) return 'A';
    return parts.map(part => part.charAt(0).toUpperCase()).join('');
  }, [name]);

  useEffect(() => {
    const load = async () => {
      const profile = await ProfileService.getProfile();
      setName(profile.name || '');
      setAvatarUri(profile.avatarUri);
    };
    void load();
  }, []);

  const save = async () => {
    if (!name.trim()) {
      Alert.alert(t('profile_name_required_title'), t('profile_name_required_body'));
      return;
    }
    await ProfileService.saveProfile({ name: name.trim(), avatarUri });
    navigation.goBack();
  };

  const openPhotoActions = () => {
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: [t('common_cancel'), t('profile_gallery'), t('profile_camera')],
          cancelButtonIndex: 0,
        },
        buttonIndex => {
          if (buttonIndex === 1) {
            void pickFromGallery();
          } else if (buttonIndex === 2) {
            void takePhoto();
          }
        },
      );
      return;
    }

    Alert.alert(
      t('profile_change_photo'),
      undefined,
      [
        {
          text: t('profile_gallery'),
          onPress: () => {
            void pickFromGallery();
          },
        },
        {
          text: t('profile_camera'),
          onPress: () => {
            void takePhoto();
          },
        },
        {
          text: t('common_cancel'),
          style: 'cancel',
        },
      ],
      { cancelable: true },
    );
  };

  const pickFromGallery = async () => {
    const status = await PermissionManager.requestStoragePermission();
    if (status !== 'granted') return;

    const result = await launchImageLibrary({ mediaType: 'photo' });
    if (result.didCancel) return;
    const asset = result.assets?.[0];
    if (!asset?.uri) return;
    setAvatarUri(asset.uri);
  };

  const takePhoto = async () => {
    const status = await PermissionManager.requestCameraPermission();
    if (status !== 'granted') return;

    const result = await launchCamera({ mediaType: 'photo' });
    if (result.didCancel) return;
    const asset = result.assets?.[0];
    if (!asset?.uri) return;
    setAvatarUri(asset.uri);
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={[styles.headerButton, { backgroundColor: colors.card, borderColor: colors.border }]}
        >
          <Icon name="arrow-left" size={26} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text }]}>
          {t('settings_profile')}
        </Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View
          style={[
            styles.heroCard,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
            },
          ]}
        >
          <View
            style={[
              styles.heroAccentPrimary,
              { backgroundColor: `${colors.primary}${Platform.OS === 'ios' ? '14' : '18'}` },
            ]}
          />
          <View
            style={[
              styles.heroAccentSecondary,
              { backgroundColor: `${colors.neutral}${Platform.OS === 'ios' ? '18' : '22'}` },
            ]}
          />

          <TouchableOpacity onPress={openPhotoActions} style={styles.avatarWrap} activeOpacity={0.9}>
            <View
              style={[
                styles.avatarRing,
                { borderColor: `${colors.primary}30`, backgroundColor: colors.surface },
              ]}
            >
              {avatarUri ? (
                <Image source={{ uri: avatarUri }} style={styles.avatar} />
              ) : (
                <View style={[styles.avatarPlaceholder, { backgroundColor: colors.background }]}>
                  <Text style={[styles.avatarInitials, { color: colors.text }]}>{initials}</Text>
                </View>
              )}
            </View>
            <Text style={[styles.avatarText, { color: colors.textSecondary }]}>
              {t('common_edit')}
            </Text>
          </TouchableOpacity>
        </View>

        <View
          style={[
            styles.formCard,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
            },
          ]}
        >
          <Text style={[styles.label, { color: colors.textSecondary }]}>
            {t('profile_name_label')}
          </Text>
          <TextInput
            style={[
              styles.input,
              {
                color: colors.text,
                borderColor: colors.border,
                backgroundColor: colors.surface,
              },
            ]}
            placeholder={t('profile_name_placeholder')}
            placeholderTextColor={colors.textSecondary}
            value={name}
            onChangeText={setName}
          />
        </View>

        <TouchableOpacity
          style={[styles.saveButton, { backgroundColor: colors.primary }]}
          onPress={save}
          activeOpacity={0.9}
        >
          <Text style={styles.saveText}>{t('common_save')}</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: ThemeTokens.spacing.lg,
    paddingVertical: ThemeTokens.spacing.md,
  },
  headerButton: {
    width: 44,
    height: 44,
    borderRadius: ThemeTokens.radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerSpacer: {
    width: 44,
    height: 44,
  },
  title: {
    fontFamily: FONT_FAMILY,
    fontSize: ThemeTokens.typography.sizes.title,
    lineHeight: ThemeTokens.typography.lineHeights.title,
    fontWeight: ThemeTokens.typography.weights.bold,
    letterSpacing: ThemeTokens.typography.letterSpacing.title,
  },
  scrollContent: {
    paddingHorizontal: ThemeTokens.spacing.lg,
    paddingBottom: ThemeTokens.spacing.xl,
  },
  heroCard: {
    position: 'relative',
    overflow: 'hidden',
    borderWidth: 1,
    borderRadius: ThemeTokens.radius.xl,
    paddingHorizontal: ThemeTokens.spacing.lg,
    paddingTop: ThemeTokens.spacing.xl,
    paddingBottom: ThemeTokens.spacing.lg,
    ...Platform.select({
      ios: ThemeTokens.shadows.soft.ios,
      android: ThemeTokens.shadows.soft.android,
    }),
  },
  heroAccentPrimary: {
    position: 'absolute',
    width: 160,
    height: 160,
    borderRadius: 80,
    top: -52,
    right: -32,
  },
  heroAccentSecondary: {
    position: 'absolute',
    width: 120,
    height: 120,
    borderRadius: 60,
    bottom: -40,
    left: -18,
  },
  avatarWrap: { alignItems: 'center', marginBottom: ThemeTokens.spacing.lg },
  avatarRing: {
    width: 122,
    height: 122,
    borderRadius: 61,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: ThemeTokens.spacing.sm,
  },
  avatar: { width: 108, height: 108, borderRadius: 54 },
  avatarPlaceholder: {
    width: 108,
    height: 108,
    borderRadius: 54,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitials: {
    fontFamily: FONT_FAMILY,
    fontSize: ThemeTokens.typography.sizes.title,
    lineHeight: ThemeTokens.typography.lineHeights.title,
    fontWeight: ThemeTokens.typography.weights.bold,
    letterSpacing: ThemeTokens.typography.letterSpacing.title,
  },
  avatarText: {
    fontFamily: FONT_FAMILY,
    fontSize: ThemeTokens.typography.sizes.caption,
    lineHeight: ThemeTokens.typography.lineHeights.caption,
    letterSpacing: ThemeTokens.typography.letterSpacing.caption,
    fontWeight: ThemeTokens.typography.weights.medium,
  },
  formCard: {
    marginTop: ThemeTokens.spacing.lg,
    borderWidth: 1,
    borderRadius: ThemeTokens.radius.xl,
    padding: ThemeTokens.spacing.lg,
    ...Platform.select({
      ios: ThemeTokens.shadows.soft.ios,
      android: ThemeTokens.shadows.soft.android,
    }),
  },
  label: {
    fontFamily: FONT_FAMILY,
    fontSize: ThemeTokens.typography.sizes.caption,
    lineHeight: ThemeTokens.typography.lineHeights.caption,
    letterSpacing: ThemeTokens.typography.letterSpacing.caption,
    marginBottom: ThemeTokens.spacing.sm,
    fontWeight: ThemeTokens.typography.weights.semibold,
  },
  input: {
    borderWidth: 1,
    borderRadius: ThemeTokens.radius.lg,
    minHeight: 56,
    paddingHorizontal: ThemeTokens.spacing.md,
    paddingVertical: ThemeTokens.spacing.md,
    fontFamily: FONT_FAMILY,
    fontSize: ThemeTokens.typography.sizes.body,
    lineHeight: ThemeTokens.typography.lineHeights.body,
    letterSpacing: ThemeTokens.typography.letterSpacing.body,
  },
  saveButton: {
    marginTop: ThemeTokens.spacing.lg,
    minHeight: 56,
    borderRadius: ThemeTokens.radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveText: {
    color: '#FFF',
    fontFamily: FONT_FAMILY,
    fontWeight: ThemeTokens.typography.weights.bold,
    fontSize: ThemeTokens.typography.sizes.body,
    lineHeight: ThemeTokens.typography.lineHeights.body,
    letterSpacing: ThemeTokens.typography.letterSpacing.body,
  },
});

export default ProfileScreen;
