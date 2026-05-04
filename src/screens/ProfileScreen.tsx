import React, { useEffect, useMemo, useState } from 'react';
import {
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
import BasePopup from '../components/ui/BasePopup';

const FONT_FAMILY =
  Platform.OS === 'ios'
    ? ThemeTokens.typography.families.ios
    : ThemeTokens.typography.families.android;

const ProfileScreen = ({ navigation }: any) => {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [name, setName] = useState('');
  const [avatarUri, setAvatarUri] = useState<string | undefined>(undefined);
  const [photoSheetVisible, setPhotoSheetVisible] = useState(false);
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
    setPhotoSheetVisible(true);
  };

  const handlePickGallery = () => {
    setPhotoSheetVisible(false);
    setTimeout(() => {
      void pickFromGallery();
    }, 120);
  };

  const handlePickCamera = () => {
    setPhotoSheetVisible(false);
    setTimeout(() => {
      void takePhoto();
    }, 120);
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
          style={[
            styles.headerButton,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
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

      <BasePopup
        accessibilityLabel={t('profile_change_photo')}
        contentStyle={[
          styles.sheetCard,
          { backgroundColor: colors.card, borderColor: colors.border },
        ]}
        maxWidth={520}
        onClose={() => setPhotoSheetVisible(false)}
        placement="bottom"
        showHandle
        visible={photoSheetVisible}
      >
        <Text style={[styles.sheetTitle, { color: colors.text }]}>
          {t('profile_change_photo')}
        </Text>
        <TouchableOpacity
          style={[styles.sheetOption, { borderColor: colors.border }]}
          onPress={handlePickGallery}
          accessibilityRole="button"
          accessibilityLabel={t('profile_gallery')}
        >
          <Icon name="image-outline" size={22} color={colors.text} />
          <Text style={[styles.sheetOptionText, { color: colors.text }]}>
            {t('profile_gallery')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.sheetOption, { borderColor: colors.border }]}
          onPress={handlePickCamera}
          accessibilityRole="button"
          accessibilityLabel={t('profile_camera')}
        >
          <Icon name="camera-outline" size={22} color={colors.text} />
          <Text style={[styles.sheetOptionText, { color: colors.text }]}>
            {t('profile_camera')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.sheetCancel, { borderColor: colors.border }]}
          onPress={() => setPhotoSheetVisible(false)}
          accessibilityRole="button"
          accessibilityLabel={t('common_cancel')}
        >
          <Text style={[styles.sheetCancelText, { color: colors.text }]}>
            {t('common_cancel')}
          </Text>
        </TouchableOpacity>
      </BasePopup>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: ThemeTokens.spacing.xl,
    paddingTop: ThemeTokens.spacing.lg,
    paddingBottom: ThemeTokens.spacing.md,
  },
  headerButton: {
    width: 42,
    height: 42,
    borderRadius: ThemeTokens.radius.lg,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      ios: ThemeTokens.shadows.soft.ios,
      android: ThemeTokens.shadows.soft.android,
    }),
  },
  headerSpacer: {
    width: 42,
    height: 42,
  },
  title: {
    fontFamily: FONT_FAMILY,
    fontSize: ThemeTokens.typography.sizes.headline,
    lineHeight: ThemeTokens.typography.lineHeights.headline,
    fontWeight: ThemeTokens.typography.weights.bold,
    letterSpacing: ThemeTokens.typography.letterSpacing.headline,
  },
  scrollContent: {
    paddingHorizontal: ThemeTokens.spacing.xl,
    paddingBottom: ThemeTokens.spacing.xxl,
  },
  heroCard: {
    position: 'relative',
    overflow: 'hidden',
    borderWidth: 1,
    borderRadius: ThemeTokens.radius.xl,
    paddingHorizontal: ThemeTokens.spacing.xl,
    paddingTop: ThemeTokens.spacing.xxl,
    paddingBottom: ThemeTokens.spacing.xl,
    ...Platform.select({
      ios: ThemeTokens.shadows.medium.ios,
      android: ThemeTokens.shadows.medium.android,
    }),
  },
  heroAccentPrimary: {
    position: 'absolute',
    width: 190,
    height: 190,
    borderRadius: 95,
    top: -64,
    right: -48,
  },
  heroAccentSecondary: {
    position: 'absolute',
    width: 140,
    height: 140,
    borderRadius: 70,
    bottom: -50,
    left: -28,
  },
  avatarWrap: { alignItems: 'center', marginBottom: ThemeTokens.spacing.lg },
  avatarRing: {
    width: 132,
    height: 132,
    borderRadius: 66,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: ThemeTokens.spacing.sm,
  },
  avatar: { width: 116, height: 116, borderRadius: 58 },
  avatarPlaceholder: {
    width: 116,
    height: 116,
    borderRadius: 58,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitials: {
    fontFamily: FONT_FAMILY,
    fontSize: ThemeTokens.typography.sizes.headline,
    lineHeight: ThemeTokens.typography.lineHeights.headline,
    fontWeight: ThemeTokens.typography.weights.bold,
    letterSpacing: ThemeTokens.typography.letterSpacing.headline,
  },
  avatarText: {
    fontFamily: FONT_FAMILY,
    fontSize: ThemeTokens.typography.sizes.caption,
    lineHeight: ThemeTokens.typography.lineHeights.caption,
    letterSpacing: ThemeTokens.typography.letterSpacing.caption,
    fontWeight: ThemeTokens.typography.weights.medium,
  },
  formCard: {
    marginTop: ThemeTokens.spacing.xl,
    borderWidth: 1,
    borderRadius: ThemeTokens.radius.xl,
    padding: ThemeTokens.spacing.xl,
    ...Platform.select({
      ios: ThemeTokens.shadows.medium.ios,
      android: ThemeTokens.shadows.medium.android,
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
    minHeight: 58,
    paddingHorizontal: ThemeTokens.spacing.md,
    paddingVertical: ThemeTokens.spacing.md,
    fontFamily: FONT_FAMILY,
    fontSize: ThemeTokens.typography.sizes.body,
    lineHeight: ThemeTokens.typography.lineHeights.body,
    letterSpacing: ThemeTokens.typography.letterSpacing.body,
  },
  saveButton: {
    marginTop: ThemeTokens.spacing.xl,
    minHeight: 58,
    borderRadius: ThemeTokens.radius.xl,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      ios: ThemeTokens.shadows.medium.ios,
      android: ThemeTokens.shadows.medium.android,
    }),
  },
  saveText: {
    color: '#FFF',
    fontFamily: FONT_FAMILY,
    fontWeight: ThemeTokens.typography.weights.bold,
    fontSize: ThemeTokens.typography.sizes.body,
    lineHeight: ThemeTokens.typography.lineHeights.body,
    letterSpacing: ThemeTokens.typography.letterSpacing.body,
  },
  sheetCard: {
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    borderBottomLeftRadius: 22,
    borderBottomRightRadius: 22,
    paddingHorizontal: ThemeTokens.spacing.xl,
    paddingTop: ThemeTokens.spacing.sm,
    paddingBottom: ThemeTokens.spacing.xl,
    borderWidth: 1,
  },
  sheetTitle: {
    fontFamily: FONT_FAMILY,
    fontSize: ThemeTokens.typography.sizes.body,
    lineHeight: ThemeTokens.typography.lineHeights.body,
    fontWeight: ThemeTokens.typography.weights.semibold,
    letterSpacing: ThemeTokens.typography.letterSpacing.body,
    textAlign: 'center',
    marginBottom: ThemeTokens.spacing.md,
  },
  sheetOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: ThemeTokens.spacing.sm,
    paddingVertical: ThemeTokens.spacing.md,
    borderRadius: 15,
    borderWidth: 1,
    paddingHorizontal: ThemeTokens.spacing.md,
    marginBottom: ThemeTokens.spacing.sm,
  },
  sheetOptionText: {
    fontFamily: FONT_FAMILY,
    fontSize: ThemeTokens.typography.sizes.body,
    lineHeight: ThemeTokens.typography.lineHeights.body,
    fontWeight: ThemeTokens.typography.weights.semibold,
    letterSpacing: ThemeTokens.typography.letterSpacing.body,
  },
  sheetCancel: {
    marginTop: ThemeTokens.spacing.xs,
    borderRadius: 15,
    borderWidth: 1,
    paddingVertical: ThemeTokens.spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetCancelText: {
    fontFamily: FONT_FAMILY,
    fontSize: ThemeTokens.typography.sizes.body,
    lineHeight: ThemeTokens.typography.lineHeights.body,
    fontWeight: ThemeTokens.typography.weights.semibold,
    letterSpacing: ThemeTokens.typography.letterSpacing.body,
  },
});

export default ProfileScreen;
