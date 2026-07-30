import { Router, type Request, type Response } from 'express';
import { getSupabaseClient } from '../storage/database/supabase-client.js';

const router = Router();

// Cache for tenant access token
let tokenCache: { token: string; expiresAt: number } | null = null;

/**
 * Get Feishu tenant access token
 */
async function getTenantAccessToken(appId: string, appSecret: string): Promise<string> {
  // Check cache first
  if (tokenCache && tokenCache.expiresAt > Date.now()) {
    return tokenCache.token;
  }

  const response = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });

  const data = await response.json() as Record<string, unknown>;

  if (data.code !== 0) {
    throw new Error(`飞书认证失败: ${data.msg || '未知错误'}`);
  }

  const token = data.tenant_access_token as string;
  const expire = data.expire as number;

  // Cache token, refresh 5 minutes before expiry
  tokenCache = {
    token,
    expiresAt: Date.now() + (expire - 300) * 1000,
  };

  return token;
}

/**
 * GET /api/v1/feishu/config
 * Get current Feishu configuration
 */
router.get('/config', async (_req: Request, res: Response) => {
  try {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('feishu_config')
      .select('id, app_id, app_token, table_id, field_name')
      .order('updated_at', { ascending: false })
      .limit(1);

    if (error) throw new Error(`查询配置失败: ${error.message}`);

    const config = data?.[0] ?? null;
    res.json({ success: true, data: config });
  } catch (err) {
    const message = err instanceof Error ? err.message : '获取配置失败';
    res.status(500).json({ success: false, error: message });
  }
});

/**
 * POST /api/v1/feishu/config
 * Save Feishu configuration
 * Body: { app_id: string, app_secret: string, app_token: string, table_id: string, field_name: string }
 */
router.post('/config', async (req: Request, res: Response) => {
  try {
    const { app_id, app_secret, app_token, table_id, field_name } = req.body as Record<string, string>;

    if (!app_id || !app_secret || !app_token || !table_id) {
      res.status(400).json({ success: false, error: '缺少必填参数' });
      return;
    }

    const client = getSupabaseClient();

    // Check if config exists
    const { data: existing } = await client
      .from('feishu_config')
      .select('id')
      .limit(1);

    if (existing && existing.length > 0) {
      // Update existing config
      const { error } = await client
        .from('feishu_config')
        .update({
          app_id,
          app_secret,
          app_token,
          table_id,
          field_name: field_name || '订单编号',
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing[0].id);

      if (error) throw new Error(`更新配置失败: ${error.message}`);
    } else {
      // Insert new config
      const { error } = await client
        .from('feishu_config')
        .insert({
          app_id,
          app_secret,
          app_token,
          table_id,
          field_name: field_name || '订单编号',
        });

      if (error) throw new Error(`保存配置失败: ${error.message}`);
    }

    // Clear token cache when config changes
    tokenCache = null;

    res.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : '保存配置失败';
    res.status(500).json({ success: false, error: message });
  }
});

/**
 * POST /api/v1/feishu/scan
 * Scan a barcode and register to Feishu
 * Body: { barcode: string }
 */
router.post('/scan', async (req: Request, res: Response) => {
  try {
    const { barcode } = req.body as { barcode: string };

    if (!barcode) {
      res.status(400).json({ success: false, error: '缺少条形码数据' });
      return;
    }

    const client = getSupabaseClient();

    // Get Feishu config
    const { data: configs, error: configError } = await client
      .from('feishu_config')
      .select('id, app_id, app_secret, app_token, table_id, field_name')
      .order('updated_at', { ascending: false })
      .limit(1);

    if (configError) throw new Error(`查询配置失败: ${configError.message}`);
    if (!configs || configs.length === 0) {
      // Save as failed record
      await client.from('scan_records').insert({
        barcode,
        status: 'failed',
        error_message: '未配置飞书凭证，请先在设置中配置',
      });
      res.status(400).json({ success: false, error: '未配置飞书凭证，请先在设置中配置' });
      return;
    }

    const config = configs[0];

    // Insert pending record
    const { data: recordData, error: recordError } = await client
      .from('scan_records')
      .insert({ barcode, status: 'pending' })
      .select()
      .single();

    if (recordError) throw new Error(`创建记录失败: ${recordError.message}`);

    try {
      // Get tenant access token
      const token = await getTenantAccessToken(config.app_id, config.app_secret);

      // Create record in Feishu Bitable
      const fieldName = config.field_name || '订单编号';
      const feishuResponse = await fetch(
        `https://open.feishu.cn/open-apis/bitable/v1/apps/${config.app_token}/tables/${config.table_id}/records`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({
            fields: { [fieldName]: barcode },
          }),
        }
      );

      const feishuData = await feishuResponse.json() as Record<string, unknown>;

      if (feishuData.code !== 0) {
        throw new Error(`飞书写入失败: ${feishuData.msg || '未知错误'} (code: ${feishuData.code})`);
      }

      // Update record as success
      await client
        .from('scan_records')
        .update({ status: 'success' })
        .eq('id', recordData.id);

      res.json({ success: true, data: { id: recordData.id, barcode, status: 'success' } });
    } catch (feishuErr) {
      const errorMsg = feishuErr instanceof Error ? feishuErr.message : '飞书同步失败';

      // Update record as failed
      await client
        .from('scan_records')
        .update({ status: 'failed', error_message: errorMsg })
        .eq('id', recordData.id);

      res.status(500).json({ success: false, error: errorMsg, data: { id: recordData.id, barcode, status: 'failed' } });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : '扫码登记失败';
    res.status(500).json({ success: false, error: message });
  }
});

/**
 * GET /api/v1/feishu/stats
 * Get scan statistics
 */
router.get('/stats', async (_req: Request, res: Response) => {
  try {
    const client = getSupabaseClient();

    // Get today's date range
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString();

    // Total count
    const { count: totalCount, error: totalError } = await client
      .from('scan_records')
      .select('*', { count: 'exact', head: true });

    if (totalError) throw new Error(`统计失败: ${totalError.message}`);

    // Today's count
    const { count: todayCount, error: todayError } = await client
      .from('scan_records')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', todayStr);

    if (todayError) throw new Error(`统计失败: ${todayError.message}`);

    // Success count
    const { count: successCount, error: successError } = await client
      .from('scan_records')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'success');

    if (successError) throw new Error(`统计失败: ${successError.message}`);

    // Today's success count
    const { count: todaySuccessCount, error: todaySuccessError } = await client
      .from('scan_records')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'success')
      .gte('created_at', todayStr);

    if (todaySuccessError) throw new Error(`统计失败: ${todaySuccessError.message}`);

    // Failed count
    const { count: failedCount, error: failedError } = await client
      .from('scan_records')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'failed');

    if (failedError) throw new Error(`统计失败: ${failedError.message}`);

    res.json({
      success: true,
      data: {
        total: totalCount || 0,
        today: todayCount || 0,
        success: successCount || 0,
        today_success: todaySuccessCount || 0,
        failed: failedCount || 0,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : '获取统计失败';
    res.status(500).json({ success: false, error: message });
  }
});

/**
 * GET /api/v1/feishu/records
 * Get scan history records
 * Query: { page?: number, size?: number }
 */
router.get('/records', async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const size = Math.min(parseInt(req.query.size as string) || 20, 100);
    const offset = (page - 1) * size;

    const client = getSupabaseClient();

    const { data, error, count } = await client
      .from('scan_records')
      .select('id, barcode, status, error_message, created_at')
      .order('created_at', { ascending: false })
      .range(offset, offset + size - 1);

    if (error) throw new Error(`查询记录失败: ${error.message}`);

    res.json({
      success: true,
      data: {
        records: data || [],
        total: count || 0,
        page,
        size,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : '获取记录失败';
    res.status(500).json({ success: false, error: message });
  }
});

export default router;
