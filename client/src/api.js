const BASE_URL = '';

function getToken() {
  return localStorage.getItem('allstar_token');
}

function authHeaders() {
  const token = getToken();
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function authHeadersNoContentType() {
  const token = getToken();
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

// Central fetch wrapper — auto-logout on 401
async function apiFetch(url, options = {}) {
  const res = await fetch(url, options);
  if (res.status === 401) {
    localStorage.removeItem('allstar_token');
    localStorage.removeItem('allstar_current_plan');
    window.location.href = '/login';
    throw new Error('Session expired. Please log in again.');
  }
  return res;
}

export async function login(username, password) {
  const res = await fetch(`${BASE_URL}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Login failed');
  return data;
}

export async function logout() {
  const res = await fetch(`${BASE_URL}/api/logout`, {
    method: 'POST',
    headers: authHeaders(),
  });
  return res.json();
}

export async function getMe() {
  const res = await apiFetch(`${BASE_URL}/api/me`, {
    headers: authHeaders(),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to get user');
  return data;
}

export async function getGenerationStatus() {
  const res = await apiFetch(`${BASE_URL}/api/generate/status`, { headers: authHeaders() });
  return res.json();
}

export async function generatePlan(notes, clientInfo, onChunk, onProgress, signal, uploadedFileIds) {
  const res = await fetch(`${BASE_URL}/api/generate`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ notes, clientInfo, uploadedFileIds }),
    signal,
  });
  if (!res.ok) {
    let errMsg = 'Failed to generate plan';
    try { const d = await res.json(); errMsg = d.error || errMsg; } catch {}
    throw new Error(errMsg);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result = null;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const jsonStr = line.slice(6).trim();
        if (!jsonStr) continue;
        let evt;
        try { evt = JSON.parse(jsonStr); } catch { continue; }
        if (evt.type === 'chunk' && onChunk) onChunk(evt.text);
        if (evt.type === 'progress' && onProgress) onProgress({ section: evt.section, total: evt.total, label: evt.label });
        if (evt.type === 'done') result = { plan_id: evt.plan_id, client_name: evt.client_name };
        if (evt.type === 'error') throw new Error(evt.error || 'Generation failed');
      }
    }
  } catch (err) {
    reader.cancel();
    throw err;
  }
  if (!result) throw new Error('Failed to generate plan');
  return result;
}

export async function revisePlan(plan_id, feedback, onChunk) {
  const res = await fetch(`${BASE_URL}/api/revise`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ plan_id, feedback }),
  });
  if (!res.ok) {
    let errMsg = 'Failed to revise plan';
    try { const d = await res.json(); errMsg = d.error || errMsg; } catch {}
    throw new Error(errMsg);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let revision_number = null;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const jsonStr = line.slice(6).trim();
      if (!jsonStr) continue;
      let evt;
      try { evt = JSON.parse(jsonStr); } catch { continue; }
      if (evt.type === 'chunk' && onChunk) onChunk(evt.text);
      if (evt.type === 'done') revision_number = evt.revision_number;
      if (evt.type === 'error') throw new Error(evt.error || 'Revision failed');
    }
  }
  if (revision_number == null) throw new Error('Revision stream ended without confirmation. Please try again.');
  return { revision_number };
}

export async function getPlanRevisions(plan_id) {
  const res = await apiFetch(`${BASE_URL}/api/plan/${plan_id}/revisions`, {
    headers: authHeaders(),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Failed to get revisions (${res.status})`);
  return data;
}

export async function uploadFile(file) {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(`${BASE_URL}/api/upload`, {
    method: 'POST',
    headers: authHeadersNoContentType(),
    body: formData,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to upload file');
  return data;
}

export async function preview97155Report(file) {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(`${BASE_URL}/api/reports/97155/preview`, {
    method: 'POST',
    headers: authHeadersNoContentType(),
    body: formData,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to preview 97155 report');
  return data;
}

export async function export97155Report(file) {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(`${BASE_URL}/api/reports/97155/export`, {
    method: 'POST',
    headers: authHeadersNoContentType(),
    body: formData,
  });
  if (!res.ok) {
    let data = {};
    try { data = await res.json(); } catch {}
    throw new Error(data.error || 'Failed to export 97155 report');
  }
  const disposition = res.headers.get('Content-Disposition') || '';
  const match = disposition.match(/filename=\"?([^"]+)\"?/i);
  const filename = match ? match[1] : '97155-report-styled.xlsx';
  const blob = await res.blob();
  return { blob, filename };
}

export async function getPrompt() {
  const res = await fetch(`${BASE_URL}/api/prompt`, {
    headers: authHeaders(),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to get prompt');
  return data;
}

export async function updatePrompt(text, label) {
  const res = await fetch(`${BASE_URL}/api/prompt`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({ text, label }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to update prompt');
  return data;
}

export async function getPromptHistory() {
  const res = await fetch(`${BASE_URL}/api/prompt/history`, {
    headers: authHeaders(),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to get prompt history');
  return data;
}

export async function restorePrompt(id) {
  const res = await fetch(`${BASE_URL}/api/prompt/restore/${id}`, {
    method: 'POST',
    headers: authHeaders(),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to restore prompt');
  return data;
}

export async function getUsers() {
  const res = await fetch(`${BASE_URL}/api/users`, {
    headers: authHeaders(),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to get users');
  return data;
}

export async function createUser(username, password, role) {
  const res = await fetch(`${BASE_URL}/api/users`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ username, password, role }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to create user');
  return data;
}

export async function deleteUser(id) {
  const res = await fetch(`${BASE_URL}/api/users/${id}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to delete user');
  return data;
}

export function getExportUrl(plan_id, revision_number) {
  return `${BASE_URL}/api/export/${plan_id}/${revision_number}`;
}

export async function getPlans() {
  const res = await apiFetch(`${BASE_URL}/api/plans`, { headers: authHeaders() });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to get plans');
  return data;
}

export async function getPlan(id) {
  const res = await fetch(`${BASE_URL}/api/plans/${id}`, { headers: authHeaders() });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to get plan');
  return data;
}

export async function duplicatePlan(id) {
  const res = await fetch(`${BASE_URL}/api/plans/${id}/duplicate`, {
    method: 'POST',
    headers: authHeaders(),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to duplicate plan');
  return data;
}

export async function getClients() {
  const res = await fetch(`${BASE_URL}/api/clients`, { headers: authHeaders() });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed');
  return data;
}

export async function getClient(id) {
  const res = await fetch(`${BASE_URL}/api/clients/${id}`, { headers: authHeaders() });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed');
  return data;
}

export async function updateClientStatus(id, status) {
  const res = await fetch(`${BASE_URL}/api/clients/${id}/status`, { method: 'PUT', headers: authHeaders(), body: JSON.stringify({ status }) });
  return res.json();
}

export async function updateClientNotes(id, notes) {
  const res = await fetch(`${BASE_URL}/api/clients/${id}/notes`, { method: 'PUT', headers: authHeaders(), body: JSON.stringify({ notes }) });
  return res.json();
}

export async function deleteClient(id) {
  const res = await fetch(`${BASE_URL}/api/clients/${id}`, { method: 'DELETE', headers: authHeaders() });
  return res.json();
}

export async function getClientDocuments(id, periodId) {
  const url = periodId
    ? `${BASE_URL}/api/clients/${id}/documents?period_id=${periodId}`
    : `${BASE_URL}/api/clients/${id}/documents`;
  const res = await fetch(url, { headers: authHeaders() });
  return res.json();
}

export async function uploadClientDocument(id, file, periodId = null) {
  const formData = new FormData();
  formData.append('file', file);
  if (periodId) formData.append('authorization_period_id', periodId);
  const res = await fetch(`${BASE_URL}/api/clients/${id}/documents`, { method: 'POST', headers: authHeadersNoContentType(), body: formData });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Upload failed');
  return data;
}

export async function getAuthPeriods(id) {
  const res = await fetch(`${BASE_URL}/api/clients/${id}/auth-periods`, { headers: authHeaders() });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed');
  return data;
}

export async function createAuthPeriod(id, body) {
  const res = await fetch(`${BASE_URL}/api/clients/${id}/auth-periods`, { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed');
  return data;
}

export async function updateAuthPeriod(id, periodId, body) {
  const res = await fetch(`${BASE_URL}/api/clients/${id}/auth-periods/${periodId}`, { method: 'PUT', headers: authHeaders(), body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed');
  return data;
}

export async function startReauth(clientId, periodId) {
  const res = await fetch(`${BASE_URL}/api/clients/${clientId}/auth-periods/${periodId}/start-reauth`, {
    method: 'POST',
    headers: authHeaders(),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to start reauth');
  return data;
}

export async function deleteClientDocument(id, docId) {
  const res = await fetch(`${BASE_URL}/api/clients/${id}/documents/${docId}`, { method: 'DELETE', headers: authHeaders() });
  return res.json();
}

export async function extractDocumentText(id, docId) {
  const res = await fetch(`${BASE_URL}/api/clients/${id}/documents/${docId}/extract`, { method: 'POST', headers: authHeaders() });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Extract failed');
  return data;
}

export async function getChatHistory(plan_id) {
  const res = await apiFetch(`${BASE_URL}/api/chat/${plan_id}`, { headers: authHeaders() });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to get chat history');
  return data;
}

// Sends a conversational message; Claude replies without regenerating the full plan
export async function sendChatMessage(plan_id, message, onChunk) {
  const res = await fetch(`${BASE_URL}/api/chat/${plan_id}`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ message }),
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'Failed to send message');
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const jsonStr = line.slice(6).trim();
      if (!jsonStr) continue;
      let evt;
      try { evt = JSON.parse(jsonStr); } catch { continue; }
      if (evt.type === 'chunk' && onChunk) onChunk(evt.text);
      if (evt.type === 'error') throw new Error(evt.error || 'Chat failed');
    }
  }
}

export async function getClientInfo(plan_id) {
  const res = await apiFetch(`${BASE_URL}/api/client-info/${plan_id}`, { headers: authHeaders() });
  const data = await res.json();
  if (!res.ok) return {};
  return data;
}

export async function saveClientInfo(plan_id, data) {
  const res = await fetch(`${BASE_URL}/api/client-info/${plan_id}`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({ data }),
  });
  return res.json();
}

export async function extractInsuranceTemplateDocument(file) {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(`${BASE_URL}/api/insurance-templates/extract`, {
    method: 'POST',
    headers: authHeadersNoContentType(),
    body: formData,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Extraction failed');
  return data;
}

// ---- INSURANCE TEMPLATES ----

export async function getInsuranceTemplates() {
  const res = await apiFetch(`${BASE_URL}/api/insurance-templates`, { headers: authHeaders() });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to get insurance templates');
  return data;
}

export async function getInsuranceTemplate(id) {
  const res = await apiFetch(`${BASE_URL}/api/insurance-templates/${id}`, { headers: authHeaders() });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to get template');
  return data;
}

export async function createInsuranceTemplate(name, text) {
  const res = await fetch(`${BASE_URL}/api/insurance-templates`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify({ name, text }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to create template');
  return data;
}

export async function getInsuranceTemplateVersions(id) {
  const res = await apiFetch(`${BASE_URL}/api/insurance-templates/${id}/versions`, { headers: authHeaders() });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to get versions');
  return data;
}

export async function restoreInsuranceTemplateVersion(templateId, versionId) {
  const res = await fetch(`${BASE_URL}/api/insurance-templates/${templateId}/versions/${versionId}/restore`, {
    method: 'POST', headers: authHeaders(),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to restore version');
  return data;
}

export async function updateInsuranceTemplate(id, name, text) {
  const res = await fetch(`${BASE_URL}/api/insurance-templates/${id}`, {
    method: 'PUT', headers: authHeaders(), body: JSON.stringify({ name, text }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to update template');
  return data;
}

export async function deleteInsuranceTemplate(id) {
  const res = await fetch(`${BASE_URL}/api/insurance-templates/${id}`, {
    method: 'DELETE', headers: authHeaders(),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to delete template');
  return data;
}

// ---- COMPLIANCE CHECKS ----

export async function extractCompliancePlan(file) {
  const formData = new FormData();
  formData.append('file', file);
  const headers = authHeaders();
  delete headers['Content-Type']; // let browser set multipart boundary
  const res = await fetch(`${BASE_URL}/api/compliance/extract`, {
    method: 'POST',
    headers,
    body: formData,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to extract plan text');
  return data; // { text, filename, chars }
}

export async function getComplianceChecks() {
  const res = await apiFetch(`${BASE_URL}/api/compliance/checks`, { headers: authHeaders() });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to get compliance checks');
  return data;
}

export async function sendComplianceChatMessage(check_result, messages, document_name, onChunk) {
  const res = await fetch(`${BASE_URL}/api/compliance/chat`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ check_result, messages, document_name }),
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'Compliance chat failed');
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const jsonStr = line.slice(6).trim();
      if (!jsonStr) continue;
      let evt;
      try { evt = JSON.parse(jsonStr); } catch { continue; }
      if (evt.type === 'chunk' && onChunk) onChunk(evt.text);
      if (evt.type === 'error') throw new Error(evt.error || 'Chat failed');
    }
  }
}

export async function runComplianceCheck(plan_text, template_id, document_name, onChunk) {
  const res = await fetch(`${BASE_URL}/api/compliance/check`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ plan_text, template_id, document_name }),
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'Failed to run compliance check');
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let check_id = null;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const jsonStr = line.slice(6).trim();
      if (!jsonStr) continue;
      let evt;
      try { evt = JSON.parse(jsonStr); } catch { continue; }
      if (evt.type === 'chunk' && onChunk) onChunk(evt.text);
      if (evt.type === 'done') check_id = evt.check_id;
      if (evt.type === 'error') throw new Error(evt.error || 'Compliance check failed');
    }
  }
  return { check_id };
}

// Regenerates the full plan incorporating all chat feedback (SSE streaming)
export async function chatRevisePlan(plan_id) {
  const res = await fetch(`${BASE_URL}/api/chat/${plan_id}/targeted-revise`, {
    method: 'POST',
    headers: authHeaders(),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to revise plan');
  return { revision_number: data.revision_number };
}

export async function regeneratePlan(plan_id, onChunk) {
  const res = await fetch(`${BASE_URL}/api/chat/${plan_id}/regenerate`, {
    method: 'POST',
    headers: authHeaders(),
  });
  if (!res.ok) {
    let errMsg = 'Failed to regenerate plan';
    try { const d = await res.json(); errMsg = d.error || errMsg; } catch {}
    throw new Error(errMsg);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let revision_number = null;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const jsonStr = line.slice(6).trim();
      if (!jsonStr) continue;
      let evt;
      try { evt = JSON.parse(jsonStr); } catch { continue; }
      if (evt.type === 'chunk' && onChunk) onChunk(evt.text);
      if (evt.type === 'done') revision_number = evt.revision_number;
      if (evt.type === 'error') throw new Error(evt.error || 'Regeneration failed');
    }
  }
  if (revision_number == null) throw new Error('Regeneration stream ended without confirmation. Please try again.');
  return { revision_number };
}
