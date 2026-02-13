import React, { useEffect, useMemo, useState } from 'react';

const API_BASE = '/EAS/api';
const GITHUB_USERNAME = (import.meta as any)?.env?.VITE_GITHUB_USERNAME || 'lello';

type Toast = { kind: 'ok' | 'err'; msg: string } | null;

type GitHubRepo = {
  id: number;
  name: string;
  full_name: string;
  html_url: string;
  description: string | null;
  fork: boolean;
  private: boolean;
  archived: boolean;
  language: string | null;
  stargazers_count: number;
  pushed_at: string | null;
  owner?: { login?: string };
};

async function jfetch(path: string, init?: RequestInit) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'content-type': 'application/json', ...(init?.headers || {}) },
    ...init
  });
  const txt = await res.text();
  const json = txt ? JSON.parse(txt) : null;
  if (!res.ok) {
    const msg = json?.error ? String(json.error) : `HTTP ${res.status}`;
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

  const [ghLoading, setGhLoading] = useState(false);
  const [ghError, setGhError] = useState<string | null>(null);
  const [ghRepos, setGhRepos] = useState<GitHubRepo[] | null>(null);

  const [schemaUri, setSchemaUri] = useState('ipfs://Qm.../schema.json');
  const [schemaRevocable, setSchemaRevocable] = useState(true);
  const [schemaExpiresAllowed, setSchemaExpiresAllowed] = useState(false);
  const [schemaAttesterMode, setSchemaAttesterMode] = useState<'0' | '1'>('0');
  const [schemaCreated, setSchemaCreated] = useState<any>(null);

  const [attSchemaId, setAttSchemaId] = useState('');
  const [attSubject, setAttSubject] = useState('');
  const [attPayload, setAttPayload] = useState('{"message":"hello soroban"}');
  const [attCreated, setAttCreated] = useState<any>(null);

  const [lookupId, setLookupId] = useState('');
  const [lookupResult, setLookupResult] = useState<any>(null);
  const [verifyResult, setVerifyResult] = useState<any>(null);

  const [subjectAddr, setSubjectAddr] = useState('');
  const [subjectList, setSubjectList] = useState<any>(null);

  const [revokeId, setRevokeId] = useState('');

  const clearToastSoon = () => setTimeout(() => setToast(null), 3500);

  useEffect(() => {
    let cancelled = false;

    async function loadRepos() {
      setGhError(null);
      setGhLoading(true);

      try {
        const cacheKey = `eas_gh_repos_${GITHUB_USERNAME}`;
        const cachedRaw = localStorage.getItem(cacheKey);
        if (cachedRaw) {
          const cached = JSON.parse(cachedRaw) as { ts: number; repos: GitHubRepo[] };
          if (cached?.ts && Array.isArray(cached?.repos) && Date.now() - cached.ts < 30 * 60 * 1000) {
            if (!cancelled) setGhRepos(cached.repos);
            return;
          }
        }

        const url = `https://api.github.com/users/${encodeURIComponent(GITHUB_USERNAME)}/repos?type=owner&sort=updated&per_page=100`;
        const res = await fetch(url, {
          headers: {
            accept: 'application/vnd.github+json'
          }
        });
        if (!res.ok) {
          throw new Error(`GitHub HTTP ${res.status}`);
        }
        const repos = (await res.json()) as GitHubRepo[];
        const onlyPublic = repos
          .filter((r) => !r.private)
          .filter((r) => !r.fork)
          .filter((r) => !r.archived)
          .filter((r) => (r.owner?.login ? r.owner.login.toLowerCase() === String(GITHUB_USERNAME).toLowerCase() : true))
          .sort((a, b) => String(b.pushed_at || '').localeCompare(String(a.pushed_at || '')));

        if (!cancelled) {
          setGhRepos(onlyPublic);
          localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), repos: onlyPublic }));
        }
      } catch (e: any) {
        if (!cancelled) setGhError(e?.message ? String(e.message) : 'Falha ao buscar repos do GitHub');
      } finally {
        if (!cancelled) setGhLoading(false);
      }
    }

    loadRepos();
    return () => {
      cancelled = true;
    };
  }, []);

  const toastEl = useMemo(() => {
    if (!toast) return null;
    return <div className={`toast ${toast.kind}`}>{toast.msg}</div>;
  }, [toast]);

  return (
    <div className="container">
      <div className="header">
        <div>
          <h1>EAS Soroban (MVP)</h1>
          <div className="subtitle">
            BasePath: <span className="pill">/EAS</span> API: <span className="pill">/EAS/api</span>
          </div>
        </div>
        <div className="headerLinks">
          <a
            className="linkPill"
            href={`https://github.com/${encodeURIComponent(GITHUB_USERNAME)}`}
            target="_blank"
            rel="noreferrer"
          >
            GitHub: @{GITHUB_USERNAME}
          </a>
        </div>
      </div>

      <div className="grid">
        <div className="card half">
          <h2>1) Criar Schema</h2>
          <div className="row">
            <div>
              <label>Schema URI (vai virar hash)</label>
              <input value={schemaUri} onChange={(e) => setSchemaUri(e.target.value)} />
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
                  setToast({ kind: 'ok', msg: `Schema criado: ${out.schemaId}` });
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
            {toastEl}
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
              <label>Payload (JSON) para sha256 off-chain</label>
              <textarea value={attPayload} onChange={(e) => setAttPayload(e.target.value)} />
            </div>
            <button
              onClick={async () => {
                setToast(null);
                setAttCreated(null);
                try {
                  const payload = JSON.parse(attPayload);
                  const out = await jfetch('/attestations', {
                    method: 'POST',
                    body: JSON.stringify({ schemaId: attSchemaId, subject: attSubject, payload, expirationLedger: null })
                  });
                  setAttCreated(out);
                  setLookupId(out.attestationId);
                  setRevokeId(out.attestationId);
                  setToast({ kind: 'ok', msg: `Atestado: ${out.attestationId}` });
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
            {toastEl}
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
            {toastEl}
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
                } catch (e: any) {
                  setToast({ kind: 'err', msg: `Erro: ${e.message}` });
                } finally {
                  clearToastSoon();
                }
              }}
            >
              Revogar
            </button>
            {toastEl}
          </div>
        </div>

        <div className="card">
          <h2>5) Listar Atestacoes por Subject</h2>
          <div className="row">
            <div className="row cols2">
              <div>
                <label>Subject</label>
                <input value={subjectAddr} onChange={(e) => setSubjectAddr(e.target.value)} placeholder="G..." />
              </div>
              <div style={{ alignSelf: 'end' }}>
                <button
                  onClick={async () => {
                    setToast(null);
                    setSubjectList(null);
                    try {
                      const out = await jfetch(`/subjects/${subjectAddr}/attestations`);
                      setSubjectList(out);
                      setToast({ kind: 'ok', msg: 'OK' });
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
            </div>
            {subjectList && (
              <div className="small">
                <pre>{pretty(subjectList)}</pre>
              </div>
            )}
            {toastEl}
          </div>
        </div>

        <div className="card">
          <h2>6) Listar Schemas</h2>
          <div className="row">
            <button
              onClick={async () => {
                setToast(null);
                try {
                  const out = await jfetch('/schemas');
                  setToast({ kind: 'ok', msg: `Schemas: ${out.schemas?.length ?? 0}` });
                  alert(pretty(out));
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
            {toastEl}
          </div>
        </div>

        <div className="card">
          <h2>Projetos Publicos (GitHub)</h2>
          <div className="row">
            <div className="small">
              Fonte: GitHub API. Mostra somente repos publicos, nao-archived e nao-fork, de autoria de <span className="pill">@{GITHUB_USERNAME}</span>.
            </div>
            {ghLoading && <div className="small">Carregando lista...</div>}
            {ghError && <div className="toast err">Erro GitHub: {ghError}</div>}
            {ghRepos && (
              <div className="repoList">
                {ghRepos.map((r) => (
                  <div className="repoItem" key={r.id}>
                    <div className="repoTop">
                      <a href={r.html_url} target="_blank" rel="noreferrer">
                        {r.name}
                      </a>
                      <div className="repoMeta">
                        {typeof r.stargazers_count === 'number' && r.stargazers_count > 0 ? (
                          <span className="repoBadge">★ {r.stargazers_count}</span>
                        ) : null}
                        {r.language ? <span className="repoBadge">{r.language}</span> : null}
                      </div>
                    </div>
                    {r.description ? <div className="small">{r.description}</div> : null}
                  </div>
                ))}
              </div>
            )}
            {ghRepos && ghRepos.length === 0 && <div className="small">Nenhum repo publico encontrado.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
