import React, { useEffect, useMemo, useState } from 'react';

const API_BASE = '/EAS/api';

type Toast = { kind: 'ok' | 'err'; msg: string } | null;

async function jfetch(path: string, init?: RequestInit) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'content-type': 'application/json', ...(init?.headers || {}) },
    ...init
  });
  const txt = await res.text();
  let json: any = null;
  try {
    json = txt ? JSON.parse(txt) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    // Fastify default error shape: { error: 'Internal Server Error', message: '...' }
    const msg =
      (json?.message ? String(json.message) : json?.error ? String(json.error) : `HTTP ${res.status}`) ||
      `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return json;
}

function pretty(v: unknown) {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

export default function App() {
  const [toast, setToast] = useState<Toast>(null);

  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    const saved = localStorage.getItem('eas_theme');
    if (saved === 'dark' || saved === 'light') return saved;
    return window.matchMedia?.('(prefers-color-scheme: light)')?.matches ? 'light' : 'dark';
  });

  const [schemaUri, setSchemaUri] = useState('');
  const [schemaRevocable, setSchemaRevocable] = useState(true);
  const [schemaExpiresAllowed, setSchemaExpiresAllowed] = useState(false);
  const [schemaAttesterMode, setSchemaAttesterMode] = useState<'0' | '1'>('0');
  const [schemaCreated, setSchemaCreated] = useState<any>(null);

  const [attSchemaId, setAttSchemaId] = useState('');
  const [attSubject, setAttSubject] = useState('');
  const [attMessage, setAttMessage] = useState('');
  const [attCreated, setAttCreated] = useState<any>(null);

  const [lookupId, setLookupId] = useState('');
  const [lookupResult, setLookupResult] = useState<any>(null);
  const [verifyResult, setVerifyResult] = useState<any>(null);

  const [subjectAddr, setSubjectAddr] = useState('');
  const [subjectList, setSubjectList] = useState<any>(null);

  const [revokeId, setRevokeId] = useState('');

  const [schemasList, setSchemasList] = useState<any>(null);

  const clearToastSoon = () => setTimeout(() => setToast(null), 3500);

  const toastEl = useMemo(() => {
    if (!toast) return null;
    return <div className={`toast ${toast.kind}`}>{toast.msg}</div>;
  }, [toast]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('eas_theme', theme);
  }, [theme]);

  return (
    <div className="container">
      <div className="header">
        <div>
          <h1>EAS Soroban (MVP)</h1>
        </div>
        <button
          type="button"
          className="themeToggle"
          onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
        >
          Tema: {theme === 'dark' ? 'Escuro' : 'Claro'}
        </button>
      </div>

      {toastEl}

      <div className="grid">
        <div className="card half">
          <h2>1) Criar Schema</h2>
          <div className="row">
            <div>
              <label htmlFor="schemaUri">Schema URI (vai virar hash)</label>
              <input
                id="schemaUri"
                value={schemaUri}
                placeholder="https://seusite.com/schema.json (ou ipfs://...)"
                onFocus={(e) => e.currentTarget.select()}
                onChange={(e) => setSchemaUri(e.target.value)}
              />
            </div>
            <div className="row cols3">
              <div>
                <label>Revogavel?</label>
                <select value={schemaRevocable ? '1' : '0'} onChange={(e) => setSchemaRevocable(e.target.value === '1')}>
                  <option value="1">Sim</option>
                  <option value="0">Nao</option>
                </select>
              </div>
              <div>
                <label>Permite expirar?</label>
                <select value={schemaExpiresAllowed ? '1' : '0'} onChange={(e) => setSchemaExpiresAllowed(e.target.value === '1')}>
                  <option value="1">Sim</option>
                  <option value="0">Nao</option>
                </select>
              </div>
              <div>
                <label>Modo attester</label>
                <select value={schemaAttesterMode} onChange={(e) => setSchemaAttesterMode(e.target.value as any)}>
                  <option value="0">permissionless</option>
                  <option value="1">issuer_only</option>
                </select>
              </div>
            </div>

            <button
              onClick={async () => {
                setToast(null);
                setSchemaCreated(null);
                if (!schemaUri.trim()) {
                  setToast({ kind: 'err', msg: 'Informe uma URL/URI para o schema.' });
                  clearToastSoon();
                  return;
                }
                try {
                  const out = await jfetch('/schemas', {
                    method: 'POST',
                    body: JSON.stringify({
                      schemaUri,
                      revocable: schemaRevocable,
                      expiresAllowed: schemaExpiresAllowed,
                      attesterMode: Number(schemaAttesterMode)
                    })
                  });
                  setSchemaCreated(out);
                  setAttSchemaId(out.schemaId);
                  setToast({ kind: 'ok', msg: out.existed ? `Schema ja existe: ${out.schemaId}` : `Schema criado: ${out.schemaId}` });
                  setSchemaUri('');
                } catch (e: any) {
                  setToast({ kind: 'err', msg: `Erro: ${e.message}` });
                } finally {
                  clearToastSoon();
                }
              }}
            >
              Criar schema
            </button>
            {schemaCreated && (
              <div className="small">
                <pre>{pretty(schemaCreated)}</pre>
              </div>
            )}
          </div>
        </div>

        <div className="card half">
          <h2>2) Emitir Atestacao</h2>
          <div className="row">
            <div className="row cols2">
              <div>
                <label>Schema ID (hex 32 bytes)</label>
                <input value={attSchemaId} onChange={(e) => setAttSchemaId(e.target.value)} placeholder="64 hex" />
              </div>
              <div>
                <label>Subject (G... ou C...)</label>
                <input value={attSubject} onChange={(e) => setAttSubject(e.target.value)} placeholder="G..." />
              </div>
            </div>
            <div>
              <label>Mensagem</label>
              <textarea
                value={attMessage}
                placeholder="Digite somente a mensagem (sem JSON)"
                onChange={(e) => setAttMessage(e.target.value)}
              />
            </div>
            <button
              onClick={async () => {
                setToast(null);
                setAttCreated(null);
                try {
                  if (!attSchemaId.trim() || !attSubject.trim()) {
                    throw new Error('Informe Schema ID e Subject.');
                  }
                  if (!attMessage.trim()) {
                    throw new Error('Informe a mensagem.');
                  }
                  const payload = { message: attMessage };
                  const out = await jfetch('/attestations', {
                    method: 'POST',
                    body: JSON.stringify({ schemaId: attSchemaId, subject: attSubject, payload, expirationLedger: null })
                  });
                  setAttCreated(out);
                  setLookupId(out.attestationId);
                  setRevokeId(out.attestationId);
                  setToast({ kind: 'ok', msg: `Atestado: ${out.attestationId}` });
                  setAttSubject('');
                  setAttMessage('');
                } catch (e: any) {
                  setToast({ kind: 'err', msg: `Erro: ${e.message}` });
                } finally {
                  clearToastSoon();
                }
              }}
            >
              Atestar
            </button>

            {attCreated && (
              <div className="small">
                <pre>{pretty(attCreated)}</pre>
              </div>
            )}
          </div>
        </div>

        <div className="card half">
          <h2>3) Consultar + Verificar</h2>
          <div className="row">
            <div>
              <label>Attestation ID</label>
              <input value={lookupId} onChange={(e) => setLookupId(e.target.value)} />
            </div>
            <div className="row cols2">
              <button
                onClick={async () => {
                  setToast(null);
                  setLookupResult(null);
                  try {
                    const out = await jfetch(`/attestations/${lookupId}`);
                    setLookupResult(out);
                    setToast({ kind: 'ok', msg: 'OK (Postgres)' });
                  } catch (e: any) {
                    setToast({ kind: 'err', msg: `Erro: ${e.message}` });
                  } finally {
                    clearToastSoon();
                  }
                }}
              >
                Buscar (DB)
              </button>
              <button
                onClick={async () => {
                  setToast(null);
                  setVerifyResult(null);
                  try {
                    const out = await jfetch(`/verify/${lookupId}`);
                    setVerifyResult(out);
                    setToast({ kind: 'ok', msg: 'OK (Soroban)' });
                  } catch (e: any) {
                    setToast({ kind: 'err', msg: `Erro: ${e.message}` });
                  } finally {
                    clearToastSoon();
                  }
                }}
              >
                Verificar (on-chain)
              </button>
            </div>

            {lookupResult && (
              <div className="small">
                <div className="pill">Postgres</div>
                <pre>{pretty(lookupResult)}</pre>
              </div>
            )}
            {verifyResult && (
              <div className="small">
                <div className="pill">Soroban</div>
                <pre>{pretty(verifyResult)}</pre>
              </div>
            )}
          </div>
        </div>

        <div className="card half">
          <h2>4) Revogar</h2>
          <div className="row">
            <div>
              <label>Attestation ID</label>
              <input value={revokeId} onChange={(e) => setRevokeId(e.target.value)} />
            </div>
            <button
              className="danger"
              onClick={async () => {
                setToast(null);
                try {
                  await jfetch(`/attestations/${revokeId}/revoke`, { method: 'POST', body: '{}' });
                  setToast({ kind: 'ok', msg: 'Revogado' });
                  setRevokeId('');
                } catch (e: any) {
                  setToast({ kind: 'err', msg: `Erro: ${e.message}` });
                } finally {
                  clearToastSoon();
                }
              }}
            >
              Revogar
            </button>
          </div>
        </div>

        <div className="card">
          <h2>5) Listar Atestacoes por Subject</h2>
          <div className="row">
            <div className="row cols1auto">
              <div>
                <label>Subject</label>
                <input value={subjectAddr} onChange={(e) => setSubjectAddr(e.target.value)} placeholder="G..." />
              </div>
              <button
                style={{ alignSelf: 'end' }}
                onClick={async () => {
                  setToast(null);
                  setSubjectList(null);
                  try {
                    const out = await jfetch(`/subjects/${subjectAddr}/attestations`);
                    setSubjectList(out);
                    setToast({ kind: 'ok', msg: 'OK' });
                    setSubjectAddr('');
                  } catch (e: any) {
                    setToast({ kind: 'err', msg: `Erro: ${e.message}` });
                  } finally {
                    clearToastSoon();
                  }
                }}
              >
                Buscar
              </button>
            </div>
            {subjectList && (
              <div className="small">
                <pre>{pretty(subjectList)}</pre>
              </div>
            )}
          </div>
        </div>

        <div className="card">
          <h2>6) Listar Schemas</h2>
          <div className="row">
            <button
              onClick={async () => {
                setToast(null);
                setSchemasList(null);
                try {
                  const out = await jfetch('/schemas');
                  setSchemasList(out);
                  setToast({ kind: 'ok', msg: `Schemas: ${out.schemas?.length ?? 0}` });
                } catch (e: any) {
                  setToast({ kind: 'err', msg: `Erro: ${e.message}` });
                } finally {
                  clearToastSoon();
                }
              }}
            >
              Atualizar lista
            </button>
            <div className="small">Dica: a lista vem do Postgres (indexer + inserts do API).</div>
            {schemasList && (
              <div className="small">
                <pre>{pretty(schemasList)}</pre>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
