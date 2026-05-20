import { NextRequest, NextResponse } from 'next/server';
import { ConfigService } from '@/services/ConfigService';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, adminId, beforeDate, filter } = body;

    if (!adminId) {
      return NextResponse.json({ error: '缺少 adminId' }, { status: 400 });
    }

    switch (action) {
      case 'archive':
        if (!beforeDate) {
          return NextResponse.json({ error: '缺少 beforeDate' }, { status: 400 });
        }
        await ConfigService.archiveData(new Date(beforeDate), adminId);
        return NextResponse.json({ success: true, message: '数据归档完成' });

      case 'backup':
        await ConfigService.backupDatabase(adminId);
        return NextResponse.json({ success: true, message: '备份已启动' });

      case 'logs':
        const logs = await ConfigService.getSystemLogs(filter || {}, adminId);
        return NextResponse.json(logs);

      default:
        return NextResponse.json({ error: '无效操作' }, { status: 400 });
    }
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
