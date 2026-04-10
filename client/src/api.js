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
  const res = await fetch(`${BASE_URL}/api/me`, {
    headers: authHeaders(),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to get user');
  return data;
}

export async function generatePlan(notes) {
  const res = await fetch(`${BASE_URL}/api/generate`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ notes }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to generate plan');
  return data;
}

export async function revisePlan(plan_id, feedback) {
  const res = await fetch(`${BASE_URL}/api/revise`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ plan_id, feedback }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to revise plan');
  return data;
}

export async function getPlanRevisions(plan_id) {
  const res = await fetch(`${BASE_URL}/api/plan/${plan_id}/revisions`, {
    headers: authHeaders(),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to get revisions');
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
  const res = await fetch(`${BASE_URL}/api/plans`, { headers: authHeaders() });
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

export async function getClientDocuments(id) {
  const res = await fetch(`${BASE_URL}/api/clients/${id}/documents`, { headers: authHeaders() });
  return res.json();
}

export async function uploadClientDocument(id, file) {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(`${BASE_URL}/api/clients/${id}/documents`, { method: 'POST', headers: authHeadersNoContentType(), body: formData });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Upload failed');
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
