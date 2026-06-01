export type SendResult = { user_id: string; token: string; ok: boolean; errorCode?: string };
export type LogRow = { report_id: string; user_id: string; token: string; status: 'sent' | 'failed' };

export function buildLogRows(reportId: string, results: SendResult[]): LogRow[] {
  return results.map((r) => ({ report_id: reportId, user_id: r.user_id, token: r.token, status: r.ok ? 'sent' : 'failed' }));
}

const CLEANUP_CODES = new Set(['UNREGISTERED', 'INVALID_ARGUMENT']);
export function invalidTokensFrom(results: SendResult[]): string[] {
  return results.filter((r) => !r.ok && r.errorCode && CLEANUP_CODES.has(r.errorCode)).map((r) => r.token);
}

export function buildFcmMessage(token: string, report: { id: string; dogName: string }): Record<string, unknown> {
  return {
    message: {
      token,
      notification: { title: '우리 동네 실종견', body: `${report.dogName}를 찾고 있어요. 혹시 보셨나요?` },
      data: { type: 'missing_report', report_id: report.id },
    },
  };
}
