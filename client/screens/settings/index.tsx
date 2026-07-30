import { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  Platform,
  Keyboard,
} from 'react-native';
import { FontAwesome6 } from '@expo/vector-icons';
import { Screen } from '@/components/Screen';
import { useFocusEffect } from 'expo-router';

interface FeishuConfig {
  id: string;
  app_id: string;
  app_token?: string;
  table_id?: string;
  field_name?: string;
  bitable_app_token?: string;
  bitable_table_id?: string;
  bit_table_field_name?: string;
}

export default function SettingsScreen() {
  const [appId, setAppId] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [appToken, setAppToken] = useState('');
  const [tableId, setTableId] = useState('');
  const [fieldName, setFieldName] = useState('订单编号');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [hasConfig, setHasConfig] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  // Load existing config
  const fetchConfig = useCallback(async () => {
    setLoading(true);
    try {
      /**
       * 服务端文件：server/src/routes/feishu.ts
       * 接口：GET /api/v1/feishu/config
       * 无参数
       */
      const response = await fetch(`${process.env.EXPO_PUBLIC_BACKEND_BASE_URL}/api/v1/feishu/config`);
      const result = await response.json() as { success: boolean; data: FeishuConfig | null };
      if (result.success && result.data) {
        const d = result.data;
        setAppId(d.app_id || '');
        setAppToken(d.app_token || d.bitable_app_token || '');
        setTableId(d.table_id || d.bitable_table_id || '');
        setFieldName(d.field_name || d.bit_table_field_name || '订单编号');
        setHasConfig(true);
        // Don't load app_secret for security, user needs to re-enter to update
      }
    } catch {
      // Silently fail
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchConfig();
    }, [fetchConfig])
  );

  const handleSave = useCallback(async () => {
    if (!appId.trim() || !appSecret.trim() || !appToken.trim() || !tableId.trim()) {
      Alert.alert('提示', '请填写所有必填项');
      return;
    }

    Keyboard.dismiss();
    setSaving(true);
    setTestResult(null);

    try {
      /**
       * 服务端文件：server/src/routes/feishu.ts
       * 接口：POST /api/v1/feishu/config
       * Body 参数：app_id: string, app_secret: string, app_token: string, table_id: string, field_name: string
       */
      const response = await fetch(`${process.env.EXPO_PUBLIC_BACKEND_BASE_URL}/api/v1/feishu/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          app_id: appId.trim(),
          app_secret: appSecret.trim(),
          app_token: appToken.trim(),
          table_id: tableId.trim(),
          field_name: fieldName.trim() || '订单编号',
        }),
      });

      const result = await response.json() as { success: boolean; error?: string };

      if (result.success) {
        setTestResult({ success: true, message: '配置保存成功！' });
        setHasConfig(true);
        setAppSecret(''); // Clear secret after save
      } else {
        setTestResult({ success: false, message: result.error || '保存失败' });
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : '网络请求失败';
      setTestResult({ success: false, message: errorMsg });
    } finally {
      setSaving(false);
    }
  }, [appId, appSecret, appToken, tableId, fieldName]);

  return (
    <Screen backgroundColor="#F5F5F4">
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>飞书配置</Text>
          <Text style={styles.headerSubtitle}>配置飞书多维表格凭证，扫码数据将同步至对应表格</Text>
        </View>

        {/* Config Form */}
        <View style={styles.formCard}>
          <View style={styles.formHeader}>
            <View style={styles.formIcon}>
              <FontAwesome6 name="table-cells" size={18} color="#0D9488" />
            </View>
            <View>
              <Text style={styles.formTitle}>多维表格配置</Text>
              <Text style={styles.formDesc}>
                {hasConfig ? '已配置，重新填写可更新' : '尚未配置'}
              </Text>
            </View>
          </View>

          {/* App ID */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>App ID *</Text>
            <View style={styles.inputContainer}>
              <TextInput
                style={styles.input}
                value={appId}
                onChangeText={setAppId}
                placeholder="飞书应用 App ID"
                placeholderTextColor="#A8A29E"
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
          </View>

          {/* App Secret */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>App Secret *</Text>
            <View style={styles.inputContainer}>
              <TextInput
                style={styles.input}
                value={appSecret}
                onChangeText={setAppSecret}
                placeholder={hasConfig ? '重新输入以更新' : '飞书应用 App Secret'}
                placeholderTextColor="#A8A29E"
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
              />
            </View>
          </View>

          {/* App Token (Bitable) */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>多维表格 App Token *</Text>
            <View style={styles.inputContainer}>
              <TextInput
                style={styles.input}
                value={appToken}
                onChangeText={setAppToken}
                placeholder="多维表格 URL 中的 app_token"
                placeholderTextColor="#A8A29E"
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
            <Text style={styles.fieldHint}>
              从表格 URL 中获取：https://xxx.feishu.cn/base/[app_token]
            </Text>
          </View>

          {/* Table ID */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>数据表 Table ID *</Text>
            <View style={styles.inputContainer}>
              <TextInput
                style={styles.input}
                value={tableId}
                onChangeText={setTableId}
                placeholder="数据表 ID (tblXXXXXX)"
                placeholderTextColor="#A8A29E"
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
            <Text style={styles.fieldHint}>
              在多维表格中右键数据表标签可复制 Table ID
            </Text>
          </View>

          {/* Field Name */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>条形码字段名称</Text>
            <View style={styles.inputContainer}>
              <TextInput
                style={styles.input}
                value={fieldName}
                onChangeText={setFieldName}
                placeholder="订单编号"
                placeholderTextColor="#A8A29E"
              />
            </View>
            <Text style={styles.fieldHint}>
              多维表格中用于存储条形码的字段名称，默认为「订单编号」
            </Text>
          </View>

          {/* Save Button */}
          <TouchableOpacity
            style={[styles.saveButton, saving && styles.saveButtonDisabled]}
            onPress={handleSave}
            disabled={saving}
          >
            {saving ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.saveButtonText}>保存配置</Text>
            )}
          </TouchableOpacity>

          {/* Test Result */}
          {testResult && (
            <View style={[
              styles.resultBox,
              testResult.success ? styles.resultSuccess : styles.resultError,
            ]}>
              <FontAwesome6
                name={testResult.success ? 'check-circle' : 'times-circle'}
                size={16}
                color={testResult.success ? '#10B981' : '#EF4444'}
              />
              <Text style={[
                styles.resultText,
                testResult.success ? styles.resultTextSuccess : styles.resultTextError,
              ]}>
                {testResult.message}
              </Text>
            </View>
          )}
        </View>

        {/* Help Section */}
        <View style={styles.helpCard}>
          <View style={styles.helpHeader}>
            <FontAwesome6 name="circle-question" size={18} color="#78716C" />
            <Text style={styles.helpTitle}>如何获取这些信息？</Text>
          </View>
          <View style={styles.helpSteps}>
            <Text style={styles.helpStep}>1. 前往飞书开放平台创建应用</Text>
            <Text style={styles.helpStep}>2. 在应用详情中获取 App ID 和 App Secret</Text>
            <Text style={styles.helpStep}>3. 为应用开通「多维表格」权限</Text>
            <Text style={styles.helpStep}>4. 创建多维表格，从 URL 获取 App Token</Text>
            <Text style={styles.helpStep}>5. 在表格中添加用于存储条形码的字段</Text>
          </View>
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5F4',
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  header: {
    paddingTop: 16,
    paddingBottom: 16,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#1C1917',
  },
  headerSubtitle: {
    fontSize: 13,
    color: '#78716C',
    marginTop: 4,
    lineHeight: 18,
  },
  formCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 20,
    shadowColor: '#0D9488',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4,
  },
  formHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
    gap: 12,
  },
  formIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(13, 148, 136, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  formTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1C1917',
  },
  formDesc: {
    fontSize: 12,
    color: '#78716C',
    marginTop: 2,
  },
  fieldGroup: {
    marginBottom: 16,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#44403C',
    marginBottom: 6,
  },
  inputContainer: {
    backgroundColor: '#F5F5F4',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E7E5E4',
  },
  input: {
    fontSize: 15,
    color: '#1C1917',
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 12 : 10,
  },
  fieldHint: {
    fontSize: 11,
    color: '#A8A29E',
    marginTop: 4,
    lineHeight: 16,
  },
  saveButton: {
    backgroundColor: '#0D9488',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    shadowColor: '#0D9488',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  saveButtonDisabled: {
    opacity: 0.7,
  },
  saveButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  resultBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
    padding: 12,
    borderRadius: 12,
  },
  resultSuccess: {
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
  },
  resultError: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
  },
  resultText: {
    fontSize: 14,
    fontWeight: '500',
    flex: 1,
  },
  resultTextSuccess: {
    color: '#059669',
  },
  resultTextError: {
    color: '#DC2626',
  },
  helpCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 20,
    marginTop: 16,
    shadowColor: '#0D9488',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  helpHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  helpTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#44403C',
  },
  helpSteps: {
    gap: 8,
  },
  helpStep: {
    fontSize: 13,
    color: '#78716C',
    lineHeight: 20,
  },
});
