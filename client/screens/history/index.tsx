import { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { FontAwesome6 } from '@expo/vector-icons';
import { Screen } from '@/components/Screen';
import { useFocusEffect } from 'expo-router';
import dayjs from 'dayjs';

interface ScanRecord {
  user_id: string;
  user_name: string;
  scan_time: string;
  raw_data: { barcode?: string; [key: string]: unknown };
  status: 'pending' | 'success' | 'failed';
}

export default function HistoryScreen() {
  const [records, setRecords] = useState<ScanRecord[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const fetchRecords = useCallback(async (pageNum: number = 1, append: boolean = false) => {
    setLoading(true);
    try {
      /**
       * 服务端文件：server/src/routes/feishu.ts
       * 接口：GET /api/v1/feishu/records
       * Query 参数：page?: number, size?: number
       */
      const response = await fetch(
        `${process.env.EXPO_PUBLIC_BACKEND_BASE_URL}/api/v1/feishu/records?page=${pageNum}&size=20`
      );
      const result = await response.json() as {
        success: boolean;
        data: ScanRecord[];
      };
      if (result.success) {
        const mappedRecords = result.data.map((r: Record<string, unknown>) => ({
          id: String(r.user_id || ''),
          barcode: r.raw_data?.barcode || r.raw_data?.raw_content || String(r.raw_data || ''),
          status: r.status as 'success' | 'failed' | 'pending',
          error_message: r.error_message as string | undefined,
          created_at: r.scan_time as string,
          user_name: r.user_name as string | undefined,
        }));
        if (append) {
          setRecords(prev => [...prev, ...mappedRecords]);
        } else {
          setRecords(mappedRecords);
        }
        setTotal(mappedRecords.length);
        setPage(pageNum);
      }
    } catch {
      // Silently fail
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchRecords(1);
    }, [fetchRecords])
  );

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    fetchRecords(1);
  }, [fetchRecords]);

  const handleLoadMore = useCallback(() => {
    if (loading || records.length >= total) return;
    fetchRecords(page + 1, true);
  }, [loading, records.length, total, page, fetchRecords]);

  const getStatusConfig = (status: string) => {
    switch (status) {
      case 'success':
        return { icon: 'check-circle' as const, color: '#10B981', bg: 'rgba(16, 185, 129, 0.1)', label: '成功' };
      case 'failed':
        return { icon: 'times-circle' as const, color: '#EF4444', bg: 'rgba(239, 68, 68, 0.1)', label: '失败' };
      default:
        return { icon: 'clock' as const, color: '#F59E0B', bg: 'rgba(245, 158, 11, 0.1)', label: '处理中' };
    }
  };

  const renderItem = useCallback(({ item }: { item: ScanRecord }) => {
    const statusConfig = getStatusConfig(item.status);
    return (
      <View style={styles.recordCard}>
        <View style={styles.recordLeft}>
          <View style={[styles.statusIcon, { backgroundColor: statusConfig.bg }]}>
            <FontAwesome6 name={statusConfig.icon} size={16} color={statusConfig.color} />
          </View>
          <View style={styles.recordInfo}>
            <Text style={styles.barcodeText} numberOfLines={1}>{item.barcode}</Text>
            <Text style={styles.timeText}>
              {dayjs(item.created_at).format('MM/DD HH:mm:ss')}
            </Text>
          </View>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: statusConfig.bg }]}>
          <Text style={[styles.statusBadgeText, { color: statusConfig.color }]}>
            {statusConfig.label}
          </Text>
        </View>
      </View>
    );
  }, []);

  const renderEmpty = useCallback(() => (
    <View style={styles.emptyContainer}>
      <FontAwesome6 name="barcode" size={48} color="#D6D3D1" />
      <Text style={styles.emptyText}>暂无扫码记录</Text>
      <Text style={styles.emptySubText}>扫描条形码后记录将显示在这里</Text>
    </View>
  ), []);

  return (
    <Screen backgroundColor="#F5F5F4">
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>扫码记录</Text>
          <Text style={styles.headerSubtitle}>共 {total} 条记录</Text>
        </View>

        {/* Records List */}
        <FlatList
          data={records}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor="#0D9488"
            />
          }
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.3}
          ListEmptyComponent={renderEmpty}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5F4',
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
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
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  recordCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    shadowColor: '#0D9488',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  recordLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  statusIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  recordInfo: {
    marginLeft: 12,
    flex: 1,
  },
  barcodeText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1C1917',
  },
  timeText: {
    fontSize: 12,
    color: '#A8A29E',
    marginTop: 2,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 9999,
  },
  statusBadgeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  separator: {
    height: 8,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
    gap: 8,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#78716C',
    marginTop: 12,
  },
  emptySubText: {
    fontSize: 13,
    color: '#A8A29E',
  },
});
