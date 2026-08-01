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
 * Get Feishu configuration from database
 */
async function getFeishuConfig(): Promise<{ app_id: string; app_secret: string; app_token: string; table_id: string; field_name?: string } | null> {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from('feishu_config')
    .select('app_id, app_secret, app_token, table_id, field_name')
    .order('updated_at', { ascending: false })
    .limit(1);

  if (error || !data || data.length === 0) {
    return null;
  }

  return data[0];
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

    // Check if barcode already exists in Feishu table (duplicate filter)
    const token = await getTenantAccessToken(config.app_id, config.app_secret);
    const fieldName = config.field_name || '订单编号';

    const checkResponse = await fetch(
      `https://open.feishu.cn/open-apis/bitable/v1/apps/${config.app_token}/tables/${config.table_id}/records/search?page_size=1`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          filter: {
            conjunction: 'and',
            conditions: [
              { field_name: fieldName, operator: 'is', value: [barcode] },
            ],
          },
        }),
      }
    );

    const checkData = await checkResponse.json() as Record<string, unknown>;

    if (checkData.code === 0) {
      const result = checkData.data as Record<string, unknown>;
      const total = result.total as number;
      if (total > 0) {
        // Duplicate found - record locally but skip Feishu write
        const { data: dupRecord } = await client
          .from('scan_records')
          .insert({ barcode, status: 'failed', error_message: '订单编号已存在，跳过重复登记' })
          .select()
          .single();

        res.json({
          success: true,
          data: { id: dupRecord?.id, barcode, status: 'duplicate' },
          message: '该订单编号已存在，已跳过重复登记',
        });
        return;
      }
    }

    // Insert pending record
    const { data: recordData, error: recordError } = await client
      .from('scan_records')
      .insert({ barcode, status: 'pending' })
      .select()
      .single();

    if (recordError) throw new Error(`创建记录失败: ${recordError.message}`);

    try {
      // Create record in Feishu Bitable
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

    if (failedError) throw new Error(`统计失败：${failedError.message}`);

    // Today's failed count
    const { count: todayFailedCount, error: todayFailedError } = await client
      .from('scan_records')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'failed')
      .gte('created_at', todayStr);

    if (todayFailedError) throw new Error(`统计失败：${todayFailedError.message}`);

    res.json({
      success: true,
      data: {
        total: totalCount || 0,
        today: todayCount || 0,
        success: successCount || 0,
        today_success: todaySuccessCount || 0,
        failed: failedCount || 0,
        today_failed: todayFailedCount || 0,
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

/**
 * GET /api/v1/feishu/table-records
 * Fetch all records from Feishu Bitable, return field values with numbering
 * Query: { field_name?: string } (optional, defaults to config field_name)
 */
router.get('/table-records', async (req: Request, res: Response) => {
  try {
    const client = getSupabaseClient();

    // Get Feishu config
    const { data: configs, error: configError } = await client
      .from('feishu_config')
      .select('id, app_id, app_secret, app_token, table_id, field_name')
      .order('updated_at', { ascending: false })
      .limit(1);

    if (configError) throw new Error(`查询配置失败: ${configError.message}`);
    if (!configs || configs.length === 0) {
      res.status(400).json({ success: false, error: '未配置飞书凭证' });
      return;
    }

    const config = configs[0];
    const fieldName = (req.query.field_name as string) || config.field_name || '1688订单编号';

    // Get tenant access token
    const token = await getTenantAccessToken(config.app_id, config.app_secret);

    // Fetch all records from Feishu Bitable with pagination
    const allItems: Array<Record<string, unknown>> = [];
    let pageToken = '';

    do {
      const url = new URL(
        `https://open.feishu.cn/open-apis/bitable/v1/apps/${config.app_token}/tables/${config.table_id}/records`
      );
      url.searchParams.set('page_size', '100');
      if (pageToken) url.searchParams.set('page_token', pageToken);

      const response = await fetch(url.toString(), {
        headers: { 'Authorization': `Bearer ${token}` },
      });

      const data = await response.json() as Record<string, unknown>;

      if (data.code !== 0) {
        throw new Error(`飞书读取失败: ${data.msg || '未知错误'} (code: ${data.code})`);
      }

      const items = (data.data as Record<string, unknown>)?.items as Array<Record<string, unknown>>;
      if (items) allItems.push(...items);

      pageToken = ((data.data as Record<string, unknown>)?.page_token as string) || '';
    } while (pageToken);

    // Extract field values with numbering
    const records = allItems.map((item, index) => {
      const fields = item.fields as Record<string, unknown>;
      const value = fields?.[fieldName];
      return {
        index: index + 1,
        value: value !== undefined && value !== null ? String(value) : '',
      };
    });

    res.json({
      success: true,
      data: {
        field_name: fieldName,
        total: records.length,
        records,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : '获取飞书表格数据失败';
    res.status(500).json({ success: false, error: message });
  }
});

/**
 * 清空今日扫描记录
 * DELETE /api/v1/feishu/clear-today
 */
router.delete('/clear-today', async (req, res) => {
  try {
    const client = getSupabaseClient();
    const today = new Date().toISOString().split('T')[0];

    const { error } = await client
      .from('scan_records')
      .delete()
      .gte('created_at', `${today}T00:00:00`)
      .lt('created_at', `${today}T23:59:59`);

    if (error) throw new Error(`清空记录失败: ${error.message}`);

    res.json({
      success: true,
      message: '今日数据已清空',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : '清空数据失败';
    res.status(500).json({ success: false, error: message });
  }
});


/**
 * 获取待填写快递单号的记录
 * GET /api/v1/feishu/pending-records
 * 返回：1688 订单编号有值但快递单号为空的记录
 */
router.get('/pending-records', async (req, res) => {
  try {
    // 获取飞书配置
    const config = await getFeishuConfig();
    if (!config) {
      return res.status(400).json({ success: false, error: '请先配置飞书' });
    }

    const accessToken = await getTenantAccessToken(config.app_id, config.app_secret);

    // 查询表格中待填写的记录（快递单号为空 + 1688 订单编号有值）
    const filter = JSON.stringify({
      conjunction: 'and',
      conditions: [
        { field_name: '快递单号', operator: 'isEmpty', value: [] },
        { field_name: '1688 订单编号', operator: 'isNotEmpty', value: [] },
      ],
    });
    const recordsUrl = `https://open.feishu.cn/open-apis/bitable/v1/apps/${config.app_token}/tables/${config.table_id}/records/search?page_size=500`;

    const recordsRes = await fetch(recordsUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ filter }),
    });

    const recordsData = await recordsRes.json() as { success: boolean; msg?: string; data?: { items?: Array<{ record_id: string; fields: Record<string, unknown> }>; records?: Array<{ record_id: string; fields: Record<string, unknown> }> } };
    if (!recordsData.success) {
      throw new Error(`查询记录失败：${recordsData.msg}`);
    }

    // 飞书 API 返回格式：data.records 或 data.items
    const items = recordsData.data?.records || recordsData.data?.items || [];
    const records = items.map(item => {
      // 1688 订单编号字段可能是数组格式：[{text: "xxx", type: "text"}]
      const orderField = item.fields['1688 订单编号'] || item.fields['1688订单编号'];
      let orderNumber = '';
      if (Array.isArray(orderField)) {
        orderNumber = orderField.map((f: any) => f.text || '').join('');
      } else if (typeof orderField === 'string') {
        orderNumber = orderField;
      }

      return {
        record_id: item.record_id,
        order_number: orderNumber,
      };
    });

    res.json({ success: true, data: { records, count: records.length } });
  } catch (err) {
    const message = err instanceof Error ? err.message : '获取待填写记录失败';
    res.status(500).json({ success: false, error: message });
  }
});
/**
 * 批量填写快递单号
 * POST /api/v1/feishu/batch-tracking
 * Body: trackingNumber: string
 */
router.post('/batch-tracking', async (req, res) => {
  try {
    const { trackingNumber } = req.body;

    if (!trackingNumber) {
      return res.status(400).json({ success: false, error: '请提供快递单号' });
    }

    // 获取飞书配置
    const config = await getFeishuConfig();
    if (!config) {
      return res.status(400).json({ success: false, error: '请先配置飞书' });
    }

    const accessToken = await getTenantAccessToken(config.app_id, config.app_secret);

    // 查询表格中需要更新的记录（快递单号为空 + 1688 订单编号有值）
    const filter = JSON.stringify({
      conjunction: 'and',
      conditions: [
        { field_name: '快递单号', operator: 'isEmpty', value: [] },
        { field_name: '1688 订单编号', operator: 'isNotEmpty', value: [] },
      ],
    });
    const recordsUrl = `https://open.feishu.cn/open-apis/bitable/v1/apps/${config.app_token}/tables/${config.table_id}/records/search?page_size=500`;
    const recordsRes = await fetch(recordsUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ filter }),
    });

    const recordsData = await recordsRes.json() as { success: boolean; msg?: string; data?: { items?: Array<{ record_id: string; fields: Record<string, unknown> }> } };
    if (!recordsData.success) {
      throw new Error(`查询记录失败: ${recordsData.msg}`);
    }

    const items = recordsData.data?.items || [];
    if (items.length === 0) {
      return res.json({ success: true, updated: 0, message: '没有需要更新的记录' });
    }

    // 批量更新快递单号
    const updateRecords = items.map((item: any) => ({
      record_id: item.record_id,
      fields: {
        '快递单号': trackingNumber,
      },
    }));

    const updateUrl = `https://open.feishu.cn/open-apis/bitable/v1/apps/${config.app_token}/tables/${config.table_id}/records/batch_update`;
    const updateRes = await fetch(updateUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ records: updateRecords }),
    });

    const updateData = await updateRes.json() as { success: boolean; msg?: string };
    if (!updateData.success) {
      throw new Error(`更新失败: ${updateData.msg}`);
    }

    res.json({
      success: true,
      updated: items.length,
      message: `成功填写${items.length}条记录`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : '批量填写失败';
    res.status(500).json({ success: false, error: message });
  }
});

/**
 * 删除飞书表格最后一条记录
 * POST /api/v1/feishu/delete-last
 */
router.post('/delete-last', async (req, res) => {
  try {
    const client = getSupabaseClient();
    const { data: config } = await client
      .from('feishu_config')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (!config) {
      throw new Error('请先配置飞书');
    }

    const tokenRes = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: config.app_id, app_secret: config.app_secret }),
    });
    const tokenData = await tokenRes.json() as { tenant_access_token?: string; code?: number; msg?: string };
    if (!tokenData.tenant_access_token) {
      throw new Error('获取飞书凭证失败');
    }
    const accessToken = tokenData.tenant_access_token;

    const listUrl = `https://open.feishu.cn/open-apis/bitable/v1/apps/${config.app_token}/tables/${config.table_id}/records?page_size=1&sort=[{"field_name":"ID","direction":"desc"}]`;
    const listRes = await fetch(listUrl, {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });
    const listData = await listRes.json() as { data?: { items?: Array<{ record_id: string }> }; success?: boolean; msg?: string };
    if (!listData.data?.items?.length) {
      throw new Error('没有可删除的记录');
    }

    const lastRecord = listData.data.items[0];
    const deleteUrl = `https://open.feishu.cn/open-apis/bitable/v1/apps/${config.app_token}/tables/${config.table_id}/records/${lastRecord.record_id}`;
    const deleteRes = await fetch(deleteUrl, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });
    const deleteData = await deleteRes.json() as { success: boolean; msg?: string };
    if (!deleteData.success) {
      throw new Error(`删除失败: ${deleteData.msg}`);
    }

    res.json({
      success: true,
      message: '删除成功',
      record_id: lastRecord.record_id,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : '删除失败';
    res.status(500).json({ success: false, error: message });
  }
});

export default router;
