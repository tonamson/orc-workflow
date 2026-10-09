'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  parseRoutingPolicy,
  ROUTING_PROVIDERS,
  TASK_KINDS,
  type RoutingPolicy,
  type RoutingSettingsEnvelope,
  type TaskKind,
} from './routing-policy';
import './routing-settings.css';

const TASK_LABELS: Record<TaskKind, { title: string; description: string }> = {
  coding: { title: 'Coding', description: 'Thực hiện và sửa đổi mã nguồn' },
  planning: { title: 'Plan / spec', description: 'Lập kế hoạch, phân tích và đặc tả' },
  review: { title: 'Review / audit', description: 'Rà soát thay đổi và tìm vấn đề' },
};
const effortLabel = (value: string) => value === 'default' ? 'Mặc định CLI' : value;
type Readiness = { provider: RoutingPolicy['supervisor']['provider']; installed: boolean | null; version: string | null; authentication: 'authenticated' | 'unauthenticated' | 'unknown'; connectionVerified: boolean; testedAt: string; diagnostic: 'complete' | 'timeout' | 'failed'; error?: 'connection' | 'server' };
function readinessLabel(result: Readiness): string {
  if (result.error === 'connection') return 'Không kết nối được máy chủ kiểm tra. Thử lại.';
  if (result.error === 'server') return 'Máy chủ không kiểm tra được CLI. Thử lại.';
  if (result.installed === false) return 'Không tìm thấy CLI.';
  if (result.installed === null) return 'Chưa thể xác minh CLI.';
  if (result.provider === 'agy') {
    const cliStatus = result.version ? `CLI phản hồi · ${result.version}` : 'Đã tìm thấy CLI';
    if (result.connectionVerified) return `${cliStatus} · Kết nối đã xác minh`;
    const connectionStatus = result.diagnostic === 'timeout' ? 'Kết nối chưa xác minh · hết thời gian kiểm tra' : result.diagnostic === 'failed' ? 'Không xác minh được kết nối' : 'Kết nối chưa xác minh';
    return `${cliStatus} · ${connectionStatus}`;
  }
  if (result.version) {
    const authStatus = result.authentication === 'authenticated' ? 'Đã đăng nhập' : result.authentication === 'unauthenticated' ? 'Chưa đăng nhập' : result.diagnostic === 'timeout' ? 'Đăng nhập chưa xác minh · hết thời gian kiểm tra' : 'Đăng nhập chưa xác minh';
    return `CLI phản hồi · ${result.version} · ${authStatus}`;
  }
  const cliStatus = result.diagnostic === 'timeout' ? 'Lệnh kiểm tra CLI hết thời gian' : result.diagnostic === 'failed' ? 'Một phần kiểm tra CLI chưa hoàn tất' : 'Đã tìm thấy CLI';
  return `${cliStatus} · Đăng nhập chưa xác minh`;
}
const settingsErrorLabel = (code?: string) => {
  if (code === 'invalid_routing_settings') return 'Cấu hình không hợp lệ. Kiểm tra model và danh sách effort rồi thử lại.';
  if (code === 'invalid_routing_policy') return 'Máy chủ trả về cấu hình định tuyến không hợp lệ.';
  if (code === 'local_runtime_only') return 'Cài đặt runtime chỉ truy cập được từ máy local.';
  if (code === 'routing_settings_revision_conflict') return 'Cấu hình đã được lưu ở nơi khác. Tải lại phiên bản mới nhất trước khi tiếp tục.';
  return code ?? 'Không thể kết nối máy chủ cài đặt.';
};

export function RoutingSettings({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [saved, setSaved] = useState<RoutingSettingsEnvelope | null>(null);
  const [policy, setPolicy] = useState<RoutingPolicy | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [discardPrompt, setDiscardPrompt] = useState(false);
  const [modelResetNotice, setModelResetNotice] = useState(false);
  const [readiness, setReadiness] = useState<Record<string, Readiness>>({});
  const [checking, setChecking] = useState<Record<string, boolean>>({});
  const loadSequence = useRef(0);
  const loadController = useRef<AbortController | null>(null);
  const readinessSequence = useRef<Record<string, number>>({});
  const readinessControllers = useRef<Record<string, AbortController>>({});
  const readinessGeneration = useRef(0);
  const dirty = useMemo(() => !!saved && !!policy && JSON.stringify(saved.policy) !== JSON.stringify(policy), [saved, policy]);

  const checkProvider = async (provider: RoutingPolicy['supervisor']['provider']) => {
    readinessControllers.current[provider]?.abort();
    const controller = new AbortController();
    readinessControllers.current[provider] = controller;
    const sequence = (readinessSequence.current[provider] ?? 0) + 1;
    const generation = readinessGeneration.current;
    readinessSequence.current[provider] = sequence;
    setChecking(current => ({ ...current, [provider]: true }));
    try {
      const response = await fetch('/api/runtime/cli-readiness', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider }), signal: controller.signal });
      const body = await response.json() as Readiness & { error?: string };
      if (!response.ok) {
        if (readinessGeneration.current === generation && readinessSequence.current[provider] === sequence) setReadiness(current => ({ ...current, [provider]: { provider, installed: null, version: null, authentication: 'unknown', connectionVerified: false, testedAt: new Date().toISOString(), diagnostic: 'failed', error: 'server' } }));
        return;
      }
      if (!controller.signal.aborted && readinessGeneration.current === generation && readinessSequence.current[provider] === sequence) setReadiness(current => ({ ...current, [provider]: body }));
    } catch (cause) {
      if (controller.signal.aborted || readinessGeneration.current !== generation || readinessSequence.current[provider] !== sequence) return;
      setReadiness(current => ({ ...current, [provider]: { provider, installed: null, version: null, authentication: 'unknown', connectionVerified: false, testedAt: new Date().toISOString(), diagnostic: 'failed', error: cause instanceof TypeError ? 'connection' : 'server' } }));
    } finally {
      if (readinessGeneration.current === generation && readinessSequence.current[provider] === sequence) setChecking(current => ({ ...current, [provider]: false }));
    }
  };

  useEffect(() => {
    if (open) return;
    readinessGeneration.current += 1;
    for (const controller of Object.values(readinessControllers.current)) controller.abort();
    readinessControllers.current = {};
    readinessSequence.current = {};
    setChecking({});
  }, [open]);

  useEffect(() => () => { readinessGeneration.current += 1; for (const controller of Object.values(readinessControllers.current)) controller.abort(); }, []);

  const load = useCallback(async () => {
    loadController.current?.abort();
    const controller = new AbortController();
    loadController.current = controller;
    const sequence = ++loadSequence.current;
    setLoading(true); setError(''); setConflict(false);
    try {
      const response = await fetch('/api/runtime/settings', { cache: 'no-store', signal: controller.signal });
      const body = await response.json() as RoutingSettingsEnvelope & { error?: string };
      if (!response.ok) throw new Error(settingsErrorLabel(body.error) || 'Không tải được cấu hình định tuyến.');
      const parsed = parseRoutingPolicy(body.policy);
      if (sequence !== loadSequence.current) return;
      setSaved({ ...body, policy: parsed }); setPolicy(parsed); setDiscardPrompt(false);
      setModelResetNotice(false);
    } catch (cause) {
      if (controller.signal.aborted || sequence !== loadSequence.current) return;
      setError(cause instanceof TypeError ? 'Không kết nối được máy chủ cài đặt. Hãy kiểm tra kết nối rồi thử lại.' : cause instanceof Error ? settingsErrorLabel(cause.message) : 'Không tải được cấu hình định tuyến.');
    } finally { if (sequence === loadSequence.current) setLoading(false); }
  }, []);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open) {
      if (!element.open) element.showModal();
      setSaved(null); setPolicy(null);
      void load();
    } else {
      ++loadSequence.current;
      loadController.current?.abort();
      if (element.open) element.close();
    }
    return () => { ++loadSequence.current; loadController.current?.abort(); };
  }, [open, load]);

  const requestClose = () => {
    if (saving) return;
    if (dirty) { setDiscardPrompt(true); return; }
    onClose();
  };

  const save = async () => {
    if (!policy || !saved || saving) return;
    setSaving(true); setError(''); setConflict(false);
    try {
      const response = await fetch('/api/runtime/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedRevision: saved.revision, policy }) });
      const body = await response.json() as RoutingSettingsEnvelope & { error?: string };
      if (response.status === 409 || body.error === 'routing_settings_revision_conflict') { setConflict(true); setError(settingsErrorLabel(body.error)); return; }
      if (!response.ok) throw new Error(settingsErrorLabel(body.error) || 'Không lưu được cấu hình.');
      setSaved({ ...body, policy: parseRoutingPolicy(body.policy) }); setPolicy(parseRoutingPolicy(body.policy));
    } catch (cause) { setError(cause instanceof TypeError ? 'Không kết nối được máy chủ cài đặt. Cấu hình chưa được lưu; hãy thử lại.' : cause instanceof Error ? settingsErrorLabel(cause.message) : 'Không lưu được cấu hình.'); }
    finally { setSaving(false); }
  };

  const changeProfile = (kind: TaskKind, update: Partial<RoutingPolicy['profiles'][TaskKind]>) => {
    if (!policy) return;
    const current = policy.profiles[kind];
    const providerChanged = update.provider !== undefined && update.provider !== current.provider;
    const provider = ROUTING_PROVIDERS.find(item => item.id === (update.provider ?? current.provider));
    const nextEfforts = providerChanged ? provider?.efforts.slice(0, 2) ?? [] : current.allowedEfforts;
    if (providerChanged && current.model) setModelResetNotice(true);
    setPolicy({ ...policy, profiles: { ...policy.profiles, [kind]: { ...current, ...update, ...(providerChanged ? { model: null } : {}), allowedEfforts: update.allowedEfforts ?? nextEfforts } } });
  };

  return <dialog ref={dialog} className="routing-dialog" aria-labelledby="routing-title" onCancel={event => { if (saving || dirty) { event.preventDefault(); if (dirty) setDiscardPrompt(true); } else onClose(); }} onClose={() => { if (open) onClose(); }}>
    <div className="routing-layout">
      <header className="routing-header"><div><span className="routing-kicker">CẤU HÌNH TOÀN CỤC</span><h2 id="routing-title">Định tuyến agent</h2><p>Áp dụng cho tất cả workspace</p></div><button type="button" className="routing-icon-close" aria-label="Đóng cài đặt" onClick={requestClose}>×</button></header>
      <div className="routing-content">
        {loading && <p className="routing-state" role="status">Đang tải cấu hình…</p>}
        {!loading && policy && saved && <>
          <fieldset className="routing-form-controls" disabled={saving}>
            <section className="routing-supervisor"><div className="routing-section-heading"><div className="routing-title-logo"><ProviderLogo provider={policy.supervisor.provider}/><div><h3>Supervisor</h3><p>Điều phối nhiệm vụ và chọn nhóm tác vụ</p></div></div><label className="routing-fixed-effort">Effort cố định<select aria-label="Effort cố định của Supervisor" value={policy.supervisor.effort} onChange={event => setPolicy({ ...policy, supervisor: { ...policy.supervisor, effort: event.target.value } })}>{saved.providers.find(item => item.id === policy.supervisor.provider)?.efforts.map(effort => <option key={effort} value={effort}>{effortLabel(effort)}</option>)}</select></label></div>
              <div className="routing-fields"><ProviderSelect value={policy.supervisor.provider} providers={saved.providers} onChange={value => { const provider = saved.providers.find(item => item.id === value); if (policy.supervisor.model) setModelResetNotice(true); setPolicy({ ...policy, supervisor: { ...policy.supervisor, provider: value, model: null, effort: provider?.efforts.includes(policy.supervisor.effort) ? policy.supervisor.effort : provider?.efforts[0] ?? policy.supervisor.effort } }); }} /><label>Model ID<input value={policy.supervisor.model ?? ''} onChange={event => setPolicy({ ...policy, supervisor: { ...policy.supervisor, model: event.target.value || null } })} placeholder="Mặc định CLI" autoCapitalize="none" spellCheck={false}/></label></div>
            </section>
          <div className="routing-task-heading"><h3>Nhóm tác vụ</h3><span>3 cấu hình</span></div>
          <div className="routing-task-list">{TASK_KINDS.map(kind => {
            const profile = policy.profiles[kind];
            const provider = saved.providers.find(item => item.id === profile.provider);
            return <section className="routing-task-card" key={kind}><div className="routing-section-heading"><div><h3>{TASK_LABELS[kind].title}</h3><p>{TASK_LABELS[kind].description}</p></div><ProviderLogo provider={profile.provider}/></div>
              <div className="routing-fields"><ProviderSelect value={profile.provider} providers={saved.providers} onChange={value => changeProfile(kind, { provider: value })}/><label>Model ID<input value={profile.model ?? ''} onChange={event => changeProfile(kind, { model: event.target.value || null })} placeholder="Mặc định CLI" autoCapitalize="none" spellCheck={false}/></label></div>
              <fieldset className="routing-efforts"><legend>Effort Supervisor được chọn</legend><div>{provider?.efforts.length ? provider.efforts.map(effort => <label key={effort}><input type="checkbox" checked={profile.allowedEfforts.includes(effort)} disabled={profile.allowedEfforts.length === 1 && profile.allowedEfforts.includes(effort)} onChange={event => changeProfile(kind, { allowedEfforts: event.target.checked ? [...profile.allowedEfforts, effort] : profile.allowedEfforts.filter(value => value !== effort) })}/><span>{effortLabel(effort)}</span></label>) : <span className="routing-no-efforts">Provider chưa khai báo effort.</span>}</div></fieldset>
            </section>;
          })}</div>
          </fieldset>
          <section className="routing-readiness" aria-labelledby="routing-readiness-title"><div><h3 id="routing-readiness-title">Kiểm tra CLI</h3><p>Kiểm tra CLI và kết nối hiện có trên máy chủ.</p></div>
            {[...new Set([policy.supervisor.provider, ...TASK_KINDS.map(kind => policy.profiles[kind].provider)])].map(provider => <div className="routing-readiness-row" key={provider}><div><strong>{ROUTING_PROVIDERS.find(item => item.id === provider)?.label}</strong>{readiness[provider] && <p role="status">{readinessLabel(readiness[provider])}</p>}{readiness[provider] && <small>Đã kiểm tra {new Date(readiness[provider].testedAt).toLocaleString()}</small>}</div><button type="button" className="routing-readiness-button" disabled={checking[provider]} onClick={() => void checkProvider(provider)}>{checking[provider] ? 'Đang kiểm tra…' : readiness[provider] ? 'Kiểm tra lại' : provider === 'agy' ? 'Kiểm tra kết nối' : 'Kiểm tra CLI'}</button></div>)}
          </section>
          {modelResetNotice && <p className="routing-model-reset" role="status">Đã xóa model ID khi đổi provider để dùng model mặc định của provider mới.</p>}
        </>}
        {error && <div className="routing-error" role="alert">{error}{conflict ? <button type="button" onClick={() => { setSaved(null); setPolicy(null); void load(); }}>Tải cấu hình mới</button> : !saved && <button type="button" onClick={() => void load()}>Thử tải lại</button>}</div>}
      </div>
      {discardPrompt && <div className="routing-discard" role="alertdialog" aria-label="Bỏ thay đổi chưa lưu"><span>Có thay đổi chưa lưu.</span><button type="button" onClick={() => setDiscardPrompt(false)}>Tiếp tục sửa</button><button type="button" className="routing-discard-confirm" onClick={() => { setDiscardPrompt(false); setSaved(null); setPolicy(null); onClose(); }}>Bỏ thay đổi</button></div>}
      <footer className="routing-footer"><span className="routing-revision">{saved ? dirty ? `Phiên bản ${saved.revision} · Chưa lưu` : saved.configured ? `Đã lưu · phiên bản ${saved.revision}` : 'Chưa lưu cấu hình' : 'Cài đặt'}</span><div><button type="button" className="routing-close" onClick={requestClose} disabled={saving}>Đóng</button><button type="button" className="routing-save" onClick={() => void save()} disabled={!saved || !policy || (saved.configured && !dirty) || saving || loading}>{saving ? 'Đang lưu…' : 'Lưu cấu hình'}</button></div></footer>
    </div>
  </dialog>;
}

function ProviderSelect({ value, providers, onChange }: { value: RoutingPolicy['supervisor']['provider']; providers: RoutingSettingsEnvelope['providers']; onChange: (value: RoutingPolicy['supervisor']['provider']) => void }) {
  return <label>Provider<select value={value} onChange={event => onChange(event.target.value as RoutingPolicy['supervisor']['provider'])}>{providers.map(provider => <option key={provider.id} value={provider.id}>{provider.id === 'agy' ? 'AGY / Antigravity' : provider.label}</option>)}</select></label>;
}

function ProviderLogo({ provider }: { provider: RoutingPolicy['supervisor']['provider'] }) {
  const image = provider === 'agy' ? 'gemini' : provider;
  return <span className="routing-provider-logo"><img src={`/cli/${image}.svg`} alt=""/><span>{provider === 'agy' ? 'AGY / Antigravity' : ROUTING_PROVIDERS.find(item => item.id === provider)?.label}</span></span>;
}
