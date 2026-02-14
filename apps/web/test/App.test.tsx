import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../src/App';

function mockFetchOnce(json: any, ok = true, status = 200) {
  const text = async () => JSON.stringify(json);
  (globalThis as any).fetch = vi.fn(async () => ({ ok, status, text }));
}

describe('<App />', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders the main sections', () => {
    render(<App />);

    expect(screen.getByText('EAS Soroban (MVP)')).toBeInTheDocument();
    expect(screen.getByText('1) Criar Schema')).toBeInTheDocument();
    expect(screen.getByText('2) Emitir Atestacao')).toBeInTheDocument();
    expect(screen.getByText('3) Consultar + Verificar')).toBeInTheDocument();
    expect(screen.getByText('4) Revogar')).toBeInTheDocument();
    expect(screen.getByText('5) Listar Atestacoes por Subject')).toBeInTheDocument();
    expect(screen.getByText('6) Listar Schemas')).toBeInTheDocument();
  });

  it('creates a schema and shows the response', async () => {
    mockFetchOnce({ schemaId: 'a'.repeat(64), schemaUriHash: 'b'.repeat(64) });
    const user = userEvent.setup();

    render(<App />);

    // Some React/Vitest setups can mount twice in dev-like mode; click the first match.
    await user.click(screen.getAllByRole('button', { name: 'Criar schema' })[0]);

    // Toast
    const toasts = await screen.findAllByText(/^Schema criado:/);
    expect(toasts.length).toBeGreaterThan(0);

    // Response is rendered (pre)
    expect(screen.getByText(/"schemaId":/)).toBeInTheDocument();
    expect((globalThis as any).fetch).toHaveBeenCalledWith(
      '/EAS/api/schemas',
      expect.objectContaining({ method: 'POST' })
    );
  });
});
