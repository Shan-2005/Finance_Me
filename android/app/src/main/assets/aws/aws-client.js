/**
 * ============================================================================
 * FINANCE ME - AWS Client Adapter (Self-Contained Auth + DynamoDB CRUD)
 * Zero external libraries: Communicates with your AWS Lambda Function URL
 * ============================================================================
 */

window.awsApi = {
  storageKey: 'finance_me_aws_auth',

  isEnabled() {
    return Boolean(
      typeof window !== 'undefined' &&
      window.AWS_CONFIG &&
      window.AWS_CONFIG.enabled &&
      window.AWS_CONFIG.lambdaFunctionUrl &&
      window.AWS_CONFIG.lambdaFunctionUrl.startsWith('http')
    );
  },

  getBaseUrl() {
    let url = (window.AWS_CONFIG && window.AWS_CONFIG.lambdaFunctionUrl) ? window.AWS_CONFIG.lambdaFunctionUrl.trim() : '';
    if (url.endsWith('/')) url = url.slice(0, -1);
    return url;
  },

  getSession() {
    const raw = localStorage.getItem(this.storageKey);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  },

  getUser() {
    const session = this.getSession();
    return session ? session.user : null;
  },

  getToken() {
    const session = this.getSession();
    return session ? session.token : null;
  },

  getAuthHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    const token = this.getToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    const user = this.getUser();
    if (user && user.id) {
      headers['X-User-Id'] = user.id;
    }
    return headers;
  },

  // --------------------------------------------------------------------------
  // AUTHENTICATION
  // --------------------------------------------------------------------------
  async register({ email, password, name }) {
    const res = await fetch(`${this.getBaseUrl()}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, name })
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Registration failed');

    if (data.token && data.user) {
      localStorage.setItem(this.storageKey, JSON.stringify({
        token: data.token,
        user: data.user
      }));
    }
    return data;
  },

  async login({ email, password }) {
    const res = await fetch(`${this.getBaseUrl()}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Login failed');

    if (data.token && data.user) {
      localStorage.setItem(this.storageKey, JSON.stringify({
        token: data.token,
        user: data.user
      }));
    }
    return data;
  },

  logout() {
    localStorage.removeItem(this.storageKey);
  },

  // --------------------------------------------------------------------------
  // TRANSACTIONS CRUD
  // --------------------------------------------------------------------------
  async fetchTransactions() {
    const res = await fetch(`${this.getBaseUrl()}/api/transactions`, {
      headers: this.getAuthHeaders()
    });
    if (!res.ok) {
      if (res.status === 401) {
        this.logout();
        throw new Error('Session expired. Please log in again.');
      }
      throw new Error(`AWS fetch failed: ${res.status}`);
    }
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  },

  async saveTransaction(txn) {
    const res = await fetch(`${this.getBaseUrl()}/api/transactions`, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify(txn)
    });
    if (!res.ok) throw new Error(`AWS save failed: ${res.status}`);
    return await res.json();
  },

  async deleteTransaction(id) {
    const res = await fetch(`${this.getBaseUrl()}/api/transactions?id=${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: this.getAuthHeaders()
    });
    if (!res.ok) throw new Error(`AWS delete failed: ${res.status}`);
    return await res.json();
  },

  async clearAllTransactions() {
    const res = await fetch(`${this.getBaseUrl()}/api/transactions?clear_all=true`, {
      method: 'DELETE',
      headers: this.getAuthHeaders()
    });
    if (!res.ok) throw new Error(`AWS clear failed: ${res.status}`);
    return await res.json();
  }
};
