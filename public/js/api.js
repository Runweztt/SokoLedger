// Small fetch wrapper: attaches the JWT, normalizes error handling. No
// framework, no build step, this file is loaded directly as a script.
const SokoAPI = (() => {
  const TOKEN_KEY = 'sokoledger_token';
  const USERNAME_KEY = 'sokoledger_username';

  function getToken() {
    return localStorage.getItem(TOKEN_KEY);
  }

  function setSession(token, username) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USERNAME_KEY, username);
  }

  function clearSession() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USERNAME_KEY);
  }

  function getUsername() {
    return localStorage.getItem(USERNAME_KEY);
  }

  class ApiError extends Error {
    constructor(message, status) {
      super(message);
      this.status = status;
    }
  }

  // Generous enough to cover a slow-but-working AI parse (the backend's own
  // RapidAPI timeout is 28s, see server/src/services/parser.js) without ever
  // leaving a button stuck disabled forever if the network actually hangs.
  const DEFAULT_TIMEOUT_MS = 40000;

  async function request(path, { method = 'GET', body, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    const headers = {};
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    let response;
    try {
      response = await fetch(path, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new ApiError('That took too long. Check your connection and try again.', 0);
      }
      throw new ApiError('Could not reach the server. Check your connection and try again.', 0);
    } finally {
      clearTimeout(timeout);
    }

    if (response.status === 401) {
      clearSession();
      window.dispatchEvent(new CustomEvent('sokoledger:unauthorized'));
    }

    const contentType = response.headers.get('content-type') || '';
    const data = contentType.includes('application/json') ? await response.json() : null;

    if (!response.ok) {
      throw new ApiError((data && data.error) || `Request failed (${response.status})`, response.status);
    }
    return data;
  }

  async function download(path, filename) {
    const headers = {};
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;

    const response = await fetch(path, { headers });
    if (!response.ok) {
      throw new ApiError(`Export failed (${response.status})`, response.status);
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  return { request, download, getToken, setSession, clearSession, getUsername, ApiError };
})();
