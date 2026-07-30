import { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Platform,
  ActivityIndicator,
  Linking,
  Modal,
  ScrollView,
} from 'react-native';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { FontAwesome6 } from '@expo/vector-icons';
import { Screen } from '@/components/Screen';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, Link } from 'expo-router';

interface Stats {
  total: number;
  today: number;
  success: number;
  today_success: number;
  failed: number;
}

const FEISHU_BITABLE_URL = 'https://gcnop2681oz6.feishu.cn/base/FeYNbNOGcaZltysJowEcuzginfd?table=tblCmub3OU18zCle&view=vewzaoO9z0';

export default function ScannerScreen() {
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const hasPermission = permission?.granted ?? false;
  const [scanning, setScanning] = useState(true);
  const [lastScan, setLastScan] = useState<{ barcode: string; status: 'success' | 'failed' | 'duplicate'; error?: string } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [pendingBarcode, setPendingBarcode] = useState<string | null>(null);
  const [stats, setStats] = useState<Stats>({ total: 0, today: 0, success: 0, today_success: 0, failed: 0 });
  const [configReady, setConfigReady] = useState(false);
  const [tableRecords, setTableRecords] = useState<Array<{ index: number; value: string }>>([]);
  const [showTableModal, setShowTableModal] = useState(false);
  const [loadingTable, setLoadingTable] = useState(false);
  const scanLineAnim = useRef(new Animated.Value(0)).current;
  const lastScanTime = useRef(0);

  // Animate scan line
  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(scanLineAnim, {
          toValue: 1,
          duration: 2000,
          useNativeDriver: true,
        }),
        Animated.timing(scanLineAnim, {
          toValue: 0,
          duration: 2000,
          useNativeDriver: true,
        }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [scanLineAnim]);

  // Request camera permission if not yet determined
  useEffect(() => {
    if (!permission) return;
    if (!permission.granted && permission.canAskAgain) {
      requestPermission();
    }
  }, [permission, requestPermission]);

  // Fetch stats
  const fetchStats = useCallback(async () => {
    try {
      const response = await fetch(`${process.env.EXPO_PUBLIC_BACKEND_BASE_URL}/api/v1/feishu/stats`);
      const result = await response.json() as { success: boolean; data: Stats };
      if (result.success) {
        setStats(result.data);
      }
    } catch {
      // Silently fail
    }
  }, []);

  // Fetch table records from Feishu
  const fetchTableRecords = useCallback(async () => {
    setLoadingTable(true);
    try {
      const response = await fetch(`${process.env.EXPO_PUBLIC_BACKEND_BASE_URL}/api/v1/feishu/table-records`);
      const result = await response.json() as {
        success: boolean;
        data: { field_name: string; total: number; records: Array<{ index: number; value: string }> };
      };
      if (result.success) {
        setTableRecords(result.data.records);
        setShowTableModal(true);
      }
    } catch {
      // Silently fail
    } finally {
      setLoadingTable(false);
    }
  }, []);

  // Check if Feishu config exists
  const checkConfig = useCallback(async () => {
    try {
      const response = await fetch(`${process.env.EXPO_PUBLIC_BACKEND_BASE_URL}/api/v1/feishu/config`);
      const result = await response.json() as { success: boolean; data: unknown };
      setConfigReady(!!result.data);
    } catch {
      setConfigReady(false);
    }
  }, []);

  // Refresh on focus
  useFocusEffect(
    useCallback(() => {
      fetchStats();
      checkConfig();
    }, [fetchStats, checkConfig])
  );

  // Handle barcode scan
  const handleBarcodeScanned = useCallback(async ({ data }: BarcodeScanningResult) => {
    const now = Date.now();
    // Debounce: prevent scanning same barcode within 3 seconds
    if (now - lastScanTime.current < 3000) return;
    if (isProcessing) return;

    lastScanTime.current = now;

    // Haptic feedback on scan
    if (Platform.OS !== 'web') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }

    // Show confirmation modal instead of auto-syncing
    setPendingBarcode(data);
    setScanning(false);
  }, [isProcessing]);

  const handleConfirmSync = useCallback(async () => {
    if (!pendingBarcode) return;
    const data = pendingBarcode;
    setPendingBarcode(null);
    setIsProcessing(true);

    try {
      /**
       * 服务端文件：server/src/routes/feishu.ts
       * 接口：POST /api/v1/feishu/scan
       * Body 参数：barcode: string
       */
      const response = await fetch(`${process.env.EXPO_PUBLIC_BACKEND_BASE_URL}/api/v1/feishu/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ barcode: data }),
      });

      const result = await response.json() as {
        success: boolean;
        error?: string;
        message?: string;
        data?: { barcode: string; status: string };
      };

      if (result.success) {
        const isDuplicate = result.data?.status === 'duplicate';
        setLastScan({
          barcode: data,
          status: isDuplicate ? 'duplicate' : 'success',
          error: isDuplicate ? result.message : undefined,
        });
        if (Platform.OS !== 'web') {
          Haptics.notificationAsync(
            isDuplicate
              ? Haptics.NotificationFeedbackType.Warning
              : Haptics.NotificationFeedbackType.Success
          );
        }
      } else {
        setLastScan({ barcode: data, status: 'failed', error: result.error });
        if (Platform.OS !== 'web') {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        }
      }

      fetchStats();
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : '网络请求失败';
      setLastScan({ barcode: data, status: 'failed', error: errorMsg });
      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    } finally {
      setIsProcessing(false);
      // Resume scanning after 2.5 seconds
      setTimeout(() => {
        setScanning(true);
      }, 2500);
    }
  }, [pendingBarcode, fetchStats]);

  const handleCancelScan = useCallback(() => {
    setPendingBarcode(null);
    setScanning(true);
  }, []);

  const scanLineTranslateY = scanLineAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 220],
  });

  return (
    <Screen safeAreaEdges={['left', 'right']} backgroundColor="#F5F5F4">
      <View style={styles.container}>
        {/* Header */}
        <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
          <View style={styles.headerContent}>
            <View>
              <Text style={styles.headerTitle}>扫码登记</Text>
              <Text style={styles.headerSubtitle}>扫描条形码同步至飞书</Text>
            </View>
            <View style={styles.headerActions}>
              <Link href="/history" asChild>
                <TouchableOpacity style={styles.iconButton}>
                  <FontAwesome6 name="clock-rotate-left" size={20} color="#0D9488" />
                </TouchableOpacity>
              </Link>
              <Link href="/settings" asChild>
                <TouchableOpacity style={styles.iconButton}>
                  <FontAwesome6 name="gear" size={20} color="#0D9488" />
                </TouchableOpacity>
              </Link>
            </View>
          </View>
        </View>

        {/* Camera Viewfinder */}
        <View style={styles.cameraSection}>
          {hasPermission ? (
            <View style={styles.cameraContainer}>
              <CameraView
                style={styles.camera}
                facing="back"
                barcodeScannerSettings={{
                  barcodeTypes: ['code128', 'code39', 'code93', 'ean13', 'ean8', 'upc_a', 'upc_e', 'qr'],
                }}
                onBarcodeScanned={scanning ? handleBarcodeScanned : undefined}
              />
              {/* Scan overlay */}
              <View style={styles.scanOverlay}>
                {/* Corner markers */}
                <View style={[styles.corner, styles.cornerTL]} />
                <View style={[styles.corner, styles.cornerTR]} />
                <View style={[styles.corner, styles.cornerBL]} />
                <View style={[styles.corner, styles.cornerBR]} />
                {/* Animated scan line */}
                <Animated.View
                  style={[styles.scanLine, { transform: [{ translateY: scanLineTranslateY }] }]}
                />
              </View>
              {/* Status overlay */}
              {lastScan && (
                <View style={[
                  styles.statusOverlay,
                  lastScan.status === 'success' && styles.statusSuccess,
                  lastScan.status === 'failed' && styles.statusFailed,
                  lastScan.status === 'duplicate' && styles.statusDuplicate,
                ]}>
                  <FontAwesome6
                    name={lastScan.status === 'success' ? 'check-circle'
                      : lastScan.status === 'duplicate' ? 'copy'
                      : 'times-circle'}
                    size={24}
                    color="#fff"
                  />
                  <Text style={styles.statusText} numberOfLines={1}>
                    {lastScan.status === 'success'
                      ? `已登记: ${lastScan.barcode}`
                      : lastScan.status === 'duplicate'
                        ? `已存在: ${lastScan.barcode}`
                        : `失败: ${lastScan.error || '未知错误'}`}
                  </Text>
                </View>
              )}
              {!configReady && (
                <View style={styles.configWarning}>
                  <FontAwesome6 name="triangle-exclamation" size={14} color="#F59E0B" />
                  <Text style={styles.configWarningText}>
                    请先<Link href="/settings"><Text style={styles.configWarningLink}>配置飞书</Text></Link>
                  </Text>
                </View>
              )}
            </View>
          ) : (
            <View style={styles.noPermission}>
              <FontAwesome6 name="camera" size={48} color="#78716C" />
              <Text style={styles.noPermissionText}>需要相机权限才能扫码</Text>
            </View>
          )}
        </View>

        {/* Confirmation Modal */}
        <Modal
          visible={pendingBarcode !== null}
          transparent
          animationType="fade"
          onRequestClose={handleCancelScan}
        >
          <View style={styles.confirmOverlay}>
            <View style={styles.confirmCard}>
              <View style={styles.confirmIconWrap}>
                <FontAwesome6 name="barcode" size={36} color="#4F46E5" />
              </View>
              <Text style={styles.confirmTitle}>确认登记到飞书</Text>
              <View style={styles.confirmBarcodeBox}>
                <Text style={styles.confirmBarcodeLabel}>订单编号</Text>
                <Text style={styles.confirmBarcodeValue} selectable>{pendingBarcode}</Text>
              </View>
              <View style={styles.confirmButtons}>
                <TouchableOpacity
                  style={[styles.confirmBtn, styles.confirmBtnCancel]}
                  onPress={handleCancelScan}
                  disabled={isProcessing}
                >
                  <Text style={styles.confirmBtnCancelText}>取消</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.confirmBtn, styles.confirmBtnOk]}
                  onPress={handleConfirmSync}
                  disabled={isProcessing}
                >
                  {isProcessing ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <Text style={styles.confirmBtnOkText}>确认</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        {/* Last Scan Result Card */}
        {lastScan && (
          <View style={styles.resultSection}>
            <View style={[
              styles.resultCard,
              lastScan.status === 'success' ? styles.resultCardSuccess
                : lastScan.status === 'duplicate' ? styles.resultCardDuplicate
                : styles.resultCardFailed,
            ]}>
              <View style={styles.resultHeader}>
                <View style={[
                  styles.resultIcon,
                  lastScan.status === 'success' ? styles.resultIconSuccess
                    : lastScan.status === 'duplicate' ? styles.resultIconDuplicate
                    : styles.resultIconFailed,
                ]}>
                  <FontAwesome6
                    name={lastScan.status === 'success' ? 'check-circle'
                      : lastScan.status === 'duplicate' ? 'copy'
                      : 'times-circle'}
                    size={20}
                    color={lastScan.status === 'success' ? '#10B981'
                      : lastScan.status === 'duplicate' ? '#F59E0B'
                      : '#EF4444'}
                  />
                </View>
                <Text style={[
                  styles.resultLabel,
                  lastScan.status === 'success' ? styles.resultLabelSuccess
                    : lastScan.status === 'duplicate' ? styles.resultLabelDuplicate
                    : styles.resultLabelFailed,
                ]}>
                  {lastScan.status === 'success' ? '登记成功'
                    : lastScan.status === 'duplicate' ? '已存在，已跳过'
                    : '登记失败'}
                </Text>
              </View>
              <View style={styles.resultBarcodeBox}>
                <Text style={styles.resultBarcodeLabel}>扫描内容</Text>
                <Text style={styles.resultBarcodeValue} selectable>{lastScan.barcode}</Text>
              </View>
              {lastScan.status === 'failed' && lastScan.error && (
                <Text style={styles.resultErrorText}>{lastScan.error}</Text>
              )}
              {lastScan.status === 'duplicate' && lastScan.error && (
                <Text style={styles.resultDuplicateText}>{lastScan.error}</Text>
              )}
            </View>

            {lastScan.status === 'success' && (
              <TouchableOpacity
                style={styles.tableLinkButton}
                onPress={fetchTableRecords}
                disabled={loadingTable}
              >
                <FontAwesome6 name="table-list" size={16} color="#4F46E5" />
                <Text style={styles.tableLinkText}>
                  {loadingTable ? '加载中...' : '查看表格数据'}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Statistics Panel */}
        <View style={styles.statsPanel}>
          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Text style={styles.statNumber}>{stats.today}</Text>
              <Text style={styles.statLabel}>今日扫描</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={[styles.statNumber, styles.statSuccess]}>{stats.today_success}</Text>
              <Text style={styles.statLabel}>登记成功</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statNumber}>{stats.total}</Text>
              <Text style={styles.statLabel}>累计扫描</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={[styles.statNumber, styles.statFailed]}>{stats.failed}</Text>
              <Text style={styles.statLabel}>登记失败</Text>
            </View>
          </View>

          {/* Jump to Feishu Button */}
          <TouchableOpacity
            style={styles.feishuButton}
            onPress={() => Linking.openURL(FEISHU_BITABLE_URL)}
            activeOpacity={0.7}
          >
            <FontAwesome6 name="table-columns" size={16} color="#4F46E5" />
            <Text style={styles.feishuButtonText}>查看飞书表格</Text>
            <FontAwesome6 name="arrow-up-right-from-square" size={12} color="#4F46E5" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Table Records Modal */}
      <Modal
        visible={showTableModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowTableModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>飞书表格数据</Text>
              <TouchableOpacity onPress={() => setShowTableModal(false)}>
                <FontAwesome6 name="xmark" size={20} color="#6B7280" />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.modalBody}>
              {tableRecords.length === 0 ? (
                <Text style={styles.modalEmptyText}>暂无数据</Text>
              ) : (
                tableRecords.map((record) => (
                  <View key={record.index} style={styles.recordRow}>
                    <Text style={styles.recordIndex}>{record.index}.</Text>
                    <Text style={styles.recordValue} selectable>{record.value}</Text>
                  </View>
                ))
              )}
            </ScrollView>
            <View style={styles.modalFooter}>
              <Text style={styles.modalTotal}>共 {tableRecords.length} 条记录</Text>
              <TouchableOpacity
                style={styles.modalCloseBtn}
                onPress={() => setShowTableModal(false)}
              >
                <Text style={styles.modalCloseText}>关闭</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5F4',
  },
  header: {
    backgroundColor: '#F5F5F4',
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  headerContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#1C1917',
  },
  headerSubtitle: {
    fontSize: 13,
    color: '#78716C',
    marginTop: 2,
  },
  headerActions: {
    flexDirection: 'row',
    gap: 8,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(13, 148, 136, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  cameraSection: {
    paddingHorizontal: 20,
    marginTop: 8,
  },
  cameraContainer: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  camera: {
    width: '100%',
    height: '100%',
  },
  scanOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  corner: {
    position: 'absolute',
    width: 30,
    height: 30,
    borderColor: '#0D9488',
  },
  cornerTL: {
    top: '50%',
    left: '15%',
    marginTop: -110,
    marginLeft: -15,
    borderTopWidth: 3,
    borderLeftWidth: 3,
    borderTopLeftRadius: 8,
  },
  cornerTR: {
    top: '50%',
    right: '15%',
    marginTop: -110,
    marginRight: -15,
    borderTopWidth: 3,
    borderRightWidth: 3,
    borderTopRightRadius: 8,
  },
  cornerBL: {
    top: '50%',
    left: '15%',
    marginTop: 90,
    marginLeft: -15,
    borderBottomWidth: 3,
    borderLeftWidth: 3,
    borderBottomLeftRadius: 8,
  },
  cornerBR: {
    top: '50%',
    right: '15%',
    marginTop: 90,
    marginRight: -15,
    borderBottomWidth: 3,
    borderRightWidth: 3,
    borderBottomRightRadius: 8,
  },
  scanLine: {
    width: 200,
    height: 2,
    backgroundColor: '#0D9488',
    shadowColor: '#0D9488',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 8,
  },
  statusOverlay: {
    position: 'absolute',
    bottom: 16,
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 16,
  },
  statusSuccess: {
    backgroundColor: 'rgba(16, 185, 129, 0.9)',
  },
  statusFailed: {
    backgroundColor: 'rgba(239, 68, 68, 0.9)',
  },
  statusDuplicate: {
    backgroundColor: 'rgba(245, 158, 11, 0.9)',
  },
  statusPending: {
    backgroundColor: 'rgba(13, 148, 136, 0.9)',
  },
  statusText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
  },
  configWarning: {
    position: 'absolute',
    top: 12,
    left: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    borderRadius: 12,
  },
  configWarningText: {
    color: '#92400E',
    fontSize: 13,
    fontWeight: '500',
  },
  configWarningLink: {
    color: '#0D9488',
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
  noPermission: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 24,
    backgroundColor: '#E7E5E4',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  noPermissionText: {
    fontSize: 14,
    color: '#78716C',
  },
  // Confirmation Modal
  confirmOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  confirmCard: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 28,
    alignItems: 'center',
    shadowColor: '#4F46E5',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 8,
  },
  confirmIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#EEF2FF',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  confirmTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1E293B',
    marginBottom: 16,
  },
  confirmBarcodeBox: {
    width: '100%',
    backgroundColor: '#F8FAFC',
    borderRadius: 16,
    padding: 16,
    marginBottom: 24,
    alignItems: 'center',
  },
  confirmBarcodeLabel: {
    fontSize: 12,
    color: '#94A3B8',
    marginBottom: 6,
    fontWeight: '500',
  },
  confirmBarcodeValue: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1E293B',
    textAlign: 'center',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  confirmButtons: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  confirmBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmBtnCancel: {
    backgroundColor: '#F1F5F9',
  },
  confirmBtnCancelText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#64748B',
  },
  confirmBtnOk: {
    backgroundColor: '#4F46E5',
  },
  confirmBtnOkText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  resultSection: {
    paddingHorizontal: 20,
    marginTop: 12,
  },
  resultCard: {
    borderRadius: 20,
    padding: 16,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4,
  },
  resultCardSuccess: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#10B981',
    borderWidth: 1.5,
    borderColor: 'rgba(16, 185, 129, 0.2)',
  },
  resultCardFailed: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#EF4444',
    borderWidth: 1.5,
    borderColor: 'rgba(239, 68, 68, 0.2)',
  },
  resultCardDuplicate: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#F59E0B',
    borderWidth: 1.5,
    borderColor: 'rgba(245, 158, 11, 0.2)',
  },
  resultHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  resultIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  resultIconSuccess: {
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
  },
  resultIconFailed: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
  },
  resultIconDuplicate: {
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
  },
  resultLabel: {
    fontSize: 15,
    fontWeight: '700',
  },
  resultLabelSuccess: {
    color: '#059669',
  },
  resultLabelFailed: {
    color: '#DC2626',
  },
  resultLabelDuplicate: {
    color: '#D97706',
  },
  resultBarcodeBox: {
    backgroundColor: '#F5F5F4',
    borderRadius: 12,
    padding: 12,
  },
  resultBarcodeLabel: {
    fontSize: 11,
    color: '#A8A29E',
    fontWeight: '500',
    marginBottom: 4,
  },
  resultBarcodeValue: {
    fontSize: 20,
    fontWeight: '800',
    color: '#1C1917',
    letterSpacing: 1,
  },
  resultErrorText: {
    fontSize: 12,
    color: '#DC2626',
    marginTop: 8,
    lineHeight: 18,
  },
  resultDuplicateText: {
    fontSize: 12,
    color: '#D97706',
    marginTop: 8,
    lineHeight: 18,
  },
  statsPanel: {
    marginTop: 16,
    paddingHorizontal: 20,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    paddingVertical: 20,
    paddingHorizontal: 8,
    shadowColor: '#0D9488',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statDivider: {
    width: 1,
    height: 32,
    backgroundColor: '#E7E5E4',
  },
  statNumber: {
    fontSize: 28,
    fontWeight: '800',
    color: '#1C1917',
  },
  statSuccess: {
    color: '#10B981',
  },
  statFailed: {
    color: '#EF4444',
  },
  statLabel: {
    fontSize: 12,
    color: '#78716C',
    marginTop: 4,
    fontWeight: '500',
  },
  feishuButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 16,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(79, 70, 229, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(79, 70, 229, 0.15)',
  },
  feishuButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#4F46E5',
  },
  tableLinkButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 12,
    paddingVertical: 10,
    paddingHorizontal: 16,
    backgroundColor: 'rgba(79, 70, 229, 0.08)',
    borderRadius: 12,
  },
  tableLinkText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#4F46E5',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '80%',
    paddingBottom: 20,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
  },
  modalBody: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    maxHeight: 400,
  },
  modalEmptyText: {
    fontSize: 14,
    color: '#9CA3AF',
    textAlign: 'center',
    paddingVertical: 40,
  },
  recordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  recordIndex: {
    fontSize: 14,
    fontWeight: '600',
    color: '#4F46E5',
    width: 36,
    flexShrink: 0,
  },
  recordValue: {
    fontSize: 14,
    color: '#1F2937',
    flex: 1,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  modalFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
  },
  modalTotal: {
    fontSize: 13,
    color: '#9CA3AF',
  },
  modalCloseBtn: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    backgroundColor: '#4F46E5',
    borderRadius: 10,
  },
  modalCloseText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});
