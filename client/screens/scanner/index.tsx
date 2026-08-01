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
  Alert,
  TextInput,
  KeyboardAvoidingView,
  TouchableWithoutFeedback,
  Keyboard,
} from 'react-native';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { Audio } from 'expo-av';
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
  today_failed: number;
}

const FEISHU_BITABLE_URL = 'https://gcnop2681oz6.feishu.cn/base/FeYNbNOGcaZltysJowEcuzginfd?table=tblCmub3OU18zCle&view=vewzaoO9z0';

export default function ScannerScreen() {
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const hasPermission = permission?.granted ?? false;
  const [scanning, setScanning] = useState(true);
  const [cameraKey, setCameraKey] = useState(0);
  const [lastScan, setLastScan] = useState<{ barcode: string; status: 'success' | 'failed' | 'duplicate'; error?: string } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [stats, setStats] = useState<Stats>({ total: 0, today: 0, success: 0, today_success: 0, failed: 0, today_failed: 0 });
  const [configReady, setConfigReady] = useState(false);
  const [configChecking, setConfigChecking] = useState(true);
  const [tableRecords, setTableRecords] = useState<Array<{ index: number; value: string }>>([]);
  const [showTableModal, setShowTableModal] = useState(false);
  const [loadingTable, setLoadingTable] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [showBatchTracking, setShowBatchTracking] = useState(false);
  const [trackingNumber, setTrackingNumber] = useState('');
  const [pendingRecords, setPendingRecords] = useState<Array<{ record_id: string; order_number: string }>>([]);
  const [loadingPending, setLoadingPending] = useState(false);
  const [batchSubmitting, setBatchSubmitting] = useState(false);
  const [batchResult, setBatchResult] = useState<{ updated: number } | null>(null);
  const [showTrackingScanModal, setShowTrackingScanModal] = useState(false);
  const [scanSuccessMsg, setScanSuccessMsg] = useState<string | null>(null);
  const [lastScannedBarcode, setLastScannedBarcode] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [trackingScanResult, setTrackingScanResult] = useState<string | null>(null);
  const scanLineAnim = useRef(new Animated.Value(0)).current;
  const lastScanTime = useRef(0);
  const successSound = useRef<Audio.Sound | null>(null);
  const duplicateSound = useRef<Audio.Sound | null>(null);

  // Load sound effects
  useEffect(() => {
    async function loadSounds() {
      await Audio.setAudioModeAsync({ playsInSilentModeIOS: true, staysActiveInBackground: false });
      try {
        const { sound: success } = await Audio.Sound.createAsync(
          require('@/assets/success.wav'),
          { shouldPlay: false }
        );
        successSound.current = success;

        const { sound: duplicate } = await Audio.Sound.createAsync(
          require('@/assets/duplicate.wav'),
          { shouldPlay: false }
        );
        duplicateSound.current = duplicate;
      } catch (error) {
        console.log('音效加载失败:', error);
      }
    }
    loadSounds();

    return () => {
      successSound.current?.unloadAsync();
      duplicateSound.current?.unloadAsync();
    };
  }, []);

  const playSuccessSound = useCallback(async () => {
    try {
      if (successSound.current) {
        await successSound.current.replayAsync();
      }
    } catch (error) {
      console.log('播放成功音效失败:', error);
    }
  }, []);

  const playDuplicateSound = useCallback(async () => {
    try {
      if (duplicateSound.current) {
        await duplicateSound.current.replayAsync();
      }
    } catch (error) {
      console.log('播放重复音效失败:', error);
    }
  }, []);

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
      const result = await response.json() as { success: boolean; data: Record<string, number> };
      if (result.success) {
        const d = result.data;
        setStats({
          total: d.total_scans ?? d.total ?? 0,
          today: d.today_scans ?? d.today ?? 0,
          success: d.success_scans ?? d.success ?? 0,
          today_success: d.today_success ?? d.success_scans ?? d.success ?? 0,
          failed: d.failed_scans ?? d.failed ?? 0,
          today_failed: d.today_failed ?? d.failed_scans ?? d.failed ?? 0,
        });
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
        data: Array<{ fields: Record<string, unknown> }>;
      };
      if (result.success) {
        const mapped = result.data.map((item, idx) => ({
          index: idx + 1,
          value: String(item.fields?.['1688订单编号'] || ''),
        }));
        setTableRecords(mapped);
        setShowTableModal(true);
      }
    } catch {
      // Silently fail
    } finally {
      setLoadingTable(false);
    }
  }, []);

  // Load table records silently for duplicate detection (no modal)
  const loadTableRecordsForDedup = useCallback(async () => {
    try {
      const response = await fetch(`${process.env.EXPO_PUBLIC_BACKEND_BASE_URL}/api/v1/feishu/table-records?user_id=mobile-app`);
      const result = await response.json() as { success: boolean; data: Array<{ fields: Record<string, unknown> }> | null };
      if (result.success && result.data) {
        const mapped = result.data.map((item, idx) => ({
          index: idx + 1,
          value: String(item.fields?.['1688订单编号'] || ''),
        }));
        setTableRecords(mapped);
      }
    } catch {
      // Silently fail
    }
  }, []);

  // Check if Feishu config exists
  const checkConfig = useCallback(async () => {
    setConfigChecking(true);
    try {
      const response = await fetch(`${process.env.EXPO_PUBLIC_BACKEND_BASE_URL}/api/v1/feishu/config`);
      const result = await response.json() as { success: boolean; data: unknown };
      setConfigReady(!!result.data);
    } catch {
      setConfigReady(false);
    } finally {
      setConfigChecking(false);
    }
  }, []);

  // Refresh on focus
  useFocusEffect(
    useCallback(() => {
      fetchStats();
      checkConfig();
      loadTableRecordsForDedup(); // Load records for duplicate detection
    }, [fetchStats, checkConfig, loadTableRecordsForDedup])
  );

  // Handle barcode scan
  const handleBarcodeScanned = useCallback(async ({ data }: BarcodeScanningResult) => {
    const now = Date.now();
    // Debounce: prevent scanning same barcode within 2 seconds
    if (now - lastScanTime.current < 2000) return;
    if (isProcessing) return;

    // Check if barcode already exists in Feishu table (frontend duplicate detection)
    const isDuplicate = tableRecords.some(r => r.value === data);
    if (isDuplicate) {
      setLastScan({
        barcode: data,
        status: 'duplicate',
        error: '该订单编号已登记，无需重复提交',
      });
      // 播放重复音效
      playDuplicateSound();
      // 重复扫描不更新时间戳，允许立即扫描新条码
      return;
    }

    // 只有成功扫描才更新时间戳
    lastScanTime.current = now;

    // Play success sound
    playSuccessSound();

    // Optimistic update: show success immediately
    setLastScan({ barcode: data, status: 'success' });
    setIsProcessing(true);

    // Sync to Feishu in background (fire-and-forget)
    try {
      /**
       * 服务端文件：部署后端 /api/v1/feishu/scan
       * 接口：POST /api/v1/feishu/scan
       * Body 参数：user_id: string, raw_data: { barcode: string }
       */
      const response = await fetch(`${process.env.EXPO_PUBLIC_BACKEND_BASE_URL}/api/v1/feishu/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: 'mobile-app', raw_data: { barcode: data } }),
      });

      const result = await response.json() as {
        success: boolean;
        error?: string;
        message?: string;
        data?: { barcode?: string; status: string; raw_data?: { barcode: string } };
      };

      if (!result.success) {
        // Update status if sync failed
        setLastScan({ barcode: data, status: 'failed', error: result.error });
      } else if (result.data?.status === 'duplicate') {
        // Update status if duplicate
        setLastScan({
          barcode: result.data?.raw_data?.barcode || result.data?.barcode || data,
          status: 'duplicate',
          error: result.message,
        });
        playDuplicateSound();
      }

      // Refresh stats and table records in background
      fetchStats();
      loadTableRecordsForDedup();
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : '网络请求失败';
      setLastScan({ barcode: data, status: 'failed', error: errorMsg });
      setScanning(true);
    }
  }, []);

  const handleRefreshCamera = useCallback(() => {
    setScanning(false);
    setCameraKey(prev => prev + 1);
    setTimeout(() => {
      setScanning(true);
    }, 1500);
  }, []);
  const handleClearToday = useCallback(async () => {
    setClearing(true);
    try {
      const response = await fetch(`${process.env.EXPO_PUBLIC_BACKEND_BASE_URL}/api/v1/feishu/clear-today`, {
        method: 'DELETE',
      });
      const result = await response.json();
      if (result.success) {
        Alert.alert('清空成功', '今日数据已重置');
        await fetchStats();
        await loadTableRecordsForDedup(); // Silent refresh (no modal)
      } else {
        Alert.alert('清空失败', result.error || '未知错误');
      }
    } catch {
      Alert.alert('清空失败', '网络错误');
    } finally {
      setClearing(false);
      setShowClearConfirm(false);
    }
  }, [fetchStats, loadTableRecordsForDedup]);

  const handleDeleteLast = useCallback(async () => {
    setIsDeleting(true);
    try {
      const response = await fetch(`${process.env.EXPO_PUBLIC_BACKEND_BASE_URL}/api/v1/feishu/delete-last`, {
        method: 'POST',
      });
      const result = await response.json();
      if (result.success) {
        Alert.alert('删除成功', result.message || '已删除最后一条记录');
        await fetchStats();
        await loadTableRecordsForDedup(); // Silent refresh (no modal)
      } else {
        Alert.alert('删除失败', result.error || '未知错误');
      }
    } catch {
      Alert.alert('删除失败', '网络错误');
    } finally {
      setIsDeleting(false);
      setShowDeleteConfirm(false);
    }
  }, [fetchStats, fetchTableRecords]);

  // 加载待填写快递单号的记录
  const loadPendingRecords = useCallback(async () => {
    setLoadingPending(true);
    try {
      /**
       * 服务端文件：server/src/routes/feishu.ts
       * 接口：GET /api/v1/feishu/pending-records
       * 返回：{ success: true, data: { records: [...], count: number } }
       */
      const response = await fetch(`${process.env.EXPO_PUBLIC_BACKEND_BASE_URL}/api/v1/feishu/pending-records`);
      const result = await response.json();
      if (result.success) {
        setPendingRecords(result.data.records || []);
      } else {
        Alert.alert('错误', result.error || '加载失败');
      }
    } catch {
      Alert.alert('错误', '网络错误');
    } finally {
      setLoadingPending(false);
    }
  }, []);

  // 批量填写快递单号
  const handleBatchSubmit = async () => {
    if (!trackingNumber.trim()) {
      Alert.alert('提示', '请输入或扫描快递单号');
      return;
    }
    setBatchSubmitting(true);
    try {
      const response = await fetch(`${process.env.EXPO_PUBLIC_BACKEND_BASE_URL}/api/v1/feishu/batch-tracking`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trackingNumber: trackingNumber.trim() }),
      });
      const result = await response.json();
      if (result.success) {
        setBatchResult({ updated: result.updated || 0 });
        setTrackingNumber('');
      } else {
        Alert.alert('失败', result.error || '未知错误');
      }
    } catch {
      Alert.alert('失败', '网络错误');
    } finally {
      setBatchSubmitting(false);
    }
  };

  // 扫码填写快递单号
  const handleTrackingScan = useCallback(async (barcode: string) => {
    setTrackingScanResult(null);
    setBatchSubmitting(true);
    try {
      /**
       * 服务端文件：server/src/routes/feishu.ts
       * 接口：POST /api/v1/feishu/batch-tracking
       * Body 参数：trackingNumber: string
       */
      const response = await fetch(`${process.env.EXPO_PUBLIC_BACKEND_BASE_URL}/api/v1/feishu/batch-tracking`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trackingNumber: barcode }),
      });
      const result = await response.json();
      if (result.success) {
        Alert.alert('填写成功', `成功填写 ${result.updated} 条记录`);
        setShowTrackingScanModal(false);
        loadPendingRecords();
        fetchStats();
      } else {
        Alert.alert('错误', result.error || '填写失败');
      }
    } catch {
      Alert.alert('错误', '网络错误');
    } finally {
      setBatchSubmitting(false);
    }
  }, [loadPendingRecords, fetchStats]);

  // 扫码 Modal 扫码成功回调
  const handleBatchBarcodeScanned = useCallback(({ data }: { data: string }) => {
    // 防止短时间内重复扫描同一个条码
    if (data === lastScannedBarcode) {
      return;
    }
    setLastScannedBarcode(data);
    setTrackingNumber(data);
    setScanSuccessMsg(`已识别：${data}`);
    setTimeout(() => setScanSuccessMsg(null), 2000);
    // 不立即关闭 Modal，让用户确认或修改
  }, [lastScannedBarcode]);

  // 关闭扫码 Modal 时重置状态
  const handleCloseTrackingScanModal = useCallback(() => {
    setShowTrackingScanModal(false);
    setLastScannedBarcode(''); // 重置，允许下次扫描相同条码
  }, []);

  // 打开扫码 Modal
  const handleBatchScan = useCallback(() => {
    setShowTrackingScanModal(true);
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

        {/* Scrollable Content */}
        <ScrollView
          style={styles.scrollContent}
          contentContainerStyle={styles.scrollContentContainer}
          showsVerticalScrollIndicator={false}
        >
          {/* Camera Viewfinder */}
          <View style={styles.cameraSection}>
          {hasPermission ? (
            <View style={styles.cameraContainer}>
              {/* Refresh button */}
              <TouchableOpacity
                style={styles.refreshButton}
                onPress={handleRefreshCamera}
              >
                <FontAwesome6 name="rotate" size={20} color="#FFFFFF" />
              </TouchableOpacity>
              <CameraView
                key={cameraKey}
                style={styles.camera}
                facing="back"
                barcodeScannerSettings={{
                  barcodeTypes: ['qr', 'ean13', 'ean8', 'code128', 'code39', 'upc_e', 'upc_a'],
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
              {!configChecking && !configReady && (
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
              <TouchableOpacity style={styles.permissionButton} onPress={requestPermission}>
                <FontAwesome6 name="shield-halved" size={16} color="#FFF" />
                <Text style={styles.permissionButtonText}>请求相机权限</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

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
              <Text style={styles.statLabel}>今日成功</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={[styles.statNumber, styles.statFailed]}>{stats.today_failed}</Text>
              <Text style={styles.statLabel}>今日失败</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statNumber}>{stats.total}</Text>
              <Text style={styles.statLabel}>累计扫描</Text>
            </View>
          </View>

          {/* Action Buttons - Consistent Spacing */}
          <View style={styles.buttonGroup}>
            {/* Batch Tracking Button */}
            <TouchableOpacity
              style={styles.batchButton}
              onPress={() => { setShowBatchTracking(true); loadPendingRecords(); }}
              activeOpacity={0.7}
            >
              <FontAwesome6 name="truck-fast" size={16} color="#059669" />
              <Text style={styles.batchButtonText}>批量填写快递单号</Text>
            </TouchableOpacity>

            {/* Clear Data & Delete Last - Two Columns */}
            <View style={styles.actionRow}>
              <TouchableOpacity
                style={styles.clearButton}
                onPress={() => setShowClearConfirm(true)}
                activeOpacity={0.7}
              >
                <FontAwesome6 name="rotate-left" size={14} color="#EF4444" />
                <Text style={styles.clearButtonText}>清空数据</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.deleteButton}
                onPress={() => setShowDeleteConfirm(true)}
                activeOpacity={0.7}
              >
                <FontAwesome6 name="trash-can" size={14} color="#EF4444" />
                <Text style={styles.deleteButtonText}>删除上一条</Text>
              </TouchableOpacity>
            </View>

            {/* View Feishu */}
            <TouchableOpacity
              style={styles.feishuButton}
              onPress={() => Linking.openURL(FEISHU_BITABLE_URL)}
              activeOpacity={0.7}
            >
              <FontAwesome6 name="table-columns" size={16} color="#4F46E5" />
              <Text style={styles.feishuButtonText}>查看飞书</Text>
              <FontAwesome6 name="arrow-up-right-from-square" size={12} color="#4F46E5" />
            </TouchableOpacity>
          </View>
        </View>
        </ScrollView>
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

      {/* Clear Confirmation Modal */}
      <Modal
        visible={showClearConfirm}
        transparent
        animationType="fade"
        onRequestClose={() => setShowClearConfirm(false)}
      >
        <View style={styles.confirmOverlay}>
          <View style={styles.clearConfirmContent}>
            <View style={styles.clearConfirmIcon}>
              <FontAwesome6 name="triangle-exclamation" size={32} color="#EF4444" />
            </View>
            <Text style={styles.clearConfirmTitle}>确认清空今日数据？</Text>
            <Text style={styles.clearConfirmDesc}>此操作将删除今日所有扫描记录，且无法恢复</Text>
            <View style={styles.clearConfirmButtons}>
              <TouchableOpacity
                style={[styles.clearConfirmBtn, styles.clearConfirmCancelBtn]}
                onPress={() => setShowClearConfirm(false)}
                disabled={clearing}
              >
                <Text style={styles.clearConfirmCancelText}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.clearConfirmBtn, styles.clearConfirmDeleteBtn]}
                onPress={handleClearToday}
                disabled={clearing}
              >
                <Text style={styles.clearConfirmDeleteText}>
                  {clearing ? '清空中...' : '确认清空'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Delete Last Record Confirmation Modal */}
      <Modal
        visible={showDeleteConfirm}
        transparent
        animationType="fade"
        onRequestClose={() => setShowDeleteConfirm(false)}
      >
        <View style={styles.confirmOverlay}>
          <View style={styles.clearConfirmContent}>
            <View style={styles.clearConfirmIcon}>
              <FontAwesome6 name="triangle-exclamation" size={32} color="#EF4444" />
            </View>
            <Text style={styles.clearConfirmTitle}>确认删除最后一条记录？</Text>
            <Text style={styles.clearConfirmDesc}>此操作将真实删除飞书表格中的最后一条记录，且无法恢复</Text>
            <View style={styles.clearConfirmButtons}>
              <TouchableOpacity
                style={[styles.clearConfirmBtn, styles.clearConfirmCancelBtn]}
                onPress={() => setShowDeleteConfirm(false)}
                disabled={isDeleting}
              >
                <Text style={styles.clearConfirmCancelText}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.clearConfirmBtn, styles.clearConfirmDeleteBtn]}
                onPress={handleDeleteLast}
                disabled={isDeleting}
              >
                <Text style={styles.clearConfirmDeleteText}>
                  {isDeleting ? '删除中...' : '确认删除'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Batch Tracking Modal */}
      <Modal
        visible={showBatchTracking}
        transparent
        animationType="slide"
        onRequestClose={() => setShowBatchTracking(false)}
      >
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 100 : 0}
        >
          <TouchableWithoutFeedback onPress={Keyboard.dismiss} disabled={Platform.OS === 'web'}>
            <View style={styles.modalOverlay}>
              <View style={styles.modalContent}>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>批量填写快递单号</Text>
                  <TouchableOpacity onPress={() => { setShowBatchTracking(false); setBatchResult(null); }}>
                    <FontAwesome6 name="xmark" size={20} color="#6B7280" />
                  </TouchableOpacity>
                </View>

            {batchResult ? (
              <View style={styles.batchResultContainer}>
                <FontAwesome6 name="circle-check" size={48} color="#10B981" />
                <Text style={styles.batchResultText}>成功填写 {batchResult.updated} 条</Text>
                <TouchableOpacity
                  style={styles.batchNewBtn}
                  onPress={() => { setBatchResult(null); setTrackingNumber(''); loadPendingRecords(); }}
                >
                  <Text style={styles.batchNewBtnText}>继续填写</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <>
                <ScrollView style={styles.modalBody}>
                  {loadingPending ? (
                    <Text style={styles.modalEmptyText}>加载中...</Text>
                  ) : pendingRecords.length === 0 ? (
                    <Text style={styles.modalEmptyText}>没有待填写的记录</Text>
                  ) : (
                    <>
                      <Text style={styles.batchPendingTitle}>待填写记录 ({pendingRecords.length}条)</Text>
                      {pendingRecords.slice(0, 20).map((record) => (
                        <View key={record.record_id} style={styles.recordRow}>
                          <Text style={styles.recordIndex}>•</Text>
                          <Text style={styles.recordValue} numberOfLines={1}>{record.order_number}</Text>
                        </View>
                      ))}
                      {pendingRecords.length > 20 && (
                        <Text style={styles.batchMoreText}>...还有 {pendingRecords.length - 20} 条</Text>
                      )}
                    </>
                  )}
                </ScrollView>

                <View style={styles.batchInputContainer}>
                  <TextInput
                    style={styles.batchInput}
                    placeholder="输入或扫描快递单号"
                    placeholderTextColor="#9CA3AF"
                    value={trackingNumber}
                    onChangeText={setTrackingNumber}
                    editable={!batchSubmitting}
                  />
                  <TouchableOpacity
                    style={styles.batchButton}
                    onPress={handleBatchScan}
                    disabled={batchSubmitting}
                  >
                    <FontAwesome6 name="barcode" size={20} color="#6366F1" />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.batchSubmitBtn, batchSubmitting && styles.batchSubmitBtnDisabled]}
                    onPress={handleBatchSubmit}
                    disabled={batchSubmitting || pendingRecords.length === 0}
                  >
                    <Text style={styles.batchSubmitBtnText}>
                      {batchSubmitting ? '提交中...' : `填写${pendingRecords.length}条`}
                    </Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
          </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </Modal>

      {/* 扫码填写快递单号 Modal */}
      <Modal
        visible={showTrackingScanModal}
        animationType="slide"
        onRequestClose={handleCloseTrackingScanModal}
      >
        <View style={styles.scannerModalContainer}>
          <View style={styles.scannerModalHeader}>
            <Text style={styles.scannerModalTitle}>扫描快递单号</Text>
            <TouchableOpacity onPress={handleCloseTrackingScanModal}>
              <FontAwesome6 name="xmark" size={20} color="#6B7280" />
            </TouchableOpacity>
          </View>

          {scanSuccessMsg && (
            <View style={styles.scanSuccessBanner}>
              <FontAwesome6 name="check-circle" size={16} color="#059669" />
              <Text style={styles.scanSuccessText}>{scanSuccessMsg}</Text>
            </View>
          )}
          <View style={styles.scannerContainer}>
            <CameraView
              style={styles.scanner}
              facing="back"
              onBarcodeScanned={(result) => {
                handleBatchBarcodeScanned(result);
                // 重置扫码状态，允许连续扫描
                setTimeout(() => setLastScannedBarcode(''), 500);
              }}
            />
            <View style={styles.scannerOverlay}>
              <View style={styles.scannerFrame} />
            </View>
            <Text style={styles.scannerHint}>将快递单号条形码放入框内</Text>
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
  scrollContent: {
    flex: 1,
  },
  scrollContentContainer: {
    paddingBottom: 40,
  },
  scanSuccessBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    backgroundColor: '#ECFDF5',
    borderRadius: 8,
    marginHorizontal: 16,
    marginTop: 8,
    gap: 8,
  },
  scanSuccessText: {
    fontSize: 14,
    color: '#059669',
    fontWeight: '600',
  },
  header: {
    backgroundColor: '#F5F5F4',
    paddingHorizontal: 20,
    paddingBottom: 40,
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
  refreshButton: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
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
  permissionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#4F46E5',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
    marginTop: 8,
  },
  permissionButtonText: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: '600',
  },
  // Confirmation Modal
  confirmOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
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
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
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
  clearButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    backgroundColor: '#FEF2F2',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#FEE2E2',
  },
  clearButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#EF4444',
  },
  batchButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    backgroundColor: '#ECFDF5',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#D1FAE5',
  },
  batchButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#059669',
  },
  deleteButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 14,
    backgroundColor: '#FEF2F2',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  deleteButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#DC2626',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 12,
  },
  buttonGroup: {
    gap: 12,
    marginTop: 16,
  },
  clearConfirmContent: {
    width: '85%',
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
  },
  clearConfirmIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#FEF2F2',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  clearConfirmTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 8,
  },
  clearConfirmDesc: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 20,
  },
  clearConfirmButtons: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  clearConfirmBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  clearConfirmCancelBtn: {
    backgroundColor: '#F3F4F6',
  },
  clearConfirmCancelText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#374151',
  },
  clearConfirmDeleteBtn: {
    backgroundColor: '#EF4444',
  },
  clearConfirmDeleteText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  batchPendingTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6B7280',
    marginBottom: 8,
  },
  batchMoreText: {
    fontSize: 12,
    color: '#9CA3AF',
    marginTop: 4,
  },
  batchResultContainer: {
    alignItems: 'center',
    paddingVertical: 40,
    gap: 16,
  },
  batchResultText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#059669',
  },
  batchNewBtn: {
    marginTop: 8,
    paddingHorizontal: 24,
    paddingVertical: 12,
    backgroundColor: '#ECFDF5',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#D1FAE5',
  },
  batchNewBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#059669',
  },
  batchInputContainer: {
    flexDirection: 'row',
    gap: 8,
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
  },
  batchInput: {
    flex: 1,
    height: 44,
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
    paddingHorizontal: 16,
    fontSize: 15,
    color: '#111827',
  },
  batchSubmitBtn: {
    paddingHorizontal: 20,
    height: 44,
    backgroundColor: '#059669',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  batchSubmitBtnDisabled: {
    backgroundColor: '#9CA3AF',
  },
  batchSubmitBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  scannerModalContainer: {
    flex: 1,
    backgroundColor: '#000000',
  },
  scannerModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#1F2937',
  },
  scannerModalTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  scannerContainer: {
    flex: 1,
    position: 'relative',
  },
  scanner: {
    flex: 1,
  },
  scannerOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scannerFrame: {
    width: 250,
    height: 250,
    borderWidth: 2,
    borderColor: '#10B981',
    borderRadius: 16,
  },
  scannerHint: {
    position: 'absolute',
    bottom: 60,
    left: 0,
    right: 0,
    textAlign: 'center',
    fontSize: 14,
    color: '#FFFFFF',
    backgroundColor: 'rgba(0,0,0,0.6)',
    padding: 12,
  },
  scannerFocusBtn: {
    position: 'absolute',
    bottom: 120,
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(255,255,255,0.9)',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  scannerCloseBtn: {
    position: 'absolute',
    top: 20,
    right: 20,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  focusButton: {
    position: 'absolute',
    bottom: 100,
    alignSelf: 'center',
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(255,255,255,0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
