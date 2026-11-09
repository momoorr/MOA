// MOA operator API (separate from moa-inquiry-api / Make ingestion).
// No public data access: validated Supabase user JWT + allowlisted Auth user UUID.
// The service-role client is created ONLY within this server function.
import { createClient } from 'npm:@supabase/supabase-js@2.119.0';

type Row = {
  id: number;
  source_ref: string | null;
  inquiry_text: string;
  ai_category: string | null;
  ai_next_action: string | null;
  ai_guide_id: string | null;
  ai_guide_version: string | null;
  ai_draft: string | null;
  ai_reason: string | null;
  review_status: string;
  reviewed_draft: string | null;
  review_note: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
};

const COLUMNS = 'id,source_ref,inquiry_text,ai_category,ai_next_action,ai_guide_id,ai_guide_version,ai_draft,ai_reason,review_status,reviewed_draft,review_note,reviewed_at,created_at,updated_at';
const allowedOrigins = (Deno.env.get('MOA_ALLOWED_ORIGINS') || 'http://localhost:8765,http://127.0.0.1:8765')
  .split(',').map(s => s.trim()).filter(Boolean);

function cors(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') || '';
  return origin && allowedOrigins.includes(origin)
    ? {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
      'Vary': 'Origin'
    }
    : {'Vary': 'Origin'};
}
function json(req: Request, body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { ...cors(req), 'Cache-Control': 'no-store' } });
}
function secretKey(name: 'SUPABASE_PUBLISHABLE_KEYS' | 'SUPABASE_SECRET_KEYS'): string {
  try {
    const parsed = JSON.parse(Deno.env.get(name) ?? '{}');
    return typeof parsed.default === 'string' ? parsed.default : '';
  } catch (_) { return ''; }
}
function stringField(v: unknown, max: number): string | null {
  if (typeof v !== 'string' || v.length > max) return null;
  return v.trim();
}

export default {
  fetch: async (req: Request): Promise<Response> => {
    const origin = req.headers.get('origin') || '';
    if (origin && !allowedOrigins.includes(origin)) return json(req, { error: 'Origin not allowed' }, 403);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
    if (req.method !== 'GET' && req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405);

    // Fail closed until the owner sets an exact Supabase Auth User UUID in Secrets.
    const operatorId = Deno.env.get('MOA_OPERATOR_USER_ID')?.trim();
    const projectUrl = Deno.env.get('SUPABASE_URL') || '';
    const publicKey = secretKey('SUPABASE_PUBLISHABLE_KEYS') || Deno.env.get('SUPABASE_ANON_KEY') || '';
    const adminKey = secretKey('SUPABASE_SECRET_KEYS') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    if (!operatorId || !projectUrl || !publicKey || !adminKey) {
      return json(req, { error: 'Operator API not configured' }, 503);
    }

    const bearer = req.headers.get('authorization') || '';
    if (!bearer.startsWith('Bearer ') || bearer.length > 5000) return json(req, { error: 'Unauthorized' }, 401);
    const token = bearer.slice(7);
    const authClient = createClient(projectUrl, publicKey, {auth: {persistSession: false, autoRefreshToken: false}});
    const { data: userData, error: userError } = await authClient.auth.getUser(token);
    if (userError || !userData?.user) return json(req, { error: 'Unauthorized' }, 401);
    if (userData.user.id !== operatorId || !userData.user.email_confirmed_at) {
      return json(req, { error: 'Operator access denied' }, 403);
    }

    // Elevated credentials never leave the Edge Function and are never sent to browsers or Make.
    const admin = createClient(projectUrl, adminKey, {auth: {persistSession: false, autoRefreshToken: false}});
    if (req.method === 'GET') {
      const { data, error } = await admin.from('moa_inquiries')
        .select(COLUMNS).order('created_at', {ascending: false}).limit(50);
      if (error) return json(req, { error: 'Read failed', code: error.code }, 500);
      return json(req, { items: data ?? [] });
    }

    const contentLength = Number(req.headers.get('content-length') || '0');
    if (contentLength > 10000) return json(req, {error:'Body too large'}, 413);
    let body: Record<string, unknown>;
    try {
      const raw = await req.text();
      if (raw.length > 10000) return json(req, {error:'Body too large'}, 413);
      const value = JSON.parse(raw);
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid JSON');
      body = value;
    } catch (_) { return json(req, {error:'Invalid JSON'}, 400); }

    const id = body.id;
    const action = body.action;
    const expected = body.expected_updated_at;
    const draft = stringField(body.reviewed_draft, 600);
    const note = stringField(body.review_note, 300);
    if (!Number.isSafeInteger(id) || Number(id) < 1 ||
        !['save', 'request_info', 'approve', 'complete'].includes(String(action)) ||
        typeof expected !== 'string' || expected.length > 80 || draft === null || note === null) {
      return json(req, { error: 'Invalid review input' }, 400);
    }

    const {data: prior, error: readErr} = await admin.from('moa_inquiries')
      .select(COLUMNS).eq('id', id).maybeSingle();
    if (readErr) return json(req, {error:'Read failed', code: readErr.code}, 500);
    if (!prior) return json(req, {error:'Not found'}, 404);
    const row = prior as Row;
    if (row.updated_at !== expected) return json(req, {error:'Record changed; refresh and retry'}, 409);

    const candidate = row.ai_category === '공통 안내' &&
      row.ai_next_action === 'USE_APPROVED_GUIDE' &&
      !!row.ai_guide_id && !!row.ai_draft;
    const now = new Date().toISOString();
    let fields: Record<string, unknown>;

    if (action === 'save') {
      if (candidate && draft.length < 5) return json(req, {error:'Answer must be at least 5 characters'}, 400);
      fields = {reviewed_draft: draft || null, review_note: note || null,
        review_status: '검토 중', reviewed_at: now, updated_at: now};
    } else if (action === 'request_info') {
      if (row.review_status === '처리 완료') return json(req, {error:'Completed inquiry cannot be reopened here'}, 409);
      fields = {reviewed_draft: null, review_note: note || null,
        review_status: '추가 확인 요청', reviewed_at: now, updated_at: now};
    } else if (action === 'approve') {
      if (!candidate || row.review_status !== '검토 중' || !row.reviewed_draft ||
          body.source_confirmed !== true || draft !== row.reviewed_draft || note !== (row.review_note ?? '')) {
        return json(req, {error:'Approval requirements not met'}, 409);
      }
      // Approval records human attestation, not independently verified external policy.
      fields = {review_status: '승인됨', reviewed_at: now, updated_at: now};
    } else {
      if (row.review_status !== '승인됨' || !row.reviewed_draft ||
          draft !== row.reviewed_draft || note !== (row.review_note ?? '')) {
        return json(req, {error:'Complete requires prior approval'}, 409);
      }
      fields = {review_status: '처리 완료', reviewed_at: now, updated_at: now};
    }

    // Optimistic concurrency: don't overwrite another review made after the displayed version.
    const {data: updated, error: writeErr} = await admin.from('moa_inquiries')
      .update(fields).eq('id', id).eq('updated_at', expected).select(COLUMNS).maybeSingle();
    if (writeErr) return json(req, {error:'Review write failed', code:writeErr.code}, 500);
    if (!updated) return json(req, {error:'Record changed; refresh and retry'}, 409);
    return json(req, {item: updated});
  }
};
