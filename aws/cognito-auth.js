/**
 * ============================================================================
 * FINANCE ME - Lightweight Amazon Cognito Client (Zero-Dependency REST API)
 * Direct browser-native integration with Amazon Cognito User Pools
 * ============================================================================
 */

class CognitoAuthService {
  constructor(config = {}) {
    this.region = config.region || 'us-east-1';
    this.userPoolId = config.userPoolId || '';
    this.clientId = config.clientId || '';
    this.endpoint = `https://cognito-idp.${this.region}.amazonaws.com/`;
    this.storageKey = 'finance_me_aws_session';
  }

  init(config) {
    if (config.region) this.region = config.region;
    if (config.userPoolId) this.userPoolId = config.userPoolId;
    if (config.clientId) this.clientId = config.clientId;
    this.endpoint = `https://cognito-idp.${this.region}.amazonaws.com/`;
  }

  isConfigured() {
    return Boolean(this.userPoolId && this.clientId && this.userPoolId.length > 5 && this.clientId.length > 5);
  }

  async _call(target, payload) {
    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-amz-json-1.1',
        'X-Amz-Target': `AWSCognitoIdentityProviderService.${target}`
      },
      body: JSON.stringify(payload)
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      const errType = (data.__type || '').split('#').pop() || 'AuthError';
      const errMsg = data.message || data.Message || 'Authentication request failed.';
      const err = new Error(errMsg);
      err.code = errType;
      throw err;
    }

    return data;
  }

  // Parse JWT token without external libraries
  parseJwt(token) {
    if (!token) return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    try {
      const base64Url = parts[1];
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
      const jsonPayload = decodeURIComponent(
        atob(base64)
          .split('')
          .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
          .join('')
      );
      return JSON.parse(jsonPayload);
    } catch (e) {
      console.warn('Failed to parse JWT:', e);
      return null;
    }
  }

  // Register new user
  async signUp({ email, password, name }) {
    if (!this.isConfigured()) throw new Error('AWS Cognito is not yet configured.');

    const userAttributes = [
      { Name: 'email', Value: email }
    ];
    if (name) {
      userAttributes.push({ Name: 'name', Value: name });
    }

    const payload = {
      ClientId: this.clientId,
      Username: email,
      Password: password,
      UserAttributes: userAttributes
    };

    const res = await this._call('SignUp', payload);
    return res;
  }

  // Sign in with email and password
  async signIn({ email, password }) {
    if (!this.isConfigured()) throw new Error('AWS Cognito is not yet configured.');

    const payload = {
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: this.clientId,
      AuthParameters: {
        USERNAME: email,
        PASSWORD: password
      }
    };

    const res = await this._call('InitiateAuth', payload);
    const authResult = res.AuthenticationResult;

    if (!authResult) {
      throw new Error(res.ChallengeName ? `Challenge required: ${res.ChallengeName}` : 'Sign in failed');
    }

    const session = this._saveSession(authResult, email);
    return session;
  }

  // Refresh access & ID tokens using refresh token
  async refreshToken() {
    const existing = this.getSession();
    if (!existing || !existing.refreshToken) return null;

    try {
      const payload = {
        AuthFlow: 'REFRESH_TOKEN_AUTH',
        ClientId: this.clientId,
        AuthParameters: {
          REFRESH_TOKEN: existing.refreshToken
        }
      };

      const res = await this._call('InitiateAuth', payload);
      const authResult = res.AuthenticationResult;
      if (authResult) {
        return this._saveSession({
          ...authResult,
          RefreshToken: authResult.RefreshToken || existing.refreshToken
        }, existing.user.email);
      }
    } catch (err) {
      console.warn('[Cognito Refresh Failed]:', err.message);
      this.signOut();
    }
    return null;
  }

  _saveSession(authResult, fallbackEmail = '') {
    const idToken = authResult.IdToken;
    const accessToken = authResult.AccessToken;
    const refreshToken = authResult.RefreshToken;
    const claims = this.parseJwt(idToken) || {};

    const session = {
      accessToken,
      idToken,
      refreshToken,
      expiresAt: (claims.exp ? claims.exp * 1000 : Date.now() + (authResult.ExpiresIn || 3600) * 1000),
      user: {
        id: claims.sub || claims['cognito:username'] || 'user',
        email: claims.email || fallbackEmail,
        name: claims.name || fallbackEmail.split('@')[0] || 'User',
        claims
      }
    };

    localStorage.setItem(this.storageKey, JSON.stringify(session));
    return session;
  }

  getSession() {
    const raw = localStorage.getItem(this.storageKey);
    if (!raw) return null;
    try {
      const session = JSON.parse(raw);
      // If token expired, attempt refresh if refresh token exists
      if (session.expiresAt && Date.now() > session.expiresAt - 60000) {
        // Will refresh asynchronously on next request
        this.refreshToken().catch(() => {});
      }
      return session;
    } catch (e) {
      return null;
    }
  }

  getUser() {
    const session = this.getSession();
    return session ? session.user : null;
  }

  getIdToken() {
    const session = this.getSession();
    return session ? session.idToken : null;
  }

  async signOut() {
    const session = this.getSession();
    if (session && session.accessToken) {
      try {
        await this._call('GlobalSignOut', { AccessToken: session.accessToken });
      } catch (e) {
        // Ignore network signout errors, clear locally anyway
      }
    }
    localStorage.removeItem(this.storageKey);
  }
}

// Global instance attached to window
window.cognitoAuth = new CognitoAuthService();
